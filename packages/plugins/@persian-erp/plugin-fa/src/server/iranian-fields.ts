import { ValidationError, ValidationErrorItem } from '@nocobase/database';
import faLocale from '../locale/fa-IR.json';
import { getIranianFieldKind, IRANIAN_FIELD_KINDS } from '../shared/iranian-fields';

// Server side of the Iranian field types (EPIC-013): values are normalized and checked before every save, so forms,
// the API and Excel imports follow the same rule.

interface SavedModel {
  changed(): string[] | false;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  constructor: { collection?: { getField(name: string): { options: { interface?: string } } | undefined } };
}

export function iranianFieldsBeforeValidate(model: SavedModel) {
  const collection = model.constructor.collection;
  if (!collection) return;
  const errors: ValidationErrorItem[] = [];
  for (const name of model.changed() || []) {
    const kind = getIranianFieldKind(collection.getField(name)?.options.interface);
    const value = model.get(name);
    if (!kind || typeof value !== 'string' || value === '') continue;
    const normalized = kind.normalize(value);
    if (normalized !== value) model.set(name, normalized);
    if (!kind.validate(normalized)) {
      const item = new ValidationErrorItem(kind.error, 'FUNCTION', name, value, model as any, kind.name, kind.name, []);
      // plugin-error-handler answers 400 and translates the item's type in its own namespace (see iranianFieldMessages).
      ((item as unknown) as { type: string }).type = kind.error;
      errors.push(item);
    }
  }
  if (errors.length) throw new ValidationError(errors[0].message, errors);
}

/** The Persian messages, added to the namespace plugin-error-handler translates validation errors with. */
export function iranianFieldMessages(i18n: { addResources(lng: string, ns: string, resources: object): void }) {
  const messages = Object.fromEntries(
    IRANIAN_FIELD_KINDS.map((kind) => [kind.error, faLocale[kind.error]]).filter(([, text]) => text),
  );
  i18n.addResources('fa-IR', 'error-handler', messages);
}

export function registerIranianFields(db: {
  interfaceManager: any;
  on(event: string, listener: (...args: any[]) => void);
}) {
  // Imported and exported as plain text.
  const Input = db.interfaceManager.getInterfaceType('input');
  for (const kind of IRANIAN_FIELD_KINDS) db.interfaceManager.registerInterfaceType(kind.name, Input);
  db.on('beforeValidate', iranianFieldsBeforeValidate);
}
