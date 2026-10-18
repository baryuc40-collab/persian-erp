# راهنمای عامل‌های هوش مصنوعی در این مخزن

## پروژه
ERP بدون‌کد فارسی بر پایه‌ی NocoBase. گام فعلی: فارسی‌سازی NocoBase (ترجمه، RTL، تقویم جلالی، فونت، اعداد). نسخه‌ی NocoBase فقط در فایل `NOCOBASE_VERSION` تعریف می‌شود؛ سیاست ارتقا در `docs/decisions/0002-version-policy.md`.
پیش از هر کار این‌ها را بخوان: `docs/plan/01-roadmap.md`، `docs/research/nocobase-i18n.md`، `backlog/BACKLOG.md`.

## قواعد
- زبان اسناد، اپیک‌ها، استوری‌ها و توضیح PRها: فارسی. نام فایل، شاخه و کد: انگلیسی.
- فقط روی استوری تأییدشده کار کن؛ هر PR یک استوری.
- تغییر در NocoBase تا جای ممکن در قالب پلاگین (`packages/`)؛ تغییر هسته فقط به‌صورت وصله‌ی کوچک در `patches/` با توضیح و لینک PR بالادستی.
- تاریخ در پایگاه داده همیشه میلادی/UTC؛ جلالی فقط در لایه‌ی نمایش و ورودی.
- ترجمه‌ها از `glossary/fa-IR.csv` و `docs/style-guide-fa.md` پیروی می‌کنند؛ متغیرهای `{{...}}` و تگ‌ها دست‌نخورده می‌مانند.
- برای RTL از ویژگی‌های منطقی CSS (`margin-inline-start`، `inset-inline-end`) استفاده کن، نه left/right.
- به شاخه‌ی پیش‌فرض مستقیم push نکن؛ PR پیش‌نویس باز کن.
- اگر ابهام داری، در بخش «پرسش‌های باز» استوری بنویس؛ حدس نزن.

## دستورها
- اجرا: `docker compose up -d` یا `yarn dev --quickstart` (جزئیات در `docs/dev/getting-started.md`)
- build پلاگین: `yarn build @persian-erp/plugin-fa --no-dts`
- آزمون: `yarn test --server packages/plugins/@persian-erp --run` و `yarn test:tools`
- بررسی‌های سبک پیش از PR: `yarn check:version`، `yarn check:glossary`، `yarn check:i18n`
- بررسی فایل ماژول: `yarn check:module <key>.erp-module.json` (قاعده‌ها در `docs/modules/standard.md`)

## مدل‌ها
راهنمای انتخاب مدل در `docs/plan/02-ai-models.md`.
