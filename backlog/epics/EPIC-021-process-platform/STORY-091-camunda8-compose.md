---
id: STORY-091
epic: EPIC-021
title: Camunda 8.10 در Compose و تنظیمات عملیاتی
status: todo
model: sonnet
---

# STORY-091: Camunda 8.10 در Compose و تنظیمات عملیاتی

## روایت
به‌عنوان مدیر فنی، می‌خواهم Camunda 8.10 با یک فرمان در کنار NocoBase بالا بیاید، داده‌اش در همان PostgreSQL باشد و تاریخچه‌اش خودکار پاک شود، تا موتور تازه بدون Elasticsearch و بدون رشد بی‌پایان داده اجرا شود.

## معیار پذیرش
- **Given** `docker compose --profile bpm up -d` **When** موتور بالا بیاید **Then** `GET /v2/topology` نسخه‌ی `8.10.x` را برمی‌گرداند و ذخیره‌ی ثانویه پایگاه داده‌ی `camunda` در همان سرور PostgreSQL است.
- **Given** موتور در حال اجرا **When** کسی بدون رمز `/v2/process-instances/search` را صدا بزند **Then** ۴۰۱ می‌گیرد. کاربر سرویس پلاگین ۲۰۰ می‌گیرد.
- **Given** فایل Compose **When** خوانده شود **Then** هیچ درگاه موتور (8080، 26500، 9600) بیرون نیامده و Compose برای سلامت از `/actuator/health` روی 9600 استفاده می‌کند.
- **Given** نمونه‌ی تمام‌شده‌ای که از `DEFAULTHISTORYTTL` گذشته **When** پاک‌سازی موتور اجرا شود **Then** نمونه از ذخیره‌ی ثانویه پاک می‌شود. با مقدار کوتاه آزمون می‌شود.
- **Given** پشتیبان شبانه **When** volume موتور و پایگاه داده‌ی `camunda` با هم برگردانده شوند **Then** نمونه‌های باز و کارهایشان همان‌اند که پیش از پشتیبان بودند.
- **Given** `yarn check:version` **When** اجرا شود **Then** نسخه‌ی Camunda فقط در `CAMUNDA_VERSION` تعریف شده است.

## یادداشت فنی
- پیکربندی کامل در بخش ۲ [تصمیم ۰۰۰۸](../../../docs/decisions/0008-camunda8-and-two-builders.md#۲-پیکربندی) آمده است.
  - `camunda/camunda:8.10.7`
  - `SECONDARYSTORAGE_TYPE=rdbms`
  - `BUSINESSIDUNIQUENESSENABLED=true`
  - `DEFAULTHISTORYTTL=P180D`
  - `AUTHENTICATION_METHOD=basic` و `UNPROTECTEDAPI=false`
  - `AUTHORIZATIONS_ENABLED=true`
- اسکریپت init پایگاه داده‌ی `camunda` و کاربرش را می‌سازد. جدول‌ها را خود موتور می‌سازد (auto-ddl).
- volume `camunda-data` برای `/usr/local/camunda/data`.
- سرویس Operaton در Compose با profile `bpm-operaton` می‌ماند تا آداپتور جایگزین آزمون شود.
- راهنمای Camunda برای پشتیبان و ارتقای ذخیره‌ی RDBMS بررسی و نتیجه در [تصمیم ۰۰۰۸](../../../docs/decisions/0008-camunda8-and-two-builders.md#پرسشهای-باز) نوشته می‌شود.
- `docker/Dockerfile`: `plugin-bpm` در ایمیج انتشار می‌آید ولی پیش‌فرض فعال نیست. خود Camunda در ایمیج نیست ([مجوز](../../../docs/decisions/0008-camunda8-and-two-builders.md#مجوز-camunda-8)).
- `docs/dev/getting-started.md`: یک بند درباره‌ی مجوز غیرعملیاتی و حداقل منابع (۴ گیگابایت حافظه).

## آزمون
- آزمون خودکار: کار CI که موتور را با همین پیکربندی بالا می‌آورد و سلامت، ۴۰۱ و ۲۰۰ را می‌سنجد؛ `yarn check:version`.
- بررسی دستی: پاک‌سازی تاریخچه با TTL کوتاه، و پشتیبان و بازگردانی روی یک نصب آزمایشی.

## تعریف انجام‌شده
- [ ] کد و آزمون در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
