import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import React from 'react';
import { MonitorApi, MonitorPage } from '../MonitorPage';

// Settings > BPMN engine > Monitoring and alerts (STORY-099). Without translations loaded the test sees the
// English keys.

const snapshot = {
  engine: {
    configured: true,
    engine: 'camunda8',
    url: 'http://camunda:8080',
    up: true,
    version: '8.10.7',
    health: 'UP',
    error: null,
    checkedAt: '2026-11-07T08:00:00.000Z',
    downSince: null,
  },
  worker: { running: true, workerId: 'worker-1', topics: 2, lastPollAt: null, lastFetchAt: null, error: null, enabled: true },
  outbox: { pending: 1, failed: 0, oldestPendingAt: null },
  reconcile: { at: '2026-11-07T02:00:00.000Z', status: 'ok', durationMs: 100, read: 10, missing: 0, error: null },
  database: { name: 'camunda', bytes: 2 * 1024 * 1024, error: null },
  instances: { open: 3, incident: 1, failed: 0, overdue: 0 },
  alerts: [{ id: 1, kind: 'outbox', key: 'outbox', status: 'open', title: 'صف ارسال پر است', openedAt: '2026-11-07T08:00:00.000Z', resolvedAt: null }],
};

const failures = {
  items: [
    {
      kind: 'incident' as const,
      id: 'inc-1',
      processKey: 'purchase_request',
      processTitle: 'درخواست خرید',
      instanceId: 'pi-1',
      businessKey: 'purchase_requests:1',
      step: 'تأیید مدیر',
      message: 'engine down',
      attempts: 2,
      createdAt: '2026-11-07T07:00:00.000Z',
      link: null,
    },
  ],
  engineError: null,
  days: 7,
};

const rules = [{ id: 1, kind: 'engineDown', enabled: true, minutes: 2, count: null, roleNames: ['admin'], channels: [] }];

const renderPage = (api: MonitorApi) =>
  render(
    <App>
      <MonitorPage api={api} />
    </App>,
  );

describe('Settings > BPMN engine > Monitoring and alerts', () => {
  it('shows the engine, worker, outbox and nightly check from bpm:monitor', async () => {
    const api: MonitorApi = {
      request: vi.fn(async ({ url }) => {
        if (url === 'bpm:monitor') return { data: { data: snapshot } };
        if (url === 'bpm:failures') return { data: { data: { items: [], engineError: null, days: 7 } } };
        if (url === 'bpmAlertRules:list') return { data: { data: [] } };
        return { data: { data: {} } };
      }),
    };
    renderPage(api);
    expect(await screen.findByText('8.10.7')).toBeTruthy();
    expect(screen.getByText('Up')).toBeTruthy();
    expect(screen.getByText('2 MB')).toBeTruthy();
    expect(screen.getByText('صف ارسال پر است')).toBeTruthy();
  });

  it('tries an incident again and refreshes the failures and the snapshot', async () => {
    let retried = false;
    const api: MonitorApi = {
      request: vi.fn(async ({ url, method, params }) => {
        if (url === 'bpm:monitor') return { data: { data: snapshot } };
        if (url === 'bpm:failures') return { data: { data: retried ? { items: [], engineError: null, days: 7 } : failures } };
        if (url === 'bpmAlertRules:list') return { data: { data: [] } };
        if (url === 'bpm:retryIncident' && method === 'post') {
          expect(params).toEqual({ filterByTk: 'inc-1' });
          retried = true;
          return { data: { data: {} } };
        }
        return { data: { data: {} } };
      }),
    };
    renderPage(api);
    expect(await screen.findByText('درخواست خرید')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bpm:retryIncident', method: 'post', params: { filterByTk: 'inc-1' } }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('درخواست خرید')).toBeNull());
  });

  it('saves an edited alert rule', async () => {
    const api: MonitorApi = {
      request: vi.fn(async ({ url, method, params, data }) => {
        if (url === 'bpm:monitor') return { data: { data: snapshot } };
        if (url === 'bpm:failures') return { data: { data: { items: [], engineError: null, days: 7 } } };
        if (url === 'bpmAlertRules:list') return { data: { data: rules } };
        if (url === 'bpmAlertRules:update' && method === 'post') {
          expect(params).toEqual({ filterByTk: 1 });
          expect(data).toEqual({ enabled: true, minutes: 5, count: null, roleNames: ['admin'], channels: [] });
          return { data: { data: {} } };
        }
        return { data: { data: {} } };
      }),
    };
    renderPage(api);
    const row = (await screen.findByText('Engine down')).closest('tr') as HTMLElement;
    const minutes = within(row).getByRole('spinbutton');
    fireEvent.change(minutes, { target: { value: '5' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bpmAlertRules:update', method: 'post' }),
      ),
    );
  });
});
