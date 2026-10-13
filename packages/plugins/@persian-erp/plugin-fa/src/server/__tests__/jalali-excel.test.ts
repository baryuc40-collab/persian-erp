import { createMockServer, MockServer } from '@nocobase/test';
import { Workbook } from 'exceljs';
import { jalaliFormat, jalaliTextToGregorian } from '../../shared/jalali-format';
import PluginFaServer from '../plugin';

describe('Jalali date text', () => {
  it('swaps only the date tokens of a format', () => {
    expect(jalaliFormat('YYYY-MM-DD HH:mm:ss', 2026, 10, 12)).toBe('[1405]-[07]-[20] HH:mm:ss');
    expect(jalaliFormat('DD/MM/YYYY', 2026, 10, 12)).toBe('[20]/[07]/[1405]');
    expect(jalaliFormat('D MMMM YYYY [at] hh:mm a', 2026, 10, 12)).toBe('[20] [مهر] [1405] [at] hh:mm a');
  });

  it('reads Jalali dates as Gregorian text', () => {
    expect(jalaliTextToGregorian('1405/07/20')).toBe('2026-10-12');
    expect(jalaliTextToGregorian('1405-7-20 14:30:00')).toBe('2026-10-12 14:30:00');
    expect(jalaliTextToGregorian('2026-10-12')).toBe('2026-10-12');
    // 30 Esfand exists only in leap years: 1403 is one, 1404 is not.
    expect(jalaliTextToGregorian('1403/12/30')).toBe('2025-03-20');
    expect(jalaliTextToGregorian('1404/12/30')).toBe('1404/12/30');
    expect(jalaliTextToGregorian('1405/13/01')).toBe('1405/13/01');
  });
});

describe('Jalali dates in Excel export and import', () => {
  let app: MockServer;

  beforeEach(async () => {
    // The class itself, so the test runs this source rather than the built package.
    app = await createMockServer({
      plugins: ['error-handler', 'action-export', 'action-import', PluginFaServer],
      acl: false,
    });
    app.db.collection({
      name: 'jalali_excel_samples',
      fields: [
        { type: 'string', name: 'title', interface: 'input' },
        { type: 'date', name: 'moment', interface: 'datetime', uiSchema: { 'x-component-props': { showTime: true } } },
        { type: 'dateOnly', name: 'day', interface: 'date' },
      ],
    });
    await app.db.sync();
    await app.db.getRepository('jalali_excel_samples').create({
      values: { title: 'sample', moment: '2026-10-12T22:00:00.000Z', day: '2026-10-12' },
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  const exportRow = async (headers: Record<string, string>) => {
    const res = await app
      .agent()
      .resource('jalali_excel_samples')
      .export({
        values: {
          columns: [
            { dataIndex: ['moment'], defaultTitle: 'moment' },
            { dataIndex: ['day'], defaultTitle: 'day' },
          ],
        },
      })
      .set(headers)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const workbook = new Workbook();
    await workbook.xlsx.load(res.body);
    return (workbook.getWorksheet(1).getRow(2).values as any[]).slice(1);
  };

  it('writes Jalali dates for Jalali requests', async () => {
    expect(await exportRow({ 'X-Timezone': '+03:30', 'X-Calendar': 'jalali' })).toEqual([
      '1405-07-21 01:30:00',
      '1405-07-20',
    ]);
  });

  it('keeps Gregorian dates otherwise', async () => {
    expect(await exportRow({ 'X-Timezone': '+03:30' })).toEqual(['2026-10-13 01:30:00', '2026-10-12']);
  });

  it('reads Jalali text back as Gregorian dates for Jalali requests', async () => {
    const collection = app.db.getCollection('jalali_excel_samples');
    const ctx = (headers: Record<string, string>) => ({
      get: (name: string) => headers[Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())],
    });
    const iface = (name: string) => {
      const field = collection.getField(name);
      const Interface = app.db.interfaceManager.getInterfaceType(field.options.interface);
      return new Interface(field.options);
    };
    const jalali = ctx({ 'X-Timezone': '+03:30', 'X-Calendar': 'jalali' });
    expect(await iface('day').toValue('1405/07/20', jalali)).toBe('2026-10-12');
    expect(await iface('moment').toValue('1405/07/20', jalali)).toBe('2026-10-11T20:30:00.000Z');
    // Without the header a Jalali year is not converted.
    expect(await iface('day').toValue('2026/10/12', ctx({ 'X-Timezone': '+03:30' }))).toBe('2026-10-12');
  });
});
