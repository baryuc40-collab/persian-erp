// Settings > BPMN engine > Monitoring and alerts (STORY-099): the engine, worker, outbox, nightly check and database
// size, the open alerts, the failure list with «try again», and the alert rules. Talks to the server only through
// `api`, so the v1 and v2 clients both use it (see client/plugin.tsx and client-v2/plugin.tsx).

import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Descriptions,
  InputNumber,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
} from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../package.json';
import { formatDate } from '../client-v2/TaskInbox';

export interface MonitorApi {
  request(config: Record<string, unknown>): Promise<{ data: any }>;
}

interface EngineStatus {
  configured: boolean;
  engine: string | null;
  url: string | null;
  up: boolean;
  version: string | null;
  health: string | null;
  error: string | null;
  checkedAt: string;
  downSince: string | null;
}

interface Snapshot {
  engine: EngineStatus;
  worker: {
    running: boolean;
    workerId: string | null;
    topics: number;
    lastPollAt: string | null;
    lastFetchAt: string | null;
    error: string | null;
    enabled: boolean;
  };
  outbox: { pending: number; failed: number; oldestPendingAt: string | null };
  reconcile: {
    at: string;
    status: string;
    durationMs: number | null;
    read: number | null;
    missing: number | null;
    error: string | null;
  } | null;
  database: { name: string; bytes: number | null; error: string | null } | null;
  instances: { open: number; incident: number; failed: number; overdue: number };
  alerts: AlertRow[];
}

interface AlertRow {
  id: number;
  kind: string;
  key: string;
  status: string;
  title: string;
  openedAt: string;
  resolvedAt: string | null;
}

interface Failure {
  kind: 'incident' | 'execution' | 'outbox';
  id: string;
  processKey: string | null;
  processTitle: string | null;
  instanceId: string | null;
  businessKey: string | null;
  step: string | null;
  message: string | null;
  attempts: number | null;
  createdAt: string | null;
  link: string | null;
}

interface AlertRule {
  id: number;
  kind: string;
  enabled: boolean;
  minutes: number | null;
  count: number | null;
  roleNames: string[];
  channels: string[];
}

const errorMessage = (error: any) =>
  error?.response?.data?.errors?.map((e: { message: string }) => e.message).join('\n') ||
  error?.message ||
  String(error);

