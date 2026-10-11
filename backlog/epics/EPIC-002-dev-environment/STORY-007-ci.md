---
id: STORY-007
epic: EPIC-002
title: CI روی Pull Request
status: in-review
model: sonnet
---

# STORY-007: CI روی Pull Request

## روایت
به‌عنوان صاحب پروژه، می‌خواهم هر PR که هوش مصنوعی یا همکاران باز می‌کنند خودکار بررسی شود، تا فقط تغییرات سالم را ادغام کنم.

## معیار پذیرش
- **Given** یک PR **When** باز یا به‌روز می‌شود **Then** GitHub Actions نصب، lint، build پلاگین‌های `@persian-erp/*` و آزمون واحد را اجرا می‌کند
- **Given** PRی که فقط `docs/`، `backlog/` یا `glossary/` را تغییر داده **When** CI اجرا شود **Then** مراحل سنگین build رد می‌شوند و فقط بررسی‌های سبک اجرا می‌شوند
- **Given** فایل `glossary/fa-IR.csv` تغییر کرده **When** CI اجرا شود **Then** ساختار CSV (۴ ستون، بدون `en` تکراری) بررسی می‌شود
- **Given** دو اجرای پشت‌سرهم **When** وابستگی‌ها تغییر نکرده **Then** cache نصب استفاده می‌شود

## یادداشت فنی
- `.github/workflows/ci.yml` با `actions/setup-node` روی Node 22 و cache برای yarn
- سرویس PostgreSQL در job آزمون

## آزمون
- باز کردن یک PR آزمایشی و دیدن نتیجه‌ی سبز

## تعریف انجام‌شده
- [ ] تغییرات در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
