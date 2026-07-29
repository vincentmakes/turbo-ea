# الحسابات

تتيح لك ميزة **الحسابات** (تبويب **Admin > Metamodel > Calculations**) تحديد **صيغ تحسب قيم الحقول تلقائيًا** عند حفظ البطاقات. وهذا مفيد لاشتقاق المقاييس والدرجات والتجميعات من بيانات هندستك.

## كيف تعمل

1. يحدّد المسؤول صيغة تستهدف نوع بطاقة وحقلًا محددين
2. عند إنشاء أو تحديث أي بطاقة من ذلك النوع، تُنفَّذ الصيغة تلقائيًا
3. تُكتب النتيجة إلى الحقل المستهدف
4. يُحدَّد الحقل المستهدف على أنه **للقراءة فقط** في صفحة تفاصيل البطاقة (يرى المستخدمون شارة "محسوب")

## إنشاء حساب

انقر **+ New Calculation** وقم بالتهيئة:

| الحقل | الوصف |
|-------|-------------|
| **Name** | اسم وصفي للحساب |
| **Target Type** | نوع البطاقة الذي ينطبق عليه هذا الحساب |
| **Target Field** | الحقل الذي تُخزَّن فيه النتيجة |
| **Formula** | التعبير المراد تقييمه (انظر بنية الصيغة أدناه) |
| **Execution Order** | ترتيب التنفيذ عند وجود حسابات متعددة لنفس النوع (يُنفَّذ الأقل أولًا) |
| **Active** | تفعيل الحساب أو تعطيله |

## بنية الصيغة

تستخدم الصيغ لغة تعبير آمنة ومعزولة في بيئة محمية. يمكنك الإشارة إلى حقول البطاقة الحالية، والبطاقات ذات الصلة والبطاقات الفرعية، والبطاقة الأصل، وتواريخ دورة الحياة.

!!! warning "استخدم مفتاح الحقل لا تسميته"
    يُشار إلى الحقول عبر **مفتاحها**، وهو عادةً بصيغة camelCase (`costTotalAnnual`)، لا عبر
    التسمية الظاهرة على البطاقة (`إجمالي التكلفة السنوية`). أي اسم غير موجود يُحلّ إلى `None`،
    وأي عملية حسابية على `None` تفشل مع **خطأ تقييم** عام.

    يمكنك معرفة المفتاح من **Admin > Metamodel >** *(نوع البطاقة)* بفتح الحقل وقراءة
    **Key** الخاص به. والأسهل: في محرر الصيغ، تسرد الشارات أسفل مربع الصيغة `data.<المفتاح>`
    لكل حقل من حقول النوع المحدد، وكتابة `data.` تفتح الإكمال التلقائي.

### متغيرات السياق

| المتغير | الوصف | مثال |
|----------|-------------|---------|
| `data.<مفتاح الحقل>` | أي حقل مخصص من البطاقة الحالية، عبر مفتاحه | `data.costTotalAnnual` |
| `data.name`، `data.description`، `data.status`، `data.subtype`، `data.approval_status`، `data.reference` | خصائص البطاقة المدمجة | `data.subtype` |
| `data.lifecycle.<المرحلة>` | تواريخ دورة الحياة، والمرحلة إحدى `plan` أو `phaseIn` أو `active` أو `phaseOut` أو `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<مفتاح نوع العلاقة>` | مصفوفة البطاقات المرتبطة بذلك النوع من العلاقات، في كلا الاتجاهين | `relations.relAppToITC` |
| `relation_count.<مفتاح نوع العلاقة>` | عدد البطاقات المرتبطة بذلك النوع من العلاقات | `relation_count.relAppToITC` |
| `children` | مصفوفة البطاقات الفرعية المباشرة (الأنواع الهرمية) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | عدد البطاقات الفرعية المباشرة | `children_count` |
| `parent` | البطاقة الأصل (كائن يحتوي على `id` و`name` و`type` و`subtype` و`attributes`)، أو `None` للبطاقة الجذرية | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | عمق البطاقة الحالية في تسلسلها الهرمي أصل-فرع (`1` = الجذر، غير محدود). `1` لأنواع البطاقات غير الهرمية | `hierarchy_level * 10` |

