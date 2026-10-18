import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import React from 'react';
import { formatDate, TaskApi, TaskDetail, TaskInbox, TaskRow } from '../TaskInbox';

// The task inbox (STORY-082). Without translations loaded the test sees the English keys.

const row: TaskRow = {
  id: 't1',
  name: 'تأیید مدیر',
  processKey: 'purchase_request',
  processName: 'درخواست خرید',
  businessKey: 'purchase_requests:1',
  created: '2026-10-14T08:00:00.000Z',
  record: { collection: 'purchase_requests', collectionTitle: 'درخواست‌ها', id: 1, title: 'لپ‌تاپ' },
};

const detail: TaskDetail = {
  ...row,
  form: [
    { id: 'approved', label: 'تأیید می‌شود؟', type: 'boolean', required: true, defaultValue: null, options: [] },
    { id: 'note', label: 'یادداشت', type: 'string', required: false, defaultValue: null, options: [] },
  ],
  fields: [
    { name: 'title', title: 'عنوان', interface: 'input', value: 'لپ‌تاپ' },
    { name: 'createdAt', title: '{{t("Created at")}}', interface: 'createdAt', value: '2026-03-20T12:00:00.000Z' },
  ],
};

describe('task inbox', () => {
  it('writes dates on the Jalali calendar in Persian', () => {
    // Nowruz 1405 is 21 March 2026.
    expect(formatDate('2026-03-20T12:00:00.000Z', 'fa-IR', false)).toBe('۲۹ اسفند ۱۴۰۴');
    expect(formatDate('2026-03-22T12:00:00.000Z', 'fa-IR', false)).toBe('۲ فروردین ۱۴۰۵');
    expect(formatDate('2026-03-20T12:00:00.000Z', 'en-US', false)).toContain('2026');
  });

  it('lists the tasks, opens one with its record and completes it with its form', async () => {
    let tasks = [row];
    const api: TaskApi = {
      request: vi.fn(async ({ url }) => {
        if (url === 'bpmTasks:list') return { data: { data: tasks } };
        if (url === 'bpmTasks:get') return { data: { data: detail } };
        tasks = [];
        return { data: { data: { id: 't1' } } };
      }),
    };
    render(
      <App>
        <TaskInbox api={api} />
      </App>,
    );
    const cells = (await screen.findByText('درخواست خرید')).closest('tr') as HTMLElement;
    expect(within(cells).getByText('درخواست‌ها: لپ‌تاپ')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'تأیید مدیر' }));
    expect(await screen.findByText('یادداشت')).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith({ url: 'bpmTasks:get', params: { filterByTk: 't1' } });
    // The record's fields, with a translated title template.
    expect(screen.getByText('عنوان')).toBeTruthy();
    expect(screen.getAllByText('Created at').length).toBeGreaterThan(0);

    // The decision is required.
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Fill in {{label}}')).toBeTruthy();
    fireEvent.click(screen.getByText('Yes'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'خوب است' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith({
        url: 'bpmTasks:complete',
        method: 'post',
        params: { filterByTk: 't1' },
        data: { approved: true, note: 'خوب است' },
      }),
    );
    expect(await screen.findByText('No tasks for you')).toBeTruthy();
  });
});
