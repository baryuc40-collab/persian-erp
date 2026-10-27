import { BpmEngineError } from './engine';
import { currentCorrelationId } from './trace';

export interface EngineSettings {
  url: string;
  username?: string;
  password?: string;
  /** Milliseconds before a request is given up. */
  timeout?: number;
}

/**
 * One JSON request to an engine's REST API with basic authentication. Network failures, a refused user, a missing
 * permission and any other error status become a BpmEngineError with a message the plugin translates; the engine's own message (`message` of
 * Operaton, `detail` or `title` of Camunda's problem+json) goes into it.
 */
export async function engineRequest<T = any>(
  settings: EngineSettings,
  url: string,
  options: { method: string; body?: unknown; form?: FormData },
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (settings.username) {
    const token = Buffer.from(`${settings.username}:${settings.password || ''}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const correlationId = currentCorrelationId();
  if (correlationId) headers['X-Correlation-Id'] = correlationId;
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method,
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: AbortSignal.timeout(settings.timeout ?? 10000),
    });
  } catch (error) {
    const reason = (error as Error & { cause?: Error }).cause?.message || (error as Error).message;
    throw new BpmEngineError('The BPMN engine cannot be reached: {{reason}}', { reason });
  }
  if (res.status === 401) {
    throw new BpmEngineError('The BPMN engine did not accept the user name or password', {}, res.status);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    let code: string | undefined;
    try {
      const problem = JSON.parse(text);
      message = problem.message || problem.detail || problem.title || text;
      code = problem.title;
    } catch {
      // Not JSON; the text is the message.
    }
    // A known user without the permission: the engine's role for the service user lacks something (decision 0008).
    const error =
      res.status === 403
        ? new BpmEngineError('The user of the BPMN engine may not do this: {{message}}', { message }, res.status)
        : new BpmEngineError(
            'The BPMN engine answered {{status}}: {{message}}',
            { status: res.status, message },
            res.status,
          );
    error.code = code;
    throw error;
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
