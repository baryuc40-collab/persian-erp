// Jalali date pickers everywhere antd's DatePicker is used: classic fields, modern flow models, filters and settings.
//
// NocoBase renders antd's DatePicker and RangePicker directly in many places (connect() in the classic client, the
// modern field and filter models, settings forms), so replacing NocoBase components one by one would miss most of
// them. Both pickers are React forwardRef components whose render function React reads on every render, so it is
// wrapped here instead: in the Jalali calendar the wrapper renders the same antd picker built on the Jalali
// generateConfig, and converts at the boundary. Values come in as Gregorian dayjs instances and are shown in Jalali;
// everything handed back (onChange values and date strings, onOk, disabledDate arguments, ...) is Gregorian again,
// so what NocoBase saves does not change (docs/decisions/0004-jalali-calendar.md).

import { DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import React, { useMemo } from 'react';
import { isJalaliPicker, usesJalali } from './calendar';
import { toGregorian } from './dayjs';
import { jalaliGenerateConfig } from './generateConfig';

const JalaliDatePicker = DatePicker.generatePicker<Dayjs>(jalaliGenerateConfig);

type Fn = (...args: any[]) => any;
type Value = Dayjs | null | undefined | (Dayjs | null | undefined)[];

const isDate = (value: unknown): value is Dayjs => dayjs.isDayjs(value) && value.isValid();
const toJ = (value: any) => (isDate(value) && !value.isJalali() ? value.calendar('jalali') : value);
const toG = (value: any) => (isDate(value) && value.isJalali() ? toGregorian(value) : value);
const mapValue = (value: any, convert: (value: any) => any): any =>
  Array.isArray(value) ? value.map(convert) : convert(value);

// antd's own default formats (date-picker/util.js), for date strings when the field sets no format.
function defaultFormat(picker: string | undefined, showTime: any) {
  if (picker === 'month') return 'YYYY-MM';
  if (picker === 'year') return 'YYYY';
  if (showTime) return `YYYY-MM-DD ${showTime?.format || 'HH:mm:ss'}`;
  return 'YYYY-MM-DD';
}

/** The date string antd would have passed for this Gregorian value. */
export function gregorianDateString(value: Dayjs, props: { format?: any; picker?: string; showTime?: any }) {
  let format = props.format;
  if (format && typeof format === 'object' && !Array.isArray(format)) format = format.format;
  if (Array.isArray(format)) format = format[0];
  if (typeof format === 'function') return format(value);
  return value.format(typeof format === 'string' ? format : defaultFormat(props.picker, props.showTime));
}

const gregorianStrings = (dates: Value, strings: any, props: any) => {
  if (Array.isArray(dates)) {
    return dates.map((date, index) => (isDate(date) ? gregorianDateString(toG(date), props) : strings?.[index]));
  }
  return isDate(dates) ? gregorianDateString(toG(dates), props) : strings;
};

const VALUE_KEYS = ['value', 'defaultValue', 'pickerValue', 'defaultPickerValue', 'minDate', 'maxDate'];

/** Props for the Jalali picker: values in, Gregorian out. */
export function toJalaliPickerProps(props: Record<string, any>) {
  const next: Record<string, any> = { ...props };
  for (const key of VALUE_KEYS) {
    if (key in props) next[key] = mapValue(props[key], toJ);
  }
  if (props.showTime && typeof props.showTime === 'object' && props.showTime.defaultValue) {
    next.showTime = { ...props.showTime, defaultValue: mapValue(props.showTime.defaultValue, toJ) };
  }
  if (Array.isArray(props.presets)) {
    next.presets = props.presets.map((preset) => ({
      ...preset,
      value: typeof preset.value === 'function' ? () => mapValue(preset.value(), toJ) : mapValue(preset.value, toJ),
    }));
  }
  const wrap = (key: string, wrapper: (fn: Fn) => Fn) => {
    if (typeof props[key] === 'function') next[key] = wrapper(props[key]);
  };
  wrap('onChange', (fn) => (dates, strings, ...rest) =>
    fn(mapValue(dates, toG), gregorianStrings(dates, strings, props), ...rest),
  );
  wrap('onCalendarChange', (fn) => (dates, strings, ...rest) =>
    fn(mapValue(dates, toG), gregorianStrings(dates, strings, props), ...rest),
  );
  wrap('onOk', (fn) => (dates, ...rest) => fn(mapValue(dates, toG), ...rest));
  wrap('onPanelChange', (fn) => (dates, ...rest) => fn(mapValue(dates, toG), ...rest));
  wrap('disabledDate', (fn) => (date, ...rest) => fn(toG(date), ...rest));
  wrap('disabledTime', (fn) => (date, ...rest) => fn(mapValue(date, toG), ...rest));
  return next;
}

function adapter(Jalali: React.ComponentType<any>) {
  const Adapter = ({ forwardedRef, ...props }: any) => {
    const jalaliProps = toJalaliPickerProps(props);
    // New Jalali instances on every render would look like new values to the picker; keep them while the Gregorian
    // values stay the same.
    const values = useMemo(
      () => VALUE_KEYS.map((key) => jalaliProps[key]),
      VALUE_KEYS.map((key) => props[key]), // eslint-disable-line react-hooks/exhaustive-deps
    );
    VALUE_KEYS.forEach((key, index) => {
      if (key in props) jalaliProps[key] = values[index];
    });
    return <Jalali {...jalaliProps} ref={forwardedRef} />;
  };
  return Adapter;
}

function wrapRender(target: any, Jalali: React.ComponentType<any>) {
  const render = target.render;
  if (typeof render !== 'function' || render.jalali) return;
  const Adapter = adapter(Jalali);
  const jalaliRender = function (props: any, ref: any) {
    if (usesJalali() && isJalaliPicker(props.picker || 'date')) return <Adapter {...props} forwardedRef={ref} />;
    return render(props, ref);
  };
  jalaliRender.jalali = true;
  target.render = jalaliRender;
}

let installed = false;

/** Makes antd's DatePicker and RangePicker Jalali for Persian users. Safe to call more than once. */
export function installJalaliPickers() {
  if (installed) return;
  installed = true;
  wrapRender(DatePicker, JalaliDatePicker);
  wrapRender(DatePicker.RangePicker, JalaliDatePicker.RangePicker);
}
