import { createMockServer, MockServer } from '@nocobase/test';
import { MODULES_NOTIFICATION_CHANNEL, PluginModulesServer } from '../plugin';
import { MODULE_PLUGINS } from './lab-module';

// The in-app channel the notification nodes of ERP modules send through (STORY-086).
describe('the modules notification channel', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: [...MODULE_PLUGINS, 'notification-manager', 'notification-in-app-message'],
      acl: true,
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('is there after the start', async () => {
    const channel = await app.db
      .getRepository('notificationChannels')
      .findOne({ filterByTk: MODULES_NOTIFICATION_CHANNEL });
    expect(channel?.toJSON()).toMatchObject({ notificationType: 'in-app-message', title: 'اعلان‌های ماژول‌ها' });
  });

  it('is left as it is when an administrator changed it', async () => {
    await app.db
      .getRepository('notificationChannels')
      .update({ filterByTk: MODULES_NOTIFICATION_CHANNEL, values: { title: 'پیام‌ها' } });
    await (app.pm.get(PluginModulesServer) as PluginModulesServer).ensureNotificationChannel();
    const channels = await app.db.getRepository('notificationChannels').find();
    expect(channels.map((c) => c.get('title'))).toEqual(['پیام‌ها']);
  });
});
