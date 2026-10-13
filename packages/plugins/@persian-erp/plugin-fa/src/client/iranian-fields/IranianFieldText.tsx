import { connect, mapReadPretty } from '@formily/react';
import { Input } from 'antd';
import React from 'react';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import pkg from '../../../package.json';
import { getIranianFieldKind } from '../../shared/iranian-fields';

/** A stored value as people read it: "IR06 2960 …" and the bank's name for a Sheba number. */
export function IranianFieldText(props: {
  value?: unknown;
  kind?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { value, kind: kindName, className, style } = props;
  const { t } = useTranslation([pkg.name, 'client']);
  if (typeof value !== 'string' || value === '') return null;
  const kind = getIranianFieldKind(kindName);
  const note = kind?.describe?.(value);
  return (
    <span className={className} style={style}>
      {/* Identifiers read left to right even on a right-to-left page. */}
      <bdi dir="ltr">{kind?.format ? kind.format(value) : value}</bdi>
      {note ? ` (${t(note)})` : null}
    </span>
  );
}

// The classic (v1) component of Iranian fields that are shown formatted: a text box in forms, formatted text elsewhere.
export const IranianFieldInput = connect(Input, mapReadPretty(IranianFieldText));
