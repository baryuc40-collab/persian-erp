---
id: STORY-038
epic: EPIC-010
title: هسته‌ی جلالی plugin-fa: jalaliday و generateConfig
status: todo
model: opus
---

# STORY-038: هسته‌ی جلالی plugin-fa: jalaliday و generateConfig

## روایت
به‌عنوان توسعه‌دهنده، می‌خواهم ابزار مشترکی برای تبدیل و قالب‌بندی جلالی داشته باشم، تا استوری‌های نمایش و انتخاب‌گر روی آن ساخته شوند.

## معیار پذیرش
- **Given** plugin-fa بارگذاری شده **When** `dayjs().format()` در هر جای برنامه صدا زده شود **Then** خروجی میلادی است (تقویم پیش‌فرض عوض نشده)
- **Given** تاریخ ۲۰۲۶-۱۰-۱۲ **When** با ابزار جلالی قالب‌بندی شود **Then** «۱۴۰۵/۰۷/۲۰» با ارقام لاتین برمی‌گردد
- **Given** `generateConfig` جلالی **When** آزمون‌های rc-picker برای افزودن ماه، آغاز هفته و تجزیه‌ی رشته اجرا شوند **Then** نتیجه درست است و تبدیل رفت‌وبرگشت تاریخ را عوض نمی‌کند

## یادداشت فنی
- `jalaliday` به وابستگی‌های plugin-fa اضافه می‌شود؛ `dayjs` از نمونه‌ی مشترک NocoBase می‌آید (requirejs).
- `src/client/jalali/`: `toJalali(value)`، `formatJalali(value, format)`، `jalaliGenerateConfig`.
- آغاز هفته شنبه است.

## آزمون
- آزمون واحد vitest برای تبدیل، قالب‌بندی، `generateConfig` و ثابت ماندن تقویم پیش‌فرض.

## تعریف انجام‌شده
- [ ] کد و آزمون در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
