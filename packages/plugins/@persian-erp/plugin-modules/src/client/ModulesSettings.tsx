// Settings > ERP modules (STORY-066): the modules of this install, their export, defining a module and importing one.
// The page only talks to the server through `api`, so the v1 and v2 clients both use it.

import {
  App,
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../package.json';
import { MODULE_FILE_SUFFIX, MODULE_KEY_PATTERN } from '../shared/format';
import type { ModuleSummary } from '../shared/summary';

export const MODULES_SETTINGS_KEY = 'erp-modules';

export interface ModulesApi {
  request(config: Record<string, unknown>): Promise<{ data: any }>;
}

export interface InstalledModule extends ModuleSummary {
  groupSchemaUid: string;
  error?: string;
}

/** What an upgrade changes (erpModules:upgrade with dryRun, STORY-076). */
export interface UpgradePlan {
  key: string;
  title: string;
  from: string;
  to: string;
  localChanges: boolean;
  collections: { added: string[]; updated: string[]; kept: string[] };
  fields: { added: string[]; updated: string[]; kept: string[] };
  routes: { added: string[]; updated: string[]; removed: string[] };
  workflows: { added: string[]; revised: string[]; disabled: string[] };
  roles: { added: string[]; updated: string[]; kept: string[] };
}

export interface ImportPreview {
  summary: ModuleSummary;
  warnings: string[];
  problems: string[];
  conflicts: string[];
  /** Only in the preview of an upgrade; null when the upgrade is refused. */
  plan?: UpgradePlan | null;
}

/** A module file that comes with the plugin (STORY-070), with what an import of it would say. */
export interface CatalogItem extends ImportPreview {
  file: string;
  installed: boolean;
  installedVersion?: string;
  /** The catalog has a higher version than the installed one. */
  upgrade?: boolean;
}

// Where an import comes from: a file the administrator chose, or a module of the catalog. An upgrade replaces an
// installed module of the same key.
type ImportSource = ({ file: unknown } | { key: string }) & { upgrade?: boolean };

const isBlocked = (preview: ImportPreview) => preview.problems.length + preview.conflicts.length > 0;

const errorMessage = (error: any) =>
  error?.response?.data?.errors?.map((e: { message: string }) => e.message).join('\n') ||
  error?.message ||
  String(error);

// The menu title may be a translation template; the page shows it as the menu does.
const useTitle = () => {
  const { t } = useTranslation([pkg.name, 'client']);
  return (title: string) => {
    const match = /^\{\{\s*t\(\s*["'](.+?)["']/.exec(title || '');
    return match ? t(match[1]) : title;
  };
};

const download = (name: string, body: string) => {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

export const ModuleContents = ({ summary }: { summary: ModuleSummary }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const title = useTitle();
  const names = (items: string[]) => (items.length ? items.map((item) => <Tag key={item}>{item}</Tag>) : '-');
  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label={t('Title')}>{summary.title}</Descriptions.Item>
      <Descriptions.Item label={t('Key')}>{summary.key}</Descriptions.Item>
      <Descriptions.Item label={t('Version')}>{summary.version}</Descriptions.Item>
      <Descriptions.Item label={t('Collections')}>
        {names(summary.collections.map((c) => (c.title ? `${title(c.title)} (${c.name})` : c.name)))}
      </Descriptions.Item>
      <Descriptions.Item label={t('Pages')}>{names(summary.pages.map((p) => title(p.title)))}</Descriptions.Item>
      <Descriptions.Item label={t('Workflows')}>
        {names(summary.workflows.map((w) => w.title || w.key))}
      </Descriptions.Item>
      <Descriptions.Item label={t('Roles')}>
        {names(summary.roles.map((r) => title(r.title) || r.name))}
      </Descriptions.Item>
      {!!summary.requiredModules?.length && (
        <Descriptions.Item label={t('Required modules')}>
          {names(summary.requiredModules.map((m) => t('{{key}} version {{version}} or later', m)))}
        </Descriptions.Item>
      )}
    </Descriptions>
  );
};

const changeTags = (items: string[], color?: string) =>
  items.length
    ? items.map((item) => (
        <Tag key={item} color={color}>
          {item}
        </Tag>
      ))
    : '-';

/** The changes of an upgrade, one row per part of the module; what is kept or goes is marked. */
export const UpgradePlanView = ({ plan }: { plan: UpgradePlan }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const rows: [string, string[], string?][] = [
    [t('New collections'), plan.collections.added, 'green'],
    [t('Updated collections'), plan.collections.updated],
    [t('New fields'), plan.fields.added, 'green'],
    [t('Updated fields'), plan.fields.updated],
    [t('New menu items'), plan.routes.added, 'green'],
    [t('Updated menu items'), plan.routes.updated],
    [t('Deleted menu items'), plan.routes.removed, 'red'],
    [t('New workflows'), plan.workflows.added, 'green'],
    [t('Workflows with a new version'), plan.workflows.revised],
    [t('Disabled workflows'), plan.workflows.disabled, 'red'],
    [t('New roles'), plan.roles.added, 'green'],
    [t('Updated roles'), plan.roles.updated],
    [t('Kept, not in the new version'), [...plan.collections.kept, ...plan.fields.kept, ...plan.roles.kept], 'orange'],
  ];
  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label={t('Version')}>
        {t('From {{from}} to {{to}}', { from: plan.from, to: plan.to })}
      </Descriptions.Item>
      {rows
        .filter(([, items]) => items.length)
        .map(([label, items, color]) => (
          <Descriptions.Item key={label} label={label}>
            {changeTags(items, color)}
          </Descriptions.Item>
        ))}
    </Descriptions>
  );
};

/**
 * What an import or an upgrade would do: the problems that stop it, the warnings it carries, then the module's
 * contents, or for an upgrade the changes it makes.
 */
export const ImportPreviewView = ({ preview, upgrade = false }: { preview: ImportPreview; upgrade?: boolean }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const blocking = [...preview.problems, ...preview.conflicts];
  const plan = preview.plan;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {upgrade && plan && (
        <Alert
          type="warning"
          showIcon
          message={t('Back up the database before the upgrade.')}
          description={
            plan.localChanges
              ? t(
                  'The module was changed after it was installed. The upgrade replaces its pages, menu, workflows and roles with those of the file, so those changes are lost.',
                )
              : undefined
          }
        />
      )}
      {blocking.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={upgrade ? t('The module cannot be upgraded') : t('The module cannot be imported')}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {blocking.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
      )}
      {preview.warnings.map((line) => (
        <Alert key={line} type="warning" showIcon message={line} />
      ))}
      {upgrade && plan ? <UpgradePlanView plan={plan} /> : <ModuleContents summary={preview.summary} />}
    </Space>
  );
};

/** What deleting a module takes away (erpModules:remove with dryRun, STORY-075). */
export interface RemovalPlan {
  key: string;
  title: string;
  version: string;
  collections: { name: string; title: string; records: number }[];
  pages: { title: string; type: string }[];
  workflows: { key: string; title: string; versions: number }[];
  roles: { name: string; title: string; users: number }[];
  dependents?: { key: string; title: string }[];
}

/** Deletes a module after showing what goes and asking for its key, which the server checks again. */
export const DeleteModule = ({
  api,
  moduleKey,
  onClose,
}: {
  api: ModulesApi;
  moduleKey: string | null;
  onClose: (deleted: boolean) => void;
}) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const title = useTitle();
  const { message } = App.useApp();
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setPlan(null);
    setTyped('');
    if (!moduleKey) return;
    api
      .request({ url: 'erpModules:remove', method: 'post', params: { filterByTk: moduleKey, dryRun: true } })
      .then(({ data }) => setPlan(data?.data))
      .catch((error) => {
        message.error(errorMessage(error));
        onClose(false);
      });
  }, [api, moduleKey]);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.request({
        url: 'erpModules:remove',
        method: 'post',
        params: { filterByTk: moduleKey, confirm: typed },
      });
      onClose(true);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const lines = (items: string[]) => (items.length ? items.map((item) => <Tag key={item}>{item}</Tag>) : '-');
  return (
    <Modal
      open={!!moduleKey}
      title={t('Delete the module')}
      width={640}
      okText={t('Delete')}
      cancelText={t('Cancel')}
      okButtonProps={{ danger: true, disabled: !plan || !!plan.dependents?.length || typed !== moduleKey }}
      confirmLoading={deleting}
      onOk={remove}
      onCancel={() => onClose(false)}
    >
      {plan && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message={t(
              'Deleting the module deletes its collections with all their records, its pages, workflows and roles. Back up the database first.',
            )}
          />
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t('Title')}>{`${plan.title} (${plan.key})`}</Descriptions.Item>
            <Descriptions.Item label={t('Collections')}>
              {lines(
                plan.collections.map(
                  (c) => `${title(c.title) || c.name}: ${t('{{count}} records', { count: c.records })}`,
                ),
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('Pages')}>{lines(plan.pages.map((p) => title(p.title)))}</Descriptions.Item>
            <Descriptions.Item label={t('Workflows')}>
              {lines(
                plan.workflows.map((w) => `${w.title || w.key}: ${t('{{count}} versions', { count: w.versions })}`),
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('Roles')}>
              {lines(plan.roles.map((r) => `${title(r.title) || r.name}: ${t('{{count}} users', { count: r.users })}`))}
            </Descriptions.Item>
          </Descriptions>
          {plan.dependents?.length ? (
            <Alert
              type="error"
              showIcon
              message={t('The module {{modules}} depends on this module; remove it first', {
                modules: plan.dependents.map((m) => `${title(m.title) || m.key} (${m.key})`).join('، '),
              })}
            />
          ) : (
            <Form layout="vertical">
              <Form.Item label={t('Type {{key}} to confirm', { key: plan.key })} htmlFor="erp-module-delete-confirm">
                <Input
                  id="erp-module-delete-confirm"
                  value={typed}
                  autoComplete="off"
                  onChange={(e) => setTyped(e.target.value.trim())}
                />
              </Form.Item>
            </Form>
          )}
        </Space>
      )}
    </Modal>
  );
};

