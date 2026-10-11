---
id: STORY-006
epic: EPIC-002
title: اسکلت پلاگین plugin-fa
status: todo
model: sonnet
---

# STORY-006: اسکلت پلاگین plugin-fa

## روایت
به‌عنوان توسعه‌دهنده، می‌خواهم پلاگین `@persian-erp/plugin-fa` از همین ابتدا وجود داشته باشد و فعال شود، تا کار RTL، فونت و جلالی در فازهای بعد فقط محتوا اضافه کند و زنجیره‌ی build از قبل آزموده باشد.

## معیار پذیرش
- **Given** برنامه در حال اجرا **When** به مدیریت افزونه‌ها می‌روم **Then** «فارسی‌سازی» (`@persian-erp/plugin-fa`) با توضیح فارسی دیده می‌شود و فعال می‌شود
- **Given** پلاگین فعال **When** صفحه بارگذاری می‌شود **Then** یک Provider خالی از طریق `this.app.use(...)` ثبت شده و هیچ تغییر بصری ندارد
- **Given** پلاگین **When** `yarn build @persian-erp/plugin-fa` **Then** بدون خطا build می‌شود
- **Given** پوشه‌ی `src/locale/` پلاگین **When** آن را می‌بینم **Then** `en-US.json` و `fa-IR.json` برای نام و توضیح پلاگین وجود دارد

## یادداشت فنی
- `yarn pm create @persian-erp/plugin-fa`
- الگوی ثبت Provider: `packages/plugins/@nocobase/plugin-theme-editor/src/client/index.tsx` (`this.app.use(CustomThemeProvider)`)
- برای هر دو کلاینت (legacy و modern) بررسی شود که پلاگین قابل‌بارگذاری است

## آزمون
- یک آزمون واحد که فعال‌شدن پلاگین را بررسی کند

## تعریف انجام‌شده
- [ ] تغییرات در یک PR
- [ ] PR به این استوری لینک دارد
- [ ] بازبینی شد و ادغام شد
