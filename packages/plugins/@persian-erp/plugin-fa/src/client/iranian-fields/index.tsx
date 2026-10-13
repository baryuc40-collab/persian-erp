// Client side of the Iranian field types (EPIC-013): a field interface per kind in an "Iranian" group, the formily
// rule that checks the value before a classic (v1) form is sent, and the modern (v2) model bindings. The server
// checks the same rule on every save (server/iranian-fields.ts), so the modern pages, which have no rule here yet,
// show the server's message.

import { registerValidateRules } from '@formily/core';
import { CollectionFieldInterface, defaultProps, operators, unique } from '@nocobase/client';
import type { Application } from '@nocobase/client';
import { DisplayItemModel, EditableItemModel, FilterableItemModel } from '@nocobase/flow-engine';
// @ts-ignore
import pkg from '../../../package.json';
import { IRANIAN_FIELD_KINDS, IranianFieldKind } from '../../shared/iranian-fields';

const t = (key: string) => `{{t(${JSON.stringify(key)}, { ns: ${JSON.stringify(pkg.name)} })}}`;

export const IRANIAN_GROUP = 'iranian';

export function interfaceFor(kind: IranianFieldKind) {
  return class extends CollectionFieldInterface {
    name = kind.name;
    type = 'object';
    group = IRANIAN_GROUP;
    order = IRANIAN_FIELD_KINDS.indexOf(kind) + 1;
    title = t(kind.title);
    sortable = true;
    default = {
      type: 'string',
      uiSchema: {
        type: 'string',
        'x-component': 'Input',
        'x-component-props': { maxLength: kind.maxLength },
        'x-validator': { [kind.name]: true },
      },
    };
    availableTypes = ['string'];
    hasDefaultValue = true;
    properties = { ...defaultProps, unique };
    filterable = { operators: operators.string };
    titleUsable = true;
  };
}

export function registerIranianFields(app: Application) {
  app.addFieldInterfaceGroups({ [IRANIAN_GROUP]: { label: t('Iranian'), order: 2.5 } });
  app.dataSourceManager.addFieldInterfaces(IRANIAN_FIELD_KINDS.map(interfaceFor));
  registerValidateRules(
    Object.fromEntries(
      IRANIAN_FIELD_KINDS.map((kind) => [
        kind.name,
        (value: unknown, _rule: unknown, ctx: { field?: { title?: string } }) => {
          if (typeof value !== 'string' || value === '' || kind.validate(kind.normalize(value))) return '';
          return app.i18n.t(kind.error, { ns: [pkg.name, 'client'], field: ctx?.field?.title || '' });
        },
      ]),
    ),
  );
  const names = IRANIAN_FIELD_KINDS.map((kind) => kind.name);
  EditableItemModel.bindModelToInterface('InputFieldModel', names, { isDefault: true });
  FilterableItemModel.bindModelToInterface('InputFieldModel', names, { isDefault: true });
  DisplayItemModel.bindModelToInterface('DisplayTextFieldModel', names, { isDefault: true });
}
