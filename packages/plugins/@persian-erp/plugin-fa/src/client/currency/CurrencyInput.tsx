import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';
import React from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../../package.json';
import { CurrencyUnit, formatAmount, rialToUnit, unitToRial } from '../../shared/iranian-currency';

export type CurrencyProps = Omit<InputNumberProps, 'value' | 'onChange'> & {
  value?: number | string | null;
  onChange?: (rial: number | null) => void;
  unit?: CurrencyUnit;
};

const UNIT_LABELS: Record<CurrencyUnit, string> = { rial: 'Rial', toman: 'Toman' };

export function useUnitLabel(unit: CurrencyUnit = 'rial') {
  const { t } = useTranslation([pkg.name, 'client']);
  return t(UNIT_LABELS[unit] || UNIT_LABELS.rial);
}

const withSeparators = (text?: string) => (text || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Takes the amount in the field's unit and hands the form whole rials. */
export function CurrencyInput(props: CurrencyProps) {
  const { value, onChange, unit = 'rial', ...rest } = props;
  const label = useUnitLabel(unit);
  return (
    <InputNumber
      style={{ width: '100%' }}
      {...rest}
      value={rialToUnit(value, unit)}
      onChange={(amount: number | string | null) => onChange?.(unitToRial(amount, unit))}
      precision={unit === 'toman' ? undefined : 0}
      formatter={(text?: number | string) => {
        const [whole, fraction] = String(text ?? '').split('.');
        return fraction === undefined ? withSeparators(whole) : `${withSeparators(whole)}.${fraction}`;
      }}
      parser={(text?: string) => (text || '').replace(/,/g, '')}
      addonAfter={label}
    />
  );
}

/** "12,500 تومان" for 125000 rials shown in tomans. */
export function CurrencyText(props: {
  value?: unknown;
  unit?: CurrencyUnit;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { value, unit = 'rial', className, style } = props;
  const label = useUnitLabel(unit);
  const text = formatAmount(value, unit);
  if (!text) return null;
  return (
    <span className={className} style={style}>
      {text} {label}
    </span>
  );
}
