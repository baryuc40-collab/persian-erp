// "Calendar" in the user menu of the classic client, next to "Language". Shown to Persian users only.

import { SchemaSettingsSelectItem } from '@nocobase/client';
import React from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../../package.json';
import { CalendarName, isPersian, setCalendarPreference, usesJalali } from './calendar';

export const CalendarSettings = () => {
  const { t, i18n } = useTranslation([pkg.name, 'client']);
  if (!isPersian(i18n.language)) return null;
  return (
    <SchemaSettingsSelectItem
      title={t('Calendar')}
      options={[
        { label: t('Jalali'), value: 'jalali' },
        { label: t('Gregorian'), value: 'gregory' },
      ]}
      value={usesJalali(i18n.language) ? 'jalali' : 'gregory'}
      onChange={(value: CalendarName) => {
        setCalendarPreference(value);
        // Dates are formatted while rendering, all over the page; reload like the language switch does.
        window.location.reload();
      }}
    />
  );
};
