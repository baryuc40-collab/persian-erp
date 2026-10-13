-- Extract the records of one ERP module from a NocoBase 2.2.x PostgreSQL database.
-- Usage: psql -v group_id=<top-level group route id> -v prefix=<module prefix, e.g. lab_> -f erp-module-queries.sql
-- Each query creates a temp table so later queries (and the reference check at the end) can use it.

-- 1. Menu routes: the group and its whole subtree.
create temp table m_routes as
with recursive t as (
  select * from "desktopRoutes" where id = :group_id
  union all
  select r.* from "desktopRoutes" r join t on r."parentId" = t.id
)
select id, "parentId", type, title, "schemaUid", "menuSchemaUid", "tabSchemaName", sort, options from t;

-- 2. Collections and fields: names starting with the module prefix.
create temp table m_collections as
select key, name, title, options from collections where name like :'prefix' || '%';
create temp table m_fields as
select key, "collectionName", name, type, interface, "reverseKey", options from fields
where "collectionName" in (select name from m_collections);

-- 3. Classic pages: uiSchemas subtrees of page routes and tab grids (and the FlowRoute shell of v2 pages).
create temp table m_ui as
select s."x-uid", s.name, s.schema::jsonb as schema from "uiSchemas" s
where s."x-uid" in (
  select p.descendant from "uiSchemaTreePath" p
  where p.ancestor in (select "schemaUid" from m_routes where "schemaUid" is not null)
);

-- 4. Modern pages: flowModels reachable from the routes, through openView.uid popup hosts and popup/block templates.
create temp table m_models (uid varchar primary key);
insert into m_models
select distinct p.descendant from "flowModelTreePath" p
where p.ancestor in (select "schemaUid" from m_routes where "schemaUid" is not null)
  and p.descendant not in (select "schemaUid" from m_routes where "schemaUid" is not null);  -- RouteModel rows come from the route hook
do $$
declare added int;
begin
  loop
    with refs as (
      select (f.options::jsonb)#>>'{stepParams,popupSettings,openView,uid}' as uid from "flowModels" f join m_models m using (uid)
      union
      select t."targetUid" from "flowModelTemplates" t
      where t.uid in (
        select (f.options::jsonb)#>>'{stepParams,popupSettings,openView,popupTemplateUid}' from "flowModels" f join m_models m using (uid)
        union
        select (f.options::jsonb)#>>'{stepParams,referenceSettings,useTemplate,templateUid}' from "flowModels" f join m_models m using (uid)
      )
    ), roots as (select uid from refs where uid is not null and uid not in (select uid from m_models))
    insert into m_models
    select distinct p.descendant from "flowModelTreePath" p join roots r on p.ancestor = r.uid
    on conflict do nothing;
    get diagnostics added = row_count;
    exit when added = 0;
  end loop;
end $$;
create temp table m_templates as
select * from "flowModelTemplates" where "targetUid" in (select uid from m_models)
   or "collectionName" in (select name from m_collections);
create temp table m_template_usages as
select * from "flowModelTemplateUsages" where "modelUid" in (select uid from m_models);

-- 5. Workflows: the current version of every workflow whose trigger targets a module collection or whose key a module page uses.
create temp table m_workflows as
select id, key, title, type, enabled, sync, config, options from workflows w
where w.current
  and (
    regexp_replace(w.config->>'collection', '^main:', '') in (select name from m_collections)
    or exists (select 1 from m_ui where schema::text like '%"workflowKey": "' || w.key || '"%' or schema::text like '%"workflowKey":"' || w.key || '"%')
    or exists (select 1 from "flowModels" f join m_models m using (uid) where f.options::text like '%"workflowKey":"' || w.key || '"%')
  );
create temp table m_nodes as
select id, key, "workflowId", type, title, "upstreamId", "downstreamId", "branchIndex", config from flow_nodes
where "workflowId" in (select id from m_workflows);

-- 6. Roles and ACL: roles named with the module prefix.
create temp table m_roles as
select name, title, description, strategy, "allowConfigure", "allowNewMenu", snippets from roles where name like :'prefix' || '%';
create temp table m_ds_roles as
select * from "dataSourcesRoles" where "roleName" in (select name from m_roles);
create temp table m_resources as
select * from "dataSourcesRolesResources" where "roleName" in (select name from m_roles);
create temp table m_actions as
select * from "dataSourcesRolesResourcesActions" where "rolesResourceId" in (select id from m_resources);
create temp table m_scopes as
select * from "dataSourcesRolesResourcesScopes"
where id in (select "scopeId" from m_actions) or "resourceName" in (select name from m_collections);
create temp table m_role_routes as
select * from "rolesDesktopRoutes" where "desktopRouteId" in (select id from m_routes);

