// Cinematic capture harness: drives the dev scenario frame by frame with its own camera and clock,
// logs game sounds, and writes 4K masters (3840x2160) through ffmpeg.
import { chromium } from 'file:///C:/Fragdachse/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ROOT = 'C:/Fragdachse/output/trailer/pipeline-cine-2026-10';
const ORIGIN = 'http://127.0.0.1:8090';
export const FPS = 60;
// DRAFT=1: 1080p masters in masters-draft/ for fast choreography checks.
export const DRAFT = !!process.env.DRAFT;
export const MASTERS = `${ROOT}/${DRAFT ? 'masters-draft' : 'masters'}`;

export async function open(scenario, { dpr = DRAFT ? 1 : 2, headless = true } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless, args: ['--use-angle=d3d11', '--enable-gpu',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  page.setDefaultTimeout(300000);
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)));
  await page.addInitScript(() => performance.setResourceTimingBufferSize(20000));
  // Isolated from Vite HMR and the PeerJS broker.
  await page.routeWebSocket(/.*/, ws => ws.close());
  await page.goto(`${ORIGIN}/dev-scenario.html#scenario=${encodeURIComponent(JSON.stringify(scenario))}`);
  await page.waitForFunction(() => window.devScenario?.status().ready);
  await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important}' });
  await run(page, { action: 'pause' });
  await install(page);
  return { browser, page };
}

export async function run(page, command) {
  const r = await page.evaluate(c => { const r = window.devScenario.run(c); return r && typeof r.then === 'function'
    ? r.then(x => ({ ok: x.ok, error: x.error })) : { ok: r.ok, error: r.error }; }, command);
  if (!r.ok) throw Error(`${JSON.stringify(command)}: ${r.error}`);
}
export const status = page => page.evaluate(() => window.devScenario.status());
export const waitReady = page => page.waitForFunction(() => window.devScenario.status().ready);

async function install(page) {
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').map(e => e.name);
    const mod = file => import(loaded.find(n => n.includes('/src/' + file)) ?? '/@fs/C:/Fragdachse/src/' + file);
    const game = (await mod('graphics/RenderResolution.ts')).getRenderResolutionController().game;
    const { getVisibleWorldView } = await mod('graphics/CameraWorldView.ts');
    const { setCameraBaseScroll } = await mod('graphics/cameraBaseScroll.ts');
    const scene = game.scene.getScene('ArenaScene'), dev = scene.devScenario;
    const C = window.__C = { game, scene, dev, cam: null, sounds: [], recording: false, t0: 0 };
    // Cinematic camera: owns centre and zoom whenever C.cam is set; game shake/feedback still applies on top.
    const sync = dev.syncCamera.bind(dev);
    dev.syncCamera = function () {
      const c = C.cam;
      if (!c || this.state !== 'ready') return sync();
      const camera = scene.cameras.main;
      camera.removeBounds(); camera.stopFollow();
      camera.setZoom(scene.scale.width / 1920 * c.zoom, scene.scale.height / 1080 * c.zoom);
      const view = getVisibleWorldView(camera);
      camera.setScroll(camera.scrollX + c.x - view.centerX, camera.scrollY + c.y - view.centerY);
      setCameraBaseScroll(scene, camera.scrollX, camera.scrollY);
    };
    // Clock: arbitrary dt per frame (slow motion and speed ramps).
    C.advance = dt => {
      const k = dev.clock; k.paused = true; k.elapsed += dt;
      k.simulationTime = (k.simulationTime ?? 0) + dt; k.original(k.simulationTime, dt);
    };
    C.now = () => dev.clock.elapsed;
    C.player = () => dev.runtime.navigationLabPort.getPlayerPosition();
    C.kraken = () => { const r = dev.runtime.getScenarioKrakenResidency(); return r?.hostPosition ? { ...r.hostPosition, phase: r.state?.phase?.kind } : null; };
    C.bridge = (await mod('network/bridge.ts')).bridge;
    C.world = g => dev.world(g);
    // Sound log for the offline mix (times in simulation ms relative to the shot start).
    const sm = game.sound;
    if (!sm.__cine) {
      sm.__cine = true;
      const add = sm.add;
      sm.add = function (key, config) {
        const s = add.call(this, key, config), id = C.sounds.length + Math.random();
        const log = e => { if (C.recording) C.sounds.push({ ...e, id, key, t: C.now() - C.t0 }); };
        const play = s.play, stop = s.stop, destroy = s.destroy;
        s.play = function (...a) { const r = play.apply(this, a); log({ e: 'play', v: this.volume, pan: this.pan ?? 0, loop: !!this.loop, rate: this.rate ?? 1 }); return r; };
        s.stop = function (...a) { log({ e: 'stop' }); return stop.apply(this, a); };
        s.destroy = function (...a) { log({ e: 'stop' }); return destroy.apply(this, a); };
        return s;
      };
    }
    // Clean hits (C.cleanHits): no blood clouds or "KRIT!" labels on the boss; tracers, flashes and sounds stay.
    const fx = scene.ctx?.effectSystem;
    if (fx && !fx.__cine) {
      fx.__cine = true;
      const hit = fx.playHitEffect.bind(fx);
      fx.playHitEffect = effect => { if (!C.cleanHits) hit(effect); };
    }
    scene.clarityCamera?.setVisible(false); // no HUD; titles are added in post
    scene.events.on('prerender', () => { if (!C.showRing) scene.playerStatusRing?.container?.setVisible(false); });
  });
}

