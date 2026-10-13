# تقویم جلالی در NocoBase v2.2.22: نقطه‌های نمایش و ورود تاریخ

این سند نتیجه‌ی STORY-037 است. همه‌ی مسیرها در کد NocoBase v2.2.22 و زیر `packages/` هستند. تصمیم بر پایه‌ی این بررسی در [ADR 0004](../decisions/0004-jalali-calendar.md) آمده است.

## خلاصه

- NocoBase هیچ نقطه‌ی گسترشی برای تقویم ندارد. در هسته و پلاگین‌ها اثری از «jalali»، «generateConfig» یا `generatePicker` نیست و تنظیمات سیستم هم فیلد تقویم ندارد. تنها تنظیم‌ها `dateFormat`، `timeFormat` و `picker` هر فیلد است.
- با این حال **بدون وصله‌ی هسته** می‌شود کامپوننت‌ها و مدل‌های تاریخ را جایگزین کرد، چون هر دو رجیستری «آخرین ثبت برنده است» هستند.
- **dayjs را نباید سراسری جلالی کرد.** چند مسیر مقدار ذخیره‌شونده را با `.format('YYYY-MM-DD…')` می‌سازند و با تقویم سراسری جلالی، تاریخ جلالی وارد پایگاه داده می‌شود.

## ۱. کلاینت کلاسیک (v1)

| چه | کجا |
| --- | --- |
| کامپوننت‌ها (`connect()` فرمیلی روی antd) | `core/client/src/schema-component/antd/date-picker/DatePicker.tsx`: `DatePicker` :77، `ReadPretty` :204، `RangePicker` :206، `FilterWithPicker` :319 |
| نمایش فقط‌خواندنی | `date-picker/ReadPretty.tsx:38-51` (تک‌تاریخ) و `:60-77` (بازه): `str2moment(value).format(getDefaultFormat(props))` |
| ساعت | `time-picker/TimePicker.tsx:42-49` |
| تبدیل مقدار انتخاب‌گر به مقدار ذخیره | `date-picker/util.ts`: `moment2str` :60، `toStringByPicker` :15-37 |
| ثبت کامپوننت‌ها | `AntdSchemaComponentProvider.tsx:44-48` با `app.addComponents`؛ `addComponent` در `core/client-v2/src/BaseApplication.tsx:534-548` یک `lodash.set` ساده است |
| رابط‌های فیلد | `'x-component': 'DatePicker'` در `collection-manager/interfaces/datetime.ts:27`، `dateOnly.ts:24`، `datetimeNoTz.ts:27`، `createdAt.ts:26`، `updatedAt.ts:26` |

**نقطه‌ی اتصال:** `app.addComponents({ DatePicker })` در `load()` پلاگین، کامپوننت را برای همه‌ی فیلدهای مبتنی بر schema جایگزین می‌کند. جایگزین باید زیرکامپوننت‌های `RangePicker`، `FilterWithPicker` و `ReadPretty` را هم داشته باشد. کدی که کامپوننت را مستقیم import می‌کند (مثل `DateFilterDynamicComponent.tsx:16,57`) از این جایگزینی بی‌خبر می‌ماند.

ابزارهای قالب‌بندی (`getDefaultFormat`، `str2moment`، `moment2str`، `getPickerFormat`، `toGmt`، `toLocal`) در `core/utils/src/date.ts` هستند و از `@nocobase/utils/client` export می‌شوند. ES module هستند و پلاگین نمی‌تواند جایگزینشان کند.

## ۲. کلاینت جدید (v2)

| چه | کجا |
| --- | --- |
| مدل‌های ویرایش | `core/client-v2/src/flow/models/fields/DateTimeFieldModel/`: `DateTimeTzFieldModel` (createdAt، datetime، updatedAt، unixTimestamp)، `DateOnlyFieldModel` (date)، `DateTimeNoTzFieldModel` (datetimeNoTz) |
| مدل نمایش | `DisplayDateTimeFieldModel.tsx:43-58`: `dayjs(value).format(finalFormat)` |
| مدل‌های فیلتر | `flow/models/blocks/filter-form/fields/date-time/*FilterFieldModel.tsx` و `DateFilterDynamicComponent` |
| ثبت | `client-v2/src/flow/index.ts:35-40` با `flowEngine.registerModels`؛ کلاینت v1 هم همین را بارگذاری می‌کند |

