import { connect, mapReadPretty } from '@formily/react';
import { CurrencyInput, CurrencyText } from './CurrencyInput';

// The classic (v1) component for currencyIRR fields: an input in forms, text in tables and details.
export const IranianCurrency = connect(CurrencyInput, mapReadPretty(CurrencyText));
