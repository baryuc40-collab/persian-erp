---
id: STORY-059
epic: EPIC-014
title: ایمیج Docker فارسی
status: in-review
model: opus   # ساختار ایمیج رسمی و پیش‌فعال‌سازی پلاگین
---

# STORY-059: ایمیج Docker فارسی

## روایت
به‌عنوان مدیر سیستم، می‌خواهم یک ایمیج Docker آماده داشته باشم، تا NocoBase فارسی را بدون ساختن از کد منبع روی سرورم اجرا کنم.

## معیار پذیرش
- **Given** یک پایگاه داده‌ی خالی PostgreSQL **When** ایمیج با `docker compose up -d` اجرا شود **Then** پس از نصب خودکار، صفحه‌ی ورود فارسی و راست‌به‌چپ است و پلاگین `@persian-erp/plugin-fa` فعال است
- **Given** همان نصب **When** کاربر وارد شود و یک فیلد تاریخ ببیند **Then** تاریخ شمسی است و منطقه‌ی زمانی پیش‌فرض `Asia/Tehran` است
- **Given** ایمیج **When** برچسب نسخه‌اش دیده شود **Then** نسخه‌ی NocoBase آن همان `NOCOBASE_VERSION` است و `yarn check:version` این را در CI می‌سنجد
- **Given** هر PR که پلاگین یا Dockerfile را تغییر دهد **When** CI اجرا شود **Then** ایمیج ساخته می‌شود و یک آزمون دود (بالا آمدن، صفحه‌ی ورود فارسی) روی آن اجرا می‌شود؛ ایمیج منتشر نمی‌شود

## یادداشت فنی
- پایه: `nocobase/nocobase:<NOCOBASE_VERSION>`. نسخه با `ARG` از فایل `NOCOBASE_VERSION` خوانده می‌شود، نه نوشته‌شده در Dockerfile.
- پلاگین با `yarn build @persian-erp/plugin-fa --no-dts` و `yarn tar` ساخته می‌شود. باید دید ایمیج رسمی پلاگین‌های محلی را از کجا می‌خواند. `storage/plugins` در compose رسمی یک volume است و چیزی که در ایمیج آن‌جا گذاشته شود، زیر volume پنهان می‌شود. پس مسیری بیرون از `storage` لازم است.
- پیش‌فعال‌سازی:
  - `APPEND_PRESET_LOCAL_PLUGINS=@persian-erp/plugin-fa` (یا متغیر هم‌ارز همین نسخه)
  - `INIT_APP_LANG=fa-IR`
  - `TZ=Asia/Tehran`
  - هر سه پیش‌فرض ایمیج‌اند و با `.env` عوض می‌شوند.
- فایل‌ها:
  - `docker/Dockerfile`
  - `docker/docker-compose.yml`: ایمیج ما و PostgreSQL 16؛ جدا از `docker-compose.yml` ریشه که برای توسعه است.
  - `docker/.env.example`
- CI: یک job تازه که ایمیج را می‌سازد (بدون push) و آزمون دود را با Playwright یا `curl` اجرا می‌کند.

## آزمون
- آزمون خودکار: job ساخت و آزمون دود در CI.
- بررسی دستی: نصب روی یک ماشین خالی و ورود.

## تصمیم‌ها
- **جای پلاگین در ایمیج:** `/app/nocobase/node_modules/@persian-erp/plugin-fa`. این مسیر بیرون از `storage/` است و volume آن را پنهان نمی‌کند. NocoBase پلاگین را از `NODE_MODULES_PATH` پیدا می‌کند. فایل `yarn tar` با `ADD` در همین مسیر باز می‌شود.
- **پیش‌فعال‌سازی با `APPEND_PRESET_BUILT_IN_PLUGINS`، نه `APPEND_PRESET_LOCAL_PLUGINS`:** در 2.2.22 تابع `getLocalPlugins` در `preset-nocobase` همیشه فهرست خالی برمی‌گرداند. پس پلاگین «محلی» فقط پیدا می‌شود و هنگام نصب فعال نمی‌شود. پلاگین «توکار» هنگام نصب فعال می‌شود. محیط توسعه (`.env.example` ریشه) هم همین را دارد. پیامد: پلاگین فارسی در «مدیریت پلاگین» غیرفعال‌شدنی نیست. برای یک نسخه‌ی فارسی این پذیرفتنی است.
- **پورت:** متغیر `HTTP_PORT` پورت سرور است و به پورت 80 داخل ایمیج (nginx ایمیج رسمی) وصل می‌شود. `APP_PORT` داخل ایمیج دست‌نخورده می‌ماند تا nginx و برنامه هم‌خوان بمانند.
- **برچسب نسخه:**
  - `com.nocobase.version`: همان `NOCOBASE_VERSION`
  - `org.opencontainers.image.version`: `<NOCOBASE_VERSION>-fa.<RELEASE>`. `RELEASE` در ساخت محلی `dev` است و در STORY-062 شماره‌ی انتشار می‌شود.
- **منطقه‌ی زمانی:** `TZ=Asia/Tehran` در ایمیج کار می‌کند. پایه Debian است و `tzdata` دارد. فقط ساعت لاگ و سرور را عوض می‌کند. NocoBase تاریخ را در پایگاه داده UTC نگه می‌دارد.

## پیاده‌سازی
- `docker/Dockerfile`: پایه `nocobase/nocobase:${NOCOBASE_VERSION}` بدون مقدار پیش‌فرض. ساخت بدون نسخه شکست می‌خورد.
- `docker/build.sh`: نسخه را از `NOCOBASE_VERSION` می‌خواند. پلاگین را می‌سازد و با `yarn tar` بسته‌بندی می‌کند، سپس ایمیج را می‌سازد.
- `docker/docker-compose.yml` و `docker/.env.example`: ایمیج منتشرشده و PostgreSQL 16، با `storage/` کنار فایل compose.
- `yarn check:version` اکنون این را هم می‌سنجد که `docker/Dockerfile` نسخه‌ی NocoBase را خودش ننوشته باشد.
- CI، job تازه‌ی «Docker image»:
  - ایمیج را می‌سازد و برچسب `com.nocobase.version` را با `NOCOBASE_VERSION` می‌سنجد.
  - یک نصب تازه با همین compose بالا می‌آورد.
  - منطقه‌ی زمانی سرور را می‌سنجد (`+0330`).
  - آزمون دود Playwright (`docker/smoke/`) را اجرا می‌کند. هیچ چیز push نمی‌شود.
- آزمون دود:
  - صفحه‌ی ورود نصب تازه `dir=rtl` و `lang=fa` است و دکمه‌ی «ورود» دارد.
  - پلاگین فعال است و `appLang` برابر `fa-IR` است.
  - پس از ورود، درخواست‌های داده سرآیند `x-calendar: jalali` دارند و صفحه‌ی کاربران فارسی است.
- بررسی محلی: ایمیج ساخته شد، نصب تازه بالا آمد و هر سه آزمون دود سبز بود.

## پرسش‌های باز
- ~~آیا `APPEND_PRESET_LOCAL_PLUGINS` در 2.2.22 برای پلاگینی که بیرون از `packages/` ایمیج است کار می‌کند؟~~ پلاگین پیدا می‌شود ولی فعال نمی‌شود. به‌جای آن `APPEND_PRESET_BUILT_IN_PLUGINS` به کار رفت (بخش تصمیم‌ها را ببینید).

## تعریف انجام‌شده
- [x] کد و آزمون در یک PR
- [x] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
