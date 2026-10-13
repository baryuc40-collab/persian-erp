import { createMockServer, MockServer } from '@nocobase/test';
import { toLatinDigits, toLatinNumber } from '../../shared/latin-digits';
import { toPersianLetters } from '../../shared/persian-letters';
import { normalizeFilter } from '../persian-text';
import PluginFaServer from '../plugin';

describe('Latin digits', () => {
  it('converts Persian and Arabic-Indic digits', () => {
    expect(toLatinDigits('۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩')).toBe('0123456789 0123456789');
    expect(toLatinDigits('کد ۴۵')).toBe('کد 45');
    expect(toLatinDigits('abc 12')).toBe('abc 12');
  });

  it('converts the Arabic separators in numbers', () => {
    expect(toLatinNumber('۱٬۲۳۴٫۵')).toBe('1,234.5');
  });
});

describe('Persian letters', () => {
  it('replaces Arabic Yeh, Alef Maksura and Kaf', () => {
    expect(toPersianLetters('علي كريمى')).toBe('علی کریمی');
    expect(toPersianLetters('علی کریمی')).toBe('علی کریمی');
  });

  it('normalizes filter values but not operators or field names', () => {
    expect(
      normalizeFilter({ $and: [{ name: { $includes: 'علي' } }, { 'tags.title': { $in: ['كد ۴۵', 3] } }] }),
    ).toEqual({ $and: [{ name: { $includes: 'علی' } }, { 'tags.title': { $in: ['کد 45', 3] } }] });
  });
});

describe('Latin digits and Persian letters on save', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({ plugins: ['error-handler', PluginFaServer], acl: false });
    app.db.collection({
      name: 'digit_samples',
      fields: [
        { type: 'string', name: 'code', interface: 'input' },
        { type: 'text', name: 'note', interface: 'textarea' },
        { type: 'double', name: 'amount', interface: 'number' },
        { type: 'bigInt', name: 'count', interface: 'integer' },
        { type: 'password', name: 'secret', interface: 'password' },
        { type: 'json', name: 'extra', interface: 'json' },
      ],
    });
    await app.db.sync();
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('stores Latin digits for text and numbers sent through the API', async () => {
    const res = await app
      .agent()
      .resource('digit_samples')
      .create({ values: { code: 'کد ۴۵', note: 'سفارش ٣ عدد', amount: '۱۲٫۵', count: '۱٬۲۰۰' } });
    expect(res.status).toBe(200);
    const record = await app.db.getRepository('digit_samples').findOne();
    expect(record.get('code')).toBe('کد 45');
    expect(record.get('note')).toBe('سفارش 3 عدد');
    expect(record.get('amount')).toBe(12.5);
    expect(Number(record.get('count'))).toBe(1200);
  });

  it('stores Persian Yeh and Kaf, and finds them by an Arabic spelling', async () => {
    await app
      .agent()
      .resource('digit_samples')
      .create({ values: { code: 'علي', note: 'كتاب' } });
    const record = await app.db.getRepository('digit_samples').findOne();
    expect(record.get('code')).toBe('علی');
    expect(record.get('note')).toBe('کتاب');
    const res = await app
      .agent()
      .resource('digit_samples')
      .list({ filter: { code: { $includes: 'علي' } } });
    expect(res.body.data.map((r) => r.code)).toEqual(['علی']);
  });

  it('converts on update too, and leaves passwords alone', async () => {
    const repo = app.db.getRepository('digit_samples');
    const record = await repo.create({ values: { code: 'a', secret: '۱۲۳ي' } });
    await repo.update({ filterByTk: record.get('id') as number, values: { code: 'ب ۷' } });
    const updated = await repo.findOne({ filterByTk: record.get('id') as number });
    expect(updated.get('code')).toBe('ب 7');
    await repo.update({ filterByTk: record.get('id') as number, values: { extra: { name: 'علي' } } });
    expect((await repo.findOne({ filterByTk: record.get('id') as number })).get('extra')).toEqual({ name: 'علي' });
    // The stored password is a hash of the digits as typed.
    expect(await app.db.getCollection('digit_samples').getField('secret').verify('۱۲۳ي', updated.get('secret'))).toBe(
      true,
    );
  });

  it('parses Persian digits in imported number cells', async () => {
    const Interface = app.db.interfaceManager.getInterfaceType('number');
    expect(await new Interface({}).toValue('۱۲٫۵')).toBe('12.5');
  });
});
