import { ConfigProvider, theme } from 'antd';
import React, { useContext, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usesPersianDigits } from './digits';
import { installFont, pageFontFamily } from './font';
import { installLatinDigitsInput } from './latin-digits-input';
import { installRtlStyles } from './rtl-styles';

// Languages written right to left. Persian is the one this plugin ships; the others only switch direction.
export const RTL_LANGUAGES = ['fa', 'ar', 'he', 'ur', 'ckb'];

const baseLanguage = (lang?: string) => (lang || '').split(/[-_]/)[0].toLowerCase();

export const isRtlLanguage = (lang?: string) => RTL_LANGUAGES.includes(baseLanguage(lang));

// Sets <html dir lang> and antd's direction for right-to-left languages, and the Vazirmatn font for Persian (with
// Persian digits unless the user chose Latin ones, see digits.ts).
// Other languages render untouched: the page is reloaded after a language switch, so the attributes are only
// removed if this provider set them.
export const FaProvider = ({ children }: { children?: React.ReactNode }) => {
  const { i18n } = useTranslation();
  const { token } = theme.useToken();
  const { locale } = useContext(ConfigProvider.ConfigContext);
  const lang = i18n?.language;
  const rtl = isRtlLanguage(lang);
  const persian = baseLanguage(lang) === 'fa';
  const persianDigits = persian && usesPersianDigits();
  // Vazirmatn has Latin letters and digits too; the default stack stays as the fallback for anything it lacks.
  const fontFamily = `'${pageFontFamily(persianDigits)}', ${token.fontFamily}`;

  useLayoutEffect(() => {
    const html = document.documentElement;
    if (rtl) {
      html.setAttribute('dir', 'rtl');
      html.setAttribute('lang', baseLanguage(lang));
      html.dataset.faDir = 'rtl';
    } else if (html.dataset.faDir) {
      html.removeAttribute('dir');
      delete html.dataset.faDir;
    }
  }, [rtl, lang]);

  useLayoutEffect(() => (persian ? installFont(token.fontFamily, persianDigits) : undefined), [
    persian,
    persianDigits,
    token.fontFamily,
  ]);

  useLayoutEffect(() => (rtl ? installRtlStyles() : undefined), [rtl]);

  // Digits typed on a Persian keyboard are saved as Latin digits; see latin-digits-input.ts.
  useLayoutEffect(() => (persian ? installLatinDigitsInput() : undefined), [persian]);

  const themeConfig = useMemo(() => (persian ? { token: { fontFamily } } : undefined), [persian, fontFamily]);

  // Modal.confirm(), message and notification called as static methods render outside this tree, so they get the
  // direction, language and font through antd's holderRender instead.
  useLayoutEffect(() => {
    if (!rtl) return undefined;
    ConfigProvider.config({
      holderRender: (node) => (
        <ConfigProvider direction="rtl" locale={locale} theme={themeConfig}>
          {node}
        </ConfigProvider>
      ),
    });
    return () => ConfigProvider.config({ holderRender: undefined });
  }, [rtl, locale, themeConfig]);

  if (!rtl) return <>{children}</>;
  return (
    <ConfigProvider direction="rtl" theme={themeConfig}>
      {children}
    </ConfigProvider>
  );
};
