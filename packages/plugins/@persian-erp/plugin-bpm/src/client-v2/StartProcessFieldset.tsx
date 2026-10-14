import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useFlowEngine } from '@nocobase/flow-engine';
import { WorkflowVariableInput } from '@nocobase/plugin-workflow/client-v2';
import { Alert, Button, Form, Input, Select, Space } from 'antd';
import React, { useEffect, useState } from 'react';
import { useT } from './locale';

type Process = { key: string; name: string | null; version: number };

export function StartProcessFieldset() {
  const t = useT();
  const flowEngine = useFlowEngine();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    flowEngine.context.api
      .request({ url: 'bpm:processes' })
      .then(({ data }) => setProcesses(data?.data || []))
      .catch((e) => setError(e?.response?.data?.errors?.[0]?.message || e?.message || String(e)));
  }, [flowEngine]);

  return (
    <>
      {error && <Alert type="warning" showIcon message={error} style={{ marginBlockEnd: 16 }} />}
      <Form.Item name={['config', 'processKey']} label={t('Process')} rules={[{ required: true }]}>
        <Select
          showSearch
          options={processes.map((p) => ({ value: p.key, label: p.name ? `${p.name} (${p.key})` : p.key }))}
          placeholder={t('Choose a deployed process')}
        />
      </Form.Item>
      <Form.Item
        name={['config', 'businessKey']}
        label={t('Business key')}
        rules={[{ required: true }]}
        extra={t('Usually the collection and the record ID, such as purchase_requests:{{id}}', { id: 'ID' })}
      >
        <WorkflowVariableInput />
      </Form.Item>
      <Form.Item
        label={t('Process variables')}
        extra={t('Only IDs and decisions; the record itself stays in NocoBase.')}
      >
        <Form.List name={['config', 'variables']}>
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space key={field.key} align="baseline">
                  <Form.Item name={[field.name, 'name']} rules={[{ required: true }]}>
                    <Input dir="ltr" placeholder={t('Variable name')} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'value']}>
                    <WorkflowVariableInput />
                  </Form.Item>
                  <Button
                    aria-label={t('Delete')}
                    icon={<DeleteOutlined />}
                    size="small"
                    type="text"
                    onClick={() => remove(field.name)}
                  />
                </Space>
              ))}
              <div>
                <Button icon={<PlusOutlined />} size="small" type="dashed" onClick={() => add({})}>
                  {t('Add a variable')}
                </Button>
              </div>
            </>
          )}
        </Form.List>
      </Form.Item>
    </>
  );
}

export default StartProcessFieldset;
