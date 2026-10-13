---
id: STORY-050
epic: EPIC-011
title: تاریخ شمسی در متن پیام اعلان
status: done
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

## پیاده‌سازی
- `server/jalali-handlebars.ts` در `load` یک helper به نام `jalali` روی `Handlebars` از `@nocobase/utils` ثبت می‌کند:
  - `{{jalali $context.data.createdAt}}` ← `1405/07/21`
  - `{{jalali $context.data.createdAt "dddd D MMMM YYYY، HH:mm"}}` ← `سه‌شنبه 21 مهر 1405، 01:30`
  - `tz="+00:00"` منطقه‌ی زمانی را عوض می‌کند.
- منطقه‌ی زمانی پیش‌فرض `Asia/Tehran` است، چون پیام بدون درخواست کاربر فرستاده می‌شود و سرورها معمولاً UTC هستند. این تصمیم به STORY-048 وابسته نیست.
- گردش‌کار فیلد «محتوا» را دست‌نخورده به سرویس اعلان می‌دهد و Handlebars آن را با `$context` و بقیه‌ی متغیرهای گردش‌کار می‌سازد (`plugin-workflow-notification/src/server/NotificationInstruction.ts`).
- فیلدهای دیگر، مثل «عنوان»، اول با قالب‌ساز خود گردش‌کار پر می‌شوند. آن قالب‌ساز `{{jalali $context.x}}` بدون قالب را متغیر ناشناخته می‌گیرد و خالی می‌کند. ولی شکلی که قالب داخل `"..."` دارد را دست نمی‌زند، چون `"` در الگوی آن نیست. پس در عنوان همیشه قالب را بنویسید: `{{jalali $context.data.createdAt "YYYY/MM/DD"}}`.

## تعریف انجام‌شده
- [x] کد و آزمون در یک PR
- [x] PR به این استوری لینک دارد ([#53](https://github.com/baryuc40-collab/persian-erp/pull/53))
- [x] بازبینی شد و ادغام شد
