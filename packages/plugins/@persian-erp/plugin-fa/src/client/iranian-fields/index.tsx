// Client side of the Iranian field types (EPIC-013): a field interface per kind in an "Iranian" group, the formily
// rule that checks the value before a classic (v1) form is sent, and the modern (v2) model bindings. The server
// checks the same rule on every save (server/iranian-fields.ts), so the modern pages, which have no rule here yet,
// show the server's message.

import { registerValidateRules } from '@formily/core';
import { CollectionFieldInterface, defaultProps, operators, unique } from '@nocobase/client';
import type { Application } from '@nocobase/client';
import { DisplayItemModel, EditableItemModel, FilterableItemModel } from '@nocobase/flow-engine';
import type { FlowEngine } from '@nocobase/flow-engine';
import React from 'react';
// @ts-ignore
import pkg from '../../../package.json';
import { IRAN_REGION_KIND, IRAN_REGION_OPERATOR } from '../../shared/iran-regions';
import { IRANIAN_FIELD_KINDS, IranianFieldKind } from '../../shared/iranian-fields';
import { IranianFieldInput, IranianFieldText } from './IranianFieldText';
import { IranRegionCascader, IranRegionSelect, IranRegionText } from './IranRegion';

export { IranianFieldInput, IranianFieldText, IranRegionCascader, IranRegionSelect, IranRegionText };

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
        // Kinds with their own display (Sheba in groups of four with the bank) use IranianFieldInput.
        'x-component': kind.format || kind.describe ? 'IranianFieldInput' : 'Input',
        'x-component-props': { maxLength: kind.maxLength, kind: kind.name },
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

// Province and city (STORY-058): picked from a list, and filtered with "is within" so that a province also finds its
// cities.
const regionKeys = new Set(['$eq', '$ne', '$empty', '$notEmpty']);
export class IranRegionFieldInterface extends CollectionFieldInterface {
  name = IRAN_REGION_KIND.name;
  type = 'object';
  group = IRANIAN_GROUP;
  order = IRANIAN_FIELD_KINDS.indexOf(IRAN_REGION_KIND) + 1;
  title = t(IRAN_REGION_KIND.title);
  sortable = true;
  availableTypes = ['string'];
  hasDefaultValue = true;
  titleUsable = true;
  default = {
    type: 'string',
    uiSchema: {
      type: 'string',
      'x-component': 'IranRegionSelect',
      'x-component-props': { changeOnSelect: false },
      'x-validator': { [IRAN_REGION_KIND.name]: true },
    },
  };
  properties = {
    ...defaultProps,
    'uiSchema.x-component-props.changeOnSelect': {
      type: 'boolean',
      'x-component': 'Checkbox',
      'x-content': t('Allow choosing a province alone'),
      'x-decorator': 'FormItem',
    },
  };
  filterable = {
    operators: [
      {
        label: t('is within'),
        value: IRAN_REGION_OPERATOR,
        selected: true,
        schema: { 'x-component': 'IranRegionSelect', 'x-component-props': { changeOnSelect: true } },
      },
      ...operators.string.filter((operator) => regionKeys.has(operator.value)),
    ],
  };
}

export function registerIranianFields(app: Application, flowEngine: FlowEngine) {
  app.addComponents({ IranianFieldInput, IranRegionSelect });
  app.addFieldInterfaceGroups({ [IRANIAN_GROUP]: { label: t('Iranian'), order: 2.5 } });
  app.dataSourceManager.addFieldInterfaces(
    IRANIAN_FIELD_KINDS.map((kind) => (kind === IRAN_REGION_KIND ? IranRegionFieldInterface : interfaceFor(kind))),
  );
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
  const names = IRANIAN_FIELD_KINDS.filter((kind) => kind !== IRAN_REGION_KIND).map((kind) => kind.name);
  EditableItemModel.bindModelToInterface('InputFieldModel', names, { isDefault: true });
  FilterableItemModel.bindModelToInterface('InputFieldModel', names, { isDefault: true });
  const formatted = IRANIAN_FIELD_KINDS.filter((kind) => kind.format || kind.describe).map((kind) => kind.name);
  DisplayItemModel.bindModelToInterface(
    'DisplayTextFieldModel',
    [...names.filter((name) => !formatted.includes(name)), IRAN_REGION_KIND.name],
    { isDefault: true },
  );

  // Modern (v2) pages: formatted kinds get a display model that renders IranianFieldText, subclassed from the flow
  // engine's own class like jalali/models.ts does.
  const FieldBase = flowEngine.getModelClass('FieldModel') as any;
  if (FieldBase) {
    class IranRegionFieldModel extends FieldBase {
      render() {
        return <IranRegionCascader {...this.props} />;
      }
    }
    flowEngine.registerModels({ IranRegionFieldModel } as Record<string, any>);
    EditableItemModel.bindModelToInterface('IranRegionFieldModel', [IRAN_REGION_KIND.name], { isDefault: true });
    FilterableItemModel.bindModelToInterface('IranRegionFieldModel', [IRAN_REGION_KIND.name], {
      isDefault: true,
      defaultProps: { changeOnSelect: true },
    });
  }

  const DisplayBase = flowEngine.getModelClass('ClickableFieldModel') as any;
  if (!DisplayBase) return;
  class DisplayIranianFieldModel extends DisplayBase {
    renderComponent(value: unknown) {
      const { className, style } = this.props;
      const kind = this.props.kind ?? this.context?.collectionField?.interface;
      return <IranianFieldText value={value} kind={kind} className={className} style={style} />;
    }
  }
  flowEngine.registerModels({ DisplayIranianFieldModel } as Record<string, any>);
  DisplayItemModel.bindModelToInterface('DisplayIranianFieldModel', formatted, { isDefault: true });
}
