import { CollectionFieldInterface, defaultProps, operators, unique } from '@nocobase/client';
// @ts-ignore
import pkg from '../../../package.json';

const t = (key: string) => `{{t(${JSON.stringify(key)}, { ns: ${JSON.stringify(pkg.name)} })}}`;

export const CURRENCY_INTERFACE = 'currencyIRR';

// "Iranian currency" in the field type list: a whole number of rials, shown and typed in rials or tomans (STORY-054).
export class IranianCurrencyFieldInterface extends CollectionFieldInterface {
  name = CURRENCY_INTERFACE;
  type = 'object';
  group = 'basic';
  order = 8;
  title = t('Iranian currency');
  description = t('Stored in rials; shown and typed in rials or tomans.');
  sortable = true;
  default = {
    type: 'bigInt',
    uiSchema: {
      type: 'number',
      'x-component': 'IranianCurrency',
      'x-component-props': { unit: 'rial' },
    },
  };
  availableTypes = ['bigInt'];
  hasDefaultValue = true;
  validationType = 'number';
  properties = {
    ...defaultProps,
    unique,
    'uiSchema.x-component-props.unit': {
      type: 'string',
      title: t('Display unit'),
      'x-component': 'Radio.Group',
      'x-decorator': 'FormItem',
      default: 'rial',
      enum: [
        { label: t('Rial'), value: 'rial' },
        { label: t('Toman'), value: 'toman' },
      ],
    },
  };
  filterable = { operators: operators.number };
  titleUsable = true;
}
