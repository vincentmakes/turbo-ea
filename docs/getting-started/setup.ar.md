# التثبيت والإعداد

يرشدك هذا الدليل خلال تثبيت Turbo EA باستخدام Docker، وتهيئة البيئة، وتحميل بيانات العرض التوضيحي، وبدء خدمات اختيارية مثل اقتراحات الذكاء الاصطناعي وخادم MCP.

## المتطلّبات المسبقة

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

نحو 2 جيجابايت من مساحة القرص الحرّة، وبضع دقائق من النطاق الترددي لأول سحب للصور، ومنفذان `8920` (HTTP) واختياريًا `9443` (HTTPS) متاحان على المضيف.

## الخطوة 1: الحصول على التهيئة

تحتاج إلى ملف `docker-compose.yml` وملف `.env` مُهيّأ في دليل عمل. أبسط طريقة هي استنساخ المستودع:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

افتح `.env` واضبط القيمتين المطلوبتين:

```dotenv
# PostgreSQL credentials (used by the embedded database container).
# Choose a strong password — it persists in the bundled volume.
POSTGRES_PASSWORD=choose-a-strong-password

# JWT signing key. Generate one with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

كل ما تبقّى في `.env.example` له قيم افتراضية معقولة.

!!! note
    ترفض الواجهة الخلفية البدء بقيمة `SECRET_KEY` الافتراضية في المثال خارج بيئة التطوير. أنشئ قيمة حقيقية قبل المضيّ قدمًا.

## الخطوة 2: السحب والبدء

تعمل الحزمة المُجمَّعة (Postgres + الواجهة الخلفية + الواجهة الأمامية + edge nginx) من صور متعدّدة المعماريات مبنيّة مسبقًا على GHCR — دون الحاجة إلى بناء محلي:

```bash
docker compose pull
docker compose up -d
```

افتح **http://localhost:8920** وسجّل أول مستخدم. تُرقّى أول مستخدم يسجّل تلقائيًا إلى **Admin**.

لتغيير منفذ المضيف، اضبط `HOST_PORT` في `.env` (الافتراضي `8920`). تُغطّى تهيئة HTTPS المباشرة في [الخطوة 5](#step-5-direct-https-optional).

## الخطوة 3: تحميل بيانات العرض التوضيحي (اختياري)

يمكن أن يبدأ Turbo EA فارغًا (بالنموذج الفوقي المُضمَّن فقط) أو مع مجموعة بيانات العرض التوضيحي **NexaTech Industries**، وهي مثالية للتقييم والتدريب واستكشاف الميزات.

اضبط راية البذر في `.env` **قبل أول تشغيل**:

```dotenv
SEED_DEMO=true
```

ثم نفّذ `docker compose up -d` (إذا كنت قد بدأت بالفعل، فراجع «إعادة الضبط وإعادة البذر» أدناه).

### رايات البذر

| المتغيّر | الافتراضي | الوصف |
|----------|---------|-------------|
| `SEED_DEMO` | `false` | تحميل مجموعة بيانات NexaTech Industries الكاملة، بما في ذلك بيانات BPM وPPM |
| `SEED_BPM` | `false` | تحميل عمليات العرض التوضيحي لـ BPM فقط (مجموعة فرعية من `SEED_DEMO`) |
| `SEED_PPM` | `false` | تحميل بيانات مشاريع PPM فقط (مجموعة فرعية من `SEED_DEMO`) |
| `RESET_DB` | `false` | إسقاط كل الجداول وإعادة إنشائها من الصفر عند البدء |

يتضمّن `SEED_DEMO=true` بالفعل بيانات BPM وPPM — لا تحتاج إلى ضبط رايات المجموعات الفرعية بشكل منفصل.

### حساب المسؤول التجريبي

عند تحميل بيانات العرض التوضيحي، يُنشأ حساب مسؤول افتراضي:

| الحقل | القيمة |
|-------|-------|
| **Email** | `admin@turboea.demo` |
| **Password** | `TurboEA!2025` |
| **Role** | Admin |

!!! warning
    يستخدم المسؤول التجريبي بيانات اعتماد معروفة وعامة. غيّر كلمة المرور — أو أنشئ حساب مسؤول خاصًا بك وعطّل هذا — لأي بيئة تتجاوز التقييم المحلي.

### ما يتضمّنه العرض التوضيحي

نحو 150 بطاقة عبر طبقات الهندسة الأربع جميعها، بالإضافة إلى العلاقات والوسوم والتعليقات والمهام ومخطّطات BPM وبيانات PPM وسجلّات قرارات هندسة المؤسسة وبيان أعمال الهندسة:

- **هندسة المؤسسة الأساسية** — المنظمات، ونحو 20 قدرة أعمال، وسياقات الأعمال، ونحو 15 تطبيقًا، ونحو 20 مكوّنًا تقنيًا، والواجهات، وكائنات البيانات، والمنصّات، والأهداف، و6 مبادرات، و5 مجموعات وسوم، وأكثر من 60 علاقة.
- **BPM** — نحو 30 عملية أعمال في تسلسل هرمي من 4 مستويات مع مخطّطات BPMN 2.0، وروابط من العناصر إلى البطاقات، وتقييمات العمليات.
- **PPM** — تقارير الحالة، وهياكل تجزئة العمل، ونحو 60 مهمة، وبنود الميزانية والتكلفة، وسجل مخاطر عبر المبادرات التجريبية الست.
- **تسليم هندسة المؤسسة** — سجلّات قرارات هندسة المؤسسة وبيانات أعمال الهندسة.

### إعادة الضبط وإعادة البذر

لمسح قاعدة البيانات والبدء من جديد:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

أعد تشغيل الحزمة، ثم **أزل `RESET_DB=true` من `.env`** — تركها مضبوطة سيعيد ضبط قاعدة البيانات عند كل إعادة تشغيل:

```bash
docker compose up -d
# Verify the new data is there, then edit .env to remove RESET_DB
```

## الخطوة 4: الخدمات الاختيارية (ملفات تعريف Compose)

كلا الإضافتين اختياريتان عبر ملفات تعريف Docker Compose وتعملان جنبًا إلى جنب مع الحزمة الأساسية دون تعطيلها.

### اقتراحات أوصاف الذكاء الاصطناعي

أنشئ أوصاف البطاقات باستخدام LLM محلي (Ollama المُجمَّع) أو مزوّد تجاري. حاوية Ollama المُجمَّعة هي أسهل مسار للإعدادات المستضافة ذاتيًا.

أضِف إلى `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

