// Corrections for NocoBase styles that use physical sides (left/right) and therefore look wrong when the page is
// right-to-left. The list of problems and their sources is in docs/research/rtl-audit.md.
//
// Every rule is scoped to html[dir='rtl'], which FaProvider sets only for RTL languages, so English and other LTR
// languages are untouched. The html prefix also gives these rules more specificity than NocoBase's emotion styles.

export const RTL_STYLE_ID = 'persian-erp-rtl-styles';

const RTL = "html[dir='rtl']";

// Inline styles (style={{ marginLeft: 8 }}) are the most common case. React writes them as "margin-left: 8px;", so an
// attribute selector can find them. An element that sets only one side gets that spacing moved to the other side;
// one that sets both sides is symmetric and left alone. Skipped: code editors, which stay left-to-right, and antd
// menu items, whose inline indent antd already puts on the correct side.
const SKIP = ':not(.cm-editor *):not(.monaco-editor *):not(.ant-menu-item):not(.ant-menu-submenu-title)';
const SPACING_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 35, 40, 48];

function inlineSpacingRules(): string {
  const rules: string[] = [];
  for (const prop of ['margin', 'padding']) {
    for (const [from, to] of [
      ['left', 'right'],
      ['right', 'left'],
    ]) {
      const selectors = SPACING_VALUES.map(
        (v) => `${RTL} [style*="${prop}-${from}: ${v}px;"]:not([style*="${prop}-${to}:"])${SKIP}`,
      );
      // One rule per value, since the value has to be copied to the other side.
      SPACING_VALUES.forEach((v, i) => {
        rules.push(`${selectors[i]}{${prop}-${from}:0 !important;${prop}-${to}:${v}px !important}`);
      });
    }
  }
  return rules.join('\n');
}

const inlineAlignRules = `
${RTL} [style*="text-align: left;"]${SKIP} { text-align: right !important; }
${RTL} [style*="text-align: right;"]${SKIP} { text-align: left !important; }
${RTL} [style*="float: left;"]${SKIP} { float: right !important; }
${RTL} [style*="float: right;"]${SKIP} { float: left !important; }
`;

// Rules for NocoBase styles that live in emotion classes (hashed names), matched through stable class names or
// structure instead.
const componentRules = `
/* Breadcrumb separators drawn with a right-pointing arrow (data source manager). */
${RTL} .ant-breadcrumb-separator .anticon-right,
${RTL} .ant-breadcrumb-separator .anticon-left {
  transform: scaleX(-1);
}

/* Gap between icon and label in the "Add block" / initializer menus. */
${RTL} .nb-schema-initializer-item-content {
  margin-left: 0;
  margin-right: 10px;
}

/* Variable ("x") button of text areas such as System title: it sits at the end of the field, not over the start of
   the text. */
${RTL} div:has(> textarea) > .ant-space-compact {
  right: auto;
  left: 0;
}
${RTL} div:has(> textarea) > .ant-space-compact .ant-btn:not(:hover) {
  border-right-color: inherit;
  border-left-color: transparent;
}

/* Remove (x) of a nested filter group. */
${RTL} [aria-label='icon-close'] > .anticon[style*='right: 10px;'] {
  right: auto !important;
  left: 10px;
}

/* Inline-edit pencil in table cells. */
${RTL} .edit-icon {
  right: auto;
  left: 8px;
  margin-left: 0;
  margin-right: 8px;
}

/* Drawer footer buttons. */
${RTL} .ant-drawer .footer .ant-btn {
  margin-right: 0;
  margin-left: 8px;
}

/* "Delete collection" dialog: its body is indented under the title, after the warning icon. */
${RTL} .ant-modal:has(.ant-modal-title .anticon-exclamation-circle) .ant-modal-body {
  margin-left: 0;
  margin-right: 35px;
}

/* Divider between the role list and the permissions in Users & Permissions. */
${RTL} [style*='border-right: 1px solid'] {
  border-right: none !important;
  border-left: 1px solid rgb(238, 238, 238) !important;
}

/* User menu (modern client): labels at the start, values at the end. */
${RTL} .nb-user-center-item {
  text-align: right;
}
${RTL} .nb-user-center-item-select .ant-select,
${RTL} .nb-user-center-item-select .ant-select-selector,
${RTL} .nb-user-center-item-select .ant-select-selection-item {
  text-align: left;
}
${RTL} .nb-user-center-item-select .ant-select-selection-item {
  padding: 0 0 0 18px !important;
}

/* Markdown blocks: quote bar and table cells follow the text direction. */
${RTL} .nb-markdown blockquote {
  border-left: none;
  border-right: 4px solid #ccc;
  padding-left: 0;
  padding-right: 20px;
}
${RTL} .nb-markdown th,
${RTL} .nb-markdown td {
  text-align: right;
}

/* Block toolbar in UI design mode (classic and modern pages): the title tag goes at the start (right) and the
   drag/add/settings icons at the end (left), mirroring the left-to-right layout. */
${RTL} .toolbar-title,
${RTL} .nb-toolbar-container > .nb-toolbar-container-title {
  left: auto;
  right: 2px;
}
${RTL} .toolbar-icons,
${RTL} .general-schema-designer-icons,
${RTL} .nb-toolbar-container > .nb-toolbar-container-icons {
  right: auto !important;
  left: 2px !important;
}
${RTL} .toolbar-icons .ant-space-item,
${RTL} .general-schema-designer-icons .ant-space-item {
  padding-left: 0 !important;
  padding-right: 1px !important;
}

/* Workflow canvas. The branches of a condition or loop follow the page direction, so the connector lines and the
   Yes/No labels have to follow them too. */
${RTL} .workflow-branch:first-child:not(:last-child)::before,
${RTL} .workflow-branch:first-child:not(:last-child)::after {
  left: auto;
  right: 50%;
}
${RTL} .workflow-branch ~ div:last-child::before,
${RTL} .workflow-branch ~ div:last-child::after {
  right: auto;
  left: 50%;
}
${RTL} .workflow-canvas span[style*='right: 4em;'] {
  right: auto !important;
  left: 4em;
}
${RTL} .workflow-canvas span[style*='left: 4em;'] {
  left: auto !important;
  right: 4em;
}
/* Loop node: the return line sits after the loop body, and the body is padded on the other side to stay centred. */
${RTL} .workflow-canvas div:has(> .workflow-branch:first-child + div > .workflow-branch-lines) {
  padding-left: 0;
  padding-right: 4em;
}
/* Zoom slider and the clipboard preview swap corners. */
${RTL} .workflow-canvas-zoomer {
  right: auto;
  left: 2em;
}
${RTL} div:has(> .workflow-clipboard-header) {
  left: auto;
  right: 2em;
}
${RTL} .workflow-versions label {
  margin-right: 0;
  margin-left: 0.5em;
}

/* Rich text (Quill) content. */
${RTL} .ql-editor {
  text-align: right;
}
${RTL} .ql-editor blockquote {
  border-left: none;
  border-right: 4px solid #ccc;
  padding-left: 0;
  padding-right: 16px;
}
${RTL} .ql-editor ol,
${RTL} .ql-editor ul {
  padding-left: 0;
  padding-right: 1.5em;
}
`;

export const rtlStyles = () => [inlineSpacingRules(), inlineAlignRules, componentRules].join('\n');

export function installRtlStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.getElementById(RTL_STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = RTL_STYLE_ID;
  style.textContent = rtlStyles();
  document.head.appendChild(style);
  return () => style.remove();
}
