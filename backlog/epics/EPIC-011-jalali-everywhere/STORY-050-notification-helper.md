---
id: STORY-050
epic: EPIC-011
title: تاریخ شمسی در متن پیام اعلان
status: todo
model: sonnet
---

# STORY-050: تاریخ شمسی در متن پیام اعلان

## روایت
به‌عنوان طراح گردش‌کار، می‌خواهم در متن ایمیل یا پیام درون‌برنامه‌ای تاریخ را شمسی بنویسم.

## معیار پذیرش
- **Given** قالب پیام `{{jalali $context.data.createdAt "YYYY/MM/DD"}}` **When** اعلان فرستاده شود **Then** متن پیام `1405/07/20` دارد
- **Given** قالب بدون helper **When** اعلان فرستاده شود **Then** بی‌تغییر است

## یادداشت فنی
- `plugin-notification-manager/src/server/utils/compile.ts` از `Handlebars` در `@nocobase/utils` استفاده می‌کند که بین پلاگین‌ها مشترک است. plugin-fa می‌تواند `Handlebars.registerHelper('jalali', ...)` ثبت کند.
- اول باید دید متغیرهای گردش‌کار (`{{$context...}}`) پیش از Handlebars جایگزین می‌شوند یا بعد از آن.

## تعریف انجام‌شده
- [ ] کد و آزمون در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
