import { fireEvent, render, screen } from '@testing-library/react';
import { InputNumber } from 'antd';
import React, { useState } from 'react';
import { installLatinDigitsInput } from '../latin-digits-input';

function Form() {
  const [text, setText] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  return (
    <>
      <input aria-label="text" value={text} onChange={(e) => setText(e.target.value)} />
      <span data-testid="text">{text}</span>
      <InputNumber aria-label="amount" value={amount} onChange={setAmount} />
      <span data-testid="amount">{String(amount)}</span>
      <input aria-label="password" type="password" defaultValue="" />
    </>
  );
}

describe('Latin digits in text boxes', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installLatinDigitsInput();
  });
  afterEach(() => uninstall());

  it('turns typed Persian digits into Latin ones before React reads them', () => {
    render(<Form />);
    fireEvent.input(screen.getByLabelText('text'), { target: { value: 'کد ۴۵' } });
    expect(screen.getByTestId('text').textContent).toBe('کد 45');
    expect((screen.getByLabelText('text') as HTMLInputElement).value).toBe('کد 45');
  });

  it('reads Persian decimals in number boxes', () => {
    render(<Form />);
    fireEvent.input(screen.getByLabelText('amount'), { target: { value: '۱۲۳٫۵' } });
    expect(screen.getByTestId('amount').textContent).toBe('123.5');
  });

  it('leaves password boxes alone', () => {
    render(<Form />);
    const password = screen.getByLabelText('password') as HTMLInputElement;
    fireEvent.input(password, { target: { value: '۱۲۳' } });
    expect(password.value).toBe('۱۲۳');
  });

  it('stops when uninstalled', () => {
    uninstall();
    render(<Form />);
    fireEvent.input(screen.getByLabelText('text'), { target: { value: '۴۵' } });
    expect(screen.getByTestId('text').textContent).toBe('۴۵');
    uninstall = () => undefined;
  });
});
