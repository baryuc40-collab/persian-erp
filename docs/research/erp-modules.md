# ماژول ERP در NocoBase 2.2.x: رکوردها و ارجاع‌ها

این سند نتیجه‌ی STORY-063 است و می‌گوید یک ماژول ERP در پایگاه داده‌ی NocoBase از کدام رکوردها ساخته می‌شود و این رکوردها چطور به هم ارجاع می‌دهند. تصمیم قالب ماژول بر پایه‌ی این بررسی در [ADR 0005](../decisions/0005-erp-module-format.md) آمده است.

- **کد:** کد NocoBase v2.2.22 خوانده شد. مسیرها نسبت به `packages/plugins/@nocobase/` هستند، مگر آن‌هایی که با `core/` شروع می‌شوند. بخش‌های اصلی (هوک `desktopRoutes`، مخزن `flowModels`، جدول دسترسی نقش‌ها) با بسته‌های ساخته‌شده‌ی 2.2.24 مقایسه شدند و یکسان‌اند.
- **آزمایش:** یک ماژول آزمایشی روی ایمیج رسمی `nocobase/nocobase:2.2.24` با PostgreSQL 16 ساخته شد. شرح آن در بخش ۹ آمده است.
- **پرس‌وجوها:** پرس‌وجوهای استخراج و بررسی ارجاع در [erp-modules-queries.sql](erp-modules-queries.sql) هستند.

## خلاصه

1. **جدول‌های دسترسی نقش‌ها نام دیگری دارند.** `rolesResources`، `rolesResourcesActions` و `rolesResourcesScopes` در plugin-acl قدیمی‌اند. از 2024 رابطه‌ی `roles.resources` به `dataSourcesRolesResources` اشاره می‌کند (`plugin-acl/src/server/collections/roles.ts:88-93`). جدول‌های زنده این‌ها هستند و در plugin-data-source-manager تعریف شده‌اند:
   - `dataSourcesRoles`
   - `dataSourcesRolesResources`
   - `dataSourcesRolesResourcesActions`
   - `dataSourcesRolesResourcesScopes`

   داده با مهاجرت `20240301164024-migrate-acl-resources.ts` به این جدول‌ها رفته است.
2. **پنجره‌های بازشو بیرون از درخت صفحه‌اند.** در صفحه‌ی مدرن، محتوای پنجره‌ی «ویرایش»، «جزئیات» و «افزودن» زیر دکمه‌ی صفحه نیست. یک مدل میزبان جدا (ریشه‌ی بی‌والد) دارد که دکمه با `stepParams.popupSettings.openView.uid` به آن اشاره می‌کند. NocoBase برای هر جدول این پنجره‌ها را خودکار به قالب پنجره (`flowModelTemplates`) تبدیل می‌کند و دکمه‌ها با `popupTemplateUid` به قالب ارجاع می‌دهند. پس برای پیدا کردن همه‌ی مدل‌های یک صفحه، پیمایش درخت کافی نیست و باید این دو ارجاع را تا جایی که مدل تازه‌ای پیدا نشود دنبال کرد. این را خود ماژول آزمایشی نشان داد، نه کد.
3. **ساختن مسیر منو اثر جانبی دارد.** هر `desktopRoutes:create` یک مدل `RouteModel` با `uid = schemaUid` در `flowModels` می‌سازد. همچنین مسیر را به همه‌ی نقش‌هایی که `allowNewMenu` دارند (پیش‌فرض: `admin` و `member`) وصل می‌کند (`plugin-client/src/server/server.ts:276-302`).
   - مسیرها باید پیش از مدل‌های زیرشان ساخته شوند.
   - مدل `RouteModel` نباید در فایل ماژول باشد، وگرنه کلید تکراری می‌شود.
4. **صفحه‌ی مدرن شناسه‌ی مسیرش را در خودش نگه می‌دارد.** `RootPageModel.props.routeId` همان `desktopRoutes.id` است. شناسه‌ی مسیر در ورود عوض می‌شود، پس این مقدار باید بازنویسی شود.
5. **دکمه‌ها گردش‌کار را با `key` صدا می‌زنند، نه با `id`.** این در هر دو نسل صفحه صادق است. `key` در همه‌ی نسخه‌های یک گردش‌کار یکسان است و هنگام ساختن می‌شود آن را داد.
6. **DDL در PostgreSQL داخل تراکنش است، ولی وضعیت حافظه نیست.** ساختن جدول و ستون با بازگشت تراکنش پاک می‌شود. ولی جدولی که در حافظه‌ی برنامه ثبت شده، ماشه‌ی گردش‌کار و دسترسی‌های حافظه‌ی ACL با بازگشت تراکنش برنمی‌گردند (بخش ۸).

