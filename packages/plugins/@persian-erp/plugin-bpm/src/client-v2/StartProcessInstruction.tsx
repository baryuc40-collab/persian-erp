import { ApartmentOutlined } from '@ant-design/icons';
import { defaultFieldNames, Instruction } from '@nocobase/plugin-workflow/client-v2';
import type { UseVariableOptions } from '@nocobase/plugin-workflow/client-v2';
import React from 'react';
import { tExpr } from './locale';

export const START_INSTRUCTION = 'bpm-start';

/** The workflow node «Start a BPMN process» (STORY-080); the server side is src/server/start-instruction.ts. */
export default class StartProcessInstruction extends Instruction {
  title = tExpr('Start a BPMN process');
  type = START_INSTRUCTION;
  group = 'extended';
  description = tExpr(
    'Starts a process of the BPMN engine for a business key, or finds the one already running for it.',
  );
  icon = (<ApartmentOutlined />);
  FieldsetLoader = () => import('./StartProcessFieldset').then((module) => ({ default: module.StartProcessFieldset }));

  createDefaultConfig() {
    return { processKey: '', businessKey: '', variables: [] };
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
        { [value]: 'instanceId', [label]: tExpr('Process instance ID') },
        { [value]: 'businessKey', [label]: tExpr('Business key') },
        { [value]: 'created', [label]: tExpr('Started now') },
      ],
    };
  }
}
