---
id: EPIC-002
title: محیط توسعه (پروژه‌ی NocoBase، Docker Compose، PostgreSQL، CI)
phase: 0
status: draft
owner: mmsh
---

# EPIC-002: محیط توسعه

## مسئله
مخزن فعلاً فقط سند دارد. برای ترجمه، RTL و پلاگین‌های فارسی باید NocoBase با نسخه‌ی قفل‌شده و پلاگین‌های خودمان با یک دستور بالا بیاید، هم روی سیستم شما، هم در جلسه‌های ابری Claude، هم در CI.

## هدف و ارزش
با `git clone` و یک دستور، NocoBase v2.2.22 با PostgreSQL و پلاگین‌های `@persian-erp/*` اجرا شود و هر PR به‌صورت خودکار build و آزمون شود.

## دامنه
- تبدیل ریشه‌ی مخزن به یک پروژه‌ی `create-nocobase-app` با PostgreSQL
- Docker Compose برای توسعه (PostgreSQL + برنامه)
- اسکلت پلاگین `@persian-erp/plugin-fa` (خالی، فقط برای اثبات زنجیره‌ی build و فعال‌سازی)
- CI در GitHub Actions: نصب، lint، build، آزمون واحد
- راهنمای اجرای محلی و آماده‌سازی جلسه‌های ابری Claude

## خارج از دامنه
- هر قابلیت فارسی‌سازی (فاز ۱ به بعد)
- محیط عملیاتی و استقرار روی سرور (فاز ۴)
- آزمون‌های تصویری RTL (EPIC-009)

## معیار پذیرش اپیک
- [ ] روی سیستم تمیز با Docker: `docker compose up` و ورود به NocoBase در مرورگر با زبان پیش‌فرض قابل‌تنظیم از `.env`
- [ ] پلاگین `@persian-erp/plugin-fa` در مدیریت افزونه‌ها دیده و فعال می‌شود
- [ ] CI روی هر PR سبز است و زمان اجرایش در README آمده
- [ ] یک جلسه‌ی ابری Claude بدون دخالت دستی می‌تواند برنامه را اجرا و آزمون کند

## وابستگی‌ها
- EPIC-001 / STORY-002 (فایل `NOCOBASE_VERSION`)

## ریسک‌ها
- NocoBase به Node 22 به بالا نیاز دارد؛ نصب وابستگی‌ها سنگین است و CI باید cache داشته باشد.
- تبدیل ریشه‌ی مخزن به پروژه‌ی برنامه ساختار پوشه‌ها را عوض می‌کند؛ `docs/`، `backlog/` و `glossary/` باید دست‌نخورده بمانند.

## پرسش‌های باز
- آیا روی سیستم خودتان Docker دارید، یا محیط توسعه فقط در جلسه‌های ابری و سرور آزمایشی است؟

## استوری‌ها
| شناسه | عنوان | وضعیت |
| --- | --- | --- |
| [STORY-004](STORY-004-app-scaffold.md) | اسکلت پروژه‌ی NocoBase در ریشه‌ی مخزن | todo |
| [STORY-005](STORY-005-docker-compose.md) | Docker Compose با PostgreSQL | todo |
| [STORY-006](STORY-006-plugin-fa-skeleton.md) | اسکلت پلاگین plugin-fa | todo |
| [STORY-007](STORY-007-ci.md) | CI روی Pull Request | todo |
| [STORY-008](STORY-008-dev-guide.md) | راهنمای اجرا و آماده‌سازی جلسه‌های ابری | todo |