## ۱. جدول‌ها و فیلدها (plugin-data-source-main)

| جدول | کلید | ستون‌های مهم |
| --- | --- | --- |
| `collections` | `key` (uid) | `name` (یکتا)، `title`، `inherit`، `hidden`، `options` (JSON با `template`، `inherits`، `titleField`، `sortable`، `tree`، `autoGenId` و…) |
| `fields` | `key` (uid) | `name`، `type`، `interface`، `collectionName`، `parentKey`، `reverseKey`، `sort`، `options` (JSON با `target`، `through`، `foreignKey`، `otherKey`، `sourceKey`، `targetKey`، `uiSchema`). یکتا روی (`collectionName`، `name`) |

تعریف: `plugin-data-source-main/src/server/collections/collections.ts` و `fields.ts`.

**ارجاع‌ها**
- `fields.collectionName` به نام جدول اشاره می‌کند.
- در فیلد رابطه، `options.target` و `options.through` نام جدول‌اند. `foreignKey`، `otherKey`، `sourceKey` و `targetKey` نام ستون‌اند.
- `reverseKey` به `key` فیلد معکوس اشاره می‌کند.
- `collections.options.inherits` نام جدول‌های والد را دارد.

**ساختن**
- `db.getRepository('collections').create({ values, context, transaction })`.
  - `context` باید مقدار داشته باشد. هوک `collections.afterSaveWithAssociations` فقط با `context` جدول را بارگذاری و DDL را اجرا می‌کند (`plugin-data-source-main/src/server/server.ts:119-138`).
  - فیلدها: هوک‌های `fields.afterCreate` و `fields.afterSaveWithAssociations` (همان فایل، :308-348). فیلد معکوس را `beforeCreateForReverseField` می‌سازد.
- API بالاتر `collections:apply` و `fields:apply` تراکنش نمی‌گیرد (`modeling/service.ts:52-140`)، پس هر ساختن جدا ثبت می‌شود.
- اگر جدول هم‌نام باشد، `collections.beforeCreate` خطا می‌دهد (`server.ts:109-117`).
- `key` و `name` را می‌شود داد. فیلد uid فقط وقتی خالی است مقدار می‌گیرد (`core/database/src/fields/uid-field.ts:18-36`).

## ۲. مسیرهای منو: `desktopRoutes` (plugin-client)

تعریف: `plugin-client/src/collections/desktopRoutes.ts`.

- کلید `id` از نوع snowflake است و فقط وقتی خالی است مقدار می‌گیرد (`core/database/src/fields/snowflake-id-field.ts:31-56`).
- درخت با `parentId` ساخته می‌شود و `sort` در هر والد جداست.
- ستون‌های دیگر: `schemaUid`، `menuSchemaUid`، `tabSchemaName`، `options`، `hideInMenu`، `enableTabs`، `enableHeader`، `displayTitle` و `hidden`.
- `type` یکی از `group`، `page`، `flowPage`، `link` و `tabs` است.
- دسترسی نقش: جدول واسط `rolesDesktopRoutes` با ستون‌های `roleName` و `desktopRouteId`.

**مسیر به رابط کاربری چطور اشاره می‌کند**

| نوع | `schemaUid` | دیگر | منبع |
| --- | --- | --- | --- |
| `group` | uid تصادفی، بی‌طرح | — | `core/client/src/modules/menu/GroupItem.tsx:73-81` |
| `page` (کلاسیک) | ریشه‌ی `Page` در `uiSchemas` | `menuSchemaUid` تصادفی و بی‌طرح است. فرزند `tabs` دارد که `schemaUid` آن `x-uid` گره‌ی `Grid` زیر Page است و `tabSchemaName` نام همان ویژگی | `PageMenuItem.tsx:88-140` |
| `flowPage` (مدرن) | پوسته‌ی `FlowRoute` در `uiSchemas` و `RouteModel` در `flowModels` | خود صفحه `RootPageModel` با `parentId = schemaUid` و `subKey: 'page'` است. فرزند `tabs` دارد و محتوای هر برگه `BlockGridModel` با `parentId = schemaUid برگه` و `subKey: 'grid'` است | `FlowPageMenuItem.tsx:88-145`، `plugin-flow-engine/src/server/flow-surfaces/service.ts` (`createFlowMenuItem`) |
| `link` | — | `options.href`، `options.params`، `options.openInNewWindow` | `LinkMenuItem.tsx:98-108` |

