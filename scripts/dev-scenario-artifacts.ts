import type { Plugin } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Dev server only: fixed output directory, PNG only, no caller-supplied filesystem paths. */
export function devScenarioArtifacts(): Plugin {
  return { name: 'local-dev-scenario-artifacts', apply: 'serve', configureServer(server) {
    server.middlewares.use('/__dev-scenario-capture', (request, response) => {
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
      };
      const address = request.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')
        || request.headers.origin !== `http://${request.headers.host}`) { send(403, { error: 'Local same-origin request required.' }); return; }
      if (request.method !== 'POST' || request.headers['content-type'] !== 'image/png') { send(400, { error: 'PNG POST required.' }); return; }
      const chunks: Buffer[] = []; let size = 0, tooLarge = false;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) { tooLarge = true; chunks.length = 0; }
        else if (!tooLarge) chunks.push(chunk);
      });
      request.on('end', () => {
        void (async () => {
          if (tooLarge) { send(413, { error: 'PNG exceeds 16 MiB.' }); return; }
          const png = Buffer.concat(chunks);
          if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { send(400, { error: 'Invalid PNG signature.' }); return; }
          const directory = resolve(server.config.root, 'build/dev-scenarios');
          const name = `capture-${randomUUID()}.png`;
          await mkdir(directory, { recursive: true });
          const path = resolve(directory, name);
          await writeFile(path, png, { flag: 'wx' });
          send(200, { path, url: `/build/dev-scenarios/${name}` });
        })().catch(error => send(500, { error: String(error) }));
      });
    });
  } };
}
