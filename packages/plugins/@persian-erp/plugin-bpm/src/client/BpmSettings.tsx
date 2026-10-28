// Settings > BPMN engine (STORY-079): the connection to the engine and the process models deployed to it.
// The page only talks to the server through `api`, so the v1 and v2 clients both use it.

import { Alert, App, Button, Card, Form, Input, Select, Space, Table, Upload } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../package.json';

export const BPM_SETTINGS_KEY = 'bpm';

export interface BpmApi {
  request(config: Record<string, unknown>): Promise<{ data: any }>;
}

export interface BpmSettingsValues {
  engine: 'camunda8' | 'operaton';
  url: string;
  username: string;
  hasPassword: boolean;
  fromEnv: boolean;
}

export interface ProcessDefinition {
  id: string;
  key: string;
  name: string | null;
  version: number;
}

const errorMessage = (error: any) =>
  error?.response?.data?.errors?.map((e: { message: string }) => e.message).join('\n') ||
  error?.message ||
  String(error);

export const BpmSettings = ({ api }: { api: BpmApi }) => {
  const { t } = useTranslation([pkg.name, 'client']);
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [settings, setSettings] = useState<BpmSettingsValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [processError, setProcessError] = useState('');
  const engine = Form.useWatch('engine', form) || settings?.engine || 'camunda8';

  const loadProcesses = useCallback(async () => {
    try {
      const { data } = await api.request({ url: 'bpm:processes' });
      setProcesses(data?.data || []);
      setProcessError('');
    } catch (error) {
      setProcesses([]);
      setProcessError(errorMessage(error));
    }
  }, [api]);

  const show = (values: BpmSettingsValues) => {
    setSettings(values);
    form.setFieldsValue({
      engine: values.engine || 'camunda8',
      url: values.url,
      username: values.username,
      password: '',
    });
  };

  useEffect(() => {
    api.request({ url: 'bpm:getSettings' }).then(({ data }) => {
      show(data?.data);
      if (data?.data?.url) loadProcesses();
    });
  }, [api]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const { data } = await api.request({ url: 'bpm:saveSettings', method: 'post', data: values });
      show(data?.data);
      message.success(t('Saved'));
      loadProcesses();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await api.request({ url: 'bpm:test', method: 'post' });
      message.success(t('Connected to the engine, version {{version}}', { version: data?.data?.version }));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const deploy = async (file: File) => {
    try {
      const { data } = await api.request({
        url: 'bpm:deploy',
        method: 'post',
        data: { name: file.name, content: await file.text() },
      });
      const keys = (data?.data?.processes || []).map((p: ProcessDefinition) => p.key).join('، ');
      if (keys) message.success(t('Deployed: {{keys}}', { keys }));
      else if (/\.form$/i.test(file.name)) message.success(t('The form is deployed'));
      else message.success(t('The model has not changed'));
      await loadProcesses();
    } catch (error) {
      message.error(errorMessage(error));
    }
    return false;
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card title={t('Engine connection')} bordered={false}>
        {settings?.fromEnv && settings.url && (
          <Alert
            type="info"
            showIcon
            style={{ marginBlockEnd: 16 }}
            message={t('The connection comes from the server environment. Saving here replaces it.')}
          />
        )}
        <Form form={form} layout="vertical" style={{ maxWidth: 520 }}>
          <Form.Item name="engine" label={t('Engine')} initialValue="camunda8">
            <Select
              options={[
                { value: 'camunda8', label: 'Camunda 8' },
                { value: 'operaton', label: 'Operaton' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="url"
            label={t('Engine address')}
            extra={
              engine === 'operaton'
                ? t('For example http://operaton:8080, without /engine-rest')
                : t('For example http://camunda:8080, without /v2')
            }
            rules={[{ required: true, message: t('Enter the engine address') }]}
          >
            <Input dir="ltr" />
          </Form.Item>
          <Form.Item name="username" label={t('User name')}>
            <Input dir="ltr" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('Password')}
            extra={settings?.hasPassword ? t('Leave empty to keep the saved password') : undefined}
          >
            <Input.Password dir="ltr" autoComplete="new-password" />
          </Form.Item>
          <Space>
            <Button type="primary" loading={saving} onClick={save}>
              {t('Save')}
            </Button>
            <Button loading={testing} disabled={!settings?.url} onClick={test}>
              {t('Test the connection')}
            </Button>
          </Space>
        </Form>
      </Card>
      <Card
        title={t('Process models')}
        bordered={false}
        extra={
          <Upload
            accept={settings?.engine === 'operaton' ? '.bpmn' : '.bpmn,.form'}
            showUploadList={false}
            beforeUpload={deploy}
            disabled={!settings?.url}
          >
            <Button disabled={!settings?.url}>
              {settings?.engine === 'operaton' ? t('Deploy a BPMN file') : t('Deploy a BPMN or form file')}
            </Button>
          </Upload>
        }
      >
        {processError && <Alert type="error" showIcon message={processError} style={{ marginBlockEnd: 16 }} />}
        <Table<ProcessDefinition>
          rowKey="id"
          pagination={false}
          dataSource={processes}
          columns={[
            { title: t('Key'), dataIndex: 'key', render: (key) => <span dir="ltr">{key}</span> },
            { title: t('Title'), dataIndex: 'name' },
            { title: t('Version'), dataIndex: 'version' },
          ]}
        />
      </Card>
    </Space>
  );
};
