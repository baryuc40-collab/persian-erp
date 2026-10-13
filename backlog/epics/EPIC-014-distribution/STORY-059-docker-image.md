---
id: STORY-059
epic: EPIC-014
title: ایمیج Docker فارسی
status: todo
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

## پرسش‌های باز
- آیا `APPEND_PRESET_LOCAL_PLUGINS` در 2.2.22 برای پلاگینی که بیرون از `packages/` ایمیج است کار می‌کند؟ اگر نه، پلاگین در `packages/plugins/@persian-erp/plugin-fa` ایمیج کپی می‌شود.

## تعریف انجام‌شده
- [ ] کد و آزمون در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
