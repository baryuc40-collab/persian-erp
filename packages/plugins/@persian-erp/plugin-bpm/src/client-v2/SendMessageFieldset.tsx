import { WorkflowVariableInput } from '@nocobase/plugin-workflow/client-v2';
import { Form, Input, InputNumber } from 'antd';
import React from 'react';
import { useT } from './locale';
import { ProcessVariablesField } from './StartProcessFieldset';

export function SendMessageFieldset() {
  const t = useT();
  return (
    <>
      <Form.Item
        name={['config', 'messageName']}
        label={t('Message')}
        rules={[{ required: true }]}
        extra={t('The name of the message in the BPMN model')}
      >
        <Input dir="ltr" />
      </Form.Item>
      <Form.Item
        name={['config', 'businessKey']}
        label={t('Business key')}
        rules={[{ required: true }]}
        extra={t('The business key the process was started with, such as purchase_requests:{{id}}', { id: 'ID' })}
      >
        <WorkflowVariableInput />
      </Form.Item>
      <Form.Item
        name={['config', 'ttlMinutes']}
        label={t('Waits for its instance (minutes)')}
        extra={t('How long the message may wait for an instance that waits for it; after that the node fails.')}
      >
        <InputNumber min={1} />
      </Form.Item>
      <ProcessVariablesField />
    </>
  );
}

export default SendMessageFieldset;
