---
id: STORY-004
epic: EPIC-002
title: اسکلت پروژه‌ی NocoBase در ریشه‌ی مخزن
status: todo
model: sonnet
---

# STORY-004: اسکلت پروژه‌ی NocoBase در ریشه‌ی مخزن

## روایت
به‌عنوان توسعه‌دهنده، می‌خواهم مخزن خودش یک پروژه‌ی NocoBase باشد که پلاگین‌های ما را در `packages/plugins/@persian-erp/` نگه می‌دارد، تا بدون فورک کردن کل NocoBase روی آن توسعه بدهیم.

## معیار پذیرش
- **Given** مخزن تازه کلون‌شده و Node 22 **When** `yarn install` و `yarn nocobase install` با PostgreSQL محلی **Then** برنامه نصب می‌شود و `yarn dev` آن را بالا می‌آورد
- **Given** `package.json` **When** نسخه‌ی پکیج‌های `@nocobase/*` را می‌بینم **Then** دقیقاً برابر `NOCOBASE_VERSION` است
- **Given** پوشه‌های `docs/`، `backlog/`، `glossary/` **When** اسکلت اضافه شد **Then** دست‌نخورده‌اند
- **Given** `.env.example` **When** آن را می‌خوانم **Then** `INIT_LANG` و تنظیمات PostgreSQL مستند شده‌اند و `.env` در `.gitignore` است

## یادداشت فنی
- `yarn create nocobase-app <dir> -d postgres` با نسخه‌ی `2.2.22`، سپس انتقال فایل‌ها به ریشه
- NocoBase به `node >=22` نیاز دارد (`engines` در `package.json` تگ v2.2.22)

## آزمون
- اجرای کامل نصب روی محیط تمیز و ورود به صفحه‌ی admin

## تعریف انجام‌شده
- [ ] تغییرات در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