**هوک‌ها** (`plugin-client/src/server/server.ts`)
- `desktopRoutes.afterCreate` (:276-302): ساختن `RouteModel` و وصل کردن نقش‌های `allowNewMenu`.
- `desktopRoutes.beforeDestroy` (:267-275): پاک کردن زیردرخت `flowModels`.
- `rolesDesktopRoutes.afterBulkCreate` و `afterBulkDestroy` (:304-350): برگه‌های پنهان را هم با مسیر والد می‌دهند یا می‌گیرند.

**ساختن:** `db.getRepository('desktopRoutes').create({ values: { ..., children: [...] }, transaction })`. فرزندهای تودرتو پشتیبانی می‌شوند.

**چیدمان‌ها (plugin-ui-layout).** هر مسیر از راه جدول واسط `desktopRoutesUiLayouts` (`desktopRouteId`، `uiLayoutUid`) به یک یا چند چیدمان (`uiLayouts`) وصل است. `desktopRoutes:listAccessible` فقط مسیرهای چیدمان درخواست‌شده را برمی‌گرداند؛ پیش‌فرض چیدمان مدیر با uid `admin-layout-model` است. اتصال را یک pre-action روی `desktopRoutes:create` می‌سازد (`plugin-ui-layout/src/server/plugin.ts`، `addDesktopRouteWriteLayout`)، پس مسیری که با مخزن ساخته شود به هیچ چیدمانی وصل نیست و در منو دیده نمی‌شود. این در بررسی اول جا ماند و هنگام آزمودن ورود روی ایمیج پیدا شد (STORY-065).

## ۳. صفحه‌ی کلاسیک: `uiSchemas` و `uiSchemaTreePath` (plugin-ui-schema-storage)

- `uiSchemas`: کلید `x-uid`، ستون‌های `name` و `schema` (همه‌ی کلیدهای `x-*`، `type` و `title`).
- `uiSchemaTreePath`: جدول بستار (closure)، با ستون‌های `ancestor`، `descendant`، `depth`، `async`، `type` و `sort`.
- `UiSchemaRepository.schemaToSingleNodes` (`repository.ts:93-147`) فقط وقتی `x-uid` یا `name` نباشد آن را می‌سازد، پس uidهای داده‌شده می‌مانند.
- **نوشتن** (همه با `@transaction()` که تراکنش داده‌شده را به کار می‌برد):
  - `insert(schema, { transaction })` (:537-546)
  - `insertNewSchema` (:548-620): درج دسته‌ای سریع، فقط برای گره‌های تازه
  - `insertAdjacent`، `patch`، `remove`، `duplicate` (که uidها را از نو می‌سازد)
- **خواندن:** `getJsonSchema(uid, { includeAsyncNode: true })`. بدون این گزینه زیردرخت‌های `x-async` جا می‌مانند.
- **ارجاع‌های داخل JSON**
  - `x-decorator-props.collection`، `.dataSource` و `.association`
  - `x-collection-field` به شکل `"جدول.فیلد"`
  - `x-acl-action` به شکل `"جدول:عمل"`
  - `x-action-settings.triggerWorkflows`: آرایه‌ی `{ workflowKey, context }` (`plugin-workflow/src/client/hooks/useTriggerWorkflowActionProps.ts:43-56`؛ خواندن در سرور: `plugin-workflow-action-trigger/src/server/ActionTrigger.ts:98-140`)
  - `x-template-uid` و `x-template-key` به `uiSchemaTemplates` (`plugin-ui-schema-storage/src/server/collections/uiSchemaTemplates.ts`)
  - `x-server-hooks` که در `uiSchemaServerHooks` ذخیره می‌شود
- `x-collection` در سطح بالای طرح فقط در صفحه‌های مدیریت جدول خود NocoBase هست، نه در صفحه‌های کاربر.

