import { SendOutlined } from '@ant-design/icons';
import { defaultFieldNames, Instruction } from '@nocobase/plugin-workflow/client-v2';
import type { UseVariableOptions } from '@nocobase/plugin-workflow/client-v2';
import React from 'react';
import { tExpr } from './locale';

export const MESSAGE_INSTRUCTION = 'bpm-message';

/** The workflow node «Send a BPMN message» (STORY-094); the server side is src/server/message-instruction.ts. */
export default class SendMessageInstruction extends Instruction {
  title = tExpr('Send a BPMN message');
  type = MESSAGE_INSTRUCTION;
  group = 'extended';
  description = tExpr(
    'Sends a message to the process instance of a business key, such as «payment received». It may come before the instance waits for it; when the engine is away it waits in the outbox.',
  );
  icon = (<SendOutlined />);
  FieldsetLoader = () => import('./SendMessageFieldset').then((module) => ({ default: module.SendMessageFieldset }));

  createDefaultConfig() {
    return { messageName: '', businessKey: '', variables: [], ttlMinutes: 60 };
  }

  // The result of the node, for the nodes after it.
  useVariables(
    { key, title }: { key: string; title: string },
    { fieldNames = defaultFieldNames }: UseVariableOptions = {},
  ) {
    const value = fieldNames.value ?? defaultFieldNames.value;
    const label = fieldNames.label ?? defaultFieldNames.label;
    return {
      [value]: key,
      [label]: title,
      [fieldNames.children ?? defaultFieldNames.children]: [
        { [value]: 'delivered', [label]: tExpr('Delivered') },
        { [value]: 'businessKey', [label]: tExpr('Business key') },
        { [value]: 'queued', [label]: tExpr('Waiting in the outbox') },
        { [value]: 'correlationId', [label]: tExpr('Correlation ID') },
      ],
    };
  }
}
