import { createMockServer, MockServer } from '@nocobase/test';
import PluginFaServer from '../plugin';

describe('Iranian currency fields on the server', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({ plugins: ['error-handler', PluginFaServer], acl: false });
    app.db.collection({
      name: 'currency_samples',
      fields: [{ type: 'bigInt', name: 'amount', interface: 'currencyIRR' }],
    });
    await app.db.sync();
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('reads imported amounts, also with Persian digits and separators', async () => {
    const Interface = app.db.interfaceManager.getInterfaceType('currencyIRR');
    expect(Interface).toBeTruthy();
    const iface = new Interface({});
    expect(await iface.toValue('۱۲۵٬۰۰۰')).toBe('125000');
    expect(await iface.toValue('125,000')).toBe('125000');
  });

  it('stores whole rials sent with Persian digits', async () => {
    await app
      .agent()
      .resource('currency_samples')
      .create({ values: { amount: '۱۲۵۰۰۰' } });
    const record = await app.db.getRepository('currency_samples').findOne();
    expect(Number(record.get('amount'))).toBe(125000);
  });
});
