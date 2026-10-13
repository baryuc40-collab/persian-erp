// Modern (v2) client: flow models that show dates in the Jalali calendar.
//
// @nocobase/client-v2 is not shared with plugins at runtime, so the models are subclassed from the classes the flow
// engine already has and registered again under the same names. Saved pages and field-interface bindings refer to
// models by name, so they pick the subclasses up (docs/decisions/0004-jalali-calendar.md).

import type { FlowEngine } from '@nocobase/flow-engine';
import { toJalaliDisplay } from './calendar';

export function registerJalaliModels(flowEngine: FlowEngine) {
  const DisplayBase = flowEngine.getModelClass('DisplayDateTimeFieldModel') as any;
  if (DisplayBase) {
    // renderComponent() formats dayjs(value); dayjs() keeps a Jalali instance Jalali, so format() prints Jalali.
    class DisplayDateTimeFieldModel extends DisplayBase {
      renderComponent(value: any) {
        return super.renderComponent(toJalaliDisplay(value, this.props?.picker));
      }
    }
    flowEngine.registerModels({ DisplayDateTimeFieldModel } as Record<string, any>);
  }
}
