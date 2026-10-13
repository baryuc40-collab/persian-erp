import { connect, mapReadPretty } from '@formily/react';
import { Cascader } from 'antd';
import React from 'react';
import { IRAN_PROVINCES, normalizeRegion, REGION_SEPARATOR, regionParts } from '../../shared/iran-regions';

// The province and city picker (STORY-058): the provinces, then the cities of the chosen one. It reads and writes the
// stored text, "اصفهان / کاشان".

interface Option {
  value: string;
  label: string;
  children?: Option[];
}

let options: Option[] | undefined;
const regionOptions = () =>
  (options ??= IRAN_PROVINCES.map(({ name, cities }) => ({
    value: name,
    label: name,
    children: cities.map((city) => ({ value: city, label: city })),
  })));

// "کاشان", "اصفهان/کا" and "اصفهان / کاشان" all find Kashan.
const searchRegion = (input: string, path: Option[]) =>
  path
    .map((option) => option.label)
    .join(REGION_SEPARATOR)
    .includes(normalizeRegion(input));

export interface IranRegionCascaderProps {
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** Lets a province be chosen alone, as in filters. */
  changeOnSelect?: boolean;
  /** Other antd Cascader props, such as disabled, placeholder or style. */
  [prop: string]: unknown;
}

export function IranRegionCascader(props: IranRegionCascaderProps) {
  const { value, onChange, changeOnSelect, ...rest } = props;
  const path = typeof value === 'string' && value !== '' ? regionParts(value) : undefined;
  return (
    <Cascader
      allowClear
      showSearch={{ filter: searchRegion }}
      {...rest}
      options={regionOptions()}
      changeOnSelect={changeOnSelect}
      value={path}
      displayRender={(labels) => labels.join(REGION_SEPARATOR)}
      onChange={(next: string[] | undefined) => onChange?.(next?.length ? next.join(REGION_SEPARATOR) : null)}
    />
  );
}

export function IranRegionText(props: { value?: unknown; className?: string; style?: React.CSSProperties }) {
  const { value, className, style } = props;
  if (typeof value !== 'string' || value === '') return null;
  return (
    <span className={className} style={style}>
      {value}
    </span>
  );
}

// The classic (v1) component: the picker in forms and filters, the text elsewhere.
export const IranRegionSelect = connect(IranRegionCascader, mapReadPretty(IranRegionText));
