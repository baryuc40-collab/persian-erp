import { defineCollection } from '@nocobase/database';

// The alert rules of STORY-099: one row for each kind of alert, made on first start with the defaults of monitor.ts.
// An administrator turns a rule off, changes its limits, the roles that get it and the notification channels it goes
// through (the in-app channel bpm-alerts by default; an email channel by its name). Rows are neither added nor removed
// through the API.
export default defineCollection({
  name: 'bpmAlertRules',
  createdAt: true,
  updatedAt: true,
  fields: [
    // engineDown, worker, outbox, incident or overdue
    { type: 'string', name: 'kind', unique: true },
    { type: 'boolean', name: 'enabled', defaultValue: true },
    // How long a state lasts before it is an alert: the engine not answering, the worker not fetching, the oldest
    // item of the outbox.
    { type: 'integer', name: 'minutes' },
    // How many items of the outbox are too many.
    { type: 'integer', name: 'count' },
    // The names of the roles whose users get the alert.
    { type: 'json', name: 'roleNames', defaultValue: [] },
    // The names of the notification channels it goes through.
    { type: 'json', name: 'channels', defaultValue: [] },
  ],
});