const DefineModule = ({
  api,
  open,
  onClose,
  used,
}: {
  api: ModulesApi;
  open: boolean;
  onClose: (saved: boolean) => void;
  used: string[];
}) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const title = useTitle();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [groups, setGroups] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    api
      .request({
        url: 'desktopRoutes:list',
        params: { paginate: false, filter: { parentId: { $empty: true }, type: 'group' }, sort: ['sort'] },
      })
      .then(({ data }) =>
        setGroups(
          (data?.data || [])
            .filter((route) => !used.includes(route.schemaUid))
            .map((route) => ({ value: route.schemaUid, label: title(route.title) })),
        ),
      );
  }, [open]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.request({ url: 'erpModules:create', method: 'post', data: values });
      message.success(t('The module was defined'));
      onClose(true);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('Define a module')}
      okText={t('Save')}
      cancelText={t('Cancel')}
      confirmLoading={saving}
      onOk={save}
      onCancel={() => onClose(false)}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ version: '1.0.0' }}>
        <Form.Item
          name="groupSchemaUid"
          label={t('Menu group')}
          extra={t('A top-level menu group; the module is everything under it.')}
          rules={[{ required: true, message: t('Choose a menu group') }]}
        >
          <Select options={groups} placeholder={t('Choose a menu group')} />
        </Form.Item>
        <Form.Item
          name="key"
          label={t('Key')}
          extra={t('Lower-case Latin letters, digits and _. Collections and roles of the module start with it and _.')}
          rules={[
            { required: true, message: t('The module key is not valid') },
            { pattern: MODULE_KEY_PATTERN, message: t('The module key is not valid') },
          ]}
        >
          <Input dir="ltr" />
        </Form.Item>
        <Form.Item name="title" label={t('Title')} rules={[{ required: true, message: t('The module needs a title') }]}>
          <Input />
        </Form.Item>
        <Form.Item name="version" label={t('Version')}>
          <Input dir="ltr" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export const ModulesCatalog = ({
  items,
  onInstall,
  onUpgrade,
}: {
  items: CatalogItem[];
  onInstall: (item: CatalogItem) => void;
  onUpgrade: (item: CatalogItem) => void;
}) => {
  const { t } = useTranslation([pkg.name, 'client']);
  if (!items.length) return null;
  return (
    <Card size="small" title={t('Catalog')} style={{ marginBlockEnd: 16 }}>
      <List
        dataSource={items}
        rowKey="file"
        renderItem={(item) => (
          <List.Item
            actions={[
              item.upgrade ? (
                <Button key="upgrade" type="link" onClick={() => onUpgrade(item)}>
                  {t('Upgrade to version {{version}}', { version: item.summary.version })}
                </Button>
              ) : item.installed ? (
                <Tag key="state" color="green">
                  {t('Installed')}
                </Tag>
              ) : (
                <Button key="install" type="link" disabled={isBlocked(item)} onClick={() => onInstall(item)}>
                  {t('Install')}
                </Button>
              ),
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <span>{item.summary.title || item.file}</span>
                  {item.summary.version && <Typography.Text type="secondary">{item.summary.version}</Typography.Text>}
                </Space>
              }
              description={
                <>
                  {item.summary.description && <div>{item.summary.description}</div>}
                  {!item.installed && isBlocked(item) && (
                    <Typography.Text type="danger">{[...item.problems, ...item.conflicts].join(' ')}</Typography.Text>
                  )}
                </>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
};

export const ModulesSettings = ({ api }: { api: ModulesApi }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const { message, modal } = App.useApp();
  const [modules, setModules] = useState<InstalledModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [defining, setDefining] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [installed, available] = await Promise.all([
        api.request({ url: 'erpModules:overview' }),
        api.request({ url: 'erpModules:catalog' }),
      ]);
      setModules(installed.data?.data || []);
      setCatalog(available.data?.data || []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const exportModule = async (key: string) => {
    try {
      const { data } = await api.request({
        url: 'erpModules:export',
        params: { filterByTk: key },
        responseType: 'text',
        transformResponse: [(body: string) => body],
      });
      download(`${key}${MODULE_FILE_SUFFIX}`, data);
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  // A preview of an upgrade, of a chosen file or of a catalog module.
  const previewUpgrade = async (next: ImportSource & { upgrade: true }) => {
    const params = 'key' in next ? { dryRun: true, filterByTk: next.key } : { dryRun: true };
    const data = 'file' in next ? next.file : undefined;
    const response = await api.request({ url: 'erpModules:upgrade', method: 'post', params, data });
    setSource(next);
    setPreview(response.data?.data);
  };

  const choose = async (picked: File) => {
    let parsed: any;
    try {
      parsed = JSON.parse(await picked.text());
    } catch {
      message.error(t('This is not an ERP module file'));
      return false;
    }
    try {
      // The file of a module that is installed is an upgrade of it (STORY-077).
      if (modules.some((m) => m.key === parsed?.module?.key)) {
        await previewUpgrade({ file: parsed, upgrade: true });
        return false;
      }
      const { data } = await api.request({
        url: 'erpModules:import',
        method: 'post',
        params: { dryRun: true },
        data: parsed,
      });
      setSource({ file: parsed });
      setPreview(data?.data);
    } catch (error) {
      message.error(errorMessage(error));
    }
    return false;
  };

  const runImport = async () => {
    setImporting(true);
    try {
      if (source.upgrade) {
        const params = 'key' in source ? { filterByTk: source.key } : {};
        await api.request({
          url: 'erpModules:upgrade',
          method: 'post',
          params,
          data: 'file' in source ? source.file : undefined,
        });
      } else if ('key' in source) {
        await api.request({ url: 'erpModules:install', method: 'post', params: { filterByTk: source.key } });
      } else {
        await api.request({ url: 'erpModules:import', method: 'post', data: source.file });
      }
      const upgraded = !!source.upgrade;
      setPreview(null);
      setSource(null);
      await load();
      // The menu is read when the app starts, so the new menu shows after a reload.
      modal.success({
        title: upgraded ? t('The module was upgraded') : t('The module was imported'),
        content: upgraded ? t('Reload the page to update the menu.') : t('Reload the page to see its menu.'),
        okText: t('Reload'),
        onOk: () => window.location.reload(),
      });
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const blocked = !!preview && isBlocked(preview);
  const upgrading = !!source?.upgrade;

  return (
    <Card bordered={false}>
      <Space style={{ marginBlockEnd: 16 }}>
        <Upload accept={`${MODULE_FILE_SUFFIX},.json`} showUploadList={false} beforeUpload={choose}>
          <Button type="primary">{t('Import a module')}</Button>
        </Upload>
        <Button onClick={() => setDefining(true)}>{t('Define a module')}</Button>
      </Space>
      <ModulesCatalog
        items={catalog}
        onInstall={(item) => {
          setSource({ key: item.summary.key });
          setPreview(item);
        }}
        onUpgrade={(item) =>
          previewUpgrade({ key: item.summary.key, upgrade: true }).catch((e) => message.error(errorMessage(e)))
        }
      />
      <Table<InstalledModule>
        rowKey="key"
        loading={loading}
        dataSource={modules}
        pagination={false}
        expandable={{
          expandedRowRender: (record) =>
            record.error ? <Alert type="error" showIcon message={record.error} /> : <ModuleContents summary={record} />,
        }}
        columns={[
          { title: t('Key'), dataIndex: 'key' },
          { title: t('Title'), dataIndex: 'title' },
          { title: t('Version'), dataIndex: 'version' },
          { title: t('Collections'), key: 'collections', render: (_, r) => (r.error ? '-' : r.collections.length) },
          { title: t('Pages'), key: 'pages', render: (_, r) => (r.error ? '-' : r.pages.length) },
          { title: t('Workflows'), key: 'workflows', render: (_, r) => (r.error ? '-' : r.workflows.length) },
          {
            title: t('Actions'),
            key: 'actions',
            render: (_, r) => (
              <Space size={0}>
                <Button type="link" disabled={!!r.error} onClick={() => exportModule(r.key)}>
                  {t('Export')}
                </Button>
                <Button type="link" danger disabled={!!r.error} onClick={() => setDeleting(r.key)}>
                  {t('Delete')}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <DeleteModule
        api={api}
        moduleKey={deleting}
        onClose={async (deleted) => {
          setDeleting(null);
          if (!deleted) return;
          await load();
          modal.success({
            title: t('The module was deleted'),
            content: t('Reload the page to update the menu.'),
            okText: t('Reload'),
            onOk: () => window.location.reload(),
          });
        }}
      />
      <DefineModule
        api={api}
        open={defining}
        used={modules.map((m) => m.groupSchemaUid)}
        onClose={(saved) => {
          setDefining(false);
          if (saved) load();
        }}
      />
      <Modal
        open={!!preview}
        title={upgrading ? t('Upgrade the module') : t('Import a module')}
        width={720}
        okText={upgrading ? t('Upgrade') : t('Import a module')}
        cancelText={t('Cancel')}
        okButtonProps={{ disabled: blocked }}
        confirmLoading={importing}
        onOk={runImport}
        onCancel={() => {
          setPreview(null);
          setSource(null);
        }}
      >
        {preview && <ImportPreviewView preview={preview} upgrade={upgrading} />}
      </Modal>
    </Card>
  );
};
