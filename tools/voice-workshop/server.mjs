import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Workshop } from './workshop.mjs';
import { VoxGenerator } from './generator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function createWorkshopServer({ port = 8092, root = process.env.VOICE_WORKSPACE ?? path.join(here, '.voice-workspace'), generator,
  gameVoiceRoot = path.resolve(here, '../../src/voice/bundled') } = {}) {
  const resolved = path.resolve(root);
  for (const publicRoot of [path.resolve(here, '../../public'), path.join(here, 'dist'), path.join(here, 'frontend')]) {
    if (resolved === publicRoot || resolved.startsWith(publicRoot + path.sep)) throw new Error('Privater Arbeitsbereich darf nicht öffentlich ausgeliefert werden.');
  }
  let config = {};
  try { config = JSON.parse(await readFile(path.join(resolved, 'local-config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Lokale Werkstatt-Konfiguration ist ungültig. local-config.json prüfen.'); }
  if (!process.env.VOICE_FFMPEG && config.ffmpeg) process.env.VOICE_FFMPEG = config.ffmpeg;
  const workshop = new Workshop(root, generator ?? new VoxGenerator({
    url: process.env.VOICE_COMFY_URL ?? config.comfyUrl,
    inputRoot: process.env.VOICE_COMFY_INPUT ?? config.comfyInput,
    outputRoot: process.env.VOICE_COMFY_OUTPUT ?? config.comfyOutput,
  }), { gameVoiceRoot }); await workshop.initialize();
  const token = randomBytes(32).toString('hex');
  let serial = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    const actualPort = server.address().port;
    const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    const origin = `http://${req.headers.host}`;
    const reply = (status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
    if (!hosts.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== origin)
      || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return reply(403, { error: 'Nur lokale Werkstattzugriffe erlaubt.' });
    const url = new URL(req.url, origin);
    const authorized = req.headers['x-voice-token'] === token || (url.pathname.startsWith('/media/') && url.searchParams.get('token') === token);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
        if (!authorized) return reply(403, { error: 'Werkstattsitzung fehlt. Seite neu laden.' });
        if (req.method === 'GET' && url.pathname === '/api/state') return reply(200, workshop.view());
        if (req.method === 'GET' && url.pathname === '/api/generator') {
          try { return reply(200, { ok: true, ...await workshop.generator.preflight() }); }
          catch (error) { return reply(200, { ok: false, message: error.message }); }
        }
        if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
          const name = url.pathname.slice(7);
          return reply(200, await readFile(workshop.file(name)), name.endsWith('.ogg') ? 'audio/ogg' : name.endsWith('.flac') ? 'audio/flac' : 'audio/wav');
        }
        if (req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: 'Ungültiger Werkstattauftrag.' });
        let body = ''; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 42 * 1024 * 1024) return reply(413, { error: 'Datei zu groß.' }); body += chunk; }
        const data = JSON.parse(body);
        if (url.pathname === '/api/export') return reply(200, await workshop.bundle(data.checksums));
        if (url.pathname === '/api/summary') return reply(200, workshop.releaseSummary(data.voiceId));
        if (url.pathname === '/api/shutdown') {
          workshop.paused = true; reply(200, { stopped: true }); server.close(); return;
        }
        const action = url.pathname.slice('/api/'.length);
        const pending = serial.then(() => workshop.action(action, data)); serial = pending.catch(() => {});
        return reply(200, await pending);
      }
      if (req.method !== 'GET') return reply(405, { error: 'Nicht erlaubt.' });
      if (url.pathname === '/') {
        const html = (await readFile(path.join(here, 'dist/index.html'), 'utf8')).replace('VOICE_SESSION_TOKEN', token);
        return reply(200, html, 'text/html; charset=utf-8');
      }
      if (/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname)) return reply(200,
        await readFile(path.join(here, 'dist', url.pathname.slice(1))), url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
      reply(404, { error: 'Nicht gefunden.' });
    } catch (error) { reply(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, workshop, token };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createWorkshopServer({ port: Number(process.env.VOICE_PORT ?? 8092) });
  console.log(`Voice-Werkstatt: http://127.0.0.1:${server.address().port} – Produktion zunächst pausiert. Strg+C beendet den Dienst.`);
}
