import { defaultFieldNames, Trigger } from '@nocobase/plugin-workflow/client-v2';
import type { UseVariableOptions, VariableOption } from '@nocobase/plugin-workflow/client-v2';
import { Form, Input } from 'antd';
import React from 'react';
import { tExpr, useT } from './locale';

export const SERVICE_TASK_TRIGGER = 'bpm-service-task';

function ServiceTaskFieldset() {
  const t = useT();
  return (
    <Form.Item
      name={['config', 'topic']}
      label={t('Topic')}
      rules={[{ required: true }]}
      extra={t(
        'The service task type in the BPMN model (the type of zeebe:taskDefinition in Camunda 8, operaton:topic in Operaton), such as place-order',
      )}
    >
      <Input dir="ltr" />
    </Form.Item>
  );
}

/** The workflow event «BPMN service task» (STORY-081); the server side is src/server/service-task-trigger.ts. */
export default class ServiceTaskTrigger extends Trigger {
  title = tExpr('BPMN service task');
  description = tExpr(
    'Runs when the BPMN engine reaches a service task of this topic. The task is completed when the workflow succeeds, and retried when it fails.',
  );
  sync = true;
  FieldsetLoader = async () => ({ default: ServiceTaskFieldset });

  useVariables(config: Record<string, unknown>, { fieldNames = defaultFieldNames }: UseVariableOptions = {}) {
    const value = fieldNames.value ?? defaultFieldNames.value;
    const label = fieldNames.label ?? defaultFieldNames.label;
    const option = (key: string, title: unknown): VariableOption =>
      ({ [value]: key, [label]: title } as VariableOption);
    return [
      option('recordId', tExpr('Record ID')),
      option('collection', tExpr('Collection')),
      option('variables', tExpr('Process variables')),
      {
        ...option('task', tExpr('Service task')),
        [fieldNames.children ?? defaultFieldNames.children]: [
          option('id', tExpr('Task ID')),
          option('businessKey', tExpr('Business key')),
          option('processKey', tExpr('Process')),
          option('topic', tExpr('Topic')),
        ],
      } as VariableOption,
    ];
  }
}
