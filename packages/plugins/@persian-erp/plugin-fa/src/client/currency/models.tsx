// Modern (v2) pages: field models for currencyIRR fields. Like jalali/models.ts, they subclass the flow engine's own
// classes, because @nocobase/client-v2 is not shared with plugins at runtime.

import { DisplayItemModel, EditableItemModel, FilterableItemModel } from '@nocobase/flow-engine';
import type { FlowEngine } from '@nocobase/flow-engine';
import React from 'react';
import { CURRENCY_INTERFACE } from './interface';
import { CurrencyInput, CurrencyText } from './CurrencyInput';

export function registerCurrencyModels(flowEngine: FlowEngine) {
  const FieldBase = flowEngine.getModelClass('FieldModel') as any;
  const DisplayBase = flowEngine.getModelClass('ClickableFieldModel') as any;
  if (!FieldBase || !DisplayBase) return;

  class IranianCurrencyFieldModel extends FieldBase {
    render() {
      return <CurrencyInput {...this.props} />;
    }
  }

  class DisplayIranianCurrencyFieldModel extends DisplayBase {
    renderComponent(value: unknown) {
      const { unit, className, style } = this.props;
      return <CurrencyText value={value} unit={unit} className={className} style={style} />;
    }
  }

  flowEngine.registerModels({ IranianCurrencyFieldModel, DisplayIranianCurrencyFieldModel } as Record<string, any>);
  EditableItemModel.bindModelToInterface('IranianCurrencyFieldModel', [CURRENCY_INTERFACE], { isDefault: true });
  FilterableItemModel.bindModelToInterface('IranianCurrencyFieldModel', [CURRENCY_INTERFACE], { isDefault: true });
  DisplayItemModel.bindModelToInterface('DisplayIranianCurrencyFieldModel', [CURRENCY_INTERFACE], { isDefault: true });
}
