import { Handlebars } from '@nocobase/utils';
import { formatJalaliDate, registerJalaliHelper } from '../jalali-handlebars';

describe('{{jalali}} in message templates', () => {
  beforeAll(() => {
    registerJalaliHelper();
  });

  const render = (template: string, data: any) => Handlebars.compile(template)(data);
  // 12 October 2026, 22:00 UTC: 21 Mehr 1405, 01:30 in Tehran, a Tuesday there.
  const data = { $context: { data: { createdAt: '2026-10-12T22:00:00.000Z' } } };

  it('formats in Tehran time by default', () => {
    expect(render('{{jalali $context.data.createdAt}}', data)).toBe('1405/07/21');
    expect(render('{{jalali $context.data.createdAt "dddd D MMMM YYYY، HH:mm"}}', data)).toBe(
      'سه‌شنبه 21 مهر 1405، 01:30',
    );
  });

  it('takes a timezone', () => {
    expect(render('{{jalali $context.data.createdAt "YYYY/MM/DD HH:mm" tz="+00:00"}}', data)).toBe('1405/07/20 22:00');
    expect(render('{{jalali $context.data.createdAt "YYYY/MM/DD HH:mm" tz="UTC"}}', data)).toBe('1405/07/20 22:00');
  });

  it('leaves empty and invalid values readable', () => {
    expect(render('[{{jalali $context.data.missing}}]', data)).toBe('[]');
    expect(formatJalaliDate('not a date')).toBe('not a date');
  });
});