## ۴. صفحه‌ی مدرن: `flowModels` و `flowModelTreePath` (plugin-flow-engine)

- `flowModels`: کلید `uid`، ستون‌های `name` و `options` (JSON). `options` این‌ها را نگه می‌دارد: `use`، `props`، `decoratorProps`، `stepParams`، `flowRegistry`، `subKey`، `subType`، `parentId`، `sortIndex` و `async`.
- `flowModelTreePath`: جدول بستار مثل `uiSchemaTreePath`. ستون `type` روی سطر خود-به-خود (`depth = 0`) همان `subKey` است.
- **نوشتن** (`repository.ts`، همه با `@transaction()`):
  - `insertModel(model)` (:1725-1731): یک ریشه با زیرمدل‌ها، بدون والد
  - `upsertModel(model)` (:1763-1782): اگر `parentId` داشته باشد، زیر والد با `subKey` می‌نشیند. خود NocoBase صفحه را همین‌طور زیر `RouteModel` می‌گذارد (`flow-surfaces/service.ts`، `createFlowMenuItem`).
  - `attach`، `move`، `duplicate`، `remove`
- **خواندن:** `findModelById(uid, { includeAsyncNode: true })` و `findModelByParentId(parentUid, { subKey })`.
- **ارجاع‌های داخل `stepParams`**
  - بلوک‌ها: `resourceSettings.init.{dataSourceKey, collectionName, associationName, sourceId, filterByTk}` (`flow-surfaces/catalog.ts:1190-1200`)
  - فیلدها: `fieldSettings.init.{dataSourceKey, collectionName, fieldPath, associationPathName}` (`flow-surfaces/builder.ts:749-795`)
  - پنجره‌ها: `popupSettings.openView.{uid, collectionName, dataSourceKey, associationName, popupTemplateUid}` (`flow-surfaces/hidden-popup-contract.ts:258-284`)
  - دکمه‌ی گردش‌کار: `formTriggerWorkflowsActionSettings.setTriggerWorkflows.group` یا `recordTriggerWorkflowsActionSettings.setTriggerWorkflows.group`، آرایه‌ی `{ workflowKey, context }`
  - صفحه: `RootPageModel.props.routeId`
- **قالب‌ها** (plugin-ui-templates):
  - `flowModelTemplates`: کلید `uid`، با ستون‌های `targetUid` (ریشه‌ی مدل قالب)، `useModel`، `type` (`popup` یا `block`)، `dataSourceKey`، `collectionName`، `associationName`، `filterByTk` و `sourceId`.
  - `flowModelTemplateUsages`: `templateUid` و `modelUid`.
  - NocoBase هنگام ساختن بلوک جدول، پنجره‌های پیش‌فرض را خودکار قالب می‌کند (عنوان قالب: «… Popup for Edit (Auto generated)»). یک قالب ممکن است در چند صفحه به کار رود.
- **API سطح بالا** `flowSurfaces:*` (`flow-surfaces/service.ts`): `createMenu`، `createPage`، `addBlock`، `addRecordAction`، `configure`، `applyBlueprint` و `exportBlueprint`. این API جدول‌ها و فیلدها را با برنامه‌ی زنده می‌سنجد. `exportBlueprint` فقط یک صفحه را خروجی می‌دهد و پنجره‌ها را هم با قالب نمی‌برد، پس برای خروجی ماژول کافی نیست.

## ۵. گردش‌کارها (plugin-workflow)

تعریف: `plugin-workflow/src/common/collections/workflows.ts` و `flow_nodes.ts`.

**`workflows`**
- کلید `id` (snowflake). `key` (uid) در همه‌ی نسخه‌ها یکی است.
- ستون‌های دیگر: `title`، `enabled`، `type` (نوع ماشه)، `config`، `current`، `sync` و `options`.
- شاخص یکتا روی (`key`، `current`). نسخه‌ی غیرجاری `current = NULL` دارد، نه `false`.
- `workflows.beforeSave` (`Plugin.ts:96-133`): اگر `key` نباشد آن را می‌سازد. نسخه‌ی فعال را جاری می‌کند و نسخه‌ی جاری قبلی همان `key` را از جاری بودن درمی‌آورد.
- `afterCreate` آمار را می‌سازد و اگر گردش‌کار فعال باشد، ماشه را **همان لحظه** در حافظه ثبت می‌کند (`Plugin.ts:478-520`).