-- Summary
select 'routes' as kind, count(*) from m_routes union all
select 'collections', count(*) from m_collections union all
select 'fields', count(*) from m_fields union all
select 'uiSchemas', count(*) from m_ui union all
select 'flowModels', count(*) from m_models union all
select 'flowModelTemplates', count(*) from m_templates union all
select 'flowModelTemplateUsages', count(*) from m_template_usages union all
select 'workflows', count(*) from m_workflows union all
select 'flow_nodes', count(*) from m_nodes union all
select 'roles', count(*) from m_roles union all
select 'dataSourcesRolesResources', count(*) from m_resources union all
select 'dataSourcesRolesResourcesActions', count(*) from m_actions union all
select 'dataSourcesRolesResourcesScopes', count(*) from m_scopes union all
select 'rolesDesktopRoutes', count(*) from m_role_routes;

-- Reference check: every reference found inside module records, and whether its target is inside the module.
create temp table m_refs (source text, ref_kind text, target text);
-- collection names in classic schemas
insert into m_refs
select 'uiSchemas', 'collection', v from m_ui, jsonb_path_query(schema::jsonb, 'strict $.**."x-decorator-props".collection') j(x), lateral (select x #>> '{}' v) q
union all select 'uiSchemas', 'collection', split_part(v, '.', 1) from m_ui, jsonb_path_query(schema::jsonb, 'strict $.**."x-collection-field"') j(x), lateral (select x #>> '{}' v) q
union all select 'uiSchemas', 'collection', split_part(v, ':', 1) from m_ui, jsonb_path_query(schema::jsonb, 'strict $.**."x-acl-action"') j(x), lateral (select x #>> '{}' v) q where v like '%:%'
union all select 'uiSchemas', 'workflowKey', x #>> '{}' from m_ui, jsonb_path_query(schema::jsonb, 'strict $.**.workflowKey') j(x);
-- collection names, popup uids, templates and workflow keys in flowModels
insert into m_refs
select 'flowModels', 'collection', x #>> '{}' from "flowModels" f join m_models using (uid), jsonb_path_query(f.options::jsonb, 'strict $.**.collectionName') j(x)
union all select 'flowModels', 'association', split_part(x #>> '{}', '.', 1) from "flowModels" f join m_models using (uid), jsonb_path_query(f.options::jsonb, 'strict $.**.associationName') j(x)
union all select 'flowModels', 'modelUid', x #>> '{}' from "flowModels" f join m_models using (uid), jsonb_path_query(f.options::jsonb, 'lax $.stepParams.popupSettings.openView.uid') j(x)
union all select 'flowModels', 'templateUid', x #>> '{}' from "flowModels" f join m_models using (uid), jsonb_path_query(f.options::jsonb, 'strict $.**.popupTemplateUid') j(x)
union all select 'flowModels', 'workflowKey', x #>> '{}' from "flowModels" f join m_models using (uid), jsonb_path_query(f.options::jsonb, 'strict $.**.workflowKey') j(x)
union all select 'flowModels', 'routeId', x #>> '{}' from "flowModels" f join m_models using (uid), jsonb_path_query(f.options::jsonb, 'lax $.props.routeId') j(x)
union all select 'flowModels', 'parentUid', (f.options::jsonb)->>'parentId' from "flowModels" f join m_models using (uid) where (f.options::jsonb)->>'parentId' is not null;
-- fields, workflows, nodes, ACL
insert into m_refs
select 'fields', 'collection', options::jsonb->>'target' from m_fields where options::jsonb ? 'target'
union all select 'fields', 'collection', options::jsonb->>'through' from m_fields where options::jsonb ? 'through'
union all select 'workflows', 'collection', regexp_replace(config->>'collection', '^main:', '') from m_workflows where config->>'collection' is not null
union all select 'flow_nodes', 'collection', regexp_replace(config->>'collection', '^main:', '') from m_nodes where config->>'collection' is not null
union all select 'flow_nodes', 'nodeKey', m[1] from m_nodes, regexp_matches(config::text, '\$jobsMapByNodeKey\.([A-Za-z0-9_]+)', 'g') m
union all select 'dataSourcesRolesResources', 'collection', name from m_resources
union all select 'dataSourcesRolesResourcesScopes', 'collection', "resourceName" from m_scopes where "resourceName" is not null;

select source, ref_kind, target,
  case ref_kind
    when 'collection' then target in (select name from m_collections)
    when 'association' then target in (select name from m_collections)
    when 'workflowKey' then target in (select key from m_workflows)
    when 'nodeKey' then target in (select key from m_nodes)
    when 'modelUid' then target in (select uid from m_models)
    when 'parentUid' then target in (select uid from m_models) or target in (select "schemaUid" from m_routes)
    when 'templateUid' then target in (select uid from m_templates)
    when 'routeId' then target::bigint in (select id from m_routes)
  end as inside_module,
  count(*) as uses
from m_refs group by 1, 2, 3 order by 4, 1, 2, 3;
