---
id: STORY-003
epic: EPIC-001
title: گزارش خودکار نسخه‌ی پایدار جدید
status: in-review
model: sonnet
---

# STORY-003: گزارش خودکار نسخه‌ی پایدار جدید

## روایت
به‌عنوان صاحب پروژه، می‌خواهم وقتی NocoBase نسخه‌ی پایدار جدیدی منتشر کرد خبردار شوم، تا ارتقا را آگاهانه زمان‌بندی کنم.

## معیار پذیرش
- **Given** یک GitHub Action زمان‌بندی‌شده (هفتگی) **When** تگ پایدار جدیدتر از `NOCOBASE_VERSION` در `nocobase/nocobase` وجود دارد **Then** یک Issue با برچسب `upgrade`، فهرست نسخه‌های جدید و لینک CHANGELOG ساخته می‌شود
- **Given** Issue باز برای همان نسخه **When** Action دوباره اجرا شود **Then** Issue تکراری ساخته نمی‌شود
- **Given** تگ‌های alpha و beta **When** Action اجرا شود **Then** نادیده گرفته می‌شوند

## یادداشت فنی
- `git ls-remote --tags https://github.com/nocobase/nocobase` و حذف `alpha|beta`
- فایل: `.github/workflows/nocobase-release-watch.yml`
- وابسته به STORY-002 (فایل `NOCOBASE_VERSION`)

## آزمون
- اجرای دستی Action با `workflow_dispatch` و یک نسخه‌ی قدیمی‌تر در ورودی

## تعریف انجام‌شده
- [ ] تغییرات در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
