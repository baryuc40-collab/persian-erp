---
id: STORY-091
epic: EPIC-021
title: Camunda 8.10 در Compose و تنظیمات عملیاتی
status: done
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

## پیاده‌سازی
- **نسخه:** فایل [`CAMUNDA_VERSION`](../../../CAMUNDA_VERSION) با `8.10.7`. Compose نسخه را از فایل نمی‌خواند، پس [`tools/check-camunda-version`](../../../tools/check-camunda-version/index.js) (بخشی از `yarn check:version` و کار «Lightweight checks» در CI) هر `camunda/camunda:<نسخه>` در دو فایل Compose و گردش‌کارهای CI را با آن می‌سنجد.
- **Compose توسعه** ([`docker-compose.yml`](../../../docker-compose.yml)) و **Compose سرور** ([`docker/docker-compose.yml`](../../../docker/docker-compose.yml)): سرویس‌های `camunda-init` و `camunda` پشت profile `bpm`، با پیکربندی بخش ۲ تصمیم ۰۰۰۸، سلامت روی 9600، بدون درگاه بیرونی، لاگ چرخشی و ۶۰ ثانیه فرصت بستن. داده در volume `camunda-data` (توسعه) یا `storage/camunda` (سرور).
  - `camunda-init` پیش از هر بالا آمدن، کاربر و پایگاه داده‌ی `camunda` را اگر نباشند می‌سازد، رمز را با `.env` یکی می‌کند، دسترسی PUBLIC را برمی‌دارد و پوشه‌ی داده را به کاربر موتور (1001) می‌دهد. در Compose سرور، با رمز خالی یا `change-me` موتور را بالا نمی‌آورد.
  - `app` با `BPM_ENGINE` (پیش‌فرض `camunda8`) و `BPM_ENGINE_URL` (پیش‌فرض `http://camunda:8080`) به موتور اشاره می‌کند. خود پلاگین `BPM_ENGINE` را از STORY-092 می‌خواند.
  - Operaton با profile `bpm-operaton` ماند.
- **بررسی موتور:** [`docker/camunda/check.sh`](../../../docker/camunda/check.sh) نسخه، ۴۰۱ بی‌رمز، ۲۰۰ کاربر سرویس، ذخیره‌ی ثانویه در پایگاه داده‌ی `camunda` و نبود درگاه بیرونی را می‌سنجد. فقط از `wget` خود موتور و `psql` خود PostgreSQL استفاده می‌کند.
- **ایمیج:** `plugin-bpm` در ایمیج انتشار هست ولی روشن نیست ([`docker/Dockerfile`](../../../docker/Dockerfile)، [`docker/build.sh`](../../../docker/build.sh)). خود Camunda در ایمیج نیست.
- **اسناد:** بخش «موتور فرایند» در [`docs/dev/getting-started.md`](../../../docs/dev/getting-started.md) و [`docs/install/README.md`](../../../docs/install/README.md): مجوز، حافظه، روشن کردن، عوض کردن رمز، پشتیبان و بازگردانی با موتور، و ارتقای موتور. سیاست ارتقا و پشتیبان و نتیجه‌ی آزمون‌ها در [تصمیم ۰۰۰۸](../../../docs/decisions/0008-camunda8-and-two-builders.md#آزمون-story-091).

### آزمون
- کار تازه‌ی «Camunda 8 (Compose)» در CI، با هر دو فایل Compose: موتور را بالا می‌آورد و `docker/camunda/check.sh` را اجرا می‌کند.
- آزمون ابزار `tools/check-camunda-version` در `yarn test:tools`.
- کار «Docker image» CI: `plugin-bpm` در ایمیج هست و آزمون دود می‌سنجد که روشن نیست.
- بررسی دستی (جزئیات در تصمیم ۰۰۰۸): پاک‌سازی تاریخچه با TTL یک دقیقه، پشتیبان سرد و بازگردانی با دو کار باز، عوض کردن رمز کاربر سرویس، رد رمز `change-me` در Compose سرور، و روشن کردن `plugin-bpm` در ایمیج.

## پرسش‌های باز
- **پلاگین در «مدیریت پلاگین‌ها» دیده نمی‌شود.** NocoBase پلاگین محلی‌ای را که در فهرست پیش‌فرض نیست، در این صفحه نشان نمی‌دهد. پس روشن کردن با دستور `pm enable` است. اگر صاحب پروژه بخواهد، `plugin-bpm` با `COMPOSE_PROFILES=bpm` خودکار روشن شود، کار جدایی است.

## تعریف انجام‌شده
- [x] کد و آزمون در یک PR
- [x] PR به این استوری لینک دارد
- [x] بازبینی شد و ادغام شد
