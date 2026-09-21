import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import sources from '../../../src/config/coopDefenseMapSources.json';
import { MapFileStore, FileConflict } from './MapFileStore';

export function mapEditorApi(projectRoot: string): Plugin {
  return {
    name: 'local-map-editor',
    configureServer(server) {
      const token = randomBytes(32).toString('hex');
      const store = new MapFileStore(resolve(projectRoot, 'src/config/coopDefenseMaps'), sources.maps, async draft => {
        const rules = await server.ssrLoadModule(resolve(projectRoot, 'tools/map-editor/shared/validation.ts'));
        return rules.validateDocument(draft);
      }, undefined, async (before, after) => {
        // Use the live module graph, just like validation; the config bundle can retain old rules.
        const policy = await server.ssrLoadModule(resolve(projectRoot, 'tools/map-editor/shared/editPolicy.ts'));
        policy.assertSupportedMapEdit(before, after);
      });
      server.middlewares.use('/api/', (request, response) => {
        const send = (status: number, data: unknown) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
        void (async () => {
          const address = server.httpServer?.address();
          const port = typeof address === 'object' && address ? address.port : server.config.server.port;
          const host = `127.0.0.1:${port}`;
          if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== `http://${host}`)) return send(403, { error: 'Nur die lokale Editor-Origin ist erlaubt.' });
          const url = new URL(request.url ?? '', `http://${host}`);
          if (request.method === 'GET' && url.pathname === '/session') return send(200, { token });
          if (request.method === 'GET' && url.pathname === '/maps') return send(200, sources.maps);
          const key = url.pathname.startsWith('/maps/') ? decodeURIComponent(url.pathname.slice(6)) : '';
          if (!sources.maps.some(s => s.file === key)) return send(404, { error: 'Unbekannte Map.' });
          if (request.method === 'GET') return send(200, await store.load(key));
          if (request.method !== 'PUT') return send(405, { error: 'Methode nicht erlaubt.' });
          if (request.headers['x-map-editor-token'] !== token || request.headers.origin !== `http://${host}`) return send(403, { error: 'Ungültige Editor-Sitzung.' });
          if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON erforderlich.' });
          const chunks: Buffer[] = []; let length = 0;
          for await (const chunk of request) { length += chunk.length; if (length > 8_000_000) throw Error('Entwurf zu groß.'); chunks.push(Buffer.from(chunk)); }
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof payload.revision !== 'string' || !payload.document || typeof payload.document !== 'object' || Array.isArray(payload.document)) throw Error('Ungültiger Speicherauftrag.');
          send(200, await store.save(key, payload.revision, payload.document));
        })().catch(error => send(error instanceof FileConflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) }));
      });
    },
  };
}
