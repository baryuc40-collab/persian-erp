import { render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import React from 'react';
import type { ModuleSummary } from '../../shared/summary';
import { ImportPreviewView, InstalledModule, ModulesApi, ModulesSettings } from '../ModulesSettings';

const summary: ModuleSummary = {
  key: 'lab',
  title: 'آزمایشگاه',
  version: '1.0.0',
  description: '',
  collections: [
    { name: 'lab_items', title: 'اقلام' },
    { name: 'lab_categories', title: '' },
  ],
  pages: [
    { title: 'اقلام مدرن', type: 'flowPage' },
    { title: '{{t("Items")}}', type: 'page' },
  ],
  workflows: [{ key: 'labstatus01', title: 'وضعیت', enabled: true }],
  roles: [{ name: 'lab_clerk', title: 'کارمند' }],
};

describe('Settings > ERP modules', () => {
  it('lists the modules of this install with their counts and an export button', async () => {
    const modules: InstalledModule[] = [
      { ...summary, groupSchemaUid: 'labgroup001' },
      { ...summary, key: 'old', title: 'قدیمی', collections: [], pages: [], workflows: [], roles: [], groupSchemaUid: 'x', error: 'The menu group is gone' },
    ];
    const api: ModulesApi = { request: vi.fn(async () => ({ data: { data: modules } })) };
    render(
      <App>
        <ModulesSettings api={api} />
      </App>,
    );
    const row = (await screen.findByText('آزمایشگاه')).closest('tr') as HTMLElement;
    expect(api.request).toHaveBeenCalledWith({ url: 'erpModules:overview' });
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells).toEqual(['', 'lab', 'آزمایشگاه', '1.0.0', '2', '2', '1', 'Export']);
    const broken = screen.getByText('قدیمی').closest('tr') as HTMLElement;
    expect(within(broken).getByRole('button', { name: 'Export' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Import a module' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Define a module' })).toBeTruthy();
  });

  it('shows what an import creates', () => {
    render(<ImportPreviewView preview={{ summary, warnings: [], problems: [], conflicts: [] }} />);
    expect(screen.getByText('اقلام (lab_items)')).toBeTruthy();
    expect(screen.getByText('lab_categories')).toBeTruthy();
    // A menu title written as a translation template is shown translated.
    expect(screen.getByText('Items')).toBeTruthy();
    expect(screen.getByText('وضعیت')).toBeTruthy();
    expect(screen.getByText('کارمند')).toBeTruthy();
    expect(screen.queryByText('The module cannot be imported')).toBeNull();
  });

  it('shows the problems that stop an import, and the warnings', async () => {
    render(
      <ImportPreviewView
        preview={{
          summary,
          warnings: ['Made with another patch version'],
          problems: ['The module conflicts with what this install already has'],
          conflicts: ['Collection: lab_items'],
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText('The module cannot be imported')).toBeTruthy());
    expect(screen.getByText('Collection: lab_items')).toBeTruthy();
    expect(screen.getByText('Made with another patch version')).toBeTruthy();
  });
});
