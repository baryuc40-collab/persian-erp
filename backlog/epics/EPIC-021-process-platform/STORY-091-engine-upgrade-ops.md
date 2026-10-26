---
id: STORY-091
epic: EPIC-021
title: ارتقای موتور به Operaton 2.2 و تنظیمات عملیاتی
status: todo
model: sonnet
---

# STORY-091: ارتقای موتور به Operaton 2.2 و تنظیمات عملیاتی

## روایت
به‌عنوان مدیر فنی، می‌خواهم موتور روی نسخه‌ی پشتیبانی‌شده باشد، تاریخچه‌اش خودکار پاک شود و در ایمیج انتشار هم باشد، تا فرایند در محیط واقعی بدون رشد بی‌پایان پایگاه داده اجرا شود.

## معیار پذیرش
- **Given** `docker compose --profile bpm up` **When** موتور بالا بیاید **Then** نسخه‌ی موتور 2.2.x است و همه‌ی آزمون‌های EPIC-016 بدون تغییر سبزند.
- **Given** موتور تازه **When** ساعت پنجره‌ی پاک‌سازی برسد **Then** نمونه‌های بسته‌ای که `historyTimeToLive` آن‌ها گذشته پاک می‌شوند.
- **Given** ایمیج `docker/Dockerfile` **When** ساخته شود **Then** `plugin-bpm` در آن هست ولی پیش‌فرض فعال نیست.
- **Given** مدل نمونه‌ی `bpmn/purchase-request.bpmn` **When** در Cockpit یا نمایشگر bpmn-js باز شود **Then** نمودار با DI دیده می‌شود.

## یادداشت فنی
- `docker-compose.yml`: ایمیج `operaton/operaton:2.2.x`. نسخه مثل `NOCOBASE_VERSION` یک جا قفل می‌شود و [تصمیم ۰۰۰۷](../../../docs/decisions/0007-bpmn-engine.md) به‌روز می‌شود.
- تنظیم `historyCleanupBatchWindowStartTime` و `...EndTime` (پیش‌فرض ۰۱:۰۰ تا ۰۵:۰۰ به وقت تهران)، `historyLevel=full` و TTL پیش‌فرض ۱۸۰ روز.
- `/actuator/health` برای بررسی سلامت در Compose و پلاگین.
- مدل نمونه با DI و نام فارسی مرحله‌ها دوباره ذخیره می‌شود.
- `docker/Dockerfile`: افزودن `plugin-bpm` به ایمیج (پیشنهاد ۲ [گزارش PoC](../../../docs/research/bpmn-poc.md#پیشنهاد)).

## آزمون
- آزمون خودکار: آزمون‌های سرور و e2e کار «E2E (BPMN)» روی 2.2.
- بررسی دستی: پاک‌سازی با پنجره‌ی کوتاه و TTL صفر روی یک نمونه‌ی بسته.

## تعریف انجام‌شده
- [ ] کد و آزمون در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
