import { defineCollection } from '@nocobase/database';

// The alerts of STORY-099: one row for each problem the monitor found, from when it was found until it was gone. A key
// names the problem (engineDown, outbox, worker:<worker>, incident:<builder>:<id>, overdue:<builder>:<instance>), and
// openKey holds it while the alert is open, so each app instance of a cluster finds the same row and one notification
// goes out. Read-only through the API.
export default defineCollection({
  name: 'bpmAlerts',
  createdAt: true,
  updatedAt: true,
  fields: [
    { type: 'string', name: 'kind', index: true },
    { type: 'string', name: 'key', index: true },
    { type: 'string', name: 'openKey', unique: true },
    // open or resolved
    { type: 'string', name: 'status', index: true },
    // In the language of the install, as the notification said it.
    { type: 'text', name: 'title' },
    // Names, counts and IDs only, such as the process, the instance and the step of an incident.
    { type: 'json', name: 'detail' },
    { type: 'date', name: 'openedAt', index: true },
    { type: 'date', name: 'resolvedAt' },
    { type: 'date', name: 'notifiedAt' },
  ],
});
