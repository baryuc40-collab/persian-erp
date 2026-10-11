# ۰۰۰۳: روش نگه‌داری و بارگذاری ترجمه‌ی فارسی

- **وضعیت:** پذیرفته‌شده
- **تاریخ:** ۱۹ مهر ۱۴۰۵ (۱۱ اکتبر ۲۰۲۶)
- **استوری:** [STORY-013](../../backlog/epics/EPIC-004-i18n-infrastructure/STORY-013-i18n-delivery-adr.md)

## زمینه

پکیج‌های NocoBase از npm نصب می‌شوند و در `node_modules` هستند. هر پکیج ترجمه‌هایش را در `dist/locale/<lang>.json` دارد، ولی هیچ پکیجی `fa-IR.json` ندارد. فایلی که در `node_modules` بگذاریم با هر `yarn install` پاک می‌شود.

بررسی کد NocoBase v2.2.22 نشان داد:

- سرور ترجمه‌ی هر پکیج را با `getResource()` در `packages/core/server/src/locale/resource.ts` می‌خواند و در `Locale.getResources()` (`locale.ts`) برای هر namespace جمع می‌کند.
- `Locale` یک نقطه‌ی گسترش رسمی دارد: `app.localeManager.registerResourceStorer(name, storer)`. خروجی هر storer روی ترجمه‌های خود پکیج‌ها ادغام می‌شود (`deepmerge`). پلاگین رسمی `plugin-localization` هم از همین راه ترجمه‌های ساخت کاربر را اضافه می‌کند.
- **هر دو کلاینت** (legacy در `client/src/nocobase-buildin-plugin/plugins/LocalePlugin.ts` و modern در `client-v2/src/nocobase-buildin-plugin/plugins/LocalePlugin.ts`) ترجمه‌ها را فقط از `app:getLang` سرور می‌گیرند. پس هر چه سرور برگرداند، هر دو کلاینت می‌بینند.
- کد زبان `fa-IR` و نگاشت dayjs آن (`fa`) از قبل در NocoBase هست.

## گزینه‌ها

| گزینه | خوبی | بدی |
| --- | --- | --- |
| ۱. بسته‌ی زبان در plugin-fa با `registerResourceStorer` | بدون وصله‌ی هسته؛ با ارتقا خراب نمی‌شود؛ هر دو کلاینت را پوشش می‌دهد | پلاگین باید فعال باشد |
| ۲. کپی `fa-IR.json` در `node_modules` با `patch-package` یا اسکریپت postinstall | ساختار مثل خود NocoBase | شکننده؛ هر نصب و ارتقا را درگیر می‌کند |
| ۳. فقط PR به مخزن NocoBase | کمترین نگه‌داری در درازمدت | تا ادغام و انتشار، چیزی در دست کاربر نیست |

## تصمیم

**گزینه‌ی ۱، و هم‌زمان گزینه‌ی ۳ در STORY-028.**

1. ترجمه‌ها در `packages/plugins/@persian-erp/plugin-fa/locales/<lang>/<namespace>.json` نگه‌داری می‌شوند. هر فایل یک namespace است، با همان کلیدهای `en-US.json` پکیج اصلی.
2. نام namespace همان نامی است که NocoBase در `app:getLang` می‌فرستد: نام کوتاه پلاگین‌های رسمی بدون پیشوند `@nocobase/plugin-`. نمونه‌ها: `client` برای `@nocobase/client`، `data-source-manager`، `workflow` و `flow-engine`. NocoBase همین ترجمه را خودش به نام کامل پکیج (`@nocobase/plugin-client`) هم کپی می‌کند.
3. plugin-fa در `load()` یک storer ثبت می‌کند (`src/server/locale-pack.ts`). این storer فقط برای `fa-IR` فایل‌ها را می‌خواند و برای زبان‌های دیگر چیزی برنمی‌گرداند.
4. کلیدی که ترجمه نشده، همان متن انگلیسی پکیج اصلی را نشان می‌دهد.
5. ترجمه‌هایی که کاربر در «مدیریت ترجمه» (`plugin-localization`) وارد می‌کند بر بسته‌ی ما برنده‌اند. storerها به ترتیب ثبت ادغام می‌شوند و `plugin-localization` storer خود را در `load()` ثبت می‌کند؛ پس plugin-fa storer را در `beforeLoad()` ثبت می‌کند تا زودتر ثبت شود (STORY-015، آزموده در `get-lang.test.ts`).
6. plugin-fa با `APPEND_PRESET_BUILT_IN_PLUGINS` جزو پلاگین‌های داخلی است: هنگام نصب فعال می‌شود و غیرفعال نمی‌شود. با `INIT_APP_LANG=fa-IR`، فارسی از همان نصب اول زبان پیش‌فرض است.

## پیامدها

- `tools/i18n-report` (STORY-014) کلیدهای `en-US` را از `node_modules/<package>/dist/locale/en-US.json` می‌خواند و با `locales/fa-IR/<namespace>.json` مقایسه می‌کند.
- `tools/glossary-check` فایل‌های `locales/fa-IR/*.json` را هم با منبع انگلیسی‌شان در `node_modules/@nocobase/plugin-<namespace>` می‌سنجد. اگر `node_modules` نصب نباشد (مثل کار سبک CI)، خود کلید متن انگلیسی فرض می‌شود.
- برای PR بالادستی (STORY-028)، هر فایل `locales/fa-IR/<namespace>.json` به `src/locale/fa-IR.json` پکیج متناظر در مخزن NocoBase کپی می‌شود.
- اگر NocoBase روزی خودش `fa-IR.json` منتشر کند، بسته‌ی ما روی آن ادغام می‌شود و اصلاحات ما برنده‌اند. نگه‌داشتن یا حذف بسته‌ی ما در آن زمان یک تصمیم جداست.

## پروتوتایپ

پنج کلید `client` در `locales/fa-IR/client.json` ترجمه شدند. پس از فعال کردن plugin-fa و افزودن فارسی به «زبان‌های فعال»، عنوان صفحه، منوی «تنظیمات سیستم»، «مدیریت پلاگین‌ها»، «زبان‌های فعال» و دکمه‌ی «ثبت» در هر دو کلاینت (`/admin` و `/v/admin`) فارسی نمایش داده شدند. آزمون `src/server/__tests__/locale-pack.test.ts` همین را در سرور می‌سنجد.

## نکته‌های به‌دست‌آمده هنگام پروتوتایپ

- `ResourceStorer.reset` در نوع TypeScript اختیاری است، ولی `Locale.reset()` آن را برای همه‌ی storerها صدا می‌زند. بدون آن، فعال‌سازی پلاگین با خطای `storer.reset is not a function` شکست می‌خورد. plugin-fa یک `reset` خالی دارد. این مورد برای گزارش بالادستی مناسب است.
- اجرای دستورهای CLI مثل `yarn pm enable` وقتی `yarn dev` در حال اجراست، فایل `storage/.app-dev/dist/client/index.html` را با `__nocobase_app_dev__ = false` بازنویسی می‌کند. در نتیجه کلاینت پلاگین‌های محلی بارگذاری نمی‌شود و صفحه سفید می‌ماند. پلاگین را از رابط کاربری یا API فعال کنید، یا بعد از دستور CLI، `yarn dev` را دوباره اجرا کنید.
