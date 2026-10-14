import { act, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, Modal, theme } from 'antd';
import i18next from 'i18next';
import React, { useContext } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { DIGITS_STORAGE_KEY } from '../digits';
import { FaProvider, isRtlLanguage } from '../FaProvider';
import { RTL_STYLE_ID, rtlStyles } from '../rtl-styles';

const Direction = () => (
  <>
    <span data-testid="dir">{useContext(ConfigProvider.ConfigContext).direction || 'ltr'}</span>
    <span data-testid="font">{theme.useToken().token.fontFamily}</span>
  </>
);
const fontStyle = () => document.getElementById('persian-erp-fa-font');
const rtlStyle = () => document.getElementById(RTL_STYLE_ID);

async function renderIn(lang: string) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: lang, resources: {} });
  return render(
    <I18nextProvider i18n={i18n}>
      <FaProvider>
        <Direction />
      </FaProvider>
    </I18nextProvider>,
  );
}

describe('FaProvider', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    delete document.documentElement.dataset.faDir;
    window.localStorage.removeItem(DIGITS_STORAGE_KEY);
  });

  it('detects right-to-left languages', () => {
    expect(isRtlLanguage('fa-IR')).toBe(true);
    expect(isRtlLanguage('ar_EG')).toBe(true);
    expect(isRtlLanguage('en-US')).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });

  it('switches the page and antd to right-to-left for Persian', async () => {
    await renderIn('fa-IR');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('fa');
    expect(screen.getByTestId('dir').textContent).toBe('rtl');
  });

  it('loads Vazirmatn from the plugin, not a CDN, for Persian', async () => {
    const { unmount } = await renderIn('fa-IR');
    expect(screen.getByTestId('font').textContent).toMatch(/^'Vazirmatn FD', /);
    const css = fontStyle()?.textContent || '';
    expect(css).toContain("url('/static/plugins/@persian-erp/plugin-fa/dist/client/fonts/Vazirmatn-Regular.woff2')");
    expect(css).toContain("url('/static/plugins/@persian-erp/plugin-fa/dist/client/fonts/Vazirmatn-FD-Bold.woff2')");
    expect(css).toContain('font-weight:700');
    expect(css).toContain("body{font-family:'Vazirmatn FD',");
    expect(css).not.toMatch(/https?:/);
    unmount();
    expect(fontStyle()).toBeNull();
  });

  it('shows Latin digits with plain Vazirmatn when the user chose them', async () => {
    window.localStorage.setItem(DIGITS_STORAGE_KEY, 'latin');
    const { unmount } = await renderIn('fa-IR');
    expect(screen.getByTestId('font').textContent).toMatch(/^'Vazirmatn', /);
    expect(fontStyle()?.textContent).toContain("body{font-family:'Vazirmatn',");
    unmount();
  });

  it('adds the RTL style corrections for Persian and removes them on unmount', async () => {
    const { unmount } = await renderIn('fa-IR');
    expect(rtlStyle()?.textContent).toContain('margin-right:8px !important');
    unmount();
    expect(rtlStyle()).toBeNull();
  });

  it('scopes every RTL correction to right-to-left pages', () => {
    const selectors = rtlStyles()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{[^}]*\}/g, '\n')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(100);
    for (const selector of selectors) expect(selector.startsWith("html[dir='rtl'] ")).toBe(true);
  });

  it('opens static Modal.confirm dialogs right-to-left', async () => {
    const { unmount } = await renderIn('fa-IR');
    let modal: { destroy: () => void } | undefined;
    act(() => {
      modal = Modal.confirm({ title: 'confirm' });
    });
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm-rtl')).not.toBeNull());
    act(() => modal?.destroy());
    unmount();
  });

  it('leaves English untouched', async () => {
    document.documentElement.setAttribute('lang', 'en');
    await renderIn('en-US');
    expect(document.documentElement.hasAttribute('dir')).toBe(false);
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(screen.getByTestId('dir').textContent).toBe('ltr');
    expect(screen.getByTestId('font').textContent).not.toContain('Vazirmatn');
    expect(fontStyle()).toBeNull();
    expect(rtlStyle()).toBeNull();
  });
});
