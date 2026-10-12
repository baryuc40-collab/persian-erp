---
id: STORY-039
epic: EPIC-010
title: نمایش جلالی تاریخ در جدول و جزئیات (v1 و v2)
status: todo
model: sonnet
---

# STORY-039: نمایش جلالی تاریخ در جدول و جزئیات (v1 و v2)

## روایت
به‌عنوان کاربر فارسی‌زبان، می‌خواهم تاریخ‌ها را در جدول و جزئیات جلالی ببینم.

## معیار پذیرش
- **Given** زبان فارسی **When** ستون «زمان ایجاد» جدول کاربران دیده شود **Then** تاریخ جلالی با همان قالب فیلد (مثلاً `YYYY/MM/DD HH:mm`) نمایش داده می‌شود
- **Given** زبان انگلیسی **When** همان ستون دیده شود **Then** تاریخ میلادی و بی‌تغییر است

## یادداشت فنی
- v1: جایگزینی `DatePicker.ReadPretty` و `DatePicker.RangePicker.ReadPretty` (`core/client/src/schema-component/antd/date-picker/ReadPretty.tsx`).
- v2: زیرکلاس `DisplayDateTimeFieldModel` با همان نام در `flowEngine.registerModels`.

## آزمون
- آزمون واحد کامپوننت نمایش؛ آزمون تصویری `page-table` و `users`.

## تعریف انجام‌شده
- [ ] کد و آزمون در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