**نقطه‌ی اتصال:** `registerModels` در `flow-engine/src/flowEngine.ts:468-474` مدل هم‌نام را بازنویسی می‌کند (فقط هشدار می‌دهد). پس پلاگین می‌تواند زیرکلاسی از هر مدل را با همان نام ثبت کند. راه دیگر `bindModelToInterface` با شرط `when` است (`flow-engine/src/models/CollectionFieldModel.tsx:236-262`).

## ۳. dayjs

- یک نمونه‌ی مشترک: `core/utils/src/dayjs.ts:26-39`. پلاگین‌ها همان نمونه را از راه requirejs می‌گیرند (`core/client/src/application/utils/globalDeps.ts:111`). پس `dayjs.extend()` پلاگین روی کل برنامه اثر دارد.
- زبان dayjs برای `fa-IR` مقدار `fa` است (`core/client/src/locale/index.ts:38`). این زبان فقط نام ماه‌های میلادی را فارسی می‌کند.
- **خطر تقویم سراسری:** این مسیرها رشته‌ی ذخیره را با `.format()` می‌سازند و با `dayjs.calendar('jalali')` تاریخ جلالی ذخیره می‌کنند: `toGmt`، `toStringByPicker`، `onChange` مدل‌های DateOnly و NoTz، و `dateRangeUtils.ts:69`. فقط مسیرهای `toISOString()` امن‌اند.

## ۴. antd و rc-picker

- antd نسخه‌ی 5.24.2 و rc-picker نسخه‌ی 4.11.3 است. NocoBase همان `DatePicker` پیش‌فرض dayjs را به کار می‌برد.
- `DatePicker.generatePicker(generateConfig)` در antd هست، پس یک `generateConfig` جلالی کافی است و rc-picker لازم نیست جدا بارگذاری شود (فقط نوع‌ها).
- زبان antd از `ConfigProvider` در `core/client/src/antd-config-provider/index.tsx:70` و `flow-engine/src/provider.tsx:94` می‌آید.

## ۵. نمایش‌های دیگر تاریخ (برای EPIC-011)

| بخش | کجا | پایه |
| --- | --- | --- |
| فیلترهای نسبی («این ماه») | `core/utils/src/parse-filter.ts:290-320`، `dateRangeUtils.ts:41-69`، `useDateVariable.ts` | `dayjs.startOf` میلادی |
| بلوک تقویم | `plugin-calendar/src/client/calendar/Calendar.tsx`، `client-v2/models/components/CalendarBlock.tsx` | react-big-calendar و date-fns |
| گانت | `plugin-gantt/src/client{,-v2}/.../helpers/date-helper.ts` | `Date` و `toLocaleDateString` |
| نمودار | `plugin-data-visualization/src/client/transformers.ts:58-82` | `dayjs().format` |
| خروجی اکسل | سرور: `plugin-action-export/src/server/services/base-exporter.ts:298` ← `core/database/src/interfaces/datetime-interface.ts:204-208` | قابل جایگزینی با `db.interfaceManager.registerInterfaceType` |
| ورود داده | `plugin-action-import/src/server/utils/transform.ts` | |

## ۶. کتابخانه‌ها

| بسته | نسخه | مجوز | توضیح |
| --- | --- | --- | --- |
| `jalaliday` | 3.1.1 | MIT | افزونه‌ی dayjs؛ تقویم را برای هر نمونه با `.calendar('jalali')` عوض می‌کند و پیش‌فرض را میلادی نگه می‌دارد |
| `antd-jalali` | 2.0.1 | MIT | `generateConfig` جلالی برای antd v5 بر پایه‌ی jalaliday؛ وابسته به jalaliday 2.x |

## ۷. گردش‌کار (STORY-047)

گردش‌کار بدون درخواست کاربر اجرا می‌شود، پس سرآیند `X-Calendar` (STORY-042) آنجا نیست و سرور نمی‌داند تقویم چه کسی را به کار ببرد.

