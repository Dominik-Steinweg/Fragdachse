import { beforeEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import config from '../vite.config';

vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(),
  mkdir: vi.fn(), writeFile: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

function handler(): Connect.NextHandleFunction {
  const resolved = (config as Function)({ mode: 'test', command: 'serve' });
  const plugin = resolved.plugins.find((entry: Plugin) => entry.name === 'local-navigation-report');
  let report!: Connect.NextHandleFunction;
  plugin.configureServer({ middlewares: { use(path: string, callback: Connect.NextHandleFunction) {
    if (path === '/__navigation-report') report = callback;
  } } } as unknown as ViteDevServer);
  return report;
}

function post(chunks: Buffer[], origin = 'http://127.0.0.1:8090', address = '127.0.0.1', host = '127.0.0.1:8090') {
  return new Promise<{ status: number; body: string }>(resolve => {
    const request = Object.assign(Readable.from(chunks), {
      method: 'POST', socket: { remoteAddress: address },
      headers: { host, origin, 'content-type': 'application/json' },
    });
    let status = 0;
    const response = { writeHead(value: number) { status = value; }, end(body: string) { resolve({ status, body }); } };
    handler()(request as IncomingMessage, response as unknown as ServerResponse, () => {});
  });
}

const report = { environment: { scenario: 'rock-field', seed: 183, count: 100, session: 'Frühstück 🦡' } };

it.each([
  ['https://unrelated.invalid', '127.0.0.1'],
  ['null', '127.0.0.1'],
  ['', '127.0.0.1'],
  ['http://127.0.0.1:8090', '192.0.2.1'],
])('rejects navigation report writes from %s / %s', async (origin, address) => {
  const result = await post([Buffer.from(JSON.stringify(report))], origin, address);
  expect(result.status).toBe(403);
  expect(mkdir).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

it('rejects a nonlocal Host even when its Origin matches', async () => {
  const result = await post([Buffer.from(JSON.stringify(report))], 'http://unrelated.invalid:8090', '127.0.0.1', 'unrelated.invalid:8090');
  expect(result.status).toBe(403);
  expect(writeFile).not.toHaveBeenCalled();
});

it.each(['localhost:8090', '[::1]:8090'])('accepts the local lab on %s', async host => {
  expect((await post([Buffer.from(JSON.stringify(report))], `http://${host}`, '::1', host)).status).toBe(200);
  expect(writeFile).toHaveBeenCalledOnce();
});

it('bounds request bytes and drains oversized input without a partial report', async () => {
  expect((await post([Buffer.alloc(20_000_000), Buffer.from('x'), Buffer.from('tail')])).status).toBe(413);
  expect(writeFile).not.toHaveBeenCalled();
});

it('preserves UTF-8 session labels split across request chunks', async () => {
  const body = Buffer.from(JSON.stringify(report));
  const split = body.indexOf(Buffer.from('ü')) + 1;
  const result = await post([body.subarray(0, split), body.subarray(split)]);
  expect(result.status).toBe(200);
  expect(writeFile).toHaveBeenCalledOnce();
  const saved = vi.mocked(writeFile).mock.calls[0][1];
  expect(JSON.parse(saved.toString())).toEqual(report);
});

it('rejects invalid report metadata without a filesystem write', async () => {
  expect((await post([Buffer.from(JSON.stringify({ environment: { scenario: '../outside', seed: 1, count: 1 } }))])).status).toBe(400);
  expect(writeFile).not.toHaveBeenCalled();
});
