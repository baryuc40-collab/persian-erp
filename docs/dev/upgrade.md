# ارتقای وصله‌ی NocoBase

این فهرست کار برای ارتقای NocoBase به یک وصله‌ی تازه در همان نسخه‌ی فرعی است (مثلاً 2.2.22 به 2.2.24). ارتقای فرعی یا اصلی (2.3، 3.0) اپیک جدا دارد ([تصمیم ۰۰۰۲](../decisions/0002-version-policy.md)).

گردش‌کار `nocobase-release-watch.yml` هر شنبه انتشارهای تازه را می‌بیند و یک issue با برچسب `upgrade` باز می‌کند. هدف ارتقا آخرین نسخه‌ای است که آن issue نام می‌برد.

## ۱. شاخه و ابزار

```bash
git checkout -b chore/nocobase-<نسخه> origin/main
yarn upgrade:nocobase <نسخه> --report upgrade-report.md
```

ابزار این کارها را انجام می‌دهد:
- `NOCOBASE_VERSION` و همه‌ی `@nocobase/*` در `package.json` را عوض می‌کند. نسخه‌ای جز وصله‌ی تازه‌تر را نمی‌پذیرد.
- `yarn install` را اجرا می‌کند.
- کلیدهای ترجمه‌ای را که نسخه‌ی تازه اضافه یا حذف کرده فهرست می‌کند. هر کلید تازه نشان دارد که ترجمه دارد یا نه.
- `LICENSE.txt` دو نسخه را مقایسه می‌کند.

اگر `yarn install` شکست خورد (معمولاً شبکه)، همان دستور را دوباره اجرا کنید. ابزار از همان جا ادامه می‌دهد. `upgrade-report.md` را commit نکنید؛ متن آن در توضیح PR می‌رود.

## ۲. مجوز

اگر گزارش گفت `LICENSE.txt: changed`، متن تازه را بخوانید و با [تصمیم ۰۰۰۱](../decisions/0001-nocobase-license.md) بسنجید. اگر بندی عوض شده که بر این پروژه اثر دارد، ارتقا را متوقف کنید و موضوع را به صاحب پروژه بگویید. اگر `unknown` بود، دو نسخه را از `https://raw.githubusercontent.com/nocobase/nocobase/v<نسخه>/LICENSE.txt` بگیرید و با `diff` مقایسه کنید.

## ۳. ترجمه‌ی کلیدهای تازه

برای هر namespace که در گزارش کلید بی‌ترجمه دارد:

```bash
yarn i18n:translate <namespace>
```

بدون کلید API، از `--export` و `--import` استفاده کنید ([getting-started.md](getting-started.md#ترجمه‌ی-یک-پکیج)). کلیدهای حذف‌شده را از `locales/fa-IR/<namespace>.json` پاک کنید. سپس:

```bash
yarn check:i18n
yarn i18n:report
```

ترجمه‌ی خودکار با بررسی واژه‌نامه کافی است. فقط اگر کلید تازه در صفحه‌های پرکاربرد است (منوها، دکمه‌های اصلی)، آن را در توضیح PR برای بازبینی انسانی نام ببرید.

## ۴. آزمون‌ها

```bash
yarn check:version
yarn build @persian-erp/plugin-fa --no-dts
yarn test --server packages/plugins/@persian-erp --run
yarn test --client packages/plugins/@persian-erp --run
yarn test:tools
```

اگر آزمونی شکست خورد، علت را در تغییرات نسخه‌ی تازه پیدا کنید ([CHANGELOG](https://github.com/nocobase/nocobase/blob/main/CHANGELOG.md)) و پلاگین را اصلاح کنید. آزمون را رد یا غیرفعال نکنید.

## ۵. PR و آزمون‌های تصویری

PR پیش‌نویس باز کنید. در توضیح آن گزارش ابزار را بگذارید (کلیدهای تازه، کلیدهای حذف‌شده، وضعیت مجوز). CI این کارها را انجام می‌دهد:
- آزمون‌ها و آزمون‌های e2e را اجرا می‌کند.
- ایمیج Docker را روی ایمیج رسمی نسخه‌ی تازه می‌سازد و آزمون دود را روی آن اجرا می‌کند.

اگر آزمون تصویری شکست خورد، تصویر اختلاف را در artifact `e2e-results` ببینید:
- تغییر از خود NocoBase است و درست به نظر می‌رسد: برچسب `update-snapshots` را بزنید تا تصویرهای مرجع بازنویسی شوند. در توضیح PR بنویسید کدام صفحه‌ها عوض شدند.
- RTL یا فونت فارسی شکسته است: پیش از ادغام اصلاح کنید.

## ۶. پس از ادغام

- issue ارتقا را با لینک PR ببندید.
- اگر نسخه‌ی تازه باید به دست کاربران برسد، انتشار تازه بسازید (STORY-062).
