import { defineCollection } from '@nocobase/database';

// The outbox of STORY-094: a start or message the engine could not take when it was sent, kept until it is sent. A
// row is written in the transaction of the workflow node, so the record and its start are saved together; the outbox
// worker sends it with retries that wait longer each time. Read-only through the API apart from «send again» and
// «put aside»; sent and put-aside rows older than BPM_EVENTS_RETENTION_DAYS are removed every night.
export default defineCollection({
  name: 'bpmOutbox',
  createdAt: true,
  updatedAt: true,
  fields: [
    // start or message
    { type: 'string', name: 'kind' },
    // pending, sent, failed (needs a person) or discarded (put aside by a person)
    { type: 'string', name: 'status', index: true },
    { type: 'string', name: 'processKey', index: true },
    { type: 'string', name: 'businessKey', index: true },
    { type: 'string', name: 'messageName' },
    // What is sent: the variables, and for a message its time to live and ID.
    { type: 'json', name: 'payload' },
    { type: 'integer', name: 'attempts', defaultValue: 0 },
    // When the worker sends it next; also moved ahead while one worker sends it, so another one leaves it alone.
    { type: 'date', name: 'nextAttemptAt', index: true },
    { type: 'text', name: 'lastError' },
    { type: 'date', name: 'sentAt' },
    // The engine's answer: the instance of a start, whether a message was delivered.
    { type: 'json', name: 'result' },
    // The workflow job waiting for this row; it goes on when the row is sent and fails when the row fails.
    { type: 'bigInt', name: 'jobId' },
    { type: 'bigInt', name: 'userId' },
    // The correlation ID of the node that wrote it; every attempt is logged in bpmEvents under it.
    { type: 'string', name: 'correlationId', index: true },
  ],
});
