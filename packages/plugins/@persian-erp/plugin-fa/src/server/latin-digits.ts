import { toLatinDigits, toLatinNumber } from '../shared/latin-digits';

// Server side of STORY-052: whatever the client, API calls and Excel imports store Latin digits.

const NUMBER_INTERFACES = ['number', 'integer', 'percent'];
// Field types whose string values are user text. Passwords and tokens are compared byte for byte and stay untouched.
const TEXT_TYPES = new Set(['string', 'text', 'uid', 'sequence']);
const NUMBER_TYPES = new Set(['integer', 'bigInt', 'float', 'double', 'decimal', 'real', 'number']);

type Ctor = new (...args: any[]) => { toValue(value: unknown, ctx?: unknown): Promise<unknown> };

// Excel import parses number cells with the field interface before saving, so "۱۲٫۵" must become "12.5" there.
export function withLatinDigits<T extends Ctor>(Base: T) {
  return class extends Base {
    async toValue(value: unknown, ctx?: unknown) {
      return super.toValue(typeof value === 'string' ? toLatinNumber(value) : value, ctx);
    }
  };
}

interface SavedModel {
  changed(): string[] | false;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  constructor: { collection?: { getField(name: string): { type: string } | undefined } };
}

// Runs before Sequelize validates any record, for every collection.
export function latinDigitsBeforeValidate(model: SavedModel) {
  const collection = model.constructor.collection;
  if (!collection) return;
  for (const name of model.changed() || []) {
    const value = model.get(name);
    if (typeof value !== 'string') continue;
    const type = collection.getField(name)?.type;
    if (TEXT_TYPES.has(type)) {
      const latin = toLatinDigits(value);
      if (latin !== value) model.set(name, latin);
    } else if (NUMBER_TYPES.has(type)) {
      const latin = toLatinNumber(value);
      if (latin !== value) model.set(name, latin.replace(/,/g, ''));
    }
  }
}

export function registerLatinDigits(db: {
  interfaceManager: any;
  on(event: string, listener: (...args: any[]) => void);
}) {
  for (const name of NUMBER_INTERFACES) {
    const Base = db.interfaceManager.getInterfaceType(name);
    if (Base) db.interfaceManager.registerInterfaceType(name, withLatinDigits(Base));
  }
  db.on('beforeValidate', latinDigitsBeforeValidate);
}
