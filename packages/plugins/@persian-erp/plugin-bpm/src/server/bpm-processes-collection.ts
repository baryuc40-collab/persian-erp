import { defineCollection } from '@nocobase/database';

// The processes of STORY-095: a NocoBase workflow or a BPMN process a designer marked as a process of the organisation,
// with what the process list and reports need. Unmarked workflows stay out of the list and out of bpmInstances.
export default defineCollection({
  name: 'bpmProcesses',
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
  fields: [
    // nocobase: a workflow of NocoBase; camunda: a process of the BPMN engine (Camunda 8 or Operaton).
    { type: 'string', name: 'builder' },
    // The workflow key, the same for all its versions, or the process ID in the BPMN model.
    { type: 'string', name: 'key' },
    { type: 'string', name: 'title' },
    { type: 'string', name: 'category' },
    // The key of the module the process belongs to (plugin-modules).
    { type: 'string', name: 'module' },
    { type: 'text', name: 'description' },
    { type: 'belongsTo', name: 'owner', target: 'users', foreignKey: 'ownerId' },
    // The roles that may start it.
    {
      type: 'belongsToMany',
      name: 'startRoles',
      target: 'roles',
      through: 'bpmProcessesStartRoles',
      foreignKey: 'processId',
      otherKey: 'roleName',
      sourceKey: 'id',
      targetKey: 'name',
    },
    { type: 'boolean', name: 'enabled', defaultValue: true },
    { type: 'hasMany', name: 'instances', target: 'bpmInstances', foreignKey: 'processId' },
  ],
  indexes: [{ unique: true, fields: ['builder', 'key'] }],
});
