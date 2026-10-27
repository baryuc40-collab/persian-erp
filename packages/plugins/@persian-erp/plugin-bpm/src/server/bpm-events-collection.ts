import { defineCollection } from '@nocobase/database';

// The connection log of STORY-093: one row for each exchange of NocoBase with the BPMN engine that changes something
// (deploy, start, message, a completed user task, a service task received, completed or failed), and for every
// exchange that failed. The engine's own audit log names only the service user, so the NocoBase user is known only
// here (decision 0008, section 6). Form values, variables and passwords never go in. Read-only through the API; rows
// older than BPM_EVENTS_RETENTION_DAYS are removed every night.
export default defineCollection({
  name: 'bpmEvents',
  createdAt: true,
  updatedAt: false,
  fields: [
    // out: NocoBase asked the engine; in: the engine handed NocoBase work (a service task).
    { type: 'string', name: 'direction' },
    // deploy, start, message, task.complete, serviceTask.received, serviceTask.complete, serviceTask.fail, …
    { type: 'string', name: 'event', index: true },
    // camunda8 or operaton
    { type: 'string', name: 'engine' },
    { type: 'string', name: 'processKey', index: true },
    { type: 'string', name: 'businessKey', index: true },
    { type: 'string', name: 'instanceId', index: true },
    // The user task or service task (job) of the engine.
    { type: 'string', name: 'taskId' },
    // The NocoBase user who caused it; empty for the worker and the system.
    { type: 'bigInt', name: 'userId', index: true },
    // Also sent to the engine as X-Correlation-Id, written in the server log and returned to the page.
    { type: 'string', name: 'correlationId', index: true },
    { type: 'integer', name: 'durationMs' },
    // ok or error
    { type: 'string', name: 'status', index: true },
    { type: 'integer', name: 'httpStatus' },
    { type: 'text', name: 'error' },
    // Names and counts only, such as the fields of a completed form or the processes of a deployment.
    { type: 'json', name: 'detail' },
  ],
  indexes: [{ fields: ['createdAt'] }],
});