مفتاح نوع العلاقة هو المفتاح الظاهر في **Admin > Metamodel > Relations**، مثل `relAppToITC`
أو `relInitiativeToApp`. والاتجاه لا يهم: تجد البطاقة نوع العلاقة تحت المفتاح نفسه سواء كانت
في طرف المصدر أو في طرف الهدف. والبطاقات المؤرشفة مستبعدة من `relations` و`relation_count`
و`children`.

### قراءة حقول بطاقة ذات صلة

كل عنصر في `relations.<مفتاح نوع العلاقة>` وفي `children` هو كائن غلاف، وليس حقول البطاقة
ذات الصلة مباشرةً:

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* يحتوي `attributes` على قيم حقول البطاقة ذات الصلة نفسها.
* ويحتوي `rel_attributes` على القيم المخزَّنة **على الرابط نفسه**، إن كان نوع العلاقة يعرّف
  مخطط سمات. فمثلًا يحمل `relAppToITC` حقل `costTotalAnnual` خاصًا به، فيمكنك تسجيل ما ينفقه
  تطبيق واحد على مكوّن تقني واحد.

وهذا مهم لـ `PLUCK` و`FILTER`، إذ تأخذان مسار مفتاح، ولذلك تحتاجان إلى البادئة `attributes.`
للوصول إلى الحقل:

```
# جمع التكلفة السنوية للمكوّنات التقنية التي يستخدمها هذا التطبيق
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# أو بدلًا من ذلك جمع التكلفة المسجَّلة على كل رابط بين التطبيق والمكوّن
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

استخراج مفتاح مجرَّد مثل `"costTotalAnnual"` يبحث عنه في كائن الغلاف، فلا يجد شيئًا ويعيد
قائمة من `None`، فتظهر عبر `SUM` بقيمة `0`. وأي صيغة على العلاقات تُصرّ على إعادة `0` تعني
غالبًا بادئة `attributes.` مفقودة.

### التعامل مع القيم الفارغة

الحقل بلا قيمة يُحلّ إلى `None`، ووجود `None` في تعبير حسابي يُطلق خطأً. لذا غلِّف بـ
`COALESCE` كل حقل قد يكون فارغًا:

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

أما `SUM` و`AVG` و`MIN` و`MAX` فهي تتجاهل أصلًا العناصر غير الرقمية ولا تحتاج إلى حماية.

### بيانات PPM على بطاقات Initiative

يُتيح الجذر `ppm` للصيغ الوصول إلى سطور الميزانية والتكلفة في وحدة PPM، مفصولةً بين capex و opex وموزَّعةً حسب السنة المالية — وهو تفصيل لا تستطيع السمتان المجمَّعتان `data.costBudget` / `data.costActual` على البطاقة تقديمه.

| المتغير | الوصف |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | الميزانية المخططة، من سطور ميزانية PPM |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | المبالغ المخططة في سطور تكلفة PPM |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | المبالغ الفعلية في سطور تكلفة PPM |
| `ppm.byYear` | المقاييس التسعة نفسها لكل سنة مالية، كقائمة `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | السنة المالية التي يقع فيها تاريخ اليوم |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | سطور تكلفة بلا تاريخ: تُحتسب في الإجماليات لكنها لا تنتمي لأي سنة |

`byYear` قائمة وليست كائنًا مفهرسًا بالسنة، حتى تعمل عليها دالّتا `FILTER` و`PLUCK` المعتادتان:

