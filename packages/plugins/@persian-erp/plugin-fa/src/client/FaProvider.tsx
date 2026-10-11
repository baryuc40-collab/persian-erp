import { ConfigProvider, theme } from 'antd';
import React, { useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FA_FONT_FAMILY, installFont } from './font';

// Languages written right to left. Persian is the one this plugin ships; the others only switch direction.
export const RTL_LANGUAGES = ['fa', 'ar', 'he', 'ur', 'ckb'];

const baseLanguage = (lang?: string) => (lang || '').split(/[-_]/)[0].toLowerCase();

export const isRtlLanguage = (lang?: string) => RTL_LANGUAGES.includes(baseLanguage(lang));

// Sets <html dir lang> and antd's direction for right-to-left languages, and the Vazirmatn font for Persian.
// Other languages render untouched: the page is reloaded after a language switch, so the attributes are only
// removed if this provider set them.
export const FaProvider = ({ children }: { children?: React.ReactNode }) => {
  const { i18n } = useTranslation();
  const { token } = theme.useToken();
  const lang = i18n?.language;
  const rtl = isRtlLanguage(lang);
  const persian = baseLanguage(lang) === 'fa';
  // Vazirmatn has Latin letters and digits too; the default stack stays as the fallback for anything it lacks.
  const fontFamily = `${FA_FONT_FAMILY}, ${token.fontFamily}`;

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

  useLayoutEffect(() => (persian ? installFont(token.fontFamily) : undefined), [persian, token.fontFamily]);

  const themeConfig = useMemo(() => (persian ? { token: { fontFamily } } : undefined), [persian, fontFamily]);

  if (!rtl) return <>{children}</>;
  return (
    <ConfigProvider direction="rtl" theme={themeConfig}>
      {children}
    </ConfigProvider>
  );
};
