import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import React from 'react';
import type { ModuleSummary } from '../../shared/summary';
import {
  CatalogItem,
  DeleteModule,
  ImportPreviewView,
  InstalledModule,
  ModulesApi,
  ModulesCatalog,
  ModulesSettings,
  RemovalPlan,
  UpgradePlan,
} from '../ModulesSettings';

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
    const api: ModulesApi = {
      request: vi.fn(async ({ url }) => ({ data: { data: url === 'erpModules:overview' ? modules : [] } })),
    };
    render(
      <App>
        <ModulesSettings api={api} />
      </App>,
    );
    const row = (await screen.findByText('آزمایشگاه')).closest('tr') as HTMLElement;
    expect(api.request).toHaveBeenCalledWith({ url: 'erpModules:overview' });
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells).toEqual(['', 'lab', 'آزمایشگاه', '1.0.0', '2', '2', '1', 'ExportDelete']);
    const broken = screen.getByText('قدیمی').closest('tr') as HTMLElement;
    expect(within(broken).getByRole('button', { name: 'Export' })).toHaveProperty('disabled', true);
    expect(within(broken).getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Import a module' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Define a module' })).toBeTruthy();
  });

  it('deletes a module only after its key is typed, and shows what goes first', async () => {
    const plan: RemovalPlan = {
      key: 'lab',
      title: 'آزمایشگاه',
      version: '1.0.0',
      collections: [{ name: 'lab_items', title: 'اقلام', records: 12 }],
      pages: [{ title: 'اقلام مدرن', type: 'flowPage' }],
      workflows: [{ key: 'labstatus01', title: 'وضعیت', versions: 2 }],
      roles: [{ name: 'lab_clerk', title: 'کارمند', users: 3 }],
    };
    const api: ModulesApi = { request: vi.fn(async () => ({ data: { data: plan } })) };
    const onClose = vi.fn();
    render(
      <App>
        <DeleteModule api={api} moduleKey="lab" onClose={onClose} />
      </App>,
    );
    // Without translations loaded the test sees the keys, so the counts are checked through the tags' prefixes.
    expect(await screen.findByText(/^اقلام: /)).toBeTruthy();
    expect(screen.getByText(/^وضعیت: /)).toBeTruthy();
    expect(screen.getByText(/^کارمند: /)).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith({ url: 'erpModules:remove', method: 'post', params: { filterByTk: 'lab', dryRun: true } });
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveProperty('disabled', true);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'la' } });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: 'lab' } });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(api.request).toHaveBeenLastCalledWith({ url: 'erpModules:remove', method: 'post', params: { filterByTk: 'lab', confirm: 'lab' } });
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

  it('lists the catalog with an install button for what can be installed', () => {
    const item = (key: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
      file: `${key}.erp-module.json`,
      installed: false,
      summary: { ...summary, key, title: key, description: `${key} description` },
      warnings: [],
      problems: [],
      conflicts: [],
      ...extra,
    });
    const onInstall = vi.fn();
    render(
      <ModulesCatalog
        items={[item('people'), item('stock', { installed: true }), item('old', { problems: ['Made with NocoBase 1.0.0'] })]}
        onInstall={onInstall}
        onUpgrade={vi.fn()}
      />,
    );
    const row = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
    expect(within(row('people')).getByText('people description')).toBeTruthy();
    fireEvent.click(within(row('people')).getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ file: 'people.erp-module.json' }));
    expect(within(row('stock')).getByText('Installed')).toBeTruthy();
    expect(within(row('stock')).queryByRole('button')).toBeNull();
    expect(within(row('old')).getByRole('button', { name: 'Install' })).toHaveProperty('disabled', true);
    expect(within(row('old')).getByText('Made with NocoBase 1.0.0')).toBeTruthy();
  });

  it('shows nothing when the plugin has no catalog', () => {
    const { container } = render(<ModulesCatalog items={[]} onInstall={vi.fn()} onUpgrade={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  const upgradePlan: UpgradePlan = {
    key: 'lab',
    title: 'آزمایشگاه',
    from: '1.0.0',
    to: '1.1.0',
    localChanges: false,
    collections: { added: [], updated: ['lab_items'], kept: [] },
    fields: { added: ['lab_items.note'], updated: [], kept: ['lab_items.old'] },
    routes: { added: [], updated: ['اقلام'], removed: ['پیوند'] },
    workflows: { added: [], revised: ['labstatus01'], disabled: [] },
    roles: { added: [], updated: [], kept: [] },
  };

  it('shows what an upgrade changes, with a reminder to back up first', () => {
    const preview = { summary, warnings: [], problems: [], conflicts: [], plan: upgradePlan };
    const { rerender } = render(<ImportPreviewView preview={preview} upgrade />);
    expect(screen.getByText('Back up the database before the upgrade.')).toBeTruthy();
    expect(screen.queryByText(/^The module was changed after it was installed/)).toBeNull();
    const row = (label: string) => screen.getByText(label).closest('tr') as HTMLElement;
    expect(within(row('New fields')).getByText('lab_items.note')).toBeTruthy();
    expect(within(row('Workflows with a new version')).getByText('labstatus01')).toBeTruthy();
    expect(within(row('Deleted menu items')).getByText('پیوند')).toBeTruthy();
    expect(within(row('Kept, not in the new version')).getByText('lab_items.old')).toBeTruthy();
    // Parts with no change get no row.
    expect(screen.queryByText('New roles')).toBeNull();

    rerender(<ImportPreviewView preview={{ ...preview, plan: { ...upgradePlan, localChanges: true } }} upgrade />);
    expect(screen.getByText(/^The module was changed after it was installed/)).toBeTruthy();
  });

  it('upgrades a catalog module that has a newer version', async () => {
    const installed: InstalledModule[] = [{ ...summary, groupSchemaUid: 'labgroup001' }];
    const catalog: CatalogItem[] = [
      {
        file: 'lab.erp-module.json',
        installed: true,
        installedVersion: '1.0.0',
        upgrade: true,
        summary: { ...summary, version: '1.1.0' },
        warnings: [],
        problems: [],
        conflicts: [],
      },
    ];
    const api: ModulesApi = {
      request: vi.fn(async ({ url, params }) => {
        if (url === 'erpModules:overview') return { data: { data: installed } };
        if (url === 'erpModules:catalog') return { data: { data: catalog } };
        if (params?.dryRun) return { data: { data: { summary, warnings: [], problems: [], conflicts: [], plan: upgradePlan } } };
        return { data: { data: { key: 'lab', plan: upgradePlan, warnings: [] } } };
      }),
    };
    render(
      <App>
        <ModulesSettings api={api} />
      </App>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Upgrade to version/ }));
    expect(await screen.findByText('Upgrade the module')).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith({
      url: 'erpModules:upgrade',
      method: 'post',
      params: { dryRun: true, filterByTk: 'lab' },
      data: undefined,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith({
        url: 'erpModules:upgrade',
        method: 'post',
        params: { filterByTk: 'lab' },
        data: undefined,
      }),
    );
    expect(await screen.findByText('The module was upgraded')).toBeTruthy();
  });
});
