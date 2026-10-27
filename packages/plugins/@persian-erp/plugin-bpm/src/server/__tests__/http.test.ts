import http from 'http';
import { AddressInfo } from 'net';
import { BpmEngineError } from '../engine';
import { engineRequest } from '../http';
import { traces } from '../trace';

// How an engine's answers become errors (STORY-092): a wrong password, a missing permission of the service user and
// Camunda's problem+json each get their own message.

let server: http.Server;
let url: string;
const answers: Record<string, { status: number; body: string }> = {
  '/unauthorized': { status: 401, body: '' },
  '/forbidden': {
    status: 403,
    body: JSON.stringify({ title: 'FORBIDDEN', detail: "Insufficient permissions to perform operation 'CREATE'" }),
  },
  '/conflict': {
    status: 409,
    body: JSON.stringify({ title: 'ALREADY_EXISTS', detail: 'Expected to create an instance, but one exists' }),
  },
  '/text': { status: 500, body: 'Internal error' },
  '/ok': { status: 200, body: '{"a":1}' },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/echo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ correlationId: req.headers['x-correlation-id'] ?? null }));
      return;
    }
    const answer = answers[req.url || ''];
    res.writeHead(answer.status, { 'Content-Type': 'application/json' });
    res.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const call = (path: string) =>
  engineRequest({ url, username: 'nocobase', password: 'secret' }, `${url}${path}`, { method: 'GET' });

async function errorOf(path: string) {
  try {
    await call(path);
  } catch (error) {
    return error as BpmEngineError;
  }
  throw new Error('no error');
}

describe('engineRequest', () => {
  it('returns the JSON of a good answer', async () => {
    await expect(call('/ok')).resolves.toEqual({ a: 1 });
  });

  it('sends the correlation ID of the exchange in progress (STORY-093)', async () => {
    await expect(call('/echo')).resolves.toEqual({ correlationId: null });
    await expect(traces.run({ correlationId: 'c-1' }, () => call('/echo'))).resolves.toEqual({ correlationId: 'c-1' });
  });

  it('tells a wrong user name or password', async () => {
    const error = await errorOf('/unauthorized');
    expect(error.message).toBe('The BPMN engine did not accept the user name or password');
    expect(error.status).toBe(401);
  });

  it('tells a missing permission apart, with the reason the engine gave', async () => {
    const error = await errorOf('/forbidden');
    expect(error.message).toBe('The user of the BPMN engine may not do this: {{message}}');
    expect(error.values).toEqual({ message: "Insufficient permissions to perform operation 'CREATE'" });
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it("keeps the engine's message and the problem's title as the code", async () => {
    const conflict = await errorOf('/conflict');
    expect(conflict.values).toEqual({ status: 409, message: 'Expected to create an instance, but one exists' });
    expect(conflict.code).toBe('ALREADY_EXISTS');
    const text = await errorOf('/text');
    expect(text.values).toEqual({ status: 500, message: 'Internal error' });
    expect(text.code).toBeUndefined();
  });

  it('tells an engine that cannot be reached', async () => {
    const error = await engineRequest({ url: 'http://127.0.0.1:1' }, 'http://127.0.0.1:1/v2/topology', {
      method: 'GET',
    }).catch((e) => e);
    expect(error).toBeInstanceOf(BpmEngineError);
    expect(error.message).toBe('The BPMN engine cannot be reached: {{reason}}');
  });
});
