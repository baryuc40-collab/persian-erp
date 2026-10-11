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
| بررسی نسخه‌ی NocoBase | `yarn check:version` |
| بررسی قالب واژه‌نامه | `yarn check:glossary` |
| بررسی ترجمه‌ها با واژه‌نامه | `yarn check:i18n` |
| آزمون ابزارها | `yarn test:tools` |

برای آزمون، فایل `.env.test` لازم است: `sed 's#^APP_ENV=.*#APP_ENV=test#' .env > .env.test`

### فعال کردن plugin-fa و زبان فارسی

1. در «مدیریت پلاگین‌ها» (Plugin manager)، `@persian-erp/plugin-fa` را فعال کنید.
2. در «تنظیمات سیستم» (System settings)، «فارسی (fa-IR)» را به «زبان‌های فعال» اضافه کنید.
3. از منوی کاربر، زبان را فارسی کنید.

وقتی `yarn dev` در حال اجراست، دستورهای CLI مثل `yarn pm enable` را اجرا نکنید. این دستورها `index.html` حالت توسعه را بازنویسی می‌کنند و کلاینت پلاگین‌های محلی دیگر بارگذاری نمی‌شود (صفحه‌ی سفید). اگر اجرا کردید، `yarn dev` را دوباره راه بیندازید. جزئیات در [ADR 0003](../decisions/0003-i18n-delivery.md).

## پلاگین جدید

```bash
yarn pm create @persian-erp/plugin-<نام>
```

پلاگین در `packages/plugins/@persian-erp/` ساخته می‌شود. برای اینکه CI آن را build کند، نامش را به مرحله‌ی «Build plugins» در `.github/workflows/ci.yml` اضافه کنید.

## جلسه‌های ابری Claude

`.claude/hooks/session-start.sh` در شروع هر جلسه‌ی ابری Claude Code روی این مخزن اجرا می‌شود. این hook فایل‌های `.env` و `.env.test` را می‌سازد، یک PostgreSQL محلی راه می‌اندازد و وابستگی‌ها را نصب می‌کند. روی سیستم خودتان کاری نمی‌کند.

نصب وابستگی‌ها به دامنه‌ی `cdn.sheetjs.com` نیاز دارد (کتابخانه‌ی xlsx که NocoBase استفاده می‌کند). اگر محیط ابری آن را مسدود کند، نصب ناموفق می‌شود و پیامش در `/tmp/persian-erp-install.log` می‌آید. برای رفع آن، این دامنه را در تنظیمات شبکه‌ی محیط ابری پروژه به فهرست دامنه‌های مجاز اضافه کنید.
