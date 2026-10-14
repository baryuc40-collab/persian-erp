// The task inbox (STORY-082): the user tasks of the BPMN engine that are the current user's, each opened in a drawer
// with its record and its form. Everything goes through the bpmTasks actions, which check the user's roles.

import {
  Alert,
  App,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Table,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../package.json';

export interface TaskApi {
  request(config: Record<string, unknown>): Promise<{ data: any }>;
}

export interface TaskRecord {
  collection: string;
  collectionTitle: string | null;
  id: string | number;
  title: string | null;
}

export interface TaskRow {
  id: string;
  name: string | null;
  processKey: string;
  processName: string | null;
  businessKey: string | null;
  created: string;
  record: TaskRecord | null;
}

export interface TaskFormField {
  id: string;
  label: string | null;
  type: 'string' | 'long' | 'boolean' | 'date' | 'enum';
  required: boolean;
  defaultValue: string | null;
  options: { id: string; name: string | null }[];
}

export interface TaskDetail extends TaskRow {
  form: TaskFormField[];
  fields: { name: string; title: string | null; interface: string; value: unknown }[];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const DATE_INTERFACES = ['date', 'datetime', 'datetimeNoTz', 'dateOnly', 'createdAt', 'updatedAt', 'unixTimestamp'];

const errorMessage = (error: any) =>
  error?.response?.data?.errors?.map((e: { message: string }) => e.message).join('\n') ||
  error?.message ||
  String(error);

/** A date in the user's language; in Persian, on the Jalali calendar. The database and the engine keep UTC. */
export function formatDate(value: string | number | Date, language: string, withTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const locale = language === 'fa-IR' ? 'fa-IR-u-ca-persian' : language;
  return new Intl.DateTimeFormat(
    locale,
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(date);
}

// Collection and field titles may be translation templates like {{t("Title")}}.
const title = (text: string | null | undefined, t: Translate) => {
  const match = /^\{\{\s*t\(\s*["'](.+?)["']/.exec(text || '');
  return match ? t(match[1], { ns: 'client' }) : text || '';
};

function fieldValue(value: unknown, fieldInterface: string, t: Translate, language: string): React.ReactNode {
  if (value === null || value === undefined || value === '') return '';
  if (DATE_INTERFACES.includes(fieldInterface) && (typeof value === 'string' || typeof value === 'number')) {
    return formatDate(value, language, !['dateOnly', 'date'].includes(fieldInterface));
  }
  if (typeof value === 'boolean') return value ? t('Yes') : t('No');
  if (Array.isArray(value)) return value.filter((v) => typeof v !== 'object').join('، ');
  if (typeof value === 'object') return '';
  return String(value);
}

const initialValue = (field: TaskFormField) => {
  if (field.defaultValue === null) return undefined;
  if (field.type === 'boolean') return field.defaultValue === 'true';
  if (field.type === 'long') return Number(field.defaultValue);
  if (field.type === 'date') return dayjs(field.defaultValue);
  return field.defaultValue;
};

// Form.Item gives its child the value and onChange, which go on to the input.
function FormInput({
  field,
  t,
  ...props
}: {
  field: TaskFormField;
  t: Translate;
  value?: unknown;
  onChange?: unknown;
}) {
  const input = props as Record<string, never>;
  switch (field.type) {
    case 'boolean':
      return (
        <Radio.Group
          {...input}
          options={[
            { value: true, label: t('Yes') },
            { value: false, label: t('No') },
          ]}
        />
      );
    case 'long':
      return <InputNumber {...input} precision={0} style={{ width: '100%' }} />;
    case 'date':
      return <DatePicker {...input} style={{ width: '100%' }} />;
    case 'enum':
      return (
        <Select
          {...input}
          options={field.options.map((option) => ({ value: option.id, label: option.name || option.id }))}
        />
      );
    default:
      return <Input.TextArea {...input} autoSize={{ minRows: 1, maxRows: 6 }} />;
  }
}

export function TaskDrawer({
  api,
  taskId,
  onClose,
}: {
  api: TaskApi;
  taskId: string | null;
  onClose: (done: boolean) => void;
}) {
  const { t, i18n } = useTranslation([pkg.name, 'client']);
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTask(null);
    setError(null);
    form.resetFields();
    if (!taskId) return;
    api
      .request({ url: 'bpmTasks:get', params: { filterByTk: taskId } })
      .then((res) => setTask(res.data?.data))
      .catch((e) => setError(errorMessage(e)));
  }, [api, taskId, form]);

  const submit = async () => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return; // The form shows what is missing.
    }
    const variables = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        dayjs.isDayjs(value) ? (value as Dayjs).toISOString() : value,
      ]),
    );
    setSaving(true);
    try {
      await api.request({ url: 'bpmTasks:complete', method: 'post', params: { filterByTk: taskId }, data: variables });
      message.success(t('The task is done'));
      onClose(true);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!taskId}
      width={560}
      title={task?.name || t('Task')}
      onClose={() => onClose(false)}
      destroyOnClose
      footer={
        task ? (
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => onClose(false)}>{t('Cancel')}</Button>
            <Button type="primary" loading={saving} onClick={submit}>
              {t('Submit')}
            </Button>
          </Space>
        ) : null
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      {!task && !error && <Spin />}
      {task && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t('Process')}>{task.processName || task.processKey}</Descriptions.Item>
            <Descriptions.Item label={t('Created at')}>{formatDate(task.created, i18n.language)}</Descriptions.Item>
          </Descriptions>
          {task.record && (
            <Descriptions
              title={title(task.record.collectionTitle, t) || task.record.collection}
              column={1}
              size="small"
              bordered
            >
              {task.fields.map((field) => (
                <Descriptions.Item key={field.name} label={title(field.title, t) || field.name}>
                  {fieldValue(field.value, field.interface, t, i18n.language)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          )}
          <Form form={form} layout="vertical" requiredMark>
            {task.form.map((field) => (
              <Form.Item
                key={field.id}
                name={field.id}
                label={field.label || field.id}
                initialValue={initialValue(field)}
                rules={
                  field.required
                    ? [{ required: true, message: t('Fill in {{label}}', { label: field.label || field.id }) }]
                    : []
                }
              >
                <FormInput field={field} t={t} />
              </Form.Item>
            ))}
          </Form>
        </Space>
      )}
    </Drawer>
  );
}

export function TaskInbox({ api }: { api: TaskApi }) {
  const { t, i18n } = useTranslation([pkg.name, 'client']);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.request({ url: 'bpmTasks:list' });
      setTasks(res.data?.data || []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const close = (done: boolean) => {
    setOpen(null);
    if (done) load();
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={load} loading={loading}>
          {t('Refresh')}
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      <Table<TaskRow>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={tasks}
        pagination={tasks.length > 20 ? { pageSize: 20 } : false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No tasks for you')} /> }}
        columns={[
          {
            key: 'name',
            title: t('Task'),
            render: (_, task) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => setOpen(task.id)}>
                {task.name || task.id}
              </Button>
            ),
          },
          { key: 'process', title: t('Process'), render: (_, task) => task.processName || task.processKey },
          {
            key: 'record',
            title: t('Record'),
            render: (_, task) =>
              task.record
                ? `${title(task.record.collectionTitle, t) || task.record.collection}: ${
                    task.record.title ?? task.record.id
                  }`
                : '',
          },
          { key: 'created', title: t('Created at'), render: (_, task) => formatDate(task.created, i18n.language) },
        ]}
      />
      <TaskDrawer api={api} taskId={open} onClose={close} />
    </Space>
  );
}

export default TaskInbox;
