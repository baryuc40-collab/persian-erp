# Persian ERP

یک ERP بدون‌کد (no-code) فارسی بر پایه‌ی [NocoBase](https://github.com/nocobase/nocobase) که ماژول‌هایش را کاربران به‌تدریج می‌سازند و در ادامه برای فرایندهای پیچیده به یک موتور BPMN (مثل Camunda) وصل می‌شود.

## گام اول: فارسی‌سازی NocoBase

نسخه‌ی پایه: **NocoBase v2.2.22** (آخرین نسخه‌ی پایدار شاخه‌ی `main`، منتشرشده در ۸ اکتبر ۲۰۲۶).

| سند | محتوا |
| --- | --- |
| [docs/research/nocobase-i18n.md](docs/research/nocobase-i18n.md) | یافته‌های فنی: معماری ترجمه، RTL، تاریخ، فونت، مجوز |
| [docs/plan/01-roadmap.md](docs/plan/01-roadmap.md) | فازبندی کلان با معیار پایان هر فاز |
| [docs/plan/02-ai-models.md](docs/plan/02-ai-models.md) | هوش مصنوعی از کجا شروع کند و هر مرحله با کدام مدل Claude |
| [docs/plan/03-owner-tasks.md](docs/plan/03-owner-tasks.md) | کارهایی که خود صاحب پروژه باید انجام دهد |
| [docs/plan/04-camunda.md](docs/plan/04-camunda.md) | رویکرد اتصال به Camunda / موتور BPMN |
| [docs/process/epics-and-stories.md](docs/process/epics-and-stories.md) | روش نوشتن اپیک و استوری با هوش مصنوعی |
| [backlog/BACKLOG.md](backlog/BACKLOG.md) | بک‌لاگ اولیه‌ی اپیک‌ها |
| [CLAUDE.md](CLAUDE.md) | قواعد کار برای عامل‌های هوش مصنوعی در این مخزن |

## ساختار مخزن (پیشنهادی)

```
docs/         اسناد برنامه، پژوهش و فرایند
backlog/      اپیک‌ها و استوری‌ها (منبع حقیقت بک‌لاگ)
glossary/     واژه‌نامه‌ی فارسی (فاز ۰)
packages/     پلاگین‌های اختصاصی NocoBase (از فاز ۱ به بعد)
patches/      وصله‌های لازم روی هسته‌ی NocoBase (تا حد امکان کم)
tools/        اسکریپت‌های کمکی (گزارش کلیدهای ترجمه‌نشده و ...)
```
