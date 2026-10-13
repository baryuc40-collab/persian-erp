// "Digits" in the user menu of the classic client, next to "Calendar". Shown to Persian users only.

import { SchemaSettingsSelectItem } from '@nocobase/client';
import React from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../package.json';
import { DigitsName, setDigitsPreference, usesPersianDigits } from './digits';
import { isPersian } from './jalali/calendar';

export const DigitsSettings = () => {
  const { t, i18n } = useTranslation([pkg.name, 'client']);
  if (!isPersian(i18n.language)) return null;
  return (
    <SchemaSettingsSelectItem
      title={t('Digits')}
      options={[
        { label: t('Persian digits'), value: 'persian' },
        { label: t('Latin digits'), value: 'latin' },
      ]}
      value={usesPersianDigits() ? 'persian' : 'latin'}
      onChange={(value: DigitsName) => {
        setDigitsPreference(value);
        // The font is chosen once for the page; reload like the calendar switch does.
        window.location.reload();
      }}
    />
  );
};
