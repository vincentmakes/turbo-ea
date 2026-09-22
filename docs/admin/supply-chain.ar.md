# سلسلة التوريد

اعتبارًا من الإصدار 1.0.0 فصاعدًا، تحمل صور الحاويات التي ينشرها Turbo EA إلى GHCR بيانات وصفية قابلة للتحقّق لسلسلة التوريد، حتى يتمكّن المشغّلون من التأكّد من أن الصورة صادرة من نظام CI الخاص بهذا المشروع قبل سحبها إلى بيئة الإنتاج.

تغطّي هذه الصفحة ما الذي يُوقَّع، وأي إصدار من cosign تحتاج إليه، وكيفية التحقّق من صورة ومن مخطط Helm، وأين يوجد ملف SBOM، وكيف تندرج بوّابة Trivy ضمن ذلك.

---

## ما الذي يُوقَّع

كل صورة يبنيها `.github/workflows/docker-publish.yml` وتُدفَع إلى `ghcr.io/vincentmakes/turbo-ea/<image>` تُوقَّع باستخدام [cosign](https://github.com/sigstore/cosign) عبر **keyless OIDC**: لا يوجد مفتاح توقيع طويل الأمد. تُصدَر الشهادة من Fulcio التابع لـ Sigstore لهوية سير العمل (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`)، وتُسجَّل في سجل الشفافية العام Rekor، ثم تُتلَف بمجرد إنشاء التوقيع.

الصور الموقَّعة:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

يُوقَّع مخطط Helm، `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`، بالطريقة نفسها بواسطة `.github/workflows/helm-publish.yml` عند كل وسم إصدار (الهوية `…/helm-publish.yml@<ref>`).

تُعاد بناء صورة `ollama` يدويًا خارج المصفوفة وهي غير موقَّعة حاليًا؛ إذا كنت تعتمد على ملف Ollama المُجمَّع وتحتاج إلى التحقّق، فابنِها من المصدر.

ينطبق التوقيع على هضم (digest) قائمة بيان OCI، لذا فإن توقيعًا واحدًا يغطّي بشفافية كلًّا من `linux/amd64` و`linux/arm64`. لا يوجد توقيع منفصل لكل منصّة يلزم تتبّعه.

---

## صيغة التوقيع وإصدار cosign المطلوب

**تحقّق باستخدام cosign 2.6 أو أحدث، أو أي إصدار 3.x.** العملاء الأقدم — cosign 2.5 وما دونه — يُبلّغون عن `no signatures found` لكل صورة ومخطط نُشِر منذ الإصدار 1.37.0، رغم أن التوقيع موجود.

السبب هو تغيير في صيغة التخزين، لا في التوقيع نفسه. حتى الإصدار 1.36.0 كان سير عمل النشر يشغّل cosign 2، الذي كان يخزّن التوقيع تحت الوسم `sha256-<digest>.sig` بجوار الصورة. ومنذ الإصدار 1.37.0 (يونيو 2026، عندما انتقل مثبِّت cosign إلى cosign 3) أصبح التوقيع [حزمة Sigstore](https://docs.sigstore.dev/about/bundle/): أي *referrer* وفق OCI 1.1 للصورة. لا يطبّق GHCR واجهة referrers API، لذا يحتفظ cosign بالحزمة تحت وسم الفهرس الاحتياطي `sha256-<digest>` — دون لاحقة `.sig` — وهو تحديدًا المكان الذي لا ينظر فيه أبدًا أي عميل أقدم من 2.6. يعرض الأمر `cosign tree` ما هو مُلحَق بالصورة:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| الإصدارات | صيغة التوقيع | يمكن التحقّق منه باستخدام |
|-----------|--------------|---------------------------|
| 1.0.0 – 1.36.0 | الوسم القديم `sha256-<digest>.sig` | أي cosign |
| 1.37.0 وما بعده، وكل مخططات Helm | حزمة Sigstore (OCI referrer) | cosign ≥ 2.6 أو 3.x |

تتحقّق كل عملية نشر الآن من توقيعها الخاص باستخدام cosign 2.6 — أقدم عميل تَعِد به هذه الصفحة — قبل أن تصبح المهمة خضراء، وبذلك فإن أي تغيير مستقبلي في الصيغة سيُفشِل CI بدلًا من أن يُفشِل عملية النشر لديك. يُصدِر المشروع عن قصد توقيعًا واحدًا فقط بصيغة Sigstore الحالية: إذا كان متحكّم القبول أو محرّك السياسات في عنقودك لا يزال يقرأ الوسم القديم فقط، فقم بتحديثه بدلًا من انتظار توقيع ثانٍ.

---

## التحقّق من صورة

ثبّت [cosign](https://docs.sigstore.dev/cosign/installation/) بالإصدار 2.6 أو أحدث، ثم:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

ما الذي تفعله الرايات:

- `--certificate-identity-regexp` — يقبل أي مسار لسير العمل داخل هذا المستودع، فيعمل الأمر نفسه سواء نُشِرت الصورة من `docker-publish.yml` على `main` أو على وسم. إذا أردت تشديدًا أكبر، استبدله بـ `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — يثبّت مُصدِر OIDC على نقطة طرف الرمز الخاصة بـ GitHub. أي توقيع صادر من مُصدِر آخر (مثل CI الخاص بنسخة منشقّة) سيفشل في التحقّق.

يطبع التحقّق الناجح الحمولة الموقَّعة وإدخالًا في سجل شفافية Rekor. أما الفشل فيخرج بقيمة غير صفرية مع تشخيص — اجعل عملية النشر تفشل عند حدوثه. إذا كان التشخيص `no signatures found`، فتحقّق أولًا من `cosign version`: راجع القسم أعلاه.

يمكنك أيضًا التحقّق عبر الهضم (digest)، وهو أصرم صيغة (محصّن ضد إعادة تخطيط الوسوم):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## التحقّق من مخطط Helm

المخطط عبارة عن أداة OCI في السجلّ نفسه ويُتحقَّق منه بالأمر نفسه:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

استثناء واحد في هوية الوسم: المخطط `2.141.0`، وهو أول إصدار للمخطط، دُفِع دون توقيع (فشلت خطوة توقيعه في المصادقة مع السجلّ) ثم وُقِّع لاحقًا من الفرع `main`، لذا فإن هوية شهادته هي `…/helm-publish.yml@refs/heads/main` وليست مرجعًا لوسم. يقبل التعبير النمطي أعلاه كلتيهما؛ أما `--certificate-identity` الصارمة فيجب أن تذكر `refs/heads/main` لهذا الإصدار وحده.

---

## SBOM

تُنشَأ قائمة بمكوّنات البرمجيات بصيغة [SPDX](https://spdx.dev/) تلقائيًا بواسطة buildkit (`sbom: true` في خطوة البناء) وتُرفَق بكل صورة كمُحيل OCI. لا يلزم تثبيت أي شيء إضافي — فهي توجد في السجلّ بجانب الصورة.

اسحبها بـ:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

يسرد ملف SBOM كل حزمة رصدها buildkit في الصورة النهائية (حزم apk، وعجلات Python، ووحدات Node، وغيرها) مع الإصدارات وعناوين URL للمصادر. وهو مدخل مفيد لأداة فحص الثغرات الخاصة بك، أو أدوات الامتثال للتراخيص، أو جرد المكوّنات.

---

## فحص الثغرات (Trivy)

يشغّل سير عمل النشر [Trivy](https://github.com/aquasecurity/trivy) على كل صورة مبنيّة في خطوتين:

- **المراقبة** — تُرفَع نتائج HIGH وCRITICAL بصيغة SARIF إلى تبويب **Security** الخاص بالمستودع في GitHub. لا تُفشِل هذه الخطوة المهمة أبدًا.
- **البوّابة** — أي نتيجة CRITICAL لها إصلاح متاح **تُفشِل عملية النشر**، ما لم تكن الثغرة CVE مدرجة في `.github/trivy-allowlist` مع تبرير مكتوب (يُعاد تقييم كل إدخال كل ربع سنة ويُحذَف بمجرد أن يُصدِر المنبع تصحيحًا).

تُعاد الخطوتان نفساهما يوميًا على بيانات `:latest` المنشورة فعليًا، وأي نتيجة HIGH أو CRITICAL قابلة للإصلاح في صورة منشورة تُطلِق إعادة بناء على مستودعات Alpine محدَّثة. تبقى نتائج HIGH حاليًا في وضع المراقبة فقط: القواعد قائمة على alpine (`python:3.12-alpine`، و`postgres:18-alpine`، و`nginx:alpine`) وتحمل بانتظام نتائج أساسية مقابل musl-libc واعتماديات apk الانتقالية لا يصل إليها أي مسار من شيفرة Turbo EA، لكن Trivy يبلّغ عنها على أي حال.

**للمشغّلين:** تحمي البوّابة الصور المنشورة، لكن شغّل أداة الفحص الخاصة بك على الصورة المسحوبة أيضًا — فقد تختلف سياستك عن سياستنا. ملف SBOM المنشور مدخل نظيف.

**للمساهمين:** إذا اكتشفت نتيجة قابلة للاستغلال فعليًا في أحد مسارات استخدام Turbo EA، فالرجاء الإبلاغ عنها عبر [استشارة أمنية خاصة](https://github.com/vincentmakes/turbo-ea/security/advisories/new) بدلًا من التعليق في مشكلة عامة. راجع [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## تثبيت SHA للإجراءات

كل GitHub Action يستخدمه سير عمل النشر مثبَّت على هضم التزام (commit SHA) مكوّن من 40 حرفًا، وليس على وسم رئيسي متغيّر. هذا يعني أن مشرفًا مُختَرَقًا في المنبع أو هجوم انتحال طباعي لا يمكنه تغيير ما يُشغَّل في نظام CI لدينا بصمت دون فارق مرئي في هذا المستودع. تتدفّق التحديثات عبر نظام `github-actions` التابع لـ Dependabot على وتيرة شهرية حتى تستمر عمليات التحديث — لكنها تمرّ عبر المراجعة.
