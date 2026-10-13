import { render, screen } from '@testing-library/react';
import React from 'react';
import { getIranianFieldKind, isLegalId, isNationalId, isSheba } from '../../shared/iranian-fields';
import { IranianFieldText } from '../iranian-fields/IranianFieldText';

describe('Iranian national IDs', () => {
  it('checks the personal national ID check digit', () => {
    expect(isNationalId('0499370899')).toBe(true);
    expect(isNationalId('0084575948')).toBe(true);
    expect(isNationalId('0499370898')).toBe(false);
    expect(isNationalId('1111111111')).toBe(false);
    expect(isNationalId('049937089')).toBe(false);
  });

  it('checks the legal entity ID check digit', () => {
    expect(isLegalId('10380284790')).toBe(true);
    expect(isLegalId('10380284791')).toBe(false);
    expect(isLegalId('11111111111')).toBe(false);
  });

  it('normalizes what people type', () => {
    const kind = getIranianFieldKind('iranNationalId');
    expect(kind.normalize('۰۴۹۹-۳۷۰۸۹۹')).toBe('0499370899');
    expect(kind.normalize(' 049 937 0899 ')).toBe('0499370899');
  });
});

describe('Sheba numbers', () => {
  const sheba = getIranianFieldKind('iranSheba');

  it('checks the ISO 13616 check digits', () => {
    expect(isSheba('IR062960000000100324200001')).toBe(true);
    expect(isSheba('IR110170000000123456789001')).toBe(true);
    expect(isSheba('IR120170000000123456789001')).toBe(false);
    expect(isSheba('IR06296000000010032420000')).toBe(false);
  });

  it('normalizes, formats and names the bank', () => {
    expect(sheba.normalize('ir06 2960 0000 0010 0324 2000 01')).toBe('IR062960000000100324200001');
    expect(sheba.normalize('۰۶۲۹۶۰۰۰۰۰۰۰۱۰۰۳۲۴۲۰۰۰۰۱')).toBe('IR062960000000100324200001');
    expect(sheba.format('IR110170000000123456789001')).toBe('IR11 0170 0000 0012 3456 7890 01');
    expect(sheba.describe('IR110170000000123456789001')).toBe('Bank Melli Iran');
    expect(sheba.describe('IR062960000000100324200001')).toBeUndefined();
  });

  it('shows the formatted number and the bank', () => {
    render(<IranianFieldText value="IR110170000000123456789001" kind="iranSheba" />);
    expect(screen.getByText('IR11 0170 0000 0012 3456 7890 01')).toBeTruthy();
    expect(screen.getByText(/Bank Melli Iran/)).toBeTruthy();
  });
});