ابدأ مع ملف تعريف `ai`:

```bash
docker compose --profile ai up -d
```

يُنزَّل النموذج تلقائيًا عند أول تشغيل (بضع دقائق، تبعًا لاتصالك). راجع [قدرات الذكاء الاصطناعي](../admin/ai.md) للحصول على مرجع التهيئة الكامل، بما في ذلك كيفية استخدام OpenAI / Gemini / Claude / DeepSeek بدلًا من Ollama المُجمَّع.

### خادم MCP

يتيح خادم MCP لأدوات الذكاء الاصطناعي — Claude Desktop وCursor وGitHub Copilot وغيرها — الاستعلام عن بيانات هندسة المؤسسة لديك عبر [Model Context Protocol](https://modelcontextprotocol.io/) مع RBAC لكل مستخدم. وهو للقراءة فقط.

```bash
docker compose --profile mcp up -d
```

راجع [تكامل MCP](../admin/mcp.md) لإعداد OAuth وتفاصيل الأدوات.

### كلاهما معًا

```bash
docker compose --profile ai --profile mcp up -d
```

## الخطوة 5: HTTPS المباشر (اختياري)

يمكن لـ edge nginx المُجمَّع إنهاء TLS بنفسه — وهو مفيد إذا لم يكن لديك وكيل عكسي خارجي. أضِف إلى `.env`:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

ضع `cert.pem` و`key.pem` في `./certs/` (يُركَّب الدليل للقراءة فقط داخل حاوية nginx). تشتقّ الصورة `server_name` والمخطّط المُمرَّر من `TURBO_EA_PUBLIC_URL`، وتخدم كلًّا من HTTP وHTTPS، وتعيد توجيه HTTP إلى HTTPS تلقائيًا.

للإعدادات خلف وكيل عكسي موجود (Caddy، Traefik، Cloudflare Tunnel)، اترك `TURBO_EA_TLS_ENABLED=false` ودع الوكيل يتولّى TLS.

## تثبيت إصدار

يعتمد `docker compose pull` افتراضيًا على `:latest`. لتثبيت إصدار محدّد في بيئة الإنتاج، اضبط `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

تُوسَم الإصدارات المُطلَقة بـ `:<full-version>` و`:<major>.<minor>` و`:<major>` و`:latest`. يستبعد سير عمل النشر وسوم الإصدارات المسبقة (`-rc.N`) من `:latest` ومن الوسوم القصيرة `:X.Y` / `:X`. راجع [الإصدارات](../reference/releases.md) للاطّلاع على شجرة الوسوم الكاملة وسياسة قناة الإصدارات المسبقة.

## استخدام PostgreSQL موجود

إذا كنت تشغّل بالفعل نسخة PostgreSQL مُدارة أو مشتركة، فوجّه الواجهة الخلفية إليها وتخطَّ خدمة `db` المُجمَّعة.

أنشئ قاعدة البيانات والمستخدم على خادمك الحالي:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

تجاوز متغيّرات الاتصال في `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

ثم ابدأ كالمعتاد: `docker compose up -d`. لا تزال خدمة `db` المُجمَّعة معرَّفة في `docker-compose.yml`؛ يمكنك إما تركها تعمل خاملة أو إيقافها صراحةً.

## التحقّق من الصور

اعتبارًا من `1.0.0` فصاعدًا، تُوقَّع كل صورة منشورة بـ cosign عبر keyless OIDC وتُشحَن مع SBOM بصيغة SPDX مُنشأة بواسطة buildkit. راجع [سلسلة التوريد](../admin/supply-chain.md) للحصول على أمر التحقّق وكيفية سحب SBOM من السجلّ.

## التطوير من المصدر

إذا أردت بناء الحزمة من المصدر (تعديل كود الواجهة الخلفية أو الأمامية)، فاستخدم تجاوز Compose للتطوير:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

أو الهدف الميسَّر:

```bash
make up-dev
```

يوجد دليل المطوّر الكامل — تسمية الفروع، وأوامر الفحص والاختبار، وفحوص ما قبل الالتزام — في [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## مرجع سريع

| السيناريو | الأمر |
|----------|---------|
| البدء لأول مرّة (بيانات فارغة) | `docker compose pull && docker compose up -d` |
| البدء لأول مرّة مع بيانات العرض التوضيحي | اضبط `SEED_DEMO=true` في `.env`، ثم الأمر نفسه |
| إضافة اقتراحات الذكاء الاصطناعي | أضِف متغيّرات AI، ثم `docker compose --profile ai up -d` |
| إضافة خادم MCP | `docker compose --profile mcp up -d` |
| تثبيت إصدار | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| إعادة الضبط وإعادة البذر | `RESET_DB=true` + `SEED_DEMO=true`، أعد التشغيل، ثم أزل `RESET_DB` |
| استخدام Postgres خارجي | تجاوز متغيّرات `POSTGRES_*` في `.env`، ثم `docker compose up -d` |
| البناء من المصدر | `make up-dev` |

## الخطوات التالية

- افتح **http://localhost:8920** (أو `HOST_PORT` المُهيّأ لديك) وسجّل الدخول. إذا حمّلت بيانات العرض التوضيحي، فاستخدم `admin@turboea.demo` / `TurboEA!2025`. وإلا فسجّل — تُرقّى أول مستخدم تلقائيًا إلى Admin.
- استكشف [لوحة المعلومات](../guide/dashboard.md) للحصول على نظرة عامة على مشهد هندسة المؤسسة لديك.
- خصّص [أنواع البطاقات والحقول](../admin/metamodel.md) — النموذج الفوقي مدفوع بالبيانات بالكامل، دون الحاجة إلى تغييرات في الكود.
- لعمليات نشر الإنتاج، راجع [سياسة التوافق](../reference/compatibility.md) و[سلسلة التوريد](../admin/supply-chain.md).
