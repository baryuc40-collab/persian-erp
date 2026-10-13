// Settings > Persian: the system's default calendar (STORY-048). Stored on the server, see server/settings.ts.

import { useAPIClient } from '@nocobase/client';
import { App, Button, Card, Form, Radio } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../package.json';

type Calendar = 'jalali' | 'gregory' | 'auto';

export const PersianSettings = () => {
  const { t } = useTranslation([pkg.name, 'client']);
  const api = useAPIClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ calendar: Calendar }>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .request({ url: 'persianErp:getSettings' })
      .then(({ data }) => form.setFieldsValue({ calendar: data?.data?.calendar || 'auto' }))
      .catch(() => form.setFieldsValue({ calendar: 'auto' }));
  }, [api, form]);

  const save = async ({ calendar }: { calendar: Calendar }) => {
    setSaving(true);
    try {
      await api.request({
        url: 'persianErp:setSettings',
        method: 'post',
        data: { calendar: calendar === 'auto' ? null : calendar },
      });
      message.success(t('Saved successfully'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card bordered={false}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          name="calendar"
          label={t('Default calendar')}
          extra={t('Used for users who have not chosen a calendar, and for workflows.')}
        >
          <Radio.Group>
            <Radio value="auto">{t('By language (Jalali in Persian)')}</Radio>
            <Radio value="jalali">{t('Jalali')}</Radio>
            <Radio value="gregory">{t('Gregorian')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('Save')}
        </Button>
      </Form>
    </Card>
  );
};
