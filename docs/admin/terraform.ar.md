# Terraform

يمكن للفرق التي تدير سحابتها عبر Terraform نشر Turbo EA بالطريقة نفسها. يوفّر المستودع أربع وحدات جذرية ضمن [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform): وحدة لكل خدمة حاويات مُدارة تغطيها صفحة [خدمات الحاويات المُدارة](managed-containers.md)، إضافة إلى وحدة تُثبّت مخطط Helm الوارد في صفحة [Kubernetes والسحابة](kubernetes.md) على عنقود تشغّله بالفعل. تتناول هذه الصفحة الوحدات؛ وتبقى الصفحتان المرتبطتان المرجع لما تستطيعه كل منصّة وما لا تستطيعه.

## ما تبنيه الوحدات

| الوحدة | المنصّة | تُنشئ | ما تُحضره أنت |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | عنقودًا ومهمّة وخدمة، وApplication Load Balancer مع HTTPS، وEFS، وأسرار Secrets Manager، وRDS for PostgreSQL (اختياري) | VPC بشبكات فرعية عامة وخاصة (NAT)، وشهادة ACM |
| `azure-container-apps` | Azure Container Apps | بيئة وcontainer app وLog Analytics وحساب تخزين ومشاركة ملفات وFlexible Server (اختياري) | مجموعة موارد؛ واختياريًا شبكة فرعية مفوَّضة ومنطقة DNS خاصة |
| `cloud-run` | Google Cloud Run | خدمة وFilestore وأسرار Secret Manager ومستودعًا بعيدًا في Artifact Registry وموازن حمل HTTPS عالميًا بشهادة مُدارة وCloud SQL (اختياري) | مشروعًا، وVPC بشبكة فرعية، ووصولًا إلى الخدمات الخاصة على تلك الـ VPC |
| `kubernetes` | أي عنقود Kubernetes | مساحة أسماء، وSecret لبيانات الاعتماد، وإصدار Helm | عنقودًا وملف kubeconfig، وخادم PostgreSQL |

تبني وحدات السحابة الثلاث **مجموعة الحاويات نفسها** التي تبنيها القوالب في صفحة خدمات الحاويات المُدارة: nginx الطرفي على المنفذ 8920 أمام الواجهة الأمامية والخلفية وخادم MCP الاختياري، وجميعها تتشارك `localhost`؛ خلفية واحدة بالضبط لا تُوسَّع أبدًا ولا تُخفَّض إلى الصفر؛ `/app/data` على مشاركة دائمة يملكها المستخدم 1000؛ وينتهي TLS عند حافة المنصّة. الشكل نفسه بأداة مختلفة — وكل ما تقوله صفحة المنصّة عن المِجسّات وتداخل النشر وقفل بدء التشغيل ينطبق دون تغيير.

ثلاث اتفاقيات تسري على الوحدات الأربع:

- **الإصدار مُدخل صريح.** لا قيمة افتراضية لـ `image_tag` (أو `chart_version` في وحدة Kubernetes) يمكن أن تتقادم؛ ويحمل ملف `terraform.tfvars.example` المجاور لكل وحدة الإصدار الحالي.
- **تُنشأ قاعدة البيانات افتراضيًا، مع مفتاح لاستخدام قاعدتك.** يوجّه `create_database = false` مع `db_host` و`db_password` الخلفية إلى خادم تشغّله بالفعل. وأيًّا كان مصدر قاعدة البيانات، تملك الوحدة كائنات مخزن الأسرار (`SECRET_KEY` وكلمة مرور قاعدة البيانات)، فيكون لتعريف الحاوية شكل واحد.
- **لا تُنشأ الشبكة أبدًا.** معرّفات VPC وVNet والشبكات الفرعية مُدخلات؛ ويسرد ملف README لكل وحدة ما يجب أن توفّره مسبقًا.

## البدء السريع

