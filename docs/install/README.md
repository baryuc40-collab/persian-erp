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
sed -i "s/^CAMUNDA_DB_PASSWORD=.*/CAMUNDA_DB_PASSWORD=$(openssl rand -hex 16)/; s/^BPM_ENGINE_PASSWORD=.*/BPM_ENGINE_PASSWORD=$(openssl rand -hex 16)/; s/^CAMUNDA_ADMIN_PASSWORD=.*/CAMUNDA_ADMIN_PASSWORD=$(openssl rand -hex 16)/" .env
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

## موتور فرایند (اختیاری)

موتور فرایند Camunda 8 فرایندهای BPMN را اجرا می‌کند ([تصمیم ۰۰۰۸](../decisions/0008-camunda8-and-two-builders.md)). اگر فرایند BPMN ندارید، این بخش را رد کنید.

پیش از روشن کردن بدانید:
- **مجوز:** Camunda 8 با Camunda License 1.0 فقط برای محیط غیرعملیاتی (آزمون و آزمایش) آزاد است. برای کار واقعی سازمان یا کلید مجوز Camunda لازم است، که در `CAMUNDA_LICENSE_KEY` می‌نشیند، یا موتور جایگزین Operaton ([مجوز Camunda 8](../decisions/0008-camunda8-and-two-builders.md#مجوز-camunda-8)).
- **حافظه:** موتور حدود ۲ گیگابایت حافظه‌ی بیشتر می‌خواهد. سرور دست‌کم ۴ گیگابایت حافظه لازم دارد.

### روشن کردن

نصبی که با `.env.example` تازه ساخته شده، رمزهای موتور را از دستور `sed` بخش نصب گرفته است. در نصب قدیمی‌تر، اول فایل Compose تازه را بگیرید و رمزها را به `.env` اضافه کنید:

```bash
cd /opt/persian-erp
curl -fsSLO https://raw.githubusercontent.com/baryuc40-collab/persian-erp/main/docker/docker-compose.yml
grep -q '^CAMUNDA_DB_PASSWORD=' .env || printf 'CAMUNDA_DB_PASSWORD=%s\nBPM_ENGINE_USERNAME=nocobase\nBPM_ENGINE_PASSWORD=%s\nCAMUNDA_ADMIN_USERNAME=admin\nCAMUNDA_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" >> .env
```

سپس موتور و پلاگین را روشن کنید:

```bash
sed -i 's/^#COMPOSE_PROFILES=bpm/COMPOSE_PROFILES=bpm/' .env
grep -q '^COMPOSE_PROFILES=bpm' .env || echo 'COMPOSE_PROFILES=bpm' >> .env
docker compose up -d
docker compose ps camunda
docker compose exec app yarn nocobase pm enable @persian-erp/plugin-bpm
```

`COMPOSE_PROFILES=bpm` در `.env` موتور را جزو همه‌ی دستورهای `docker compose` می‌کند. بار اول بالا آمدن موتور حدود یک دقیقه طول می‌کشد. وقتی `docker compose ps camunda` وضعیت `healthy` را نشان داد، موتور آماده است.

نکته‌ها:
- داده‌ی موتور در `storage/camunda` است و تاریخچه‌اش در پایگاه داده‌ی `camunda` همان PostgreSQL. سرویس `camunda-init` این پایگاه داده و کاربرش را می‌سازد. اگر یکی از سه رمز موتور در `.env` خالی یا `change-me` باشد، این سرویس با پیام روشن می‌ایستد و موتور بالا نمی‌آید.
- موتور دو کاربر دارد. برنامه با کاربر سرویس (`BPM_ENGINE_USERNAME`) وصل می‌شود، که فقط اجازه‌ی کار با فرایندها، کارها و پیام‌ها را دارد. نه کاربر می‌سازد و نه Operate را باز می‌کند. کاربر مدیر (`CAMUNDA_ADMIN_USERNAME`) برای Operate و Tasklist و عوض کردن رمزهاست.
- هیچ درگاهی از موتور بیرون نمی‌آید. فقط برنامه با `http://camunda:8080` به آن وصل می‌شود.
- نمونه‌های تمام‌شده‌ی فرایند پس از `CAMUNDA_HISTORY_TTL` از تاریخچه‌ی موتور پاک می‌شوند. پیش‌فرض `P180D` یعنی ۱۸۰ روز است. نمونه‌های باز هیچ‌وقت پاک نمی‌شوند.
- لاگ موتور با `docker compose logs -f camunda` دیده می‌شود. Docker آن را در پنج فایل ۵۰ مگابایتی نگه می‌دارد.
- هر تبادل برنامه با موتور که چیزی را عوض می‌کند (استقرار، شروع فرایند، انجام کار، کار سرویس) و هر تبادل ناموفق، با نام کاربر و یک شناسه‌ی پیگیری در جدول `bpmEvents` و لاگ برنامه (`docker compose logs app`) نوشته می‌شود. داده‌ی فرم و رمز در آن نیست. ردیف‌ها پس از `BPM_EVENTS_RETENTION_DAYS` روز (پیش‌فرض ۹۰) هر شب ساعت ۳ پاک می‌شوند.
- اگر موتور خاموش یا در حال راه‌اندازی باشد، ثبت رکورد خراب نمی‌شود. شروع فرایند و پیام در جدول `bpmOutbox` (صف ارسال) می‌مانند و برنامه آن‌ها را با فاصله‌ی رو به افزایش (از ۵ ثانیه تا ۱۵ دقیقه) دوباره می‌فرستد. گردش‌کار هم منتظر می‌ماند و پس از فرستاده شدن ادامه می‌دهد. پس از `BPM_OUTBOX_MAX_ATTEMPTS` تلاش (پیش‌فرض ۵۰، حدود ۱۱ ساعت)، مورد «ناموفق» می‌شود و منتظر مدیر فنی می‌ماند. موردهای منتظر را این‌طور ببینید:

  ```bash
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' <<'SQL'
  select id, kind, status, "businessKey", attempts, "lastError" from "bpmOutbox" where status in ('pending', 'failed');
  SQL
  ```

  دوباره فرستادن یا کنار گذاشتن یک مورد، تا صفحه‌ی «پایش و هشدارها» (STORY-099)، با API است: `POST /api/bpmOutbox:resend?filterByTk=<id>` یا `bpmOutbox:discard`، با کاربری که تکه‌ی دسترسی `pm.bpm` را دارد.
- سلامت موتور: `docker compose exec camunda wget -q -O - http://localhost:9600/actuator/health`.

### Operate و Tasklist

ابزار خود موتور برای دیدن نمونه‌ها و کارها و رفع خطا، فقط برای مدیر فنی است. چون درگاه موتور بیرون نیست، با تونل SSH باز می‌شود. اول روی سرور نشانی موتور را در شبکه‌ی Docker بگیرید:

```bash
cd /opt/persian-erp
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(docker compose ps -q camunda)"
```

سپس روی رایانه‌ی خودتان تونل را باز کنید (`<نشانی>` خروجی دستور بالاست) و `http://localhost:8088/operate` را در مرورگر باز کنید. نام کاربر و رمز، `CAMUNDA_ADMIN_USERNAME` و `CAMUNDA_ADMIN_PASSWORD` در `.env` است.

```bash
ssh -N -L 8088:<نشانی>:8080 <کاربر>@<سرور>
```

### عوض کردن رمزهای موتور

موتور دو کاربرش را فقط بار اول از `.env` می‌سازد. پس برای عوض کردن رمز، اول رمز را با کاربر مدیر در خود موتور عوض کنید و بعد در `.env`. رمز تازه چند ثانیه بعد کار می‌کند. `<رمز تازه>` را با رمز تازه عوض کنید.

رمز کاربر سرویس:

```bash
cd /opt/persian-erp
NEW='<رمز تازه>'
docker compose exec -T -e NEW="$NEW" camunda sh -c 'u="$CAMUNDA_SECURITY_INITIALIZATION_USERS_0_USERNAME"; wget -q -O - --method=PUT --header="Content-Type: application/json" --body-data="{\"password\":\"$NEW\",\"name\":\"NocoBase\",\"email\":\"nocobase@example.com\"}" --user "$CAMUNDA_SECURITY_INITIALIZATION_USERS_1_USERNAME" --password "$CAMUNDA_SECURITY_INITIALIZATION_USERS_1_PASSWORD" --auth-no-challenge "http://localhost:8080/v2/users/$u"'
sed -i "s/^BPM_ENGINE_PASSWORD=.*/BPM_ENGINE_PASSWORD=$NEW/" .env
docker compose up -d
```

رمز کاربر مدیر:

```bash
cd /opt/persian-erp
NEW='<رمز تازه>'
docker compose exec -T -e NEW="$NEW" camunda sh -c 'u="$CAMUNDA_SECURITY_INITIALIZATION_USERS_1_USERNAME"; wget -q -O - --method=PUT --header="Content-Type: application/json" --body-data="{\"password\":\"$NEW\",\"name\":\"Camunda admin\",\"email\":\"admin@example.com\"}" --user "$u" --password "$CAMUNDA_SECURITY_INITIALIZATION_USERS_1_PASSWORD" --auth-no-challenge "http://localhost:8080/v2/users/$u"'
sed -i "s/^CAMUNDA_ADMIN_PASSWORD=.*/CAMUNDA_ADMIN_PASSWORD=$NEW/" .env
docker compose up -d
```

رمز `CAMUNDA_DB_PASSWORD` را فقط در `.env` عوض کنید و `docker compose up -d` بزنید. `camunda-init` رمز کاربر پایگاه داده را با آن یکی می‌کند.

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

### پشتیبان با موتور فرایند

اگر موتور فرایند روشن است، پوشه‌ی `storage/camunda` و پایگاه داده‌ی `camunda` باید از یک لحظه باشند. پس موتور در زمان پشتیبان‌گیری چند ده ثانیه خاموش می‌شود. در این مدت شروع فرایند و کارتابل پیام «موتور در دسترس نیست» می‌دهند، پس پشتیبان را در ساعت کم‌کار بگیرید. این دستورها جای دستورهای بالا را می‌گیرند:

```bash
cd /opt/persian-erp
mkdir -p backups
docker compose stop camunda
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/db.dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc camunda' > backups/camunda.dump
tar czf "backups/persian-erp-$(date +%Y%m%d-%H%M).tar.gz" --exclude=storage/db .env backups/db.dump backups/camunda.dump storage
docker compose start camunda
rm backups/db.dump backups/camunda.dump
```

موتور با `docker compose stop` مرتب بسته می‌شود، پس چیزی از کارهای باز از دست نمی‌رود. Camunda روش پشتیبان بدون خاموشی هم دارد که به فضای ذخیره‌ی پشتیبان (S3 یا مانند آن) نیاز دارد ([راهنمای Camunda](https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/rdbms/rdbms-backup/)). برای یک سرور، روش بالا ساده‌تر است.

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

اگر پشتیبان موتور فرایند دارد (`backups/camunda.dump`)، پیش از آخرین `docker compose up -d` پایگاه داده‌ی موتور را هم برگردانید:

```bash
docker compose run --rm camunda-init
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d camunda --clean --if-exists' < backups/camunda.dump
```

پوشه‌ی `storage/camunda` با `tar` برگشته است. نمونه‌های باز فرایند و کارهایشان همان‌اند که در لحظه‌ی پشتیبان بودند.

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

### ارتقای موتور فرایند

نسخه‌ی Camunda در فایل `docker-compose.yml` است و با فایل تازه عوض می‌شود. یادداشت انتشار می‌گوید که نسخه‌ی موتور عوض شده یا نه. Camunda نسخه‌ی فرعی را فقط یکی‌یکی ارتقا می‌دهد، مثلاً 8.10 به 8.11، و برگشت به نسخه‌ی پایین‌تر ندارد ([سازگاری نسخه‌ها](https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/core-settings/concepts/version-compatibility)). اگر از چند انتشار عقب‌اید و یادداشت‌ها بیش از یک ارتقای نسخه‌ی فرعی موتور دارند، انتشارها را به‌ترتیب نصب کنید. پیش از ارتقا پشتیبان بگیرید، سپس:

```bash
cd /opt/persian-erp
curl -fsSLO https://raw.githubusercontent.com/baryuc40-collab/persian-erp/main/docker/docker-compose.yml
docker compose pull camunda
docker compose up -d
```

موتور هنگام بالا آمدن جدول‌های پایگاه داده‌ی `camunda` را خودش ارتقا می‌دهد.

## افزودن به NocoBase موجود

اگر NocoBase رسمی را از قبل دارید، لازم نیست ایمیج فارسی را نصب کنید. فقط پلاگین را اضافه کنید:

1. از [صفحه‌ی انتشارها](https://github.com/baryuc40-collab/persian-erp/releases) فایل `plugin-fa-<نسخه>.tgz` را دانلود کنید. نسخه‌ی NocoBase در نام انتشار باید با نسخه‌ی NocoBase شما یکی باشد.
2. در NocoBase به «Plugin manager» بروید. دکمه‌ی «Add & update» را بزنید و فایل را بارگذاری کنید. NocoBase شما هنوز انگلیسی است، پس نام‌ها انگلیسی‌اند.
3. پلاگین «فارسی‌سازی» (Persian localization) را فعال کنید.
4. در «System settings» زبان «فارسی» را به «Enabled languages» اضافه کنید و آن را زبان پیش‌فرض کنید. از این پس نام‌ها فارسی‌اند: «مدیریت پلاگین‌ها» و «تنظیمات سیستم».

کاربران می‌توانند از منوی کاربری، زبان، تقویم (جلالی یا میلادی) و ارقام (فارسی یا لاتین) را برای خودشان عوض کنند.