**ماشه‌ها و جدول‌ها:** `config.collection` به شکل `"منبع:جدول"` یا فقط نام جدول برای منبع اصلی است (`core/data-source-manager/src/utils.ts:10-26`).
- `collection`: `config.collection`، `changed` (نام فیلدها)، `condition`، `appends`
- `action`: `config.collection` و `global`. گردش‌کار غیرسراسری فقط وقتی اجرا می‌شود که دکمه `key` آن را داشته باشد (`ActionTrigger.ts:126-140`).
- `schedule` (حالت فیلد تاریخ) و `custom-action`: `config.collection`

**`flow_nodes`**
- کلید `id` (snowflake) و `key` (uid). `key` گره در نسخه‌ها می‌ماند و در متغیرها به شکل `{{$jobsMapByNodeKey.<key>}}` به کار می‌رود.
- اتصال گره‌ها:
  - `workflowId` گره را به گردش‌کار وصل می‌کند.
  - `upstreamId` و `downstreamId` زنجیره را می‌سازند. گره‌ی اول `upstreamId = null` دارد.
  - گره‌ی اول هر شاخه `upstreamId` را برابر گره‌ی شاخه‌دار و `branchIndex` را برابر شماره‌ی شاخه می‌گذارد.
- گره‌هایی مثل `create`، `update`، `destroy`، `query` و `aggregate` در `config.collection` نام جدول دارند.
- **ساختن:** `WorkflowRepository.revision` (`repositories/WorkflowRepository.ts:14-100`) الگوی درست را دارد. اول همه‌ی گره‌ها ساخته می‌شوند، بعد `upstreamId` و `downstreamId` با نقشه‌ی شناسه‌ی قدیم به جدید بازنویسی می‌شوند. API `flow_nodes:create` همسایه‌ها را جابه‌جا می‌کند و برای ورود دسته‌ای مناسب نیست.

## ۶. نقش‌ها و دسترسی (plugin-acl و plugin-data-source-manager)

| جدول | کلید | ستون‌ها و ارجاع‌ها |
| --- | --- | --- |
| `roles` | `name` | `title` (یکتا)، `strategy`، `default`، `hidden`، `allowConfigure`، `allowNewMenu`، `snippets` |
| `dataSourcesRoles` | `id` | `roleName`، `dataSourceKey`، `strategy` |
| `dataSourcesRolesResources` | `id` | `roleName`، `dataSourceKey`، `name` (= نام جدول)، `usingActionsConfig` |
| `dataSourcesRolesResourcesActions` | `id` | `rolesResourceId`، `name` (عمل)، `fields` (نام فیلدها)، `scopeId` |
| `dataSourcesRolesResourcesScopes` | `id` | `key`، `dataSourceKey`، `name`، `resourceName` (= نام جدول، برای محدوده‌های سراسری خالی)، `scope` (فیلتر) |
| `rolesDesktopRoutes` | (`roleName`، `desktopRouteId`) | دیدن منو |
| `uiButtonSchemasRoles` | (`uid`، `roleName`) | دسترسی دکمه در صفحه‌ی کلاسیک |

- **ساختن:** با مخزن‌ها و هوک‌هایشان، تا ACL حافظه هم به‌روز شود:
  - `roles.afterSaveWithAssociations` (`plugin-acl/src/server/server.ts:239-285`)
  - `dataSourcesRolesResources.afterSaveWithAssociations` و هوک‌های محدوده و عمل (`plugin-data-source-manager/src/server/plugin.ts:508-640`)
- **API HTTP `roles.dataSourceResources:create` تراکنش خودش را باز می‌کند** (`resourcers/data-sources-resources.ts`). در سرور معادلش `db.getRepository('dataSourcesRolesResources').create({ values: { roleName, dataSourceKey, name, usingActionsConfig, actions }, transaction })` است.
- محدوده‌ها باید پیش از عمل‌ها ساخته شوند.

## ۷. نقشه‌ی ارجاع‌ها

