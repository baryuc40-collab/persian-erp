# ۰۰۰۸: Camunda 8 به‌عنوان موتور BPMN، کنار گردش‌کار NocoBase

- **وضعیت:** موتور پذیرفته‌شده (درخواست صاحب پروژه، ۴ آبان ۱۴۰۵). بقیه پیشنهادی تا تأیید.
- **تاریخ:** ۴ آبان ۱۴۰۵ (۲۶ اکتبر ۲۰۲۶)
- **اپیک:** [EPIC-021](../../backlog/epics/EPIC-021-process-platform/epic.md)
- **جای تصمیم ۰۰۰۷ را می‌گیرد در:** بخش ۱ (موتور و نسخه) و بخش ۲ (پیکربندی) [تصمیم ۰۰۰۷](0007-bpmn-engine.md). بخش‌های رابط، مالکیت داده، هویت و تکرار امن با تغییرهای بخش ۴ همین سند می‌مانند.

## زمینه

- اثبات مفهوم EPIC-016 با Operaton 2.1.5 (هم‌خانواده‌ی Camunda 7) کار کرد ([تصمیم ۰۰۰۷](0007-bpmn-engine.md)).
- صاحب پروژه خواست موتور **آخرین نسخه‌ی پایدار Camunda 8، از ۸.۹ به بالا** باشد. کار تجاری نمی‌کند و نصب و استفاده‌ی آن را برای خودش مشکل نمی‌داند.
- همچنین خواست **هر فرایند را بشود یا با گردش‌کار خود NocoBase ساخت یا با Camunda**، به انتخاب کاربر.

## مجوز Camunda 8

این را یک بار روشن می‌نویسیم، چون روی انتشار محصول اثر دارد:

- Camunda 8 Self-Managed زیر **Camunda License 1.0** است. این مجوز استفاده را فقط در «محیط غیرعملیاتی» می‌دهد: توسعه، staging، آزمون، تضمین کیفیت، نمایش و ارزیابی. «سامانه‌ی زنده یا عملیاتی» را شامل نمی‌شود.
- خود متن مجوز استثنایی برای استفاده‌ی غیرتجاری ندارد. پس استفاده‌ی واقعی یک سازمان، حتی بدون درآمد، یکی از این دو را می‌خواهد. این برداشت ما از متن مجوز است، نه نظر حقوقی.
  - **مجوز غیرتجاری رایگان** ([Camunda Non-Commercial License](https://camunda.com/common-good)) با درخواست و بررسی Camunda:
    - همه‌ی امکانات را بی‌محدودیت باز می‌کند.
    - برای سازمان‌های غیرانتفاعی، کار آموزشی و پژوهشی، و پروژه‌ی شخصی است.
    - شرکت‌های کوچک، استارتاپ‌ها و پروژه‌ی غیرتجاری درون یک شرکت را مورد به مورد بررسی می‌کند.
    - آن صفحه درباره‌ی کشور متقاضی چیزی نمی‌گوید. اینکه درخواستی از ایران پذیرفته شود روشن نیست و باید از خود Camunda پرسید.
  - **مجوز Enterprise** پولی.
- بدون کلید مجوز همه‌ی امکانات کار می‌کند. محصول فقط برچسب «Non-production license» نشان می‌دهد و در لاگ هشدار می‌نویسد.
- منبع‌ها:
  - [صفحه‌ی مجوزهای Camunda](https://docs.camunda.io/docs/reference/licenses/)
  - متن `licenses/CAMUNDA-LICENSE-1.0.txt` در مخزن `camunda/camunda`، که در ایمیج هم هست: `/usr/local/camunda/CAMUNDA-LICENSE-1.0.txt`
  - [پیکربندی مجوز](https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/core-settings/configuration/licensing/)

پیامد برای محصول:

1. ایمیج انتشار persian-erp، Camunda را در خود ندارد. Camunda پشت profile `bpm` در Compose می‌آید و هر نصب آن را خودش از Docker Hub می‌گیرد.
2. **آداپتور Operaton (Apache-2.0) می‌ماند.** نصبی که موتور رایگان برای محیط عملیاتی می‌خواهد، با `BPM_ENGINE=operaton` همان امکانات پایه را دارد. آزمون‌های قرارداد `BpmEngine` روی هر دو موتور اجرا می‌شوند.
3. فرایندهایی که با گردش‌کار NocoBase ساخته شوند، به Camunda نیازی ندارند و زیر [مجوز NocoBase](0001-nocobase-license.md) می‌مانند.

## تصمیم

### ۱. موتور و نسخه

- **`camunda/camunda:8.10.7`.** آخرین نسخه‌ی پایدار در ۴ آبان ۱۴۰۵ است؛ آخرین نسخه‌ی سری ۸.۹، 8.9.26 است.
  - یک کانتینر «Orchestration Cluster» است که Zeebe، Operate، Tasklist، Identity و REST API v2 را با هم دارد.
  - Connectors، Optimize، Web Modeler، Console و Keycloak لازم نیستند. طراحی فرایند داخل NocoBase است.
- **ذخیره‌ی ثانویه: RDBMS روی همان PostgreSQL 16، در پایگاه داده‌ی جدای `camunda`.**
  - Elasticsearch لازم نیست. Camunda هر دو را برای محیط عملیاتی معتبر می‌داند.
  - نوع ذخیره پس از نصب عوض نمی‌شود.
  - H2 فقط برای توسعه است.
  - Camunda 8.10 از PostgreSQL 14 پشتیبانی نمی‌کند؛ ما روی 16 هستیم.
- **ذخیره‌ی اصلی Zeebe** روی volume `camunda-data` (`/usr/local/camunda/data`).
- نسخه مثل `NOCOBASE_VERSION` یک جا قفل می‌شود (`CAMUNDA_VERSION`) و هر ارتقا PR جدا دارد.

### ۲. پیکربندی

| تنظیم | مقدار | چرا |
| --- | --- | --- |
| `CAMUNDA_DATA_SECONDARYSTORAGE_TYPE` | `rdbms` | بدون Elasticsearch |
| `CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_URL`، `_USERNAME`، `_PASSWORD` | `jdbc:postgresql://postgres:5432/camunda`؛ رمز از secret | همان سرور PostgreSQL با پایگاه داده‌ی جدا. موتور جدول‌هایش را خودش می‌سازد. |
| `CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_HISTORY_DEFAULTHISTORYTTL` | `P180D` | پیش‌فرض موتور ۳۰ روز است. |
| `CAMUNDA_PROCESSINSTANCECREATION_BUSINESSIDUNIQUENESSENABLED` | `true` | موتور خودش کلید کسب‌وکار تکراری را رد می‌کند. |
| `CAMUNDA_SECURITY_AUTHENTICATION_METHOD` | `basic` | پلاگین با کاربر سرویس وصل می‌شود. |
| `CAMUNDA_SECURITY_AUTHENTICATION_UNPROTECTEDAPI` | `false` | API بدون رمز باز نمی‌ماند. |
| `CAMUNDA_SECURITY_AUTHORIZATIONS_ENABLED` | `true` | |
| `CAMUNDA_SECURITY_INITIALIZATION_USERS_0_*`، `_ROLES_0_*` و `_AUTHORIZATIONS_*` | کاربر سرویس پلاگین با نقش `bpm_service` | کمترین دسترسی (بخش ۶)؛ رمز از secret |
| `CAMUNDA_SECURITY_INITIALIZATION_USERS_1_*` و `_DEFAULTROLES_ADMIN_USERS_0` | کاربر مدیر موتور | برای Operate، Tasklist و عوض کردن رمزها؛ رمز از secret |
| `CAMUNDA_LICENSE_KEY` | خالی | فقط اگر روزی مجوز غیرتجاری یا Enterprise گرفته شود. |
| `JAVA_TOOL_OPTIONS` | `-Xmx2g` | سقف حافظه‌ی موتور |
| درگاه‌ها | 8080 (REST، Operate و Tasklist)، 26500 (gRPC)، 9600 (سلامت و متریک)، همه بدون `ports` | موتور فقط در شبکه‌ی داخلی است. |
| سلامت در Compose | `wget` به `http://localhost:9600/actuator/health/readiness` | ایمیج `curl` ندارد. |
| لاگ | `json-file` با پنج فایل ۵۰ مگابایتی | لاگ موتور دیسک را پر نمی‌کند. |
| `stop_grace_period` | ۶۰ ثانیه | موتور پیش از kill مرتب بسته می‌شود. |

STORY-091 این پیکربندی را در هر دو فایل Compose گذاشت: `docker-compose.yml` برای توسعه با volume `camunda-data`، و `docker/docker-compose.yml` برای سرور با پوشه‌ی `storage/camunda`. هر دو پشت profile `bpm` هستند. نسخه فقط در `CAMUNDA_VERSION` تعریف می‌شود و `yarn check:version` برابری تصویرهای Compose و CI را با آن می‌سنجد. سرویس `camunda-init` پایگاه داده‌ی `camunda` و کاربرش را می‌سازد و مالک آن است، و در Compose سرور اگر رمزی خالی یا `change-me` باشد، موتور را بالا نمی‌آورد.

**ارتقای نسخه.** نسخه‌ی وصله‌ای آزاد است. نسخه‌ی فرعی فقط یکی‌یکی بالا می‌رود (8.10 به 8.11) و برگشت ندارد ([سازگاری نسخه‌ها](https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/core-settings/concepts/version-compatibility)). پس هر PR که `CAMUNDA_VERSION` را عوض می‌کند، نسخه‌ی فرعی را حداکثر یک پله بالا می‌برد. جدول‌های ذخیره‌ی ثانویه را خود موتور هنگام بالا آمدن ارتقا می‌دهد.

**پشتیبان.** روش پیش‌فرض، پشتیبان سرد است: موتور با `docker compose stop` بسته می‌شود، `pg_dump` پایگاه داده‌ی `camunda` و پوشه‌ی داده‌ی موتور با هم برداشته می‌شوند، و موتور دوباره روشن می‌شود. دستورها در [راهنمای نصب](../install/README.md#پشتیبان-با-موتور-فرایند) آمده‌اند. روش رسمی Camunda برای RDBMS ([پشتیبان](https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/rdbms/rdbms-backup/) و [بازگردانی](https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/rdbms/rdbms-restore/)) بدون خاموشی است، ولی پشتیبان پیوسته‌ی موتور در یک فضای ذخیره (S3، GCS، Azure یا پوشه) و برنامه‌ی بازگردانی جدا می‌خواهد. برای نصب یک‌سروری، پشتیبان سرد ساده‌تر و مطمئن‌تر است.

### ۳. دو سازنده‌ی فرایند

هر فرایند در فهرست فرایندها یک **سازنده** دارد:

- **`nocobase`:** گردش‌کار خود NocoBase (`plugin-workflow`) با نود «کار انسانی» (`plugin-workflow-manual`)، شرط، حلقه، درخواست HTTP و بقیه‌ی نودها. ویرایشگرش همان بوم گردش‌کار NocoBase است و دست نمی‌خورد.
- **`camunda`:** مدل BPMN که با ویرایشگر bpmn-js داخل NocoBase کشیده و در Camunda 8 مستقر می‌شود.

سازنده هنگام ساخت فرایند انتخاب می‌شود. بعداً عوض نمی‌شود، چون تبدیل خودکار گردش‌کار به BPMN یا برعکس در دامنه نیست.

| | گردش‌کار NocoBase | Camunda 8 |
| --- | --- | --- |
| مناسب برای | تأیید یک یا دو مرحله‌ای، کار خودکار روی یک مجموعه، اعلان، محاسبه | فرایند چندنفره و چندروزه، مسیرهای موازی، تایمر و پیام، نسخه و انتقال نمونه‌ها، ممیزی کامل |
| ویرایشگر | بوم گردش‌کار NocoBase | bpmn-js داخل NocoBase |
| کار انسانی | نود «کار انسانی» | `zeebe:userTask` |
| موتور جدا | ندارد | Camunda 8 |
| مجوز | مجوز NocoBase | Camunda License 1.0: فقط غیرعملیاتی |
| داده‌ی پایش | مجموعه‌های `workflows`، `executions` و `jobs` | REST API v2 |
| ابزار فنی | تاریخچه‌ی اجرای گردش‌کار در NocoBase | Operate و Tasklist |

**برای کاربر یکی است:** منوی «فرایندها»، صندوق کار، شروع فرایند، درخواست‌های من، مدیریت فرایندها و پایش. هر صفحه ستون یا برچسب «سازنده» دارد.

**پل میان دو سازنده:** هر دو در EPIC-016 ساخته شده‌اند.
- نود «شروع فرایند BPMN» در گردش‌کار NocoBase یک فرایند Camunda را شروع می‌کند.
- رویداد «کار سرویس BPMN» کار سرویس Camunda را با یک گردش‌کار NocoBase انجام می‌دهد.

**صندوق کار یکی است.** NocoBase مرکز کار خودش را دارد که کارهای نود «کار انسانی» در آن می‌آیند. کارهای انسانی Camunda هم با `registerTaskType` در کلاینت و `updateTasksStats` در سرور `plugin-workflow` به همان مرکز اضافه می‌شوند. هر دو در NocoBase 2.2.24 هستند.

### ۴. تغییرها در `BpmEngine` و `Camunda8Adapter`

| کار | Camunda 8 (REST API v2) | فرق با Operaton |
| --- | --- | --- |
| استقرار | `POST /v2/deployments` (multipart) | |
| شروع | `POST /v2/process-instances` با `processDefinitionId` و `businessId` | کلید تکراری ۴۰۹ `ALREADY_EXISTS` می‌گیرد. آداپتور نمونه‌ی باز را با `/v2/process-instances/search` پیدا می‌کند و `created: false` برمی‌گرداند. قفل محلی تصمیم ۰۰۰۷ فقط برای Operaton می‌ماند. |
| پیام | `POST /v2/messages/correlation` با `correlationKey` برابر کلید کسب‌وکار | اگر نمونه‌ای منتظر نباشد ۴۰۴ `NOT_FOUND` می‌گیرد. آداپتور آن را «پیام به جایی نرسید» گزارش می‌کند. |
| کار سرویس | `POST /v2/jobs/activation` با `requestTimeout` (long polling)؛ `/v2/jobs/{key}/completion`، `/failure` (با `retries` و `retryBackOff`)، `/error` (خطای کسب‌وکار) | «موضوع» Operaton همان `type` کار است. هر کار `businessId` دارد. |
| کار انسانی | `POST /v2/user-tasks/search` با `candidateGroups`، `assignee` یا `businessId`؛ `/assignment`؛ `/completion` | فقط `zeebe:userTask` پشتیبانی می‌شود. کار انسانی قدیمی بر پایه‌ی job نه. |
| آمار و مدیریت | `/v2/process-definitions/{key}/statistics/element-instances`، `/v2/incidents/search`، `/v2/process-instances/{key}/cancellation`، `/suspension`، `/resumption`، `/modification`، `/migration`، `PATCH /v2/jobs/{key}` و `/v2/incidents/{key}/resolution` | متدهای تازه‌ی `BpmEngine` برای STORY-097 تا STORY-099 و STORY-105 |

- کلیدهای Camunda 8 عدد ۶۴ بیتی‌اند و در JSON رشته‌اند. `BpmEngine` همه‌ی شناسه‌ها را رشته نگه می‌دارد.
- قاعده‌ی متغیرها و تاریخ‌ها همان تصمیم ۰۰۰۷ است: فقط مقدار ساده، و تاریخ رشته‌ی ISO با UTC.
- اگر موتوری کاری را نداشته باشد، آداپتور خطای «این موتور این کار را پشتیبانی نمی‌کند» می‌دهد و رابط کاربری دکمه را پنهان می‌کند.

### ۵. مدل BPMN

مدل‌های Operaton در Camunda 8 اجرا نمی‌شوند، چون افزونه‌های XML و زبان عبارت‌ها فرق دارد. [`bpmn/purchase-request.bpmn`](../../bpmn/purchase-request.bpmn) همان «درخواست خرید» با DI است که روی 8.10.7 مستقر و اجرا شد. از STORY-092 مدل اصلی همین است و نسخه‌ی Operaton در [`bpmn/operaton/`](../../bpmn/operaton/purchase-request.bpmn) است.

| Operaton | Camunda 8 |
| --- | --- |
| `operaton:candidateGroups="purchase_manager"` | `<zeebe:userTask/>` و `<zeebe:assignmentDefinition candidateGroups="purchase_manager"/>` |
| `operaton:type="external" operaton:topic="place-order"` | `<zeebe:taskDefinition type="place-order" retries="3"/>` |
| شرط `${approved}` (JUEL) | `=approved = true` (FEEL) |
| `operaton:historyTimeToLive` | ندارد؛ TTL برای کل موتور تنظیم می‌شود. |
| `operaton:formField` | فرم Camunda در فایل `.form` که کار با `zeebe:formDefinition formId` به آن وصل است (STORY-092)، مثل [`purchase-approve.form`](../../bpmn/purchase-approve.form). فرم جاسازی‌شده در مدل برای کار انسانی Camunda پذیرفته نیست. فرم NocoBase با `externalReference` در STORY-101 می‌آید. |

### ۶. هویت، دسترسی و ممیزی

- قاعده‌های تصمیم ۰۰۰۷ می‌مانند:
  - `candidateGroups` نام فنی نقش NocoBase است و `assignee` شناسه‌ی کاربر NocoBase.
  - کاربران NocoBase در موتور ساخته نمی‌شوند. ACL فقط در NocoBase است.
- لاگ ممیزی خود موتور (`/v2/audit-logs/search`) همه‌ی کارها را به نام کاربر سرویس می‌نویسد. پس نام کاربر واقعی فقط در لاگ اتصال `bpmEvents` در NocoBase است.
- Operate و Tasklist فقط برای مدیر فنی‌اند: با کاربر جدای Camunda برای هر مدیر فنی و فقط با تونل SSH.
- **کمترین دسترسی (STORY-092).** کاربر سرویس فقط نقش `bpm_service` را دارد:

  | منبع | دسترسی |
  | --- | --- |
  | `PROCESS_DEFINITION` (همه) | `READ_PROCESS_DEFINITION`، `CREATE_PROCESS_INSTANCE`، `READ_PROCESS_INSTANCE`، `UPDATE_PROCESS_INSTANCE`، `CANCEL_PROCESS_INSTANCE`، `MODIFY_PROCESS_INSTANCE`، `SUSPEND_PROCESS_INSTANCE`، `READ_USER_TASK`، `UPDATE_USER_TASK`، `CLAIM_USER_TASK`، `COMPLETE_USER_TASK` |
  | `RESOURCE` (همه) | `CREATE`، `READ` (استقرار مدل و فرم) |
  | `MESSAGE` (همه) | `CREATE`، `READ` |

  پس کاربر سرویس نه کاربر و نقش می‌سازد، نه دسترسی می‌دهد و نه Operate را باز می‌کند. لغو، تعلیق و جابه‌جایی نمونه در STORY-097 تا STORY-105 می‌آیند ولی از همین حالا در نقش هستند، چون موتور کاربرها، نقش و دسترسی‌ها را فقط بار اول از تنظیمات می‌سازد و دسترسی‌ای که بعداً به تنظیمات اضافه شود، به نصب موجود نمی‌رسد. دسترسی تازه در نصب موجود با کاربر مدیر و `POST /v2/authorizations` داده می‌شود و استوری‌ای که آن را لازم دارد، این قدم را در راهنمای ارتقا می‌نویسد.

## آزمون دستی

روی `camunda/camunda:8.10.7` و `postgres:16` در Docker، ۴ آبان ۱۴۰۵. در این آزمون `UNPROTECTEDAPI=true` بود؛ احراز هویت پلاگین با `basic` در STORY-091 آزموده می‌شود.

- موتور با ذخیره‌ی ثانویه‌ی PostgreSQL بالا آمد و ۵۳ جدول در پایگاه داده‌ی `camunda` ساخت. `GET /v2/topology` نسخه‌ی 8.10.7 را برگرداند.
- **مجوز:**
  - `GET /v2/license` این را برگرداند: `{"validLicense":false,"licenseType":"unknown","isCommercial":false}`.
  - لاگ این هشدار را داشت: «No license detected when one is expected».
  - Operate و Tasklist برچسب «Non-production license» و «Non-commercial license» دارند و همه‌ی امکانات کار کرد.
- **کلید کسب‌وکار:**
  - مدل تبدیل‌شده مستقر شد و ۱۴ نمونه با `businessId` از `purchase_requests:1021` تا `purchase_requests:1034` شروع شدند.
  - شروع دوباره با `purchase_requests:1021` پاسخ ۴۰۹ `ALREADY_EXISTS` گرفت.
- **کار انسانی:** جست‌وجوی کارها `candidateGroups=["purchase_manager"]` و `businessId` را داشت. تکمیل با متغیر و واگذاری هر دو ۲۰۴ دادند.
- **کار سرویس:**
  - `jobs/activation` کارها را با `businessId` و متغیرها داد.
  - شکست با `retries: 0` خطای `JOB_NO_RETRIES` ساخت.
  - `PATCH /v2/jobs/{key}` و `POST /v2/incidents/{key}/resolution` خطا را رفع کردند.
- **آمار:** شمار هر مرحله با نمودار Operate یکی بود:
  - «تأیید مدیر»: ۵ فعال و ۹ تمام‌شده
  - «ثبت سفارش»: ۲ فعال، ۱ خطا و ۴ تمام‌شده
- **مدیریت نمونه:** تعلیق و ادامه‌ی نمونه هر دو ۲۰۴ دادند.
- **پیام:** پیام بدون نمونه‌ی منتظر ۴۰۴ `NOT_FOUND` گرفت.
- **سلامت و متریک:** `/actuator/health` روی درگاه 9600 `UP` داد. `/actuator/prometheus` بدون افزونه کار می‌کند.
- **حافظه:** پس از این کارها، کانتینر موتور حدود ۶۶۰ مگابایت و PostgreSQL حدود ۸۰ مگابایت حافظه داشت (با `-Xmx2g`).

### آزمون STORY-091

روی همان نسخه با فایل‌های Compose همین مخزن، ۵ آبان ۱۴۰۵:

- `docker/camunda/check.sh` با هر دو فایل Compose: نسخه 8.10.7، درخواست بی‌رمز ۴۰۱، کاربر سرویس ۲۰۰، ۵۳ جدول در پایگاه داده‌ی `camunda` با مالک `camunda`، و بی‌درگاه بیرونی. همین اسکریپت درگاهی را که با فایل override بیرون آمده بود، پیدا کرد و شکست داد.
- **پاک‌سازی تاریخچه:** با `DEFAULTHISTORYTTL=PT1M`، نمونه‌ی تمام‌شده‌ای که ساعت ۲۰:۴۰:۵۱ تمام شد، تا ۲۰:۴۲:۱۷ از جست‌وجو و از جدول `process_instance` پاک شد.
- **پشتیبان و بازگردانی:**
  - دو نمونه‌ی «درخواست خرید» با کار «تأیید مدیر» باز شروع شدند و پشتیبان سرد گرفته شد.
  - پس از پشتیبان، یکی از کارها تکمیل شد.
  - همه‌چیز با `docker compose down -v` پاک شد و پایگاه داده و پوشه‌ی موتور از پشتیبان برگشتند.
  - هر دو کار با همان کلید برگشتند. تکمیل کار برگشته ۲۰۴ داد و کار سرویس بعدی ساخته شد. شروع دوباره با کلید کسب‌وکار یک نمونه‌ی باز، ۴۰۹ گرفت.
- **رمز کاربر سرویس:** موتور کاربر را فقط بار اول می‌سازد. عوض کردن `BPM_ENGINE_PASSWORD` و ساختن دوباره‌ی کانتینر رمز موتور را عوض نکرد (رمز تازه ۴۰۱، رمز قبلی ۲۰۰). `PUT /v2/users/{username}` رمز را عوض کرد. دستورش در راهنمای نصب است.
- **Compose سرور:** با رمز `change-me`، `camunda-init` با پیام «Set CAMUNDA_DB_PASSWORD in .env to a new password.» ایستاد و موتور بالا نیامد. با رمزهای تازه، پوشه‌ی `storage/camunda` مال کاربر 1001 شد و موتور سالم بالا آمد.
- **پلاگین در ایمیج:** در ایمیجی که `plugin-bpm` را دارد ولی جزو پلاگین‌های پیش‌فرض نیست، پلاگین در «مدیریت پلاگین‌ها» دیده نمی‌شود. `yarn nocobase pm enable @persian-erp/plugin-bpm` آن را بدون راه‌اندازی دوباره روشن کرد.

### آزمون STORY-092

روی همان نسخه با `docker-compose.yml` همین مخزن، ۵ آبان ۱۴۰۵:

- آزمون قرارداد موتور (`engines.test.ts`) با کاربر سرویس و نقش `bpm_service` سبز شد: استقرار مدل و فرم، شروع و شروع تکراری، کار انسانی با فرم پیوندی، پیام، و کار سرویس با تکمیل و شکست.
- کاربر سرویس برای ساختن کاربر ۴۰۳ گرفت و در Operate صفحه‌ی «You don’t have access to this component» دید. کاربر مدیر کاربر ساخت (۲۰۱) و داشبورد Operate را دید.
- کاربر سرویس رمز خودش را نمی‌تواند عوض کند (۴۰۳). کاربر مدیر رمز هر دو کاربر را با `PUT /v2/users/{username}` عوض کرد و رمز تازه چند ثانیه بعد کار کرد.
- دسترسی‌ای که پس از بار اول به تنظیمات اضافه شد (`CANCEL_PROCESS_INSTANCE`)، پس از راه‌اندازی دوباره در `/v2/authorizations/search` نیامد. برای همین همه‌ی دسترسی‌های پیش‌بینی‌شده از اول در نقش هستند.
- `docker/camunda/check.sh` حالا ۴۰۳ کاربر سرویس و ۲۰۰ کاربر مدیر را هم می‌سنجد.

تصویرها در [بخش ۷ طرح سکوی فرایند](../plan/05-process-platform.md#۷-ابزار-خود-موتور-operate-و-tasklist) آمده‌اند.

## پیامدها

- **خوب:**
  - آخرین نسل موتور Camunda.
  - یکتایی کلید کسب‌وکار در خود موتور.
  - Operate و Tasklist برای عیب‌یابی، و APIهای آمار و انتقال نمونه.
  - متریک Prometheus آماده.
  - بدون Elasticsearch.
  - فرایند ساده با گردش‌کار NocoBase و بی‌نیاز به موتور جدا.
- **بد:**
  - مجوز فقط برای محیط غیرعملیاتی است.
  - سنگین‌تر است. Camunda برای یک ماشین دست‌کم ۲ هسته، ۴ گیگابایت حافظه و ۳۲ گیگابایت SSD می‌خواهد. HDD پشتیبانی نمی‌شود. ویندوز برای محیط عملیاتی در فهرست نیست و WSL پیشنهاد شده است.
  - دو جا برای پشتیبان‌گیری هست: volume موتور و پایگاه داده‌ی `camunda`. بازگردانی باید هر دو را با هم برگرداند.
  - مدل‌ها گویش `zeebe:` دارند و مدل‌های Operaton باید تبدیل شوند.
  - دو آداپتور باید نگهداری شوند.
  - ایمیج حدود ۱٫۲ گیگابایت است.

## پرسش‌های باز

- **پشتیبان بدون خاموشی.** پشتیبان سرد موتور را چند ده ثانیه خاموش می‌کند. اگر نصبی خاموشی را نپذیرد، روش رسمی Camunda با فضای ذخیره‌ی پشتیبان لازم است (بخش ۲). پیش‌فرض: پشتیبان سرد.
- **مجوز برای استفاده‌ی واقعی.** پیش از اولین استفاده‌ی واقعی، صاحب پروژه یکی را انتخاب می‌کند: درخواست مجوز غیرتجاری از Camunda، یا اجرای همان نصب با `BPM_ENGINE=operaton`. تا آن وقت، توسعه و آزمون بی‌کلید ادامه دارد.
- **نگهداری بلندمدت آداپتور Operaton.** پیش‌فرض: می‌ماند، با آزمون قرارداد مشترک، تا وقتی نصبی بخواهد بدون کلید مجوز Camunda در محیط عملیاتی کار کند.