```
# إجمالي ميزانية capex عبر كل السنوات
ppm.capexBudget

# ميزانية capex للسنة المالية الحالية فقط
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# ميزانية capex لكل مبادرة مرتبطة بهذه البطاقة
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

* **تُسمّى السنة المالية باسم السنة الميلادية التي تنتهي فيها.** مع بداية في أكتوبر، يقع 15 أكتوبر 2025 في السنة المالية 2026 و30 سبتمبر 2025 في 2025. ومع بداية يناير الافتراضية تطابق السنةُ المالية السنةَ الميلادية.
* **تستمد سطور الميزانية وسطور التكلفة سنتها من مصدرين مختلفين.** يحمل سطر الميزانية السنة المالية التي أدخلتها؛ أما سنة سطر التكلفة فتُشتق من تاريخه. وإذا كانت مؤسستك تسمّي السنوات بسنة *البداية*، فسيختلف الاثنان.
* `total*` هو مجموع كل السطور، لا `capex + opex`. والسطر الذي لا تنتمي فئته إلى أيٍّ منهما (من استيراد مثلًا) يظل محتسبًا في الإجمالي.
* البطاقة التي ليست مبادرة تقرأ كل مقاييس `ppm` بقيمة `0` مع `byYear` فارغ، فتُعيد الصيغةُ على النوع الخطأ صفرًا بدل أن تُخفق.

يؤدي تعديل سطر ميزانية أو تكلفة في PPM إلى إعادة تشغيل حسابات المبادرة، فيتحدَّث كل ما يُشتق منها فورًا. أما البطاقات التي تقرأ بيانات PPM لبطاقة *أخرى* عبر علاقة فلا تُحدَّث.

### الدوال المدمجة

| الدالة | الوصف | مثال |
|----------|-------------|---------|
| `IF(condition, true_val, false_val)` | منطق شرطي. يُقيَّم الفرع المختار فقط | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(array)` | مجموع القيم الرقمية | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(array)` | متوسط القيم الرقمية | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(array)` | القيمة الدنيا | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(array)` | القيمة العليا | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(array)` | عدد العناصر | `COUNT(relations.relAppToInterface)` |
| `ROUND(value, decimals)` | تقريب رقم | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(value)` | القيمة المطلقة | `ABS(data.budgetVariance)` |
| `LN(value)` | اللوغاريتم الطبيعي. يعيد `None` للصفر والقيم السالبة والمدخلات غير الرقمية | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | أول قيمة غير فارغة | `COALESCE(data.customScore, 0)` |
| `LOWER(text)` | نص بأحرف صغيرة | `LOWER(data.productName)` |
| `UPPER(text)` | نص بأحرف كبيرة | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | دمج السلاسل النصية | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(text, search)` | التحقق مما إذا كان النص يحتوي على سلسلة فرعية | `CONTAINS(data.description, "legacy")` |
| `PLUCK(array, مسار المفتاح)` | استخراج مسار مفتاح من كل عنصر | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(array, مسار المفتاح, value)` | الإبقاء على العناصر التي يساوي مسار مفتاحها قيمة معينة | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(value, mapping)` | تعيين القيم الفئوية إلى درجات | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

كما تتوفر دوال بايثون المدمجة الآمنة `len` و`str` و`int` و`float` و`bool` و`abs` و`round`
و`min` و`max` و`sum`، إضافة إلى المعاملات والمقارنات المعتادة.

### أمثلة على الصيغ { #example-formulas }

**جمع عدة حقول تكلفة على البطاقة نفسها:**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**إجمالي التكلفة السنوية للمكوّنات التقنية التي يستخدمها تطبيق:**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**درجة المخاطرة بناءً على الأهمية الحرجة:**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**عدد الواجهات المرتبطة:**
```
relation_count.relAppToInterface
```

**عدد التطبيقات المستضافة محليًا في مؤسسة:**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**تجميع تكلفة من البطاقات الفرعية:**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**التموضع وفق نموذج TIME (Tolerate / Invest / Migrate / Eliminate)**، وهو المثال نفسه الذي ستراه في لوحة **Formula Reference** داخل **Admin → Metamodel → Calculations** عند إنشاء حساب جديد. النوع المستهدف = `Application`، الحقل المستهدف = `timeModel`. يفترض أنك أضفت حقلَي `single_select` باسمَي `businessFit` و`technicalFit` بالخيارات `excellent` و`adequate` و`insufficient` و`unreasonable`:
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

وكما يبيّن المثال، يمكن أن تمتد الصيغة على عدة أسطر. والسطر بصيغة `اسم = تعبير` يخزّن قيمة
وسيطة تستطيع الأسطر اللاحقة إعادة استخدامها، وقيمة السطر الأخير هي ما يُكتب في الحقل المستهدف.

