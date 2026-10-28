import { AsyncLocalStorage } from 'async_hooks';

/**
 * The correlation ID of the exchange in progress (STORY-093). The event log starts a trace around each exchange, and
 * every request to the engine made inside it, also deep in an adapter, carries the ID as X-Correlation-Id; so the
 * adapters and BpmEngine need no new parameter.
 */
export const traces = new AsyncLocalStorage<{ correlationId: string }>();

export const currentCorrelationId = () => traces.getStore()?.correlationId;