export const camera = (page, c) => page.evaluate(c => { window.__C.cam = c; }, c);
export const krakenPos = page => page.evaluate(() => window.__C.kraken());
export const playerPos = page => page.evaluate(() => window.__C.player());
/** Critically damped follow for camera targets (node side). */
export function follower(k = .08) {
  let cur = null;
  return target => { if (!cur) cur = { ...target }; else for (const key of Object.keys(target)) cur[key] += (target[key] - cur[key]) * k; return { ...cur }; };
}
export const hud = (page, visible) => page.evaluate(v => window.__C.scene.clarityCamera?.setVisible(v), visible);

/** Advances n frames of dt ms each, then waits until the result is presented. */
export async function step(page, n = 1, dt = 1000 / FPS) {
  await page.evaluate(async ([n, dt]) => {
    const C = window.__C;
    await new Promise(r => requestAnimationFrame(() => { for (let i = 0; i < n; i++) C.advance(dt); r(); }));
    await new Promise(r => requestAnimationFrame(r));
  }, [n, dt]);
}
/** Steps until predicate(status) holds (max frames). */
export async function until(page, predicate, max = 900, chunk = 2) {
  for (let i = 0; i < max; i += chunk) { const s = await status(page); if (predicate(s)) return s; await step(page, chunk); }
  throw Error('until: condition not reached');
}

function writer(out) {
  mkdirSync(dirname(out), { recursive: true });
  const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => p.on('exit', c => c === 0 ? res() : rej(Error('ffmpeg ' + c))));
  return { write: b => new Promise(r => p.stdin.write(b) ? r() : p.stdin.once('drain', r)), close: () => { p.stdin.end(); return done; } };
}

/**
 * Records `frames` frames. shot.frame(f) runs before each frame and returns {cam, dt?};
 * dt defaults to real time. Masters are 4K; sound events and per-frame sim times are saved alongside.
 */
export async function record(page, name, frames, frame) {
  const out = `${MASTERS}/${name}.mp4`, w = writer(out), t = Date.now(), sim = [];
  await page.evaluate(() => { const C = window.__C; C.sounds = []; C.t0 = C.now(); C.recording = true; });
  let s = 0;
  for (let f = 0; f < frames; f++) {
    const r = (await frame(f)) ?? {};
    if (r.cam) await camera(page, r.cam);
    const dt = r.dt ?? 1000 / FPS;
    await step(page, 1, dt); s += dt; sim.push(+s.toFixed(3));
    await w.write(await page.screenshot({ type: 'jpeg', quality: 95 }));
    if (f % 60 === 0) console.log(`  ${name} ${f}/${frames} ${((Date.now() - t) / (f + 1)).toFixed(0)} ms/frame`);
  }
  await w.close();
  const sounds = await page.evaluate(() => { const C = window.__C; C.recording = false; return C.sounds; });
  writeFileSync(`${MASTERS}/${name}.json`, JSON.stringify({ frames, fps: FPS, sim, sounds }));
  console.log(`  recorded ${name} (${frames} f) in ${((Date.now() - t) / 1000).toFixed(0)} s, ${sounds.length} sounds`);
}

// Keyframed camera paths: keys [[frame, {x, y, zoom}], ...] with smooth in/out easing per segment.
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
export function path(keys, f, ease = smooth) {
  if (f <= keys[0][0]) return { ...keys[0][1] };
  for (let i = 1; i < keys.length; i++) if (f <= keys[i][0]) {
    const [f0, a] = keys[i - 1], [f1, b] = keys[i], k = ease((f - f0) / (f1 - f0));
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, zoom: a.zoom + (b.zoom - a.zoom) * k };
  }
  return { ...keys[keys.length - 1][1] };
}
/** Speed ramp: piecewise time scale [[frame, scale], ...] linearly interpolated. */
export function ramp(keys, f) {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (f <= keys[i][0]) {
    const [f0, a] = keys[i - 1], [f1, b] = keys[i]; return a + (b - a) * (f - f0) / (f1 - f0);
  }
  return keys[keys.length - 1][1];
}
/** Subtle handheld drift (deterministic). */
export const drift = (f, amp = 6) => ({ x: Math.sin(f * .031) * amp + Math.sin(f * .017 + 1.3) * amp * .6,
  y: Math.cos(f * .027 + .4) * amp * .7 + Math.sin(f * .013) * amp * .5 });
