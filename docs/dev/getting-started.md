# راهنمای اجرا و توسعه

## روش ۱: Docker (پیشنهادی)

پیش‌نیاز: Docker و Docker Compose.

```bash
git clone https://github.com/baryuc40-collab/persian-erp.git
cd persian-erp
cp .env.example .env
# در .env مقدار APP_KEY را عوض کنید: openssl rand -base64 64 | tr -d '\n'
docker compose up -d
docker compose logs -f app
```

بار اول نصب وابستگی‌ها و پایگاه داده چند دقیقه طول می‌کشد. وقتی در لاگ نشانی برنامه آمد، http://localhost:13000 را باز کنید و با `INIT_ROOT_EMAIL` و `INIT_ROOT_PASSWORD` از `.env` وارد شوید.

| کار | دستور |
| --- | --- |
| توقف | `docker compose down` |
| پاک کردن کامل داده‌ها | `docker compose down -v` |
| اجرای دستور داخل برنامه | `docker compose exec app yarn <دستور>` |

## روش ۲: بدون Docker

پیش‌نیاز: Node 22 یا بالاتر، Yarn 1، PostgreSQL 16.

```bash
cp .env.example .env            # APP_KEY را عوض کنید و تنظیمات DB_* را با PostgreSQL خودتان یکی کنید
yarn install --ignore-engines
yarn dev --quickstart           # بار اول نصب، بعد از آن فقط اجرا
```

## دستورهای پرکاربرد

| کار | دستور |
| --- | --- |
| اجرای توسعه | `yarn dev --quickstart` |
| build پلاگین | `yarn build @persian-erp/plugin-fa --no-dts` |
| آزمون پلاگین‌ها | `yarn test --server packages/plugins/@persian-erp --run` |
| آزمون کلاینت پلاگین‌ها | `yarn test --client packages/plugins/@persian-erp --run` |
| آزمون e2e فارسی و RTL (برنامه باید روی پورت 13000 بالا باشد) | `yarn test:e2e` |
| بررسی نسخه‌ی NocoBase | `yarn check:version` |
| بررسی قالب واژه‌نامه | `yarn check:glossary` |
| بررسی ترجمه‌ها با واژه‌نامه | `yarn check:i18n` |
| گزارش پوشش ترجمه | `yarn i18n:report` (گزینه‌ها: `--missing`، `--package <namespace>`، `--json`، `--min <درصد>`) |
| ترجمه‌ی کلیدهای جاافتاده‌ی یک پکیج | `yarn i18n:translate <namespace>` (جزئیات پایین) |
| آزمون ابزارها | `yarn test:tools` |
| ارتقا به وصله‌ی تازه‌ی NocoBase | `yarn upgrade:nocobase <نسخه>` ([فهرست کار](upgrade.md)) |

### آزمون تصویری

`yarn test:e2e` آزمون‌های تصویری `e2e/visual/` را هم اجرا می‌کند. این آزمون‌ها ۱۳ صفحه‌ی کلیدی را به فارسی و انگلیسی عکس‌برداری می‌کنند و با تصویرهای مرجع `e2e/__screenshots__/` می‌سنجند. فهرست صفحه‌ها از [فهرست مشکلات RTL](../research/rtl-audit.md) آمده است. داده‌های لازم (دو گردش‌کار، یکی با شرط و یکی با حلقه، و یک صفحه با بلوک جدول) را خود آزمون می‌سازد.

- تصویرهای مرجع در CI ساخته می‌شوند، چون مرورگر و فونت‌های هر سیستم کمی متفاوت رسم می‌کنند. اگر در یک PR تصویری وجود نداشته باشد، CI آن را می‌سازد و در همان شاخه commit می‌کند.
- اگر تغییری عمداً ظاهر را عوض کرده، برچسب `update-snapshots` را به PR بزنید. CI همه‌ی تصویرهای تغییرکرده را بازنویسی و commit می‌کند و برچسب را برمی‌دارد. تصویرهای جدید را در بخش Files changed همان PR ببینید.
- اگر اختلاف بیش از ۰٫۲ درصد پیکسل‌ها باشد، آزمون شکست می‌خورد. تصویر واقعی، تصویر مرجع و تصویر اختلاف در artifact با نام `e2e-results` ذخیره می‌شوند.
- برای اجرای محلی، اول با `yarn test:e2e --update-snapshots` تصویرهای مرجع محلی بسازید. این تصویرها را commit نکنید.

برای آزمون، فایل `.env.test` لازم است: `sed 's#^APP_ENV=.*#APP_ENV=test#' .env > .env.test`

### زبان فارسی

plugin-fa و plugin-modules با `APPEND_PRESET_BUILT_IN_PLUGINS` در `.env` هنگام نصب فعال می‌شوند. برای اینکه فارسی از همان نصب اول زبان پیش‌فرض باشد، پیش از نصب در `.env` بگذارید `INIT_APP_LANG=fa-IR`.

روی برنامه‌ای که پیش‌تر نصب شده:

1. اگر `@persian-erp/plugin-fa` در «مدیریت پلاگین‌ها» (Plugin manager) فعال نیست، فعالش کنید.
2. در «تنظیمات سیستم» (System settings)، «فارسی (fa-IR)» را به «زبان‌های فعال» اضافه کنید.
3. از منوی کاربر، زبان را فارسی کنید.

ترجمه‌ای که در «مدیریت ترجمه» (Localization) وارد کنید بر ترجمه‌ی plugin-fa برنده است.