const bytesText = (bytes: number | null) => {
  if (bytes === null) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const MonitorPage = ({ api }: { api: MonitorApi }) => {
  const { t, i18n } = useTranslation([pkg.name, 'client']);
  const { message } = App.useApp();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<{ items: Failure[]; engineError: string | null; days: number } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [savingRuleId, setSavingRuleId] = useState<number | null>(null);

  const kindLabel = (kind: string) =>
    (({
      engineDown: t('Engine down'),
      worker: t('Worker'),
      outbox: t('Outbox'),
      incident: t('Incident'),
      overdue: t('Overdue'),
    } as Record<string, string>)[kind] ?? kind);

  const loadSnapshot = useCallback(async () => {
    try {
      const { data } = await api.request({ url: 'bpm:monitor' });
      setSnapshot(data?.data ?? null);
      setSnapshotError('');
    } catch (error) {
      setSnapshotError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadFailures = useCallback(async () => {
    try {
      const { data } = await api.request({ url: 'bpm:failures' });
      setFailures(data?.data ?? null);
    } catch (error) {
      message.error(errorMessage(error));
    }
  }, [api, message]);

  const loadRules = useCallback(async () => {
    try {
      const { data } = await api.request({ url: 'bpmAlertRules:list', params: { sort: 'id' } });
      setRules(data?.data ?? []);
    } catch (error) {
      message.error(errorMessage(error));
    }
  }, [api, message]);

  useEffect(() => {
    loadSnapshot();
    loadFailures();
    loadRules();
  }, [loadSnapshot, loadFailures, loadRules]);

  const refresh = () => {
    setLoading(true);
    loadSnapshot();
    loadFailures();
  };

  const retry = async (failure: Failure) => {
    setRetryingId(failure.id);
    try {
      await api.request({ url: 'bpm:retryIncident', method: 'post', params: { filterByTk: failure.id } });
      message.success(t('Tried again'));
      await Promise.all([loadFailures(), loadSnapshot()]);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setRetryingId(null);
    }
  };

  const updateRule = (id: number, patch: Partial<AlertRule>) => {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const saveRule = async (rule: AlertRule) => {
    setSavingRuleId(rule.id);
    try {
      await api.request({
        url: 'bpmAlertRules:update',
        method: 'post',
        params: { filterByTk: rule.id },
        data: {
          enabled: rule.enabled,
          minutes: rule.minutes,
          count: rule.count,
          roleNames: rule.roleNames,
          channels: rule.channels,
        },
      });
      message.success(t('Saved'));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSavingRuleId(null);
    }
  };

  const date = (value: string | null | undefined) => (value ? formatDate(value, i18n.language) : '—');

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {snapshotError && <Alert type="error" showIcon message={snapshotError} />}
      <Card
        title={t('Engine')}
        bordered={false}
        loading={loading}
        extra={
          <Button onClick={refresh} loading={loading}>
            {t('Refresh')}
          </Button>
        }
      >
        {snapshot && (
          <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
            <Descriptions.Item label={t('Status')}>
              {!snapshot.engine.configured ? (
                <Tag>{t('Not configured')}</Tag>
              ) : snapshot.engine.up ? (
                <Badge status="success" text={t('Up')} />
              ) : (
                <Badge status="error" text={t('Down')} />
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('Version')}>{snapshot.engine.version ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('Down since')}>
              {snapshot.engine.up ? '—' : date(snapshot.engine.downSince)}
            </Descriptions.Item>
            <Descriptions.Item label={t('Checked at')}>{date(snapshot.engine.checkedAt)}</Descriptions.Item>
            {snapshot.engine.error && (
              <Descriptions.Item label={t('Error')} span={4}>
                <span dir="ltr">{snapshot.engine.error}</span>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Card>

      {snapshot && (
        <Card bordered={false} loading={loading}>
          <Space size="large" wrap>
            <Statistic
              title={t('Worker')}
              value={snapshot.worker.enabled ? (snapshot.worker.running ? t('Running') : t('Stopped')) : t('Off')}
            />
            <Statistic title={t('Last fetch')} value={date(snapshot.worker.lastFetchAt)} />
            <Statistic title={t('Outbox: pending')} value={snapshot.outbox.pending} />
            <Statistic title={t('Outbox: failed')} value={snapshot.outbox.failed} />
            <Statistic
              title={t('Nightly check')}
              value={
                snapshot.reconcile
                  ? `${date(snapshot.reconcile.at)} (${
                      snapshot.reconcile.status === 'ok' ? t('Succeeded') : t('Failed')
                    })`
                  : t('Never run')
              }
            />
            <Statistic
              title={t('Database size')}
              value={
                snapshot.database
                  ? bytesText(snapshot.database.bytes) ?? snapshot.database.error ?? '—'
                  : t('Unavailable')
              }
            />
            <Statistic title={t('Running instances')} value={snapshot.instances.open} />
            <Statistic title={t('Instances with an error')} value={snapshot.instances.incident} />
            <Statistic title={t('Overdue instances')} value={snapshot.instances.overdue} />
          </Space>
        </Card>
      )}

      <Card title={t('Open alerts')} bordered={false} loading={loading}>
        <Table<AlertRow>
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: t('No open alerts') }}
          dataSource={snapshot?.alerts ?? []}
          columns={[
            { title: t('Kind'), dataIndex: 'kind', render: kindLabel, width: 160 },
            { title: t('Title'), dataIndex: 'title' },
            { title: t('Opened at'), dataIndex: 'openedAt', render: date, width: 200 },
          ]}
        />
      </Card>

      <Card title={t('Failures')} bordered={false}>
        {failures?.engineError && (
          <Alert type="warning" showIcon style={{ marginBlockEnd: 16 }} message={failures.engineError} />
        )}
        <Table<Failure>
          rowKey={(row) => `${row.kind}:${row.id}`}
          size="small"
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: t('No failures') }}
          dataSource={failures?.items ?? []}
          columns={[
            {
              title: t('Kind'),
              dataIndex: 'kind',
              width: 120,
              render: (kind: Failure['kind']) =>
                ({ incident: t('Incident'), execution: t('Workflow execution'), outbox: t('Outbox') }[kind]),
            },
            {
              title: t('Process'),
              render: (_, row) => row.processTitle ?? row.processKey ?? '—',
            },
            { title: t('Business key'), dataIndex: 'businessKey', render: (v) => v ?? '—' },
            { title: t('Step'), dataIndex: 'step', render: (v) => v ?? '—' },
            { title: t('Message'), dataIndex: 'message', render: (v) => v ?? '—' },
            { title: t('Attempts'), dataIndex: 'attempts', width: 90, render: (v) => v ?? '—' },
            { title: t('Created at'), dataIndex: 'createdAt', render: date, width: 180 },
            {
              title: t('Actions'),
              width: 140,
              render: (_, row) =>
                row.kind === 'incident' ? (
                  <Button size="small" loading={retryingId === row.id} onClick={() => retry(row)}>
                    {t('Try again')}
                  </Button>
                ) : row.link ? (
                  <a href={row.link} target="_blank" rel="noreferrer">
                    {t('Open the execution')}
                  </a>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card title={t('Alert rules')} bordered={false}>
        <Table<AlertRule>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rules}
          columns={[
            { title: t('Kind'), dataIndex: 'kind', render: kindLabel, width: 140 },
            {
              title: t('Enabled'),
              dataIndex: 'enabled',
              width: 90,
              render: (enabled: boolean, row) => (
                <Switch checked={enabled} onChange={(value) => updateRule(row.id, { enabled: value })} />
              ),
            },
            {
              title: t('Minutes'),
              dataIndex: 'minutes',
              width: 130,
              render: (minutes: number | null, row) =>
                minutes === null ? (
                  '—'
                ) : (
                  <InputNumber
                    min={0}
                    value={minutes}
                    onChange={(value) => updateRule(row.id, { minutes: value ?? 0 })}
                  />
                ),
            },
            {
              title: t('Count'),
              dataIndex: 'count',
              width: 110,
              render: (count: number | null, row) =>
                count === null ? (
                  '—'
                ) : (
                  <InputNumber min={0} value={count} onChange={(value) => updateRule(row.id, { count: value ?? 0 })} />
                ),
            },
            {
              title: t('Roles'),
              dataIndex: 'roleNames',
              render: (roleNames: string[], row) => (
                <Select
                  mode="tags"
                  style={{ minWidth: 160 }}
                  value={roleNames}
                  open={false}
                  onChange={(value) => updateRule(row.id, { roleNames: value })}
                />
              ),
            },
            {
              title: t('Channels'),
              dataIndex: 'channels',
              render: (channels: string[], row) => (
                <Select
                  mode="tags"
                  style={{ minWidth: 160 }}
                  placeholder={t('In-app only')}
                  value={channels}
                  open={false}
                  onChange={(value) => updateRule(row.id, { channels: value })}
                />
              ),
            },
            {
              title: t('Actions'),
              width: 100,
              render: (_, row) => (
                <Button size="small" type="primary" loading={savingRuleId === row.id} onClick={() => saveRule(row)}>
                  {t('Save')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
};
