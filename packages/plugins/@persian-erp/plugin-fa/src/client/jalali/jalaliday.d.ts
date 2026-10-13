// jalaliday describes its entry points only through package.json "exports", which this repo's TypeScript settings
// (moduleResolution: node) do not read.
declare module 'jalaliday/dayjs' {
  import type { PluginFunc } from 'dayjs';

  const jalaliday: PluginFunc;
  export default jalaliday;
}