| از | فیلد | به | شناسه‌ی پایدار برای خروجی |
| --- | --- | --- | --- |
| `fields` | `collectionName`، `options.target`، `options.through`، `reverseKey` | جدول، فیلد | نام جدول؛ (جدول، نام فیلد) |
| `desktopRoutes` | `parentId` | مسیر | جایگاه در درخت |
| `desktopRoutes` | `schemaUid`، `menuSchemaUid` | `uiSchemas` یا `flowModels` | uid |
| `desktopRoutes` (`tabs`) | `schemaUid`، `tabSchemaName` | گره‌ی `Grid` یا والد `BlockGridModel` | uid |
| `rolesDesktopRoutes` | `roleName`، `desktopRouteId` | نقش، مسیر | نام نقش و جایگاه مسیر |
| `uiSchemas` | `x-decorator-props.collection`، `x-collection-field`، `x-acl-action` | جدول، فیلد | نام |
| `uiSchemas` | `x-action-settings.triggerWorkflows[].workflowKey` | گردش‌کار | `key` |
| `uiSchemas` | `x-template-uid`، `x-template-key` | `uiSchemaTemplates` | uid، key |
| `flowModels` | `parentId`، `subKey` | مدل یا `schemaUid` مسیر | uid |
| `flowModels` | `resourceSettings.init`، `fieldSettings.init`، `openView.collectionName` | جدول، فیلد | نام |
| `flowModels` | `popupSettings.openView.uid` | مدل میزبان پنجره | uid |
| `flowModels` | `popupSettings.openView.popupTemplateUid`، `referenceSettings.useTemplate.templateUid` | `flowModelTemplates` | uid |
| `flowModels` | `*TriggerWorkflowsActionSettings.setTriggerWorkflows.group[].workflowKey` | گردش‌کار | `key` |
| `flowModels` | `props.routeId` (`RootPageModel`) | مسیر | **باید بازنویسی شود** |
| `flowModelTemplates` | `targetUid`، `collectionName` | مدل، جدول | uid، نام |
| `flowModelTemplateUsages` | `templateUid`، `modelUid` | قالب، مدل | uid |
| `workflows` | `key`، `config.collection` | جدول | `key`، نام |
| `flow_nodes` | `workflowId`، `upstreamId`، `downstreamId`، `branchIndex`، `config.collection`، `$jobsMapByNodeKey` | گردش‌کار، گره، جدول | `key` گره |
| `dataSourcesRolesResources` | `roleName`، `name` | نقش، جدول | (نقش، جدول) |
| `dataSourcesRolesResourcesActions` | `rolesResourceId`، `scopeId`، `fields` | منبع، محدوده، فیلد | از راه والد؛ `key` محدوده |
| `dataSourcesRolesResourcesScopes` | `resourceName` | جدول | `key` |

## ۸. DDL و تراکنش در PostgreSQL

**در پایگاه داده بله، در حافظه‌ی برنامه نه.**

- `Repository.create` با `@transaction()` است و اگر تراکنش داده شود همان را به کار می‌برد (`core/database/src/decorators/transaction-decorator.ts:12-80`).
- `CollectionModel.migrate({ transaction })` جدول را در حافظه ثبت می‌کند و `collection.sync({ transaction })` را صدا می‌زند (`plugin-data-source-main/src/server/models/collection.ts:198-245`). `SyncRunner` تراکنش را به همه‌ی دستورهای DDL می‌دهد (`core/database/src/sync-runner.ts:80-405`). در PostgreSQL، `CREATE TABLE` و `ALTER TABLE` تراکنشی‌اند و با بازگشت پاک می‌شوند.
- **وضعیت حافظه با بازگشت تراکنش بیرونی برنمی‌گردد:**
  - `FieldModel.load` پاک کردن فیلد را به رویداد `transactionRollback:<id>` بسته است (`models/field.ts:83-88`). این رویداد فقط وقتی فرستاده می‌شود که خود مخزن تراکنش را ساخته باشد.
  - جدولی که `load()` ثبت کرده، اگر مرحله‌ی بعدی شکست بخورد، از حافظه پاک نمی‌شود.
  - ماشه‌ی گردش‌کار فعال همان لحظه ثبت می‌شود.
  - نوشتن ACL حافظه هم برنمی‌گردد.
- **پیامد برای ورود:**
  - گردش‌کارها غیرفعال ساخته شوند و پس از ثبت تراکنش فعال شوند.
  - پس از بازگشت تراکنش، جدول‌های تازه با `db.removeCollection(name)` از حافظه پاک شوند و ACL نقش‌های تازه دوباره بارگذاری شود.