| نقطه | کجا | وضعیت | پیشنهاد |
| --- | --- | --- | --- |
| متغیرهای بازه‌ی تاریخ (`dateRange.thisMonth` و ...) | `plugin-workflow/src/server/functions/index.ts` با `functions.register` | میلادی، با منطقه‌ی زمانی سرور | ثبت دوباره‌ی همین نام‌ها با بازه‌ی شمسی (`shared/jalali-ranges.ts`)، به شرط یک تنظیم سیستمی «تقویم پیش‌فرض: شمسی». `functions` یک Registry است و ثبت دوباره جایگزین می‌کند. |
| تریگر زمان‌بندی ثابت (تکرار ماهانه و cron) | `plugin-workflow/src/server/triggers/ScheduleTrigger/StaticScheduleTrigger.ts` با `cron-parser` | میلادی | cron نمی‌تواند «اول هر ماه شمسی» را بیان کند. راه ممکن: یک تریگر تازه یا تکرار روزانه به همراه شرط «امروز اول ماه شمسی است» با یک تابع `jalali.isMonthStart`. |
| تریگر زمان‌بندی بر پایه‌ی فیلد تاریخ | `DateFieldScheduleTrigger.ts` | فاصله‌ها روزانه‌اند | به تقویم بستگی ندارد. |
| متن پیام اعلان | `plugin-notification-manager/src/server/utils/compile.ts` با `Handlebars` از `@nocobase/utils` | تاریخ به شکل ISO | `Handlebars` بین پلاگین‌ها مشترک است. پس plugin-fa می‌تواند helper به نام `jalali` ثبت کند (`{{jalali date "YYYY/MM/DD"}}`). باید بررسی شود که متغیرهای گردش‌کار پیش از Handlebars جایگزین می‌شوند یا نه. |
| فیلتر نود «پرس‌وجو» | `{{$nDate.thisMonth}}` در فیلتر نود | میلادی، بدون سرآیند | با همان تنظیم سیستمی، میان‌افزار STORY-042 می‌تواند برای کارهای بدون درخواست هم شمسی حساب کند. |

نتیجه: پیش‌نیاز مشترک همه‌ی این موارد یک **تنظیم سیستمی تقویم پیش‌فرض** است (STORY-048). بعد از آن، متغیرهای بازه‌ی شمسی (STORY-049) و helper قالب پیام (STORY-050) کار کوچکی‌اند.

## ۸. بلوک تقویم و گانت (STORY-045 و STORY-046)

- react-big-calendar و date-fns در بسته‌ی ساخته‌شده‌ی `plugin-calendar` قرار دارند و بین پلاگین‌ها مشترک نیستند. localizer هم درون کامپوننت ساخته می‌شود (`Calendar.tsx:349`، `CalendarBlock.tsx:351`). پس از بیرون نمی‌شود جایش را گرفت.
- قالب‌های عنوان (`monthHeaderFormat` و ...) با نشانه‌های date-fns نوشته شده‌اند و نوار ابزار، سرستون‌ها و بازه‌ی دیده‌شده هم جداگانه با dayjs و date-fns حساب می‌شوند. در مجموع ده فایل و حدود ۲۰۰۰ خط درگیرند.
- گانت با `Date` خام و `getMonth()` کار می‌کند (`plugin-gantt/src/client{,-v2}/.../date-helper.ts` و `components/calendar/calendar.tsx`).
- وصله زدن روی کد ساخته‌شده و فشرده‌ی این دو پلاگین شکننده است و با هر نسخه می‌شکند. نوشتن دوباره‌ی آن‌ها در plugin-fa هم مجاز نیست، چون کدشان AGPL است و plugin-fa مجوز Apache دارد.
- تصمیم: این دو استوری منتظر یک نقطه‌ی گسترش در خود NocoBase می‌مانند: «تقویم پیش‌فرض قابل‌تعویض برای بلوک تقویم و گانت» (adapter تاریخ). متن پیشنهادی issue در `/mnt/project-files/upstream/calendar-adapter-issue.md` آماده است.
