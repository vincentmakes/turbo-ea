# سلسلة التوريد

اعتبارًا من الإصدار 1.0.0 فصاعدًا، تحمل صور الحاويات التي ينشرها Turbo EA إلى GHCR بيانات وصفية قابلة للتحقّق لسلسلة التوريد، حتى يتمكّن المشغّلون من التأكّد من أن الصورة صادرة من نظام CI الخاص بهذا المشروع قبل سحبها إلى بيئة الإنتاج.

تغطّي هذه الصفحة ما الذي يُوقَّع، وكيفية التحقّق منه، وأين يوجد ملف SBOM، وكيف يندرج فحص Trivy (المعلوماتي حاليًا) ضمن ذلك.

---

## ما الذي يُوقَّع

كل صورة يبنيها `.github/workflows/docker-publish.yml` وتُدفَع إلى `ghcr.io/vincentmakes/turbo-ea/<image>` تُوقَّع باستخدام [cosign](https://github.com/sigstore/cosign) عبر **keyless OIDC**: لا يوجد مفتاح توقيع طويل الأمد. تُصدَر الشهادة من Fulcio التابع لـ Sigstore لهوية سير العمل (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`)، وتُسجَّل في سجل الشفافية العام Rekor، ثم تُتلَف بمجرد إنشاء التوقيع.

الصور الموقَّعة:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

تُعاد بناء صورة `ollama` يدويًا خارج المصفوفة وهي غير موقَّعة حاليًا؛ إذا كنت تعتمد على ملف Ollama المُجمَّع وتحتاج إلى التحقّق، فابنِها من المصدر.

ينطبق التوقيع على هضم (digest) قائمة بيان OCI، لذا فإن توقيعًا واحدًا يغطّي بشفافية كلًّا من `linux/amd64` و`linux/arm64`. لا يوجد توقيع منفصل لكل منصّة يلزم تتبّعه.

---

## التحقّق من صورة

ثبّت [cosign](https://docs.sigstore.dev/cosign/installation/)، ثم:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:1.0.0
```

ما الذي تفعله الرايات:

- `--certificate-identity-regexp` — يقبل أي مسار لسير العمل داخل هذا المستودع، فيعمل الأمر نفسه سواء نُشِرت الصورة من `docker-publish.yml` على `main` أو على وسم. إذا أردت تشديدًا أكبر، استبدله بـ `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v1.0.0'`.
- `--certificate-oidc-issuer` — يثبّت مُصدِر OIDC على نقطة طرف الرمز الخاصة بـ GitHub. أي توقيع صادر من مُصدِر آخر (مثل CI الخاص بنسخة منشقّة) سيفشل في التحقّق.

يطبع التحقّق الناجح الحمولة الموقَّعة وعنوان URL لإدخال في سجل شفافية Rekor. أما الفشل فيخرج بقيمة غير صفرية مع تشخيص — اجعل عملية النشر تفشل عند حدوثه.

يمكنك أيضًا التحقّق عبر الهضم (digest)، وهو أصرم صيغة (محصّن ضد إعادة تخطيط الوسوم):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:1.0.0 --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## SBOM

تُنشَأ قائمة بمكوّنات البرمجيات بصيغة [SPDX](https://spdx.dev/) تلقائيًا بواسطة buildkit (`sbom: true` في خطوة البناء) وتُرفَق بكل صورة كمُحيل OCI. لا يلزم تثبيت أي شيء إضافي — فهي توجد في السجلّ بجانب الصورة.

اسحبها بـ:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:1.0.0 | jq .
```

يسرد ملف SBOM كل حزمة رصدها buildkit في الصورة النهائية (حزم apk، وعجلات Python، ووحدات Node، وغيرها) مع الإصدارات وعناوين URL للمصادر. وهو مدخل مفيد لأداة فحص الثغرات الخاصة بك، أو أدوات الامتثال للتراخيص، أو جرد المكوّنات.

---

## فحص الثغرات (Trivy)

يشغّل سير عمل النشر [Trivy](https://github.com/aquasecurity/trivy) على كل صورة مبنيّة بحثًا عن ثغرات CVE من الفئتين HIGH وCRITICAL، ويرفع النتيجة بصيغة SARIF إلى تبويب **Security** الخاص بالمستودع في GitHub.

الفحص حاليًا **غير حاجب** (`exit-code: 0`). الأسباب:

- القواعد قائمة على alpine (`python:3.12-alpine`، و`postgres:18-alpine`، و`nginx:alpine`). تحمل صور alpine بانتظام نتائج أساسية مقابل musl-libc واعتماديات apk الانتقالية — كثير منها غير قابل للوصول عبر أي مسار يستخدمه Turbo EA فعليًا، لكن Trivy يبلّغ عنها على أي حال.
- معاملة تلك النتائج كحالات فشل صارمة من اليوم الأول سيحجب كل عملية نشر دون إعطاء المشغّلين وقتًا للتفاعل. الخطة المرحلية هي: إطلاق فحوص معلوماتية، والتقاط الأساس في `.github/trivy-allowlist.yaml` مع تبرير لكل CVE، *ثم* تحويل البوابة إلى الوضع الإلزامي.

**للمشغّلين:** إذا كانت نتائج Trivy مهمّة لعملية النشر لديك، فشغّل أداة الفحص الخاصة بك على الصورة المسحوبة. ملف SBOM المنشور مدخل نظيف. لا تعتمد على أن تكون البوابة الأصلية إلزامية بعد.

**للمساهمين:** إذا اكتشفت نتيجة قابلة للاستغلال فعليًا في أحد مسارات استخدام Turbo EA، فالرجاء الإبلاغ عنها عبر [استشارة أمنية خاصة](https://github.com/vincentmakes/turbo-ea/security/advisories/new) بدلًا من التعليق في مشكلة عامة. راجع [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## تثبيت SHA للإجراءات

كل GitHub Action يستخدمه سير عمل النشر مثبَّت على هضم التزام (commit SHA) مكوّن من 40 حرفًا، وليس على وسم رئيسي متغيّر. هذا يعني أن مشرفًا مُختَرَقًا في المنبع أو هجوم انتحال طباعي لا يمكنه تغيير ما يُشغَّل في نظام CI لدينا بصمت دون فارق مرئي في هذا المستودع. تتدفّق التحديثات عبر نظام `github-actions` التابع لـ Dependabot على وتيرة شهرية حتى تستمر عمليات التحديث — لكنها تمرّ عبر المراجعة.
