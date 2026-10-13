import { fireEvent, render } from '@testing-library/react';
import { DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/fa';
import React from 'react';
import { setCalendarLanguageSource } from '../jalali/calendar';
import { gregorianDateString, installJalaliPickers, toJalaliPickerProps } from '../jalali/pickers';

let language = 'fa-IR';
setCalendarLanguageSource(() => language);
installJalaliPickers();

afterEach(() => {
  language = 'fa-IR';
  document.body.innerHTML = '';
});

const cell = (title: string) => document.querySelector(`td[title="${title}"]`) as HTMLElement;
const inputs = () => Array.from(document.querySelectorAll('.ant-picker input')) as HTMLInputElement[];

describe('Jalali pickers', () => {
  it('shows a Gregorian value in Jalali and hands back Gregorian', () => {
    const onChange = vi.fn();
    render(<DatePicker open value={dayjs('2026-10-12')} onChange={onChange} />);
    expect(inputs()[0].value).toBe('1405-07-20');
    fireEvent.click(cell('1405-07-21'));
    const [date, dateString] = onChange.mock.calls[0];
    expect(date.isJalali()).toBe(false);
    expect(date.format('YYYY-MM-DD')).toBe('2026-10-13');
    expect(dateString).toBe('2026-10-13');
  });

  it('does the same for ranges', () => {
    const onChange = vi.fn();
    render(<DatePicker.RangePicker onChange={onChange} defaultPickerValue={[dayjs('2026-10-12'), null]} />);
    fireEvent.mouseDown(inputs()[0]);
    fireEvent.click(inputs()[0]);
    fireEvent.click(cell('1405-07-01'));
    fireEvent.click(cell('1405-07-20'));
    const [dates, strings] = onChange.mock.calls[0];
    expect(dates.map((date: Dayjs) => date.isJalali())).toEqual([false, false]);
    expect(strings).toEqual(['2026-09-23', '2026-10-12']);
  });

  it('asks disabledDate about Gregorian dates', () => {
    const disabledDate = vi.fn((date: Dayjs) => date.format('YYYY-MM-DD') === '2026-10-13');
    render(<DatePicker open value={dayjs('2026-10-12')} disabledDate={disabledDate} />);
    expect(disabledDate.mock.calls.every(([date]) => !date.isJalali())).toBe(true);
    expect(cell('1405-07-21').className).toContain('ant-picker-cell-disabled');
  });

  it('leaves English, quarter and week pickers alone', () => {
    language = 'en-US';
    render(<DatePicker value={dayjs('2026-10-12')} />);
    expect(inputs()[0].value).toBe('2026-10-12');
    language = 'fa-IR';
    render(<DatePicker picker="quarter" value={dayjs('2026-10-12')} />);
    expect(inputs()[1].value).toBe('2026-Q4');
  });
});

describe('toJalaliPickerProps', () => {
  it('converts values and presets and keeps the time', () => {
    const props = toJalaliPickerProps({
      value: dayjs('2026-10-12T14:30:00'),
      presets: [{ label: 'x', value: () => dayjs('2026-03-21') }],
      showTime: { defaultValue: dayjs('2026-01-01T09:15:00') },
    });
    expect(props.value.format('YYYY/MM/DD HH:mm')).toBe('1405/07/20 14:30');
    expect(props.presets[0].value().format('YYYY/MM/DD')).toBe('1405/01/01');
    expect(props.showTime.defaultValue.format('HH:mm')).toBe('09:15');
  });

  it('formats date strings like antd', () => {
    const date = dayjs('2026-10-12T14:30:00');
    expect(gregorianDateString(date, {})).toBe('2026-10-12');
    expect(gregorianDateString(date, { showTime: true })).toBe('2026-10-12 14:30:00');
    expect(gregorianDateString(date, { showTime: { format: 'HH:mm' } })).toBe('2026-10-12 14:30');
    expect(gregorianDateString(date, { picker: 'month' })).toBe('2026-10');
    expect(gregorianDateString(date, { format: ['YYYY/MM/DD', 'YYYYMMDD'] })).toBe('2026/10/12');
    expect(gregorianDateString(date, { format: { format: 'DD.MM.YYYY' } })).toBe('12.10.2026');
  });
});
