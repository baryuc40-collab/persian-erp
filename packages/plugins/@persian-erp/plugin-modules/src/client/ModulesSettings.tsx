// Settings > ERP modules (STORY-066): the modules of this install, their export, defining a module and importing one.
// The page only talks to the server through `api`, so the v1 and v2 clients both use it.

import { App, Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Upload } from 'antd';
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

export interface ImportPreview {
  summary: ModuleSummary;
  warnings: string[];
  problems: string[];
  conflicts: string[];
}

const errorMessage = (error: any) =>
  error?.response?.data?.errors?.map((e: { message: string }) => e.message).join('\n') || error?.message || String(error);

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
      <Descriptions.Item label={t('Workflows')}>{names(summary.workflows.map((w) => w.title || w.key))}</Descriptions.Item>
      <Descriptions.Item label={t('Roles')}>{names(summary.roles.map((r) => title(r.title) || r.name))}</Descriptions.Item>
    </Descriptions>
  );
};

/** What an import would do: the module's contents, then the problems that stop it or the warnings it carries. */
export const ImportPreviewView = ({ preview }: { preview: ImportPreview }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const blocking = [...preview.problems, ...preview.conflicts];
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {blocking.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={t('The module cannot be imported')}
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
      <ModuleContents summary={preview.summary} />
    </Space>
  );
};

const DefineModule = ({ api, open, onClose, used }: { api: ModulesApi; open: boolean; onClose: (saved: boolean) => void; used: string[] }) => {
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

export const ModulesSettings = ({ api }: { api: ModulesApi }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const { message, modal } = App.useApp();
  const [modules, setModules] = useState<InstalledModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [defining, setDefining] = useState(false);
  const [file, setFile] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.request({ url: 'erpModules:overview' });
      setModules(data?.data || []);
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

  const choose = async (picked: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await picked.text());
    } catch {
      message.error(t('This is not an ERP module file'));
      return false;
    }
    try {
      const { data } = await api.request({ url: 'erpModules:import', method: 'post', params: { dryRun: true }, data: parsed });
      setFile(parsed);
      setPreview(data?.data);
    } catch (error) {
      message.error(errorMessage(error));
    }
    return false;
  };

  const runImport = async () => {
    setImporting(true);
    try {
      await api.request({ url: 'erpModules:import', method: 'post', data: file });
      setPreview(null);
      setFile(null);
      await load();
      // The menu is read when the app starts, so the new menu shows after a reload.
      modal.success({
        title: t('The module was imported'),
        content: t('Reload the page to see its menu.'),
        okText: t('Reload'),
        onOk: () => window.location.reload(),
      });
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const blocked = !!preview && preview.problems.length + preview.conflicts.length > 0;

  return (
    <Card bordered={false}>
      <Space style={{ marginBlockEnd: 16 }}>
        <Upload accept={`${MODULE_FILE_SUFFIX},.json`} showUploadList={false} beforeUpload={choose}>
          <Button type="primary">{t('Import a module')}</Button>
        </Upload>
        <Button onClick={() => setDefining(true)}>{t('Define a module')}</Button>
      </Space>
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
              <Button type="link" disabled={!!r.error} onClick={() => exportModule(r.key)}>
                {t('Export')}
              </Button>
            ),
          },
        ]}
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
        title={t('Import a module')}
        width={720}
        okText={t('Import a module')}
        cancelText={t('Cancel')}
        okButtonProps={{ disabled: blocked }}
        confirmLoading={importing}
        onOk={runImport}
        onCancel={() => {
          setPreview(null);
          setFile(null);
        }}
      >
        {preview && <ImportPreviewView preview={preview} />}
      </Modal>
    </Card>
  );
};