```bash
cd deploy/terraform/<module>
cp terraform.tfvars.example terraform.tfvars
# عدّل terraform.tfvars، ثم أبقِ السر خارج أي ملف:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

وجّه DNS إلى المخرج الذي تسمّيه الوحدة — `alb_dns_name` على AWS، و`fqdn` على Azure، و`load_balancer_ip` على Google Cloud — ثم افتح `public_url` وسجّل: يصبح أول مستخدم هو المدير.

!!! warning "الحالة تحتوي على أسرار"
    ينتهي المطاف بـ `secret_key` وكلمات مرور قاعدة البيانات المولَّدة وقيم أسرار Container Apps جميعها في حالة Terraform. استخدم خلفية بعيدة مشفّرة مع تحكّم في الوصول (S3 مع SSE والقفل، أو حاوية Azure Storage، أو دلو GCS، أو Terraform Cloud) — ولا تضع أبدًا ملف `terraform.tfstate` على حاسوب محمول لنسخة حقيقية. احتفظ بـ `SECRET_KEY` مع نسخ قاعدة البيانات الاحتياطية: فقدانه يُبطل كل الجلسات وكل الإعدادات المشفّرة، ولا تستطيع قاعدة البيانات وحدها استعادتها.

## AWS ECS Fargate

**قبل البدء**: VPC بشبكتين فرعيتين عامتين على الأقل (موازن الحمل) وشبكتين فرعيتين خاصتين في منطقتي توفّر مختلفتين (المهمّة، وأهداف تركيب EFS، وقاعدة البيانات)؛ وبوابة NAT لتتمكن الشبكات الخاصة من سحب الصور من ghcr.io؛ وشهادة ACM لاسم المضيف في المنطقة نفسها.

المُدخلات المطلوبة: `region` و`vpc_id` و`public_subnet_ids` و`private_subnet_ids` و`certificate_arn` و`public_url` و`image_tag`. واختياريًا `route53_zone_id` — فتُنشئ الوحدة حينها سجل الاسم البديل بنفسها. نسخة RDS المُنشأة خاصة ومشفّرة ومحمية من الحذف وتحتفظ بسبعة أيام من النسخ الاحتياطية؛ ولاستخدام قاعدتك استعمل `create_database = false` و`db_host` و`db_security_group_id` (تفتح الوحدة المنفذ من المهمّة).

عمليات النشر بأسلوب الإيقاف ثم التشغيل (`deployment_minimum_healthy_percent = 0`)، لذا تكلّف ترقية الإصدار دقيقة أو دقيقتين من التوقف ولا تشغّل خلفيتين أبدًا. لفتح صدفة: `aws ecs execute-command … --container backend --interactive --command sh`. ولاستخدام Amazon Bedrock كمزوّد للذكاء الاصطناعي، أضف سياسة IAM الواردة في [ميزات الذكاء الاصطناعي](ai.md) إلى دور المهمة الخاص بالوحدة.

## Azure Container Apps

**قبل البدء**: مجموعة موارد موجودة. لتكامل VNet، شبكة فرعية `/27` مفوَّضة إلى `Microsoft.App/environments`. ولقاعدة بيانات لا يمكن الوصول إليها من الإنترنت، شبكة فرعية *ثانية* مفوَّضة إلى `Microsoft.DBforPostgreSQL/flexibleServers` ومنطقة DNS خاصة تنتهي بـ `.postgres.database.azure.com` ومرتبطة بالـ VNet — اضبط `postgresql_delegated_subnet_id` و`postgresql_private_dns_zone_id` معًا. وبدونهما يحتفظ الخادم المُنشأ بنقطة نهاية عامة مقيّدة بخدمات Azure.

المُدخلات المطلوبة: `subscription_id` و`resource_group_name` و`location` و`public_url` و`image_tag`، إضافة إلى `storage_account_name` و`postgresql_server_name` فريدين عالميًا. يستجيب النشر الأول على المخرج `fqdn`؛ اربط نطاقًا مخصصًا عبر `az containerapp hostname add` / `bind` كما هو موضح في صفحة خدمات الحاويات المُدارة، ثم اضبط `public_url` وطبّق مجددًا. لا يملك Azure علامة حماية من الحذف لـ Flexible Server، لذا تضع الوحدة أقفال `CanNotDelete` على الخادم وحساب التخزين بدلًا من ذلك (`db_deletion_protection` و`storage_deletion_protection`).

## Google Cloud Run

**قبل البدء**: مشروع، وشبكة VPC بشبكة فرعية في المنطقة، و**وصول إلى الخدمات الخاصة** على تلك الـ VPC — يحتاجه عنوان IP الخاص لـ Cloud SQL. إن لم تكن الـ VPC تملكه بعد، فاضبط `create_private_service_connection = true` مرة واحدة؛ إذ يفشل إنشاء تناظر ثانٍ على VPC يملك واحدًا بالفعل.

المُدخلات المطلوبة: `project_id` و`region` و`network` و`subnetwork` و`public_url` و`image_tag`. تفعّل الوحدة واجهات API، وتُنشئ مستودعًا بعيدًا في Artifact Registry يعمل وكيلًا لـ ghcr.io (لا يستطيع Cloud Run السحب من ghcr.io مباشرة)، ونسخة Filestore لـ `/app/data` (يبدأ المستوى الافتراضي `BASIC_HDD` من 1 TiB وهو التكلفة الغالبة)، وتشغّل مهمّة لمرة واحدة تجعل المشاركة مملوكة للمستخدم 1000، وتضع أمام الخدمة موازن حمل HTTPS عالميًا بشهادة تديرها Google. أنشئ سجل DNS من النوع A لمضيف `public_url` يشير إلى `load_balancer_ip`؛ تبقى الشهادة في حالة `PROVISIONING` حتى يُحلّ ذلك السجل. تفشل عمليات الرفع التي تتجاوز 32 MiB — كاستيراد مساحة عمل كبيرة — على مسار HTTP/1 في Cloud Run؛ وهذا حدّ من المنصّة لا إعداد في الوحدة.

## Kubernetes

تغلّف وحدة `kubernetes` المخطط المنشور في `helm_release`، للفرق التي تُدار عناقيدها هي الأخرى عبر Terraform. تُنشئ مساحة الأسماء وSecret يحمل `SECRET_KEY` و`POSTGRES_PASSWORD` (أو تستخدم عبر `existing_secret` واحدًا أنتجه External Secrets أو Sealed Secrets)، وتولّد مفاتيح values الخاصة بالمخطط وتمرّر الـ Secret بالاسم — فلا تمرّ الأسرار عبر values أبدًا. المُدخلات المطلوبة: `chart_version` و`public_url` و`db_host`، وإمّا `secret_key` + `db_password` وإمّا `existing_secret`. تمرّ فئة Ingress والتعليقات التوضيحية وTLS عبر الكائن `ingress`؛ وكل ما لا تعرضه الوحدة (`backend.resources` و`seed.demo`…) يمرّ عبر `extra_values`، وهي قائمة مستندات values للمخطط تُدمج بعد المستند المولَّد.

تقرأ كتلتا `provider` ملف kubeconfig؛ استبدلهما بمصادقة عنقودك الخاصة (رمز EKS، أو بيانات اعتماد AKS، أو إضافة مصادقة GKE) عندما يُنشئ Terraform العنقود أيضًا.

## الترقيات والإزالة

ترقية الإصدار هي تغيير `image_tag` (أو `chart_version`) متبوعًا بـ `terraform apply`؛ تشغّل الخلفية الترحيلات عند بدء التشغيل، تحت قفل بدء التشغيل على المنصّات التي تتداخل فيها النسخة القديمة والجديدة. اقرأ أولًا [ملاحظات الإصدار](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md)، وخذ نسخة احتياطية من قاعدة البيانات كما في أي تثبيت آخر — تنطبق صفحة [التشغيل والترقيات](operations.md).

يُرفض `terraform destroy` ما دامت الحماية من الحذف مفعّلة: عطّل `db_deletion_protection` (على AWS وGoogle Cloud والأقفال على Azure)، و`deletion_protection` على خدمة Cloud Run، وعلى AWS قرّر بشأن لقطة RDS النهائية (`db_skip_final_snapshot`)، ثم طبّق ودمّر. لا يمكن إعادة استخدام اسم نسخة Cloud SQL المحذوفة لمدة أسبوع.

## التحقق دون سحابة

تحمل كل وحدة اختبارات ضمن `tests/` تعمل ضد **مزوّدين وهميين**: مخططات مزوّدين حقيقية، وقيم مختلقة، ولا بيانات اعتماد، ولا يُنشأ شيء. تثبّت هذه الاختبارات التوصيلات التي تعتمد عليها صفحات المنصّات — خلفية واحدة، والحافة على المنفذ 8920، والأسرار بالإحالة، ومجلد البيانات، ومفاتيح استخدام مواردك — ويشغّلها CI مع `terraform validate` و`tflint` عند كل تغيير. ما لا تستطيع إثباته هو أن السحابة ستقبل الخطة؛ فأول `terraform plan` على حساب حقيقي هو ذلك الفحص. لا يُختبر OpenTofu، لكن الوحدات تتجنّب كل ميزة خاصة بـ Terraform وحده.

## استكشاف الأخطاء

| العَرَض | السبب والحل |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | تملك الـ VPC وصولًا إلى الخدمات الخاصة بالفعل. اضبط `create_private_service_connection = false`. |
| تبقى شهادة Google المُدارة في `PROVISIONING` | لم يُحلّ سجل DNS من النوع A لمضيف `public_url` بعدُ إلى `load_balancer_ip`. صحّح DNS وانتظر؛ لا شيء لتطبيقه. |
| `Permission denied` تحت `/app/data` على Cloud Run | المشاركة ليست مملوكة للمستخدم 1000 — بعد استعادة مثلًا. غيّر `chown_job_token` وطبّق لتشغيل المهمّة مجددًا. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | يتطلب الوصول الخاص كليهما؛ يجب ربط المنطقة بالـ VNet وأن تختلف الشبكة الفرعية عن شبكة البيئة. |
| `db_host is required when create_database is false` | يتطلب استخدام قاعدتك `db_host` و`db_password` (`TF_VAR_db_password`). |
| يرفض `terraform destroy` | الحماية من الحذف أو قفل `CanNotDelete` مفعّل؛ انظر *الترقيات والإزالة*. |
| يستجيب التطبيق على عنوان المنصّة لا على `public_url` | يشير DNS إلى مكان آخر، أو ما زال `public_url` يذكر FQDN المنصّة — اضبطه على الأصل النهائي وطبّق؛ فملف تعريف ارتباط الجلسة مرتبط به. |
