import { defineCollection } from '@nocobase/database';

// One row per module defined on this install: its key and the top-level menu group it is built around.
export default defineCollection({
  name: 'erpModules',
  autoGenId: false,
  filterTargetKey: 'key',
  timestamps: true,
  fields: [
    { type: 'string', name: 'key', primaryKey: true },
    { type: 'string', name: 'title' },
    { type: 'string', name: 'version', defaultValue: '1.0.0' },
    { type: 'text', name: 'description' },
    { type: 'string', name: 'groupSchemaUid' },
  ],
});
