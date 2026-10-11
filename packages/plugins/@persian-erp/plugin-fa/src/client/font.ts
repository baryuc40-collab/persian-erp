export const FA_FONT_FAMILY = 'Vazirmatn';

const STYLE_ID = 'persian-erp-fa-font';
const WEIGHTS: [number, string][] = [
  [400, 'Regular'],
  [500, 'Medium'],
  [700, 'Bold'],
];

// Files under the plugin's package root are served by NocoBase at /static/plugins/<package>/.
export function fontBaseUrl() {
  const publicPath = (window as any).__nocobase_public_path__ || '/';
  return `${publicPath.replace(/\/?$/, '/')}static/plugins/@persian-erp/plugin-fa/fonts/`;
}

export function fontFaceCss(baseUrl: string, fallback: string) {
  const faces = WEIGHTS.map(
    ([weight, name]) =>
      `@font-face{font-family:'${FA_FONT_FAMILY}';src:url('${baseUrl}Vazirmatn-${name}.woff2') format('woff2');` +
      `font-weight:${weight};font-style:normal;font-display:swap;}`,
  ).join('\n');
  return `${faces}\nbody{font-family:${FA_FONT_FAMILY},${fallback};}`;
}

// Adds the @font-face rules once; returns a function that removes them.
export function installFont(fallback: string) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = fontFaceCss(fontBaseUrl(), fallback);
    document.head.appendChild(style);
  }
  return () => style.remove();
}
