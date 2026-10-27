# ۰۰۰۷: موتور BPMN و طراحی اتصال آن به NocoBase

- **وضعیت:** پیشنهادی (تا تأیید صاحب پروژه). بخش ۱ (موتور و نسخه) و بخش ۲ (پیکربندی) با [تصمیم ۰۰۰۸](0008-camunda8-and-two-builders.md) جایگزین شده‌اند: موتور Camunda 8.10 است و Operaton آداپتور جایگزین می‌ماند. بقیه‌ی بخش‌ها با تغییرهای بخش ۴ تصمیم ۰۰۰۸ برقرارند.
- **تاریخ:** ۲۲ مهر ۱۴۰۵ (۱۴ اکتبر ۲۰۲۶)
- **استوری:** [STORY-078](../../backlog/epics/EPIC-016-bpmn-engine/STORY-078-engine-decision.md)

## زمینه

[برنامه‌ی فاز ۶](../plan/04-camunda.md) اتصال یک موتور BPMN 2.0 را برای فرایندهای طولانی و چندمرحله‌ای پیشنهاد کرد. EPIC-016 این اتصال را در حد اثبات مفهوم می‌خواهد. این سند دو چیز را روشن می‌کند: کدام موتور، و پلاگین `@persian-erp/plugin-bpm` با چه شکلی به آن وصل شود.

سه محدودیت انتخاب را تنگ می‌کند:
- **مجوز:** محصول باید بدون خرید مجوز تجاری خارجی در ایران عرضه شود. پس موتور باید متن‌باز و قابل استفاده در محیط عملیاتی باشد.
- **سادگی اجرا:** نصب کوچک باید با یک `docker compose up` بالا بیاید و پشتیبان‌گیری جدا نخواهد.
- **بدون‌کد:** کاربر فرایند را با ابزارهای NocoBase (گردش‌کار، فرم، نقش) به کار می‌گیرد، نه با رابط موتور.

## گزینه‌ها

