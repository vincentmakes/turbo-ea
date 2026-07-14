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

تستخدم الصيغ لغة تعبير آمنة ومعزولة في بيئة محمية. يمكنك الإشارة إلى سمات البطاقة، وبيانات البطاقات ذات الصلة، ومعلومات دورة الحياة.

### متغيرات السياق

| المتغير | الوصف | مثال |
|----------|-------------|---------|
| `fieldKey` | أي سمة من البطاقة الحالية | `businessCriticality` |
| `related_{type_key}` | مصفوفة من البطاقات ذات الصلة من نوع معيّن | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, etc. | قيم تواريخ دورة الحياة | `lifecycle_endOfLife` |
| `parent` | البطاقة الأصل (كائن يحتوي على `id` و`name` و`type` و`subtype` و`attributes`)، أو `None` للبطاقة الجذرية | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | عمق البطاقة الحالية في تسلسلها الهرمي أصل-فرع (`1` = الجذر، غير محدود). `1` لأنواع البطاقات غير الهرمية | `hierarchy_level * 10` |

!!! note "ملاحظة"
    تُحدَّث القيم المشتقة من `parent` و`hierarchy_level` عند إعادة إسناد البطاقة إلى أصل جديد (يُعاد حساب شجرتها الفرعية بالكامل) وعند تشغيل **إعادة حساب الكل** للنوع — وليس عند كل تعديل للبطاقة الأصل. احْمِ دائمًا مرجع `parent` بـ `IF(parent, …)` كي لا تُسبِّب البطاقات الجذرية (حيث تكون `parent` بقيمة `None`) خطأً.

### الدوال المدمجة

| الدالة | الوصف | مثال |
|----------|-------------|---------|
| `IF(condition, true_val, false_val)` | منطق شرطي | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | مجموع القيم الرقمية | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | متوسط القيم الرقمية | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | القيمة الدنيا | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | القيمة العليا | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | عدد العناصر | `COUNT(related_interfaces)` |
| `ROUND(value, decimals)` | تقريب رقم | `ROUND(avgCost, 2)` |
| `ABS(value)` | القيمة المطلقة | `ABS(delta)` |
| `COALESCE(a, b, ...)` | أول قيمة غير فارغة | `COALESCE(customScore, 0)` |
| `LOWER(text)` | نص بأحرف صغيرة | `LOWER(status)` |
| `UPPER(text)` | نص بأحرف كبيرة | `UPPER(category)` |
| `CONCAT(a, b, ...)` | دمج السلاسل النصية | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(text, search)` | التحقق مما إذا كان النص يحتوي على سلسلة فرعية | `CONTAINS(description, "legacy")` |
| `PLUCK(array, key)` | استخراج حقل من كل عنصر | `PLUCK(related_applications, "name")` |
| `FILTER(array, key, value)` | تصفية العناصر بحسب قيمة الحقل | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(value, mapping)` | تعيين القيم الفئوية إلى درجات | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### أمثلة على الصيغ { #example-formulas }

**إجمالي التكلفة السنوية من التطبيقات ذات الصلة:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**درجة المخاطرة بناءً على الأهمية الحرجة:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**عدد الواجهات النشطة:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**التموضع وفق نموذج TIME (Tolerate / Invest / Migrate / Eliminate)** — وهو المثال نفسه الذي ستراه في لوحة **Formula Reference** داخل **Admin → Metamodel → Calculations** عند إنشاء حساب جديد. النوع المستهدف = `Application`، الحقل المستهدف = `timeModel`. يفترض أنك أضفت حقلَي `single_select` باسمَي `businessFit` و`technicalFit` بالخيارات `excellent` و`adequate` و`insufficient` و`unreasonable`:
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

وهذا أيضًا المثال العملي المُشار إليه في [دليل المبتدئين في هندسة المؤسسة](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**التعليقات** مدعومة باستخدام `#`:
```
# Calculate weighted risk score
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## تشغيل الحسابات

تُنفَّذ الحسابات تلقائيًا عند حفظ البطاقة. يمكنك أيضًا تشغيل حساب يدويًا ليُنفَّذ على جميع البطاقات من النوع المستهدف:

1. ابحث عن الحساب في القائمة
2. انقر زر **Run**
3. تُقيَّم الصيغة لكل بطاقة مطابقة وتُحفظ النتائج

## ترتيب التنفيذ

عندما تستهدف حسابات متعددة نفس نوع البطاقة، تُنفَّذ بالترتيب المحدد بقيمة **execution order** الخاصة بها. وهذا مهم عندما يعتمد حساب على نتيجة حساب آخر — اضبط الحساب الذي يُعتمد عليه ليُنفَّذ أولًا (رقم أقل).
