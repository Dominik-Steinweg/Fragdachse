import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connect, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { devScenarioArtifacts } from '../scripts/dev-scenario-artifacts';

it('accepts bounded loopback artifacts, restricts reports to the lab and owns every output path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fd-scenario-artifacts-'));
  try {
    const handlers=new Map<string,Connect.NextHandleFunction>();
    const plugin = devScenarioArtifacts();
    const configure = plugin.configureServer as (server: ViteDevServer) => void;
    configure({ config: { root: directory }, middlewares: { use: (path: string, next: Connect.NextHandleFunction) => { handlers.set(path,next); } } } as unknown as ViteDevServer);
    const request = (body: Buffer, origin = 'http://127.0.0.1:8090', address = '127.0.0.1',kind='capture',referer='http://127.0.0.1:8090/dev-scenario.html') => new Promise<{ status: number; body: Record<string, string> }>(resolve => {
      const stream = Readable.from([body]);
      Object.assign(stream, { method: 'POST', headers: { host: '127.0.0.1:8090', origin, referer,'content-type': kind==='capture'?'image/png':'application/json' }, socket: { remoteAddress: address } });
      let status = 0;
      const response = { writeHead(value: number) { status = value; }, end(value: string) { resolve({ status, body: JSON.parse(value) }); } };
      handlers.get(`/__dev-scenario-${kind}`)!(stream as IncomingMessage, response as unknown as ServerResponse, () => {});
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
    const snapshot={isolated:true,network:'local-only',state:'ready',config:{version:1},path:'../../outside.json',
      worldLightingMeasurement:{rawFrameIntervalsMs:[16,42,18]}};
    const json=Buffer.from(JSON.stringify(snapshot));
    const report=(body:Buffer,referer?:string)=>request(body,undefined,undefined,'report',referer);
    expect((await report(json,'http://127.0.0.1:8090/')).status).toBe(403);
    expect((await report(Buffer.from('{broken'))).status).toBe(400);
    expect((await report(Buffer.from('{}'))).status).toBe(400);
    expect((await report(Buffer.alloc(4*1024*1024+1))).status).toBe(413);
    const saved=await report(json);
    expect(saved.status).toBe(200);
    expect(saved.body.path.startsWith(join(directory,'build','dev-scenarios','report-'))).toBe(true);
    expect(saved.body.path.endsWith('.json')).toBe(true);
    expect(JSON.parse(await readFile(saved.body.path,'utf8'))).toEqual(snapshot);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