وقتی `yarn dev` در حال اجراست، دستورهای CLI مثل `yarn pm enable` را اجرا نکنید. این دستورها `index.html` حالت توسعه را بازنویسی می‌کنند و کلاینت پلاگین‌های محلی دیگر بارگذاری نمی‌شود (صفحه‌ی سفید). اگر اجرا کردید، `yarn dev` را دوباره راه بیندازید. اگر صفحه باز هم سفید ماند، الگوی `index.html` هم بازنویسی شده است. آن را از بسته‌ی اصلی برگردانید و `yarn dev` را دوباره اجرا کنید:

```bash
cp node_modules/@nocobase/app/dist/client/index.html.tpl storage/.app-dev/dist/client/index.html.tpl
```
 جزئیات در [ADR 0003](../decisions/0003-i18n-delivery.md).

### ترجمه‌ی یک پکیج

`yarn i18n:translate <namespace>` کلیدهای ترجمه‌نشده‌ی یک پکیج را با Claude API ترجمه می‌کند و در `plugin-fa/locales/fa-IR/<namespace>.json` می‌نویسد. `<namespace>` همان نامی است که `yarn i18n:report` نشان می‌دهد، مثل `client` یا `workflow`.

- کلید API فقط از متغیر محیطی `ANTHROPIC_API_KEY` خوانده می‌شود. مدل پیش‌فرض را با `--model` یا `I18N_TRANSLATE_MODEL` عوض کنید.
- واژه‌نامه و راهنمای سبک در بخش ثابت پرامپت هستند و cache می‌شوند.
- هر ترجمه با همان قواعد `check:i18n` سنجیده می‌شود. ترجمه‌ی خطادار یک بار دوباره خواسته می‌شود و اگر باز خطا داشت، نوشته نمی‌شود و در خروجی با `REJECTED` می‌آید.
- ترجمه‌های موجود عوض نمی‌شوند، مگر با `--force`. گزینه‌های دیگر: `--limit <n>`، `--batch-size <n>`، `--dry-run`.

بدون کلید API (مثلاً وقتی خود عامل در جلسه ترجمه می‌کند):

```bash
yarn i18n:translate client --export todo.json   # کلیدهای ترجمه‌نشده با متن انگلیسی
# مقدارهای todo.json را فارسی کنید
yarn i18n:translate client --import todo.json   # ادغام، با همان بررسی‌ها
```

## موتور BPMN (اختیاری)

پلاگین `@persian-erp/plugin-bpm` به موتور Operaton وصل می‌شود ([تصمیم ۰۰۰۷](../decisions/0007-bpmn-engine.md)). موتور پشت profile `bpm` است:

```bash
docker compose --profile bpm up -d
```

- موتور در schema جدای `operaton` همان PostgreSQL نصب می‌شود و درگاهش بیرون نمی‌آید.
- کاربر سرویس از `BPM_ENGINE_USERNAME` و `BPM_ENGINE_PASSWORD` در `.env` می‌آید. پیش از استفاده‌ی واقعی رمز `change-me` را عوض کنید.
- پلاگین را در «مدیر پلاگین» فعال کنید. «تنظیمات ← موتور BPMN» اتصال را نشان می‌دهد، «آزمون اتصال» دارد و فایل `.bpmn` را مستقر می‌کند.
- Worker کارهای سرویس در هر نمونه‌ی برنامه اجرا می‌شود و کار هر موضوع را به گردش‌کار با رویداد «کار سرویس BPMN» می‌دهد. `BPM_WORKER=off` آن را خاموش می‌کند و `BPM_WORKER_INTERVAL` فاصله‌ی پرسش از موتور را به میلی‌ثانیه تعیین می‌کند (پیش‌فرض ۲۰۰۰).
- آزمون‌های `OperatonEngine` فقط با `OPERATON_URL` اجرا می‌شوند. دستور اجرای یک موتور آزمایشی در بالای `plugin-bpm/src/server/__tests__/operaton.test.ts` آمده است.

## پلاگین جدید

```bash
yarn pm create @persian-erp/plugin-<نام>
```

پلاگین در `packages/plugins/@persian-erp/` ساخته می‌شود. برای اینکه CI آن را build کند، نامش را به مرحله‌ی «Build plugins» در `.github/workflows/ci.yml` اضافه کنید.

## جلسه‌های ابری Claude

`.claude/hooks/session-start.sh` در شروع هر جلسه‌ی ابری Claude Code روی این مخزن اجرا می‌شود. این hook فایل‌های `.env` و `.env.test` را می‌سازد، یک PostgreSQL محلی راه می‌اندازد و وابستگی‌ها را نصب می‌کند. برنامه‌ی توسعه از پایگاه داده‌ی `nocobase_dev` و آزمون‌ها از `nocobase` استفاده می‌کنند، چون آزمون‌ها پایگاه داده‌ی خود را پاک می‌کنند. روی سیستم خودتان کاری نمی‌کند.

نصب وابستگی‌ها به دامنه‌ی `cdn.sheetjs.com` نیاز دارد (کتابخانه‌ی xlsx که NocoBase استفاده می‌کند). اگر محیط ابری آن را مسدود کند، نصب ناموفق می‌شود و پیامش در `/tmp/persian-erp-install.log` می‌آید. برای رفع آن، این دامنه را در تنظیمات شبکه‌ی محیط ابری پروژه به فهرست دامنه‌های مجاز اضافه کنید.