- `collections:apply`، `roles.dataSourceResources:create` و `workflows:revision` هر کدام تراکنش خودشان را دارند (یا ندارند). پس ورود یکپارچه باید مستقیم با مخزن‌ها و یک تراکنش مشترک انجام شود.

## ۹. ماژول آزمایشی

روی `nocobase/nocobase:2.2.24` با PostgreSQL 16 و پیشوند `lab_`، این‌ها از راه API ساخته شد، همان‌طور که رابط کاربری می‌سازد:

- **جدول‌ها:** `lab_categories` و `lab_items`، با رابطه‌ی `category` (چند به یک) و فیلد معکوس `items`
- **گردش‌کار «تنظیم وضعیت قلم»:** ماشه‌ی جدول روی `lab_items`، با گره‌ی شرط و دو شاخه. یکی از گره‌ها با `$jobsMapByNodeKey` به خروجی گره‌ی دیگر ارجاع می‌دهد.
- **گردش‌کار «تأیید قلم»:** ماشه‌ی عمل، غیرسراسری
- **گروه منوی «آزمایشگاه»:**
  - صفحه‌ی مدرن با `flowSurfaces:createPage`. بلوک جدول `lab_items` دارد، با پنجره‌های پیش‌فرض و دکمه‌ی ردیفی که «تأیید قلم» را صدا می‌زند.
  - صفحه‌ی کلاسیک با `uiSchemas:insert` و `desktopRoutes:create`. بلوک جدول و دکمه‌ی «اجرای گردش‌کار» دارد.
- **نقش `lab_clerk`:**
  - دسترسی دیدن (با محدوده‌ی سفارشی) و ویرایش روی `lab_items`، و دیدن روی `lab_categories`
  - دسترسی به همه‌ی مسیرهای گروه

[erp-modules-queries.sql](erp-modules-queries.sql) رکوردهای ماژول را از گروه منو و پیشوند استخراج می‌کند. سپس همه‌ی ارجاع‌های داخل آن‌ها را درمی‌آورد و می‌گوید هر کدام درون ماژول است یا نه. اجرا:

```
psql -v group_id=<id گروه> -v prefix=lab_ -f docs/research/erp-modules-queries.sql
```

| رکورد | تعداد |
| --- | --- |
| مسیر | ۵ (گروه، دو صفحه، دو برگه) |
| جدول / فیلد | ۲ / ۷ |
| `uiSchemas` | ۱۳ (۱۲ گره‌ی صفحه‌ی کلاسیک و پوسته‌ی `FlowRoute`) |
| `flowModels` | ۸۳ (همه‌ی ۸۸ مدل پایگاه داده، جز ۵ `RouteModel` که هوک مسیر می‌سازد) |
| `flowModelTemplates` / `flowModelTemplateUsages` | ۵ / ۷ |
| گردش‌کار / گره | ۲ / ۵ |
| نقش / منبع / عمل / محدوده | ۱ / ۲ / ۲ / ۱ |
| `rolesDesktopRoutes` | ۱۵ (۵ مسیر × ۳ نقش: `lab_clerk` و `admin` و `member` که هوک وصل کرده) |

**نتیجه‌ی بررسی ارجاع:** هر ۷۵ ارجاع یکتا (نام جدول، `workflowKey`، `key` گره، uid مدل، uid قالب، `routeId`، والد مدل) به رکوردی درون همین مجموعه اشاره می‌کرد و هیچ ارجاعی بیرون نماند. فقط وقتی که پیمایش `openView.uid` و `popupTemplateUid` اضافه شد، ۶۳ مدل از ۸۳ مدل (پنجره‌ها و قالب‌هایشان) پیدا شدند. پیمایش درخت به‌تنهایی فقط ۲۰ مدل را پیدا می‌کرد.

**چیزهایی که در آزمایش نبود:** قالب بلوک (`ReferenceBlockModel`)، جدول درختی، فیلد چند به چند با جدول واسط، طرح‌های `x-async` و دسترسی دکمه (`uiButtonSchemasRoles`). پرس‌وجوها این‌ها را پوشش می‌دهند یا در ADR 0005 کنار گذاشته شده‌اند. آزمون e2e ماژول مرجع (STORY-068) آن‌هایی را که ماژول «اشخاص» دارد دوباره می‌سنجد.
