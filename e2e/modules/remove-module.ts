import { Api } from '../helpers';

const query = (filter: object) => `paginate=false&filter=${encodeURIComponent(JSON.stringify(filter))}`;

/**
 * Removes what importing a module file made, so the tests after it (reference screenshots among them) see the
 * install as it was. There is no module removal in the plugin yet, so the parts are removed one by one.
 */
export async function removeImportedModule(api: Api, file: any) {
  const routeUids = (route) => [route.schemaUid, ...(route.children || []).flatMap(routeUids)];
  const routes = await api.call(`desktopRoutes:list?${query({ schemaUid: { $in: routeUids(file.routes) } })}`);
  // Children first, so that no route is left without its parent.
  for (const route of routes.sort((a, b) => (b.parentId ? 1 : 0) - (a.parentId ? 1 : 0))) {
    await api.call(`desktopRoutes:destroy?filterByTk=${route.id}`);
  }
  for (const model of file.flowModels) await api.call(`flowModels:destroy?filterByTk=${model.uid}`);
  for (const schema of file.uiSchemas) await api.call(`uiSchemas:remove/${schema['x-uid']}`);
  for (const template of file.flowModelTemplates) {
    await api.call(`flowModelTemplates:destroy?filterByTk=${template.uid}`);
  }
  for (const role of file.roles) await api.call(`roles:destroy?filterByTk=${role.name}`);
  for (const collection of file.collections) await api.call(`collections:destroy?filterByTk=${collection.name}`);
  await api.call(`erpModules:destroy?filterByTk=${file.module.key}`);
}
