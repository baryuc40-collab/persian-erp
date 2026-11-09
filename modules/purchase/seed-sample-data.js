#!/usr/bin/env node
// Seeds realistic sample purchase requests (STORY-107) across every end state of the process, through the same
// HTTP API a person or a browser uses: three demo users sign in and act, the engine runs for real. Never writes to
// the database directly, so it needs the «درخواست خرید» module and its BPMN model already deployed (build.js and
// Settings > BPMN engine).
//
// For a development or demo instance only — it creates real users with a shared, published password and real
// records. Never run this against a production install.
//
// usage: node modules/purchase/seed-sample-data.js <base-url> <admin-email> <admin-password>
const [baseURL, adminAccount, adminPassword] = process.argv.slice(2);
if (!baseURL || !adminAccount || !adminPassword) {
  console.error('usage: seed-sample-data.js <base-url> <admin-email> <admin-password>');
  process.exit(2);
}

const DEMO_PASSWORD = 'Demo-pass-123';
const USERS = {
  requester: { email: 'ali.rezaei@purchase.demo', nickname: 'علی رضایی', role: 'purchase_requester' },
  manager: { email: 'sara.mohammadi@purchase.demo', nickname: 'سارا محمدی', role: 'purchase_manager' },
  finance: { email: 'hossein.karimi@purchase.demo', nickname: 'حسین کریمی', role: 'purchase_finance' },
};

async function call(token, role, action, body) {
  const res = await fetch(`${baseURL}/api/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Role': role,
      'X-Locale': 'fa-IR',
      ...(token ? { Authorization: `Bearer ${token}` } : { 'X-Authenticator': 'basic' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await res.text();
  if (!res.ok) throw new Error(`${action}: ${res.status} ${content.slice(0, 2000)}`);
  return content ? JSON.parse(content).data : undefined;
}

const list = (token, role, resource, filter) =>
  call(token, role, `${resource}:list?paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits for a check to stop throwing, for the moment between an action and the engine's and workflow's reaction.
async function eventually(check, timeout = 20000) {
  const until = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > until) throw error;
      await sleep(500);
    }
  }
}

(async () => {
  const adminToken = (await call(undefined, 'root', 'auth:signIn', { account: adminAccount, password: adminPassword }))
    .token;

  for (const user of Object.values(USERS)) {
    const [found] = await list(adminToken, 'root', 'users', { email: user.email });
    if (!found) {
      await call(adminToken, 'root', 'users:create', {
        email: user.email,
        nickname: user.nickname,
        roles: [user.role],
        password: DEMO_PASSWORD,
      });
    }
  }
  const tokens = {};
  for (const [key, user] of Object.entries(USERS)) {
    tokens[key] = (await call(undefined, user.role, 'auth:signIn', { account: user.email, password: DEMO_PASSWORD }))
      .token;
  }
  const as = (key) => ({ token: tokens[key], role: USERS[key].role });

  const idOf = async (title) => (await list(adminToken, 'root', 'purchase_requests', { title }))[0].id;
  const statusOf = async (title) => (await list(adminToken, 'root', 'purchase_requests', { title }))[0]?.status;
  const waitForStatus = (title, status) =>
    eventually(async () => {
      const found = await statusOf(title);
      if (found !== status) throw new Error(`"${title}" is "${found}", not "${status}" yet`);
    });

  const myTask = (who, title) =>
    eventually(async () => {
      const { token, role } = as(who);
      const tasks = await call(token, role, 'bpmTasks:list');
      const task = tasks.find((t) => t.record?.title === title);
      if (!task) throw new Error(`no task yet for "${title}"`);
      return task;
    });

  const decide = async (who, title, values) => {
    const { token, role } = as(who);
    const task = await myTask(who, title);
    await call(token, role, `bpmTasks:complete?filterByTk=${task.id}`, values);
  };

  // A fresh run suffix so this script can be run more than once without clashing with earlier sample data.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const REQUESTS = [
    // [title, amount in toman, description]
    [`خرید کاغذ A4 ${stamp}`, '2000000', 'برای واحد اداری'],
    [`خرید تجهیزات شبکه ${stamp}`, '8000000', 'سوییچ و کابل‌کشی طبقه‌ی دوم'],
    [`خرید نرم‌افزار حسابداری ${stamp}`, '65000000', 'لایسنس سالانه، تمدید خودکار'],
    [`خرید خودروی اداری ${stamp}`, '950000000', 'برای واحد پخش، جایگزین خودروی فرسوده'],
    [`خرید میز و صندلی ${stamp}`, '15000000', 'برای اتاق جلسات طبقه‌ی سوم'],
    [`خرید سرور پشتیبان ${stamp}`, '720000000', 'برای مرکز داده، پشتیبان‌گیری شبانه'],
    [`خرید چاپگر ${stamp}`, '4000000', 'برای واحد مالی'],
  ];
  const [paper, network, software, car, desk, server, printer] = REQUESTS.map((r) => r[0]);

  for (const [title, amount, description] of REQUESTS) {
    const { token, role } = as('requester');
    // The field stores rials (STORY-054); this script, unlike the browser's IranianCurrency input, talks to the
    // API directly, so the toman amount above is converted here instead.
    await call(token, role, 'purchase_requests:create', { title, amount: String(Number(amount) * 10), description });
  }
  console.log(`created ${REQUESTS.length} requests as ${USERS.requester.nickname}`);

  // 1) small amount, still waiting on the manager: no action, so the inbox and the monitoring page have something.
  await myTask('manager', paper);

  // 2) small amount, the manager approves it: ordered, no finance step.
  await decide('manager', network, { approved: true, managerNote: 'طبق بودجه‌ی سه‌ماهه تأیید شد' });
  await waitForStatus(network, 'ordered');

  // 3) large amount, the manager approves it: still waiting, now on finance.
  await decide('manager', software, { approved: true, managerNote: 'برای فروش سال آینده لازم است' });
  await myTask('finance', software);

  // 4) large amount, both approve it: ordered.
  await decide('manager', car, { approved: true, managerNote: 'با پیشنهاد سه فروشنده مقایسه شد' });
  await decide('finance', car, { approved: true, financeNote: 'در سقف بودجه‌ی سالانه است' });
  await waitForStatus(car, 'ordered');

  // 5) the manager rejects it.
  await decide('manager', desk, { approved: false, managerNote: 'موجودی انبار کافی است' });
  await waitForStatus(desk, 'rejected');

  // 6) the manager approves it, finance rejects it.
  await decide('manager', server, { approved: true, managerNote: 'از نظر فنی تأیید می‌شود' });
  await decide('finance', server, { approved: false, financeNote: 'به سال مالی بعد موکول شود' });
  await waitForStatus(server, 'rejected');

  // 7) the requester cancels it before anyone decides.
  const { token: requesterToken, role: requesterRole } = as('requester');
  await call(requesterToken, requesterRole, `purchase_requests:update?filterByTk=${await idOf(printer)}`, {
    cancelRequested: true,
  });
  await waitForStatus(printer, 'canceled');

  console.log('sample data ready:');
  for (const [title] of REQUESTS) console.log(`  ${await statusOf(title)}\t${title}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