وهذا أيضًا المثال العملي المُشار إليه في [دليل المبتدئين في هندسة المؤسسة](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**التعليقات** مدعومة باستخدام `#`:
```
# Calculate weighted risk score
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## التحقق والاختبار

يوفّر محرر الصيغ فحصين مختلفين، وسلوكهما ليس واحدًا:

* **Validate** ينفّذ الصيغة على بطاقة اصطناعية. يُمنَح كل حقل رقمي القيمة الوهمية `1`، ولا
  تملك البطاقة **أي علاقات ولا بطاقات فرعية ولا بيانات أصل خاصة بها**. وهو يؤكد أن البنية
  النحوية سليمة وأن الأسماء المستخدمة موجودة، لكن أي صيغة تجمع عبر `relations` أو `children`
  ستُظهر هنا دائمًا `0` أو نتيجة فارغة. وهذا سلوك متوقَّع ولا يدل على خلل في الصيغة.
* **Test**، وهو متاح على حساب محفوظ، يُنفَّذ على بطاقة حقيقية تختارها أنت. وهو الخيار الصحيح
  لكل ما يتعلق بالعلاقات أو البطاقات الفرعية أو البطاقة الأصل. ولا يُكتب شيء في البطاقة، بل
  تُعرض عليك النتيجة فقط.

## قراءة نتائج التشغيل اليدوي

تشغيل حساب من القائمة يقيّمه لكل بطاقة من النوع المستهدف، ويبلّغ عمّا حدث فعلًا لا عن عدد
البطاقات التي عولجت فحسب. يفتح زر **عرض التفاصيل** في شريط النتيجة التفصيل التالي:

* **كتلة لكل حساب**، مع عدد البطاقات التي حُسبت دون أخطاء وعدد التي فشلت. تعمل جميع الحسابات
  المفعّلة على النوع معًا، وهذا ما يكشف أيّها المسؤول عن الخلل.
* **صف لكل خطأ مختلف**، مع عدد البطاقات التي ظهر عليها. الصيغة الخاطئة تخطئ بالطريقة نفسها في كل
  مكان، لذا فإن إحدى وعشرين حالة فشل تعني عادةً إصلاحًا واحدًا لا إحدى وعشرين.
* **البطاقات نفسها**، مُدرجة أسفل كل خطأ مع روابط إليها، لفتح إحداها ومعاينة البيانات التي
  تسببت في الفشل. يُدرج عشرة على الأكثر لكل خطأ؛ وإن زاد العدد يُعرض الباقي كعدد.

يضع زر **نسخ التقرير** التفصيل كاملًا في الحافظة كنص عادي.

تعكس شارة الحالة في قائمة الحسابات التشغيل نفسه: حمراء إن فشلت أي بطاقة، وخضراء فقط عندما تُحسب
جميعها.

## متى تُنفَّذ الحسابات

يُعاد تقييم حسابات البطاقة عندما:

* تُنشأ البطاقة أو تُحفظ؛
* تُنشأ علاقة تمسّ البطاقة أو تُعدَّل أو تُحذف (يُعاد حساب طرفَي العلاقة كليهما)؛
* تُسنَد البطاقة إلى أصل جديد، فيُعاد حساب شجرتها الفرعية بالكامل؛
* تُشغِّل الحساب يدويًا من القائمة، فيُقيَّم لكل بطاقة من النوع المستهدف وتُحفظ النتائج.

ولا **يُعاد** تقييمها عند تعديل بطاقة أخرى تقرأ منها الصيغة. فإذا غيّرت تكلفة على مكوّن تقني،
فلن يتغيّر التطبيق الذي يجمعها إلا بعد حفظ ذلك التطبيق، أو تغيّر إحدى علاقاته، أو تشغيلك
الحساب للنوع. وللتجميعات على بيانات يتولاها آخرون، شغّل الحساب دوريًا أو بعد استيراد جماعي.

!!! note "ملاحظة"
    وينطبق الأمر نفسه على القيم المشتقة من `parent` و`hierarchy_level`: فهي تُحدَّث عند إعادة
    الإسناد إلى أصل جديد وعند التشغيل اليدوي، لا عند كل تعديل للبطاقة الأصل. احْمِ دائمًا مرجع
    `parent` بـ `IF(parent, …)` كي لا تُسبِّب البطاقات الجذرية، حيث تكون `parent` بقيمة
    `None`، خطأً.

## ترتيب التنفيذ

عندما تستهدف حسابات متعددة نفس نوع البطاقة، تُنفَّذ بالترتيب المحدد بقيمة **execution order** الخاصة بها. وهذا مهم عندما يعتمد حساب على نتيجة حساب آخر: اضبط الحساب الذي يُعتمد عليه ليُنفَّذ أولًا (رقم أقل).

ويرفض Turbo EA أي مجموعة حسابات تُشكِّل حلقة مغلقة، مثل حقل A يُحسب من الحقل B بينما يُحسب B من A.
