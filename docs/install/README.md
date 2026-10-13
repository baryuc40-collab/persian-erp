# راهنمای نصب NocoBase فارسی

این راهنما برای مدیر سیستم است. با آن NocoBase فارسی را روی یک سرور لینوکس با Docker نصب می‌کنید، از آن پشتیبان می‌گیرید و آن را ارتقا می‌دهید. برای اجرای برنامه از روی کد (توسعه) [docs/dev/getting-started.md](../dev/getting-started.md) را ببینید.

نسخه‌ی فارسی همان NocoBase رسمی است و فقط پلاگین فارسی‌سازی (`@persian-erp/plugin-fa`) روی آن نصب و فعال شده است. نام هر نسخه دو بخش دارد: نسخه‌ی NocoBase و شماره‌ی انتشار فارسی، مثل `2.2.22-fa.1`.

## نصب

پیش‌نیاز: سرور لینوکس با Docker و Docker Compose (دستور `docker compose version` باید کار کند)، و دست‌کم ۲ گیگابایت حافظه.

```bash
mkdir -p /opt/persian-erp && cd /opt/persian-erp
curl -fsSLO https://raw.githubusercontent.com/baryuc40-collab/persian-erp/main/docker/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/baryuc40-collab/persian-erp/main/docker/.env.example
sed -i "s/^APP_KEY=.*/APP_KEY=$(openssl rand -hex 32)/; s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 16)/" .env
nano .env
```

در `nano` این سه مقدار را عوض کنید و فایل را ذخیره کنید (Ctrl+O، Enter، Ctrl+X):
- `INIT_ROOT_EMAIL`: ایمیل مدیر سیستم
- `INIT_ROOT_PASSWORD`: رمز مدیر سیستم
- `IMAGE_TAG`: نسخه‌ای که نصب می‌کنید، از [صفحه‌ی انتشارها](https://github.com/baryuc40-collab/persian-erp/releases)

```bash
docker compose up -d
docker compose logs -f app
```

وقتی در لاگ عبارت `app has been started` آمد، Ctrl+C بزنید و `http://<نشانی سرور>:13000` را باز کنید. با `INIT_ROOT_EMAIL` و `INIT_ROOT_PASSWORD` وارد شوید. بار اول نصب پایگاه داده چند دقیقه طول می‌کشد.

نکته‌ها:
- `APP_KEY` نشست‌های کاربران را امضا می‌کند. آن را عوض نکنید و همراه پشتیبان نگه دارید.
- پورت را با `HTTP_PORT` در `.env` عوض کنید.
- همه‌ی داده‌ها در پوشه‌ی `storage` کنار `docker-compose.yml` است: پایگاه داده در `storage/db/postgres` و فایل‌های بارگذاری‌شده در `storage/uploads`.
- زبان، تقویم جلالی و منطقه‌ی زمانی تهران پیش‌فرض‌اند. برای تغییر، `INIT_APP_LANG` و `TZ` را پیش از اولین `up` در `.env` عوض کنید.

## HTTPS

ایمیج فقط HTTP دارد. برای HTTPS یک reverse proxy جلوی آن بگذارید که گواهی را بگیرد و درخواست‌ها را به `HTTP_PORT` بفرستد. ساده‌ترین راه Caddy است. Caddy گواهی Let's Encrypt را خودش می‌گیرد و این `Caddyfile` (با دامنه‌ی خودتان) برایش کافی است:

```
erp.example.com {
	reverse_proxy localhost:13000
}
```

جزئیات و نمونه‌ی nginx در [راهنمای استقرار NocoBase](https://docs.nocobase.com/get-started/deployment/production) است.

## پشتیبان‌گیری

این دستورها یک فایل پشتیبان با تاریخ ساخت در پوشه‌ی `backups` می‌سازند. برنامه در این مدت کار می‌کند.

```bash
cd /opt/persian-erp
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/db.dump
tar czf "backups/persian-erp-$(date +%Y%m%d-%H%M).tar.gz" --exclude=storage/db .env backups/db.dump storage
rm backups/db.dump
```

فایل `tar.gz` را به جای دیگری (سرور دیگر یا فضای ابری) منتقل کنید. پشتیبانی که روی همان سرور بماند، با خراب شدن سرور از دست می‌رود. برای پشتیبان‌گیری خودکار شبانه، این دستورها را در یک فایل بگذارید و با `cron` اجرا کنید.

### بازگردانی

روی سرور تازه (یا پس از پاک کردن نصب قبلی)، فایل پشتیبان را در `/opt/persian-erp` بگذارید. سپس `<file>` را با نام آن عوض کنید:

```bash
cd /opt/persian-erp
curl -fsSLO https://raw.githubusercontent.com/baryuc40-collab/persian-erp/main/docker/docker-compose.yml
tar xzf <file>.tar.gz
docker compose up -d postgres
docker compose exec -T postgres sh -c 'until pg_isready -q -h localhost; do sleep 1; done'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < backups/db.dump
docker compose up -d
```

`.env` از پشتیبان برمی‌گردد، پس `APP_KEY` و رمزها همان قبلی‌اند و کاربران با همان رمزها وارد می‌شوند.

## ارتقا

هر انتشار تازه در [صفحه‌ی انتشارها](https://github.com/baryuc40-collab/persian-erp/releases) یادداشتی دارد که می‌گوید چه چیزی عوض شده است. پیش از ارتقا پشتیبان بگیرید (بخش بالا). سپس `IMAGE_TAG` را در `.env` به نسخه‌ی تازه عوض کنید:

```bash
cd /opt/persian-erp
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<نسخه‌ی تازه>/' .env
docker compose pull app
docker compose up -d
docker compose logs -f app
```

برنامه هنگام بالا آمدن پایگاه داده را خودش ارتقا می‌دهد و داده‌ها می‌مانند. اگر ارتقا شکست خورد، `IMAGE_TAG` قبلی را برگردانید و پشتیبان را بازگردانید. نسخه‌ی پایین‌تر روی پایگاه داده‌ی ارتقایافته اجرا نمی‌شود.

## افزودن به NocoBase موجود

اگر NocoBase رسمی را از قبل دارید، لازم نیست ایمیج فارسی را نصب کنید. فقط پلاگین را اضافه کنید:

1. از [صفحه‌ی انتشارها](https://github.com/baryuc40-collab/persian-erp/releases) فایل `plugin-fa-<نسخه>.tgz` را دانلود کنید. نسخه‌ی NocoBase در نام انتشار باید با نسخه‌ی NocoBase شما یکی باشد.
2. در NocoBase به «Plugin manager» بروید. دکمه‌ی «Add & update» را بزنید و فایل را بارگذاری کنید. NocoBase شما هنوز انگلیسی است، پس نام‌ها انگلیسی‌اند.
3. پلاگین «فارسی‌سازی» (Persian localization) را فعال کنید.
4. در «System settings» زبان «فارسی» را به «Enabled languages» اضافه کنید و آن را زبان پیش‌فرض کنید. از این پس نام‌ها فارسی‌اند: «مدیریت پلاگین‌ها» و «تنظیمات سیستم».

کاربران می‌توانند از منوی کاربری، زبان، تقویم (جلالی یا میلادی) و ارقام (فارسی یا لاتین) را برای خودشان عوض کنند.
