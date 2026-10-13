// Classic (v1) client: shows read-only date fields in the Jalali calendar.
//
// NocoBase's DatePicker renders its read-only text with str2moment(value).format(format) (ReadPretty.tsx). Rather
// than copying that component, which also carries the field's popup link, this wrapper resolves the value the same
// way, turns it into a Jalali instance and passes that on. str2moment returns a dayjs instance as it is, so
// format() prints the Jalali date. The options that str2moment would apply again are cleared.

import { isVoidField } from '@formily/core';
import { observer, useField } from '@formily/react';
import { DatePicker as BaseDatePicker, inferPickerType, useDatePickerContext } from '@nocobase/client';
import { str2moment } from '@nocobase/utils/client';
import React from 'react';
import { isJalaliPicker, toJalaliDisplay, usesJalali } from './calendar';

const isReadPretty = (field: any) => !!field && !isVoidField(field) && field.pattern === 'readPretty';

export function jalaliReadPrettyProps(props: any, picker: string = props.picker) {
  if (!props.value || !usesJalali() || !isJalaliPicker(picker || 'date')) return props;
  const resolved = str2moment(props.value, props);
  const value = Array.isArray(resolved)
    ? resolved.map((item) => toJalaliDisplay(item, picker))
    : toJalaliDisplay(resolved, picker);
  return { ...props, value, dateOnly: false, gmt: false, utc: true, utcOffset: undefined };
}

const DatePicker: any = observer((props: any) => {
  const field = useField();
  const { utc = true } = useDatePickerContext();
  if (!isReadPretty(field)) return <BaseDatePicker {...props} />;
  const value = Array.isArray(props.value) ? props.value[0] : props.value;
  return <BaseDatePicker {...jalaliReadPrettyProps({ utc, ...props, value })} />;
});

const RangePicker = observer((props: any) => {
  const field = useField();
  const { utc = true } = useDatePickerContext();
  if (!isReadPretty(field) || !Array.isArray(props.value)) return <BaseDatePicker.RangePicker {...props} />;
  // NocoBase infers the picker from the stored strings; do it before they become dayjs instances.
  const picker = inferPickerType(props.value[0], props.picker);
  return <BaseDatePicker.RangePicker {...jalaliReadPrettyProps({ utc, ...props, picker }, picker)} />;
});

Object.assign(DatePicker, BaseDatePicker, { RangePicker });

export { DatePicker as JalaliDatePicker };
