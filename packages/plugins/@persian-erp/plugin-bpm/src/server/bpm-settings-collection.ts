import { defineCollection } from '@nocobase/database';

// The connection to the BPMN engine, one row (id 1). The password is never sent to the client. It is kept as text:
// a password field would hash it, and the plugin has to send it to the engine. BPM_ENGINE_PASSWORD keeps it out of
// the database.
export default defineCollection({
  name: 'bpmSettings',
  fields: [
    // camunda8 or operaton; empty in a row saved before the choice existed, which means operaton.
    { type: 'string', name: 'engine' },
    { type: 'string', name: 'url' },
    { type: 'string', name: 'username' },
    { type: 'string', name: 'password', hidden: true },
  ],
});
