import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, visitFrom } from '../src/server/server.js';

let base = '';
let server: ReturnType<typeof startServer>;
beforeAll(async () => {
  server = startServer(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('the local server', () => {
  it('reports health and the providers it has', async () => {
    const h = await (await fetch(`${base}/api/health`)).json();
    expect(h.ok).toBe(true);
    expect(h.providers).toContain('mock');
  });

  it('rebuilds the visit from the seed and actions, and returns the model step', async () => {
    const res = await fetch(`${base}/api/researcher`, { method: 'POST', body: JSON.stringify({ seed: 4, question: 1, actions: [], provider: 'mock' }) });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.action.kind).toBe('search');
    expect(r.fallback).toBe(false);
  });

  it('refuses bad input', async () => {
    expect(() => visitFrom({ seed: -1, question: 1, actions: [] })).toThrow();
    expect(() => visitFrom({ seed: 4, question: 1, actions: [{ kind: 'answer', answer: 'x', cite: [] }] })).toThrow(/bad action/);
    expect(() => visitFrom({ seed: 4, question: 1, actions: [{ kind: 'open', doc: 'nowhere' }] })).toThrow(/earlier action/);
    const res = await fetch(`${base}/api/researcher`, { method: 'POST', body: JSON.stringify({ seed: 4, question: 1, actions: [], provider: 'anthropic-nope' }) });
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/nope/../../etc/passwd`)).status).toBe(404);
  });
});
