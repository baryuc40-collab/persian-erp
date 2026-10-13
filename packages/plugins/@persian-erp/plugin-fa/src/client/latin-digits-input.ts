import { hasNonLatinDigits, toLatinDigits, toLatinNumber } from '../shared/latin-digits';

// Client side of STORY-052: digits typed or pasted on a Persian keyboard turn into Latin digits as they reach a text
// box, so forms send "123.5" for "۱۲۳٫۵". The field still shows Persian shapes through the Vazirmatn FD font.
//
// The listener runs in the capture phase on the document, before React's own listener on the app root reads the
// event. It writes the value through the prototype setter, which React's change tracking does not see, so React still
// notices a change and calls onChange with the converted text.

const setters = new Map<object, (value: string) => void>();
function nativeSetter(element: HTMLInputElement | HTMLTextAreaElement) {
  const proto = Object.getPrototypeOf(element);
  if (!setters.has(proto)) setters.set(proto, Object.getOwnPropertyDescriptor(proto, 'value').set);
  return setters.get(proto);
}

// Number and email inputs reject Persian digits before any event and do not support carets, so they are left out.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'tel', 'url', '']);

function convertible(target: EventTarget): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) {
    // Code editors (Monaco) type through a hidden textarea; code keeps whatever digits were typed.
    return !target.closest('.monaco-editor');
  }
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.getAttribute('type') || '');
}

function isNumberBox(element: HTMLInputElement | HTMLTextAreaElement) {
  return element.classList.contains('ant-input-number-input') || element.getAttribute('inputmode') === 'decimal';
}

/** Converts the value of a text box in place; returns whether it changed. */
export function convertInputDigits(element: HTMLInputElement | HTMLTextAreaElement) {
  const value = element.value;
  if (!hasNonLatinDigits(value) && !(isNumberBox(element) && /[٫٬]/.test(value))) return false;
  const latin = isNumberBox(element) ? toLatinNumber(value) : toLatinDigits(value);
  // Every replacement is one character for one character, so the caret stays where it was.
  const { selectionStart, selectionEnd } = element;
  nativeSetter(element).call(element, latin);
  if (selectionStart != null) element.setSelectionRange(selectionStart, selectionEnd);
  return true;
}

function onInput(event: Event) {
  // Mid-composition text belongs to the input method; it is converted when composition ends.
  if ((event as InputEvent).isComposing || !convertible(event.target)) return;
  convertInputDigits(event.target);
}

function onCompositionEnd(event: CompositionEvent) {
  if (convertible(event.target) && convertInputDigits(event.target)) {
    event.target.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Starts converting digits in every text box of the page; returns a function that stops it. */
export function installLatinDigitsInput(doc: Document = document) {
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('compositionend', onCompositionEnd, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('compositionend', onCompositionEnd, true);
  };
}
