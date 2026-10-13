import { createForm } from '@formily/core';
import { Field, FormProvider } from '@formily/react';
import { getDefaultFormat, str2moment } from '@nocobase/utils/client';
import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import React from 'react';
import { JalaliDatePicker, jalaliReadPrettyProps, registerJalaliModels, setCalendarLanguageSource } from '../jalali';

// NocoBase's read-only DatePicker text, as in core/client/src/schema-component/antd/date-picker/ReadPretty.tsx.
// The real component needs a whole application around it; the wrapper only relies on this contract.
vi.mock('@nocobase/client', () => {
  const ReadPretty = (props: any) => <div>{str2moment(props.value, props)?.format(getDefaultFormat(props))}</div>;
  const DatePicker: any = ReadPretty;
  DatePicker.RangePicker = (props: any) => (
    <div>
      {str2moment(props.value, props)
        .map((item) => item.format(getDefaultFormat(props)))
        .join('~')}
    </div>
  );
  return {
    DatePicker,
    useDatePickerContext: () => ({ utc: true }),
    inferPickerType: (value: string, picker?: string) => (/^\d{4}-\d{2}$/.test(value) ? 'month' : picker || 'date'),
  };
});

let language = 'fa-IR';
setCalendarLanguageSource(() => language);

afterEach(() => {
  language = 'fa-IR';
});

const renderField = (value: unknown, props: Record<string, unknown>, component = JalaliDatePicker) => {
  const form = createForm({ readPretty: true, values: { day: value } });
  return render(
    <FormProvider form={form}>
      <Field name="day" component={[component, props]} />
    </FormProvider>,
  );
};

describe('Jalali display in the classic client', () => {
  it('turns read-only values into Jalali instances', () => {
    const props = jalaliReadPrettyProps({ value: '2026-10-12', dateOnly: true, utc: true });
    expect(props.value.format('YYYY-MM-DD')).toBe('1405-07-20');
    expect(props.dateOnly).toBe(false);
    const range = jalaliReadPrettyProps({ value: ['2026-03-21', '2026-10-12'], dateOnly: true });
    expect(range.value.map((item) => item.format('YYYY/MM/DD'))).toEqual(['1405/01/01', '1405/07/20']);
  });

  it('leaves English, quarters and weeks Gregorian', () => {
    const quarter = { value: '2026-10-12', picker: 'quarter' };
    expect(jalaliReadPrettyProps(quarter)).toBe(quarter);
    language = 'en-US';
    const props = { value: '2026-10-12', dateOnly: true };
    expect(jalaliReadPrettyProps(props)).toBe(props);
  });

  it('renders read-only dates, times and ranges in Jalali', () => {
    renderField('2026-10-12', { dateOnly: true, dateFormat: 'YYYY/MM/DD' });
    expect(screen.getByText('1405/07/20')).toBeInTheDocument();
    const moment = dayjs('2026-10-12T13:05:00').toISOString();
    renderField(moment, { dateFormat: 'YYYY-MM-DD', showTime: true, timeFormat: 'HH:mm' });
    expect(screen.getByText('1405-07-20 13:05')).toBeInTheDocument();
    renderField(['2026-03-21', '2026-10-12'], { dateOnly: true }, JalaliDatePicker.RangePicker);
    expect(screen.getByText('1405-01-01~1405-07-20')).toBeInTheDocument();
  });

  it('renders English read-only dates in Gregorian', () => {
    language = 'en-US';
    renderField('2026-10-12', { dateOnly: true, dateFormat: 'YYYY/MM/DD' });
    expect(screen.getByText('2026/10/12')).toBeInTheDocument();
  });
});

describe('Jalali display in the modern client', () => {
  // NocoBase's DisplayDateTimeFieldModel.renderComponent(), reduced to the line that formats the value.
  class DisplayDateTimeFieldModel {
    props: Record<string, any> = { format: 'YYYY-MM-DD HH:mm:ss' };
    renderComponent(value: any) {
      return value ? dayjs(value).format(this.props.format) : '';
    }
  }

  const registered = () => {
    const models: Record<string, any> = {};
    registerJalaliModels({
      getModelClass: (name: string) => (name === 'DisplayDateTimeFieldModel' ? DisplayDateTimeFieldModel : undefined),
      registerModels: (map: Record<string, any>) => Object.assign(models, map),
    } as any);
    return new models.DisplayDateTimeFieldModel();
  };

  it('replaces the display model under the same name', () => {
    const model = registered();
    expect(model).toBeInstanceOf(DisplayDateTimeFieldModel);
    expect(model.constructor.name).toBe('DisplayDateTimeFieldModel');
  });

  it('shows dates in Jalali with the field format', () => {
    expect(registered().renderComponent('2026-10-12 13:05:06')).toBe('1405-07-20 13:05:06');
  });

  it('keeps English and empty values as they were', () => {
    const model = registered();
    expect(model.renderComponent(undefined)).toBe('');
    language = 'en-US';
    expect(model.renderComponent('2026-10-12 13:05:06')).toBe('2026-10-12 13:05:06');
  });
});
