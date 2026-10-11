---
id: STORY-005
epic: EPIC-002
title: Docker Compose با PostgreSQL
status: in-review
model: sonnet
---

# STORY-005: Docker Compose با PostgreSQL

## روایت
به‌عنوان صاحب پروژه، می‌خواهم بدون نصب Node و PostgreSQL روی سیستمم NocoBase فارسی را با یک دستور اجرا کنم، تا هر تغییر را خودم ببینم.

## معیار پذیرش
- **Given** Docker نصب است **When** `cp .env.example .env && docker compose up -d` **Then** پس از آماده‌شدن، `http://localhost:13000` صفحه‌ی ورود NocoBase را نشان می‌دهد
- **Given** `docker compose down` و دوباره `up` **When** وارد می‌شوم **Then** داده‌ها حفظ شده‌اند (volume برای PostgreSQL و storage)
- **Given** کد پلاگین‌ها در `packages/plugins/@persian-erp/` **When** در حالت توسعه تغییر می‌کند **Then** بدون ساخت دوباره‌ی ایمیج قابل‌مشاهده است

## یادداشت فنی
- PostgreSQL با نسخه‌ی مشخص (مثلاً `postgres:16`)، نه `latest`
- سرویس برنامه بر پایه‌ی `node:22`، پوشه‌ی پروژه mount شود
- منطقه‌ی زمانی `TZ=Asia/Tehran` در `.env.example`

## آزمون
- اجرای دستی روی سیستم تمیز؛ مستندسازی در README

## تعریف انجام‌شده
- [ ] تغییرات در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
