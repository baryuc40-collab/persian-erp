export const FA_FONT_FAMILY = 'Vazirmatn';
// The same font with Persian shapes for the Latin digits 0-9 (STORY-051).
export const FA_DIGITS_FONT_FAMILY = 'Vazirmatn FD';

const STYLE_ID = 'persian-erp-fa-font';
const WEIGHTS: [number, string][] = [
  [400, 'Regular'],
  [500, 'Medium'],
  [700, 'Bold'],
];

// The build copies fonts/ to dist/client/fonts; the image's nginx serves only dist/client of a plugin (STORY-072).
export function fontBaseUrl() {
  const publicPath = (window as any).__nocobase_public_path__ || '/';
  return `${publicPath.replace(/\/?$/, '/')}static/plugins/@persian-erp/plugin-fa/dist/client/fonts/`;
}

/** The family the page uses: Vazirmatn FD for Persian digits, Vazirmatn for Latin ones. */
export function pageFontFamily(persianDigits: boolean) {
  return persianDigits ? FA_DIGITS_FONT_FAMILY : FA_FONT_FAMILY;
}

export function fontFaceCss(baseUrl: string, fallback: string, persianDigits = false) {
  const faces = [
    [FA_FONT_FAMILY, 'Vazirmatn'],
    [FA_DIGITS_FONT_FAMILY, 'Vazirmatn-FD'],
  ]
    .flatMap(([family, file]) =>
      WEIGHTS.map(
        ([weight, name]) =>
          `@font-face{font-family:'${family}';src:url('${baseUrl}${file}-${name}.woff2') format('woff2');` +
          `font-weight:${weight};font-style:normal;font-display:swap;}`,
      ),
    )
    .join('\n');
  return `${faces}\nbody{font-family:'${pageFontFamily(persianDigits)}',${fallback};}`;
}

// Adds the @font-face rules once; returns a function that removes them.
export function installFont(fallback: string, persianDigits = false) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = fontFaceCss(fontBaseUrl(), fallback, persianDigits);
    document.head.appendChild(style);
  }
  return () => style.remove();
}