| گزینه | مجوز | API | پایگاه داده | ارزیابی |
| --- | --- | --- | --- | --- |
| **Operaton 2.1** | Apache-2.0 (فایل `LICENSE` در ایمیج `operaton/operaton:2.1.5`) | REST سازگار با Camunda 7 (`/engine-rest`) | PostgreSQL، MySQL، H2 و دیگران | **انتخاب** |
| CIB seven 2.0 | Apache-2.0، با پشتیبانی تجاری CIB ([cib.de/seven](https://cib.de/en/seven)) | REST سازگار با Camunda 7 | همان | جایگزین هم‌ارز |
| Camunda 8 Self-Managed | از ۸.۶ برای محیط عملیاتی مجوز تجاری لازم است ([اعلام Camunda](https://camunda.com/blog/2024/10/camunda-licensing-what-you-need-to-know/)) | gRPC و REST، با Zeebe، Elasticsearch و Operate | Elasticsearch یا OpenSearch | رد: مجوز و سنگینی |
| Camunda 7 Community | Apache-2.0 | REST | همان | رد: پایان عمر نسخه‌ی رایگان |

Operaton و CIB seven هر دو فورک Camunda 7 با همان API هستند. Operaton انتخاب شد چون پروژه‌ی جامعه‌محور است، ایمیج رسمی Docker با نسخه‌های پایدار دارد و در [برنامه‌ی فاز ۶](../plan/04-camunda.md) پیش‌فرض بود. چون API یکی است، تعویض با CIB seven فقط تعویض ایمیج است.

## تصمیم

### ۱. موتور و نسخه

- **Operaton 2.1.5**، ایمیج `operaton/operaton:2.1.5`. نسخه مثل `NOCOBASE_VERSION` در یک جا قفل می‌شود و ارتقای آن PR جدا دارد.
- موتور در همان PostgreSQL نصب، در schema جدای `operaton` اجرا می‌شود. این schema با یک اسکریپت init ساخته می‌شود، چون موتور schema را خودش نمی‌سازد. پس یک پشتیبان، هر دو را دارد.

### ۲. پیکربندی لازم

بررسی‌شده روی `operaton/operaton:2.1.5`؛ جزئیات در «آزمون دستی» پایین آمده است.

| تنظیم | مقدار | چرا |
| --- | --- | --- |
| `OPERATON_BPM_RUN_AUTH_ENABLED` | `true` | بدون آن `engine-rest` به هر درخواستی بدون احراز هویت پاسخ می‌دهد. |
| `OPERATON_BPM_ADMIN_USER_ID` و `..._PASSWORD` | کاربر سرویس پلاگین، رمز از secret | پلاگین فقط با این کاربر حرف می‌زند. |
| `OPERATON_BPM_RUN_EXAMPLE_ENABLED` | `false` | وگرنه فرایند نمونه‌ی invoice با چند نمونه‌ی باز مستقر می‌شود. |
| `SPRING_DATASOURCE_*` | `jdbc:postgresql://postgres:5432/<db>?currentSchema=operaton` | پایگاه داده‌ی مشترک، schema جدا |
| درگاه | بدون `ports` در Compose | موتور فقط در شبکه‌ی داخلی است. Cockpit و Tasklist (`/operaton/app`) هم بیرون نمی‌آیند. |

ایمیج موتور با `default.yml` بالا می‌آید که authorization و بررسی deserialization را خاموش دارد. `docker-compose.yml` گزینه‌های `production.yml` را با `SPRING_APPLICATION_JSON` روشن می‌کند ([گزارش PoC](../research/bpmn-poc.md#پیکربندی-پیشفرض-ایمیج-موتور)).

### ۳. رابط `BpmEngine`

پلاگین فقط با این رابط کار می‌کند و `OperatonAdapter` آن را با REST پیاده می‌کند. نام‌ها مستقل از Camunda 7 انتخاب شده‌اند تا `Camunda8Adapter` هم ممکن باشد.

```ts
interface BpmEngine {
  version(): Promise<string>;
  deploy(name: string, files: { name: string; content: Buffer }[]): Promise<{ id: string; processes: ProcessDefinition[] }>;
  listProcesses(): Promise<ProcessDefinition[]>; // آخرین نسخه‌ی هر key
  start(processKey: string, businessKey: string, variables: Variables): Promise<{ instanceId: string; created: boolean }>;
  sendMessage(name: string, businessKey: string, variables?: Variables): Promise<void>;
  listUserTasks(filter: { candidateGroups?: string[]; assignee?: string; businessKey?: string }): Promise<UserTask[]>;
  getUserTask(taskId: string): Promise<UserTask | null>;
  completeUserTask(taskId: string, variables: Variables): Promise<void>;
  fetchServiceTasks(workerId: string, topics: { name: string; lockMs: number }[], max: number): Promise<ServiceTask[]>;
  completeServiceTask(workerId: string, taskId: string, variables?: Variables): Promise<void>;
  failServiceTask(workerId: string, taskId: string, error: { message: string; retries: number; retryMs: number }): Promise<void>;
}
```

`Variables` فقط مقدارهای ساده می‌پذیرد: رشته، عدد، بولی و تاریخ به‌صورت رشته‌ی ISO و UTC. شیء جاوا سریال‌شده پذیرفته نمی‌شود.

### ۴. مالکیت داده

> **رکورد در NocoBase است؛ فرایند فقط کلید رکورد و تصمیم‌ها را نگه می‌دارد.**

- business key هر نمونه `<collection>:<id>` است، مثل `purchase_requests:1`.
- متغیرهای فرایند فقط شناسه‌ها و تصمیم‌ها را دارند، مثل `recordId` و `approved`. فرم کار انسانی داده را از رکورد می‌خواند و در رکورد می‌نویسد، و فقط تصمیم به موتور می‌رود.
- تاریخ در موتور هم UTC است، مثل پایگاه داده‌ی NocoBase. نمایش جلالی فقط در صندوق کار است.

### ۵. هویت و دسترسی

- **نقش‌ها:** candidate group در مدل BPMN نام نقش NocoBase است (مثل `purchase_manager`) و assignee شناسه‌ی کاربر NocoBase.
- **کاربر مستقیم با موتور حرف نمی‌زند.** کاربران NocoBase در موتور ساخته نمی‌شوند. پلاگین کارها را با کاربر سرویس می‌خواند و پیش از نمایش یا تکمیل، نقش‌های کاربر جاری را با candidate groupها و assignee کار می‌سنجد. پس ACL یک جاست: NocoBase.
- اکشن‌های پلاگین (`bpmTasks:list`، `bpmTasks:complete` و مانند آن‌ها) برای همه‌ی کاربران واردشده باز است ولی فقط کارهای خود کاربر را برمی‌گرداند یا می‌پذیرد. استقرار مدل و تنظیمات فقط برای مدیر است.

### ۶. تراکنش و تکرار امن

- شروع فرایند و نوشتن در NocoBase در یک تراکنش نیستند. نود «شروع فرایند» بعد از commit رکورد اجرا می‌شود؛ گردش‌کار رویداد مجموعه همین کار را می‌کند.
- **موتور business key را یکتا نمی‌کند** (بررسی‌شده: دو بار شروع با یک key، دو نمونه می‌سازد). پس `start` اول نمونه‌ی باز با همان key و فرایند را جست‌وجو می‌کند و اگر باشد همان را با `created: false` برمی‌گرداند. برای دو اجرای هم‌زمان، پلاگین یک قفل کوتاه روی business key در پایگاه داده‌ی NocoBase می‌گیرد.
- Worker کار سرویس را با `fetchAndLock` و `workerId` یکتای هر نمونه‌ی برنامه قفل می‌کند. پس در خوشه هر کار یک بار گرفته می‌شود. گردش‌کار NocoBase که کار را انجام می‌دهد باید تکرارپذیر باشد، چون اگر تکمیل پس از اجرا شکست بخورد، کار پس از پایان قفل دوباره گرفته می‌شود.
- شکست با `failServiceTask` و شمارش تلاش گزارش می‌شود. پس از آخرین تلاش موتور incident می‌سازد.

### ۷. جای قطعه‌ها در پلاگین

| قطعه | جا | استوری |
| --- | --- | --- |
| `BpmEngine`، `OperatonAdapter`، تنظیمات اتصال و استقرار مدل | `plugin-bpm/src/server/engine/` و صفحه‌ی «تنظیمات ← موتور BPMN» | STORY-079 |
| نود «شروع فرایند BPMN» | `registerInstruction('bpm-start', ...)` در `plugin-workflow` ([`Plugin.ts`](https://github.com/nocobase/nocobase/blob/v2.2.22/packages/plugins/%40nocobase/plugin-workflow/src/server/Plugin.ts#L320)) | STORY-080 |
| Worker و رویداد گردش‌کار «کار سرویس BPMN» | `plugin-bpm/src/server/worker.ts` و یک trigger گردش‌کار | STORY-081 |
| صندوق کار | اکشن‌های `bpmTasks` و بلوک صفحه‌ی مدرن | STORY-082 |
| فرایند نمونه | [`bpmn/purchase-request.bpmn`](../../bpmn/purchase-request.bpmn) و یک ماژول ERP | STORY-083 |

پلاگین اختیاری است. Operaton در Compose پشت profile `bpm` می‌آید و نصب بدون آن دست نمی‌خورد.

## آزمون دستی

روی `operaton/operaton:2.1.5` و `postgres:16`، با پیکربندی بخش ۲:
- بدون احراز هویت `GET /engine-rest/version` ۴۰۱ می‌دهد و با کاربر سرویس ۲۰۰ و `{"version":"2.1.5"}`.
- با schema `operaton`، موتور ۴۹ جدول در همان schema ساخت.
- مدل [`purchase-request.bpmn`](../../bpmn/purchase-request.bpmn) مستقر شد. استقرار دوباره‌ی همان فایل با `enable-duplicate-filtering` نسخه‌ی تازه نساخت.
- شروع با business key `purchase_requests:1` ← کار «تأیید مدیر» با `candidateGroup=purchase_manager` پیدا شد ← تکمیل با `approved=true` ← کار سرویس `place-order` با `fetchAndLock` و متغیر `recordId` گرفته و تکمیل شد ← نمونه `COMPLETED`.
- شروع دوباره با همان business key، نمونه‌ی دوم ساخت. این دلیل قاعده‌ی بخش ۶ است.
- مصرف حافظه‌ی موتور پس از راه‌اندازی حدود ۶۲۰ مگابایت بود.

## پیامدها

- **خوب:** موتور متن‌باز با مجوز Apache-2.0، بدون وابستگی تجاری. یک پایگاه داده و یک پشتیبان. ACL فقط در NocoBase. رابط پلاگین راه Camunda 8 یا CIB seven را باز نگه می‌دارد.
- **بد:** حدود ۶۰۰ مگابایت حافظه‌ی بیشتر برای نصبی که BPMN می‌خواهد. Cockpit موتور در دسترس کاربر نیست، پس پایش نمونه‌ها تا اپیک بعدی فقط با REST ممکن است. نگاشت نقش به candidate group یعنی تغییر نام نقش در NocoBase مدل BPMN را می‌شکند.

## پرسش‌های باز

- **کاربر سرویس با دسترسی کامل:** پیش‌فرض این است که کاربر سرویس پلاگین مدیر موتور باشد. STORY-083 بررسی می‌کند که آیا authorization موتور با دسترسی کمتر کافی است.
- **نام نقش در مدل:** پیش‌فرض نام فنی نقش (`name`) است، نه عنوان آن، چون عنوان فارسی و تغییرپذیر است.
