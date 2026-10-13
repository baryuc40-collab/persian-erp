import { getIranianFieldKind, isLegalId, isNationalId } from '../../shared/iranian-fields';

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
