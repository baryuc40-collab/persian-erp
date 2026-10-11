import { ConfigProvider } from 'antd';
import React, { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

// Languages written right to left. Persian is the one this plugin ships; the others only switch direction.
export const RTL_LANGUAGES = ['fa', 'ar', 'he', 'ur', 'ckb'];

const baseLanguage = (lang?: string) => (lang || '').split(/[-_]/)[0].toLowerCase();

export const isRtlLanguage = (lang?: string) => RTL_LANGUAGES.includes(baseLanguage(lang));

// Sets <html dir lang> and antd's direction for right-to-left languages. Other languages render untouched:
// the page is reloaded after a language switch, so the attributes are only removed if this provider set them.
export const FaProvider = ({ children }: { children?: React.ReactNode }) => {
  const { i18n } = useTranslation();
  const lang = i18n?.language;
  const rtl = isRtlLanguage(lang);

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

  if (!rtl) return <>{children}</>;
  return <ConfigProvider direction="rtl">{children}</ConfigProvider>;
};
