import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { BalanceConflict, BalanceFileStore } from './BalanceFileStore';

export function balanceEditorApi(root: string): Plugin {
  return {
    name: 'local-balance-editor', apply: 'serve',
    configureServer(server) {
      const token = randomBytes(32).toString('hex');
      const store = new BalanceFileStore(root, async () => await server.ssrLoadModule(resolve(root, 'tools/balance-editor/shared/content.ts')) as typeof import('../shared/content'));
      server.middlewares.use('/api/balance', (request, response) => {
        const send = (status: number, data: unknown) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
        void (async () => {
          const address = server.httpServer?.address();
          const port = typeof address === 'object' && address ? address.port : server.config.server.port;
          const host = `127.0.0.1:${port}`, origin = `http://${host}`;
          const remote = request.socket.remoteAddress;
          if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '') || request.headers.host !== host
            || (request.headers.origin && request.headers.origin !== origin)) return send(403, { error: 'Nur die lokale Editor-Origin ist erlaubt.' });
          const path = new URL(request.url ?? '/', origin).pathname;
          if (request.method === 'GET' && path === '/session') return send(200, { token });
          if (request.method === 'GET' && path === '/workspace') return send(200, await store.load());
          if (request.method !== 'POST' || !['/validate', '/save'].includes(path)) return send(404, { error: 'Unbekannter Balance-Endpunkt.' });
          if (request.headers.origin !== origin || request.headers['x-balance-editor-token'] !== token) return send(403, { error: 'Ungültige Editor-Sitzung.' });
          if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON erforderlich.' });
          const chunks: Buffer[] = []; let length = 0;
          for await (const chunk of request) {
            length += chunk.length;
            if (length > 4_000_000) return send(413, { error: 'Entwurf zu groß.' });
            chunks.push(Buffer.from(chunk));
          }
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (path === '/validate') {
            if (!Array.isArray(payload.drafts)) throw Error('Entwürfe fehlen.');
            return send(200, await store.validate(payload.drafts));
          }
          if (typeof payload.key !== 'string' || typeof payload.revision !== 'string' || !payload.document || Array.isArray(payload.document)) throw Error('Ungültiger Speicherauftrag.');
          return send(200, await store.save(payload.key, payload.revision, payload.document));
        })().catch(error => send(error instanceof BalanceConflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) }));
      });
    },
  };
}
