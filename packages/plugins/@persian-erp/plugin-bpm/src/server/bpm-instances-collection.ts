import { defineCollection } from '@nocobase/database';

// The instances of STORY-095: one row for each run of a process of bpmProcesses, of either builder, kept up to date
// from the workflow executions of NocoBase and from the BPMN engine. The engine and the executions stay the source of
// truth; this table is there to list, filter, report and check access without asking the engine. Rows outlive the
// engine's history, so finished instances stay in reports. Read-only through the API.
export default defineCollection({
  name: 'bpmInstances',
  createdAt: true,
  updatedAt: true,
  fields: [
    // nocobase or camunda, as in bpmProcesses.
    { type: 'string', name: 'builder' },
    { type: 'belongsTo', name: 'process', target: 'bpmProcesses', foreignKey: 'processId', onDelete: 'SET NULL' },
    { type: 'string', name: 'processKey', index: true },
    // The version of the BPMN process, or the ID of the workflow version that ran.
    { type: 'integer', name: 'version' },
    // The execution ID of NocoBase or the process instance key of the engine.
    { type: 'string', name: 'instanceId' },
    { type: 'string', name: 'businessKey', index: true },
    // The record of the business key `<collection>:<id>`.
    { type: 'string', name: 'recordCollection' },
    { type: 'string', name: 'recordId' },
    // Who started it; this user sees the row without other permission.
    { type: 'belongsTo', name: 'requester', target: 'users', foreignKey: 'requesterId', onDelete: 'SET NULL' },
    // active, suspended, incident (waits for a person to fix it), failed, rejected, completed or canceled.
    { type: 'string', name: 'status', index: true },
    // Where it waits now, in words and as the IDs of the model; several when it runs in parallel.
    { type: 'string', name: 'currentStep' },
    { type: 'string', name: 'currentStepId' },
    { type: 'belongsTo', name: 'assignee', target: 'users', foreignKey: 'assigneeId', onDelete: 'SET NULL' },
    // Role names that may take the open task.
    { type: 'json', name: 'candidateGroups' },
    { type: 'date', name: 'dueAt' },
    { type: 'date', name: 'startedAt', index: true },
    { type: 'date', name: 'endedAt' },
    // When it was last compared with the engine or the execution.
    { type: 'date', name: 'syncedAt' },
  ],
  indexes: [{ unique: true, fields: ['builder', 'instanceId'] }],
});
