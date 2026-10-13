import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { formatAmount, rialToUnit, unitToRial } from '../../shared/iranian-currency';
import { CurrencyInput, CurrencyText } from '../currency/CurrencyInput';

describe('Iranian currency', () => {
  it('converts between rials and tomans', () => {
    expect(rialToUnit('125000', 'toman')).toBe(12500);
    expect(unitToRial(12500, 'toman')).toBe(125000);
    expect(unitToRial(12500.5, 'toman')).toBe(125005);
    expect(unitToRial('', 'toman')).toBeNull();
    expect(rialToUnit(null)).toBeNull();
  });

  it('formats with thousands separators', () => {
    expect(formatAmount(125000, 'toman')).toBe('12,500');
    expect(formatAmount('125000', 'rial')).toBe('125,000');
    expect(formatAmount(125005, 'toman')).toBe('12,500.5');
    expect(formatAmount(undefined)).toBe('');
  });

  it('shows the amount with its unit', () => {
    render(<CurrencyText value={125000} unit="toman" />);
    expect(screen.getByText('12,500 Toman')).toBeTruthy();
  });

  it('takes tomans and hands the form rials', () => {
    const Form = () => {
      const [rial, setRial] = useState<number | null>(null);
      return (
        <>
          <CurrencyInput aria-label="amount" unit="toman" value={rial} onChange={setRial} />
          <span data-testid="rial">{String(rial)}</span>
        </>
      );
    };
    render(<Form />);
    const input = screen.getByLabelText('amount') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12500' } });
    expect(screen.getByTestId('rial').textContent).toBe('125000');
    expect(input.value).toBe('12,500');
    expect(screen.getByText('Toman')).toBeTruthy();
  });
});
