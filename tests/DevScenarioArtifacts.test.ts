import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connect, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { devScenarioArtifacts } from '../scripts/dev-scenario-artifacts';

it('accepts only loopback same-origin PNGs and owns artifact paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fd-scenario-artifacts-'));
  try {
    let handler: Connect.NextHandleFunction;
    const plugin = devScenarioArtifacts();
    const configure = plugin.configureServer as (server: ViteDevServer) => void;
    configure({ config: { root: directory }, middlewares: { use: (_path: string, next: Connect.NextHandleFunction) => { handler = next; } } } as unknown as ViteDevServer);
    const request = (body: Buffer, origin = 'http://127.0.0.1:8090', address = '127.0.0.1') => new Promise<{ status: number; body: Record<string, string> }>(resolve => {
      const stream = Readable.from([body]);
      Object.assign(stream, { method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'image/png' }, socket: { remoteAddress: address } });
      let status = 0;
      const response = { writeHead(value: number) { status = value; }, end(value: string) { resolve({ status, body: JSON.parse(value) }); } };
      handler(stream as IncomingMessage, response as unknown as ServerResponse, () => {});
    });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await request(png, 'https://unrelated.invalid')).status).toBe(403);
    expect((await request(png, 'http://127.0.0.1:8090', '192.0.2.1')).status).toBe(403);
    expect((await request(Buffer.from('not an image'))).status).toBe(400);
    expect((await request(Buffer.alloc(16 * 1024 * 1024 + 1))).status).toBe(413);
    const result = await request(png);
    expect(result.status).toBe(200);
    expect(result.body.path.startsWith(join(directory, 'build', 'dev-scenarios'))).toBe(true);
    expect(await readFile(result.body.path)).toEqual(png);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
