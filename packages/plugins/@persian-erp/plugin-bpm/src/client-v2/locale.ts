import { tExpr as flowTExpr, useFlowEngine } from '@nocobase/flow-engine';
// @ts-ignore
import pkg from '../../package.json';

export const NAMESPACE = pkg.name;

/** Translations of this plugin inside workflow pages, which run on the flow engine. */
export function useT() {
  const flowEngine = useFlowEngine();
  return (key: string, options?: Record<string, unknown>) =>
    flowEngine.context.t(key, { ns: [NAMESPACE, 'workflow', 'client'], nsMode: 'fallback', ...options });
}

export function tExpr(key: string, options?: Record<string, unknown>) {
  return flowTExpr(key, { ns: [NAMESPACE, 'workflow', 'client'], nsMode: 'fallback', ...options });
}
