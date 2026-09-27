// Trailer capture harness: drives the dev-scenario page frame-by-frame and pipes frames into ffmpeg.
import { chromium } from 'file:///C:/Fragdachse/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const BASE = 'http://127.0.0.1:8090/dev-scenario.html';

export async function openGame({ dpr = 2, width = 1920, height = 1080, headless = true } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
      '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) console.log('[console.error]', m.text().slice(0, 300)); });
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.devScenario, null, { timeout: 180000 });
  await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important}' });
  return { browser, page };
}

/** Starts a scenario and installs camera/HUD/sound hooks. */
export async function startScenario(page, scenario) {
  const r = await page.evaluate(async (scenario) => {
    const dev = window.devScenario;
    const res = dev.run({ action: 'start', scenario });
    if (!res.ok) return res;
    return await dev.whenReady();
  }, scenario);
  if (!r.ok) throw new Error('scenario failed: ' + r.error);
  await installHooks(page);
  return r.status;
}

export async function installHooks(page) {
  await page.evaluate(async () => {
    // Import the exact module instances the game loaded (Vite may serve them via /@fs/ with ?t= stamps).
    const loaded = performance.getEntriesByType('resource').map(e => e.name);
    const mod = (file) => import(loaded.find(n => n.includes('/src/' + file)) ?? '/@fs/C:/Fragdachse/src/' + file);
    const rr = await mod('graphics/RenderResolution.ts');
    const cbs = await mod('graphics/cameraBaseScroll.ts');
    const audio = await mod('audio/AudioCatalog.ts');
    const { bridge } = await mod('network/bridge.ts');
    const { UTILITY_CONFIGS } = await mod('loadout/LoadoutConfig.ts');
    const game = rr.getRenderResolutionController().game;
    const scene = game.scene.getScene('ArenaScene');
    const dev = scene.devScenario;
    if (!dev) throw new Error('no dev controller');
    const prev = window.__T;
    const T = window.__T = {
      game, scene, dev, audioAssets: audio.AUDIO_ASSETS,
      cam: { follow: true, x: 0, y: 0, zoom: 1, ox: 0, oy: 0, smooth: 0 },
      cur: null, lastCamT: -1,
      sounds: prev?.sounds ?? [], soundId: prev?.soundId ?? 0, soundBase: 0,
    };
    // Pickup-only utilities (NUKE, HOLY_HAND_GRENADE, BFG …): grant as temporary utility and use it.
    T.bridge = bridge;
    T.startTemp = (utilityId) => {
      const wr = dev.runtime.flow.getWorldRuntime();
      const binding = wr.worldScopedBindings.find(b => b && typeof b.addTemporaryUtility === 'function');
      const pid = bridge.getLocalPlayerId();
      const instanceId = binding.addTemporaryUtility(pid, UTILITY_CONFIGS[utilityId], 1);
      if (!instanceId) return { ok: false, reason: 'grant failed' };
      const cfg = dev.runtime.rpcPorts.playerLoadout.getTemporaryUtilityConfig(pid, instanceId);
      T.temp = { instanceId, heldId: undefined };
      const type = cfg.activation.type;
      if (type === 'charged_throw' || type === 'charged_gate' || type === 'charged_alternate') {
        T.temp.heldId = `trailer:${Math.random()}`;
        const ok = dev.runtime.rpcPorts.playerLoadout.startUtilityHeldAction(pid, T.temp.heldId, type, bridge.getSynchronizedNow(), undefined, instanceId);
        return { ok, charged: true, full: cfg.activation.fullChargeDuration };
      }
      return { ok: true, charged: false };
    };
    T.releaseTemp = () => {
      const pid = bridge.getLocalPlayerId();
      const target = dev.world(dev.aim), player = dev.runtime.navigationLabPort.getPlayerPosition();
      const r = dev.runtime.rpcPorts.playerLoadout.usePlayerAction({ category: 'utility', playerId: pid,
        angle: Math.atan2(target.y - player.y, target.x - player.x), targetX: target.x, targetY: target.y,
        hostNowMs: bridge.getSynchronizedNow(), source: { kind: 'temporary', instanceId: T.temp.instanceId },
        params: { heldActionId: T.temp.heldId, temporaryUtilityInstanceId: T.temp.instanceId } });
      return { ok: r?.ok, reason: r?.reason };
    };
    // Manual simulation advance with arbitrary dt (slow motion); mirrors ScenarioClock's callback.
    T.advance = (dt) => {
      const c = dev.clock;
      c.paused = true;
      c.elapsed += dt;
      c.simulationTime = (c.simulationTime ?? performance.now()) + dt;
      c.original(c.simulationTime, dt);
    };
    // Lobby/free camera: applied right before rendering so it wins over any scene camera logic.
    T.lobbyCam = null;
    scene.events.on('prerender', () => {
      const c = T.lobbyCam; if (!c) return;
      const camera = scene.cameras.main;
      camera.removeBounds();
      camera.setZoom(scene.scale.width / 1920 * c.zoom, scene.scale.height / 1080 * c.zoom);
      camera.setScroll(c.x - 1920 / c.zoom / 2, c.y - 1080 / c.zoom / 2);
    });
    // ── Camera override (replaces the dev "center on player" camera) ──
    dev.syncCamera = function () {
      if (this.state !== 'ready') return;
      const c = T.cam;
      let tx, ty;
      if (c.follow) {
        const p = this.runtime.navigationLabPort.getPlayerPosition();
        if (!p) return;
        tx = p.x + c.ox; ty = p.y + c.oy;
      } else { tx = c.x; ty = c.y; }
      const now = dev.clock.now;
      if (!T.cur || c.smooth <= 0) T.cur = { x: tx, y: ty };
      else if (now !== T.lastCamT) { T.cur.x += (tx - T.cur.x) * c.smooth; T.cur.y += (ty - T.cur.y) * c.smooth; }
      T.lastCamT = now;
      const camera = scene.cameras.main;
      camera.removeBounds();
      const z = c.zoom;
      camera.setZoom(scene.scale.width / 1920 * z, scene.scale.height / 1080 * z);
      camera.setScroll(T.cur.x - 1920 / z / 2, T.cur.y - 1080 / z / 2);
      cbs.setCameraBaseScroll(scene, camera.scrollX, camera.scrollY);
    };
    // ── Sound event log (wrap every Phaser sound instance once) ──
    const sm = game.sound;
    if (!sm.__trailerWrapped) {
      sm.__trailerWrapped = true;
      const origAdd = sm.add;
      const findDesc = (obj, name) => { for (let o = obj; o; o = Object.getPrototypeOf(o)) { const d = Object.getOwnPropertyDescriptor(o, name); if (d) return d; } return null; };
      sm.add = function (key, config) {
        const s = origAdd.call(this, key, config);
        const id = ++window.__T.soundId;
        const log = (ev) => { const W = window.__T; if (W.recording) W.sounds.push({ ...ev, id, key, t: W.dev.clock.now - W.soundBase }); };
        const origPlay = s.play, origStop = s.stop, origDestroy = s.destroy;
        s.play = function (...args) {
          const r = origPlay.apply(this, args);
          log({ e: 'play', v: this.volume, pan: this.pan ?? 0, loop: !!this.loop, rate: this.rate ?? 1, detune: this.detune ?? 0 });
          return r;
        };
        s.stop = function (...a) { log({ e: 'stop' }); return origStop.apply(this, a); };
        s.destroy = function (...a) { log({ e: 'stop' }); return origDestroy.apply(this, a); };
        for (const prop of ['volume', 'pan', 'rate', 'detune']) {
          const d = findDesc(s, prop);
          if (!d || !d.set) continue;
          Object.defineProperty(s, prop, { configurable: true, get() { return d.get.call(this); },
            set(v) { d.set.call(this, v); if (this.isPlaying) log({ e: 'set', prop, val: v }); } });
        }
        return s;
      };
    }
  });
}

/** Page-side helpers. */
export const cam = (page, values) => page.evaluate(v => Object.assign(window.__T.cam, v), values);
export const cmd = async (page, command) => {
  const r = await page.evaluate(c => { const r = window.devScenario.run(c); return { ok: r.ok, error: r.error, last: r.status?.lastAction }; }, command);
  if (!r.ok) console.log('  cmd failed', JSON.stringify(command), r.error);
  return r;
};
export const hud = (page, visible) => page.evaluate(v => { const c = window.__T.scene.clarityCamera; if (c) c.setVisible(v); }, visible);
export const status = page => page.evaluate(() => window.devScenario.status());

/** Advance the paused simulation by n frames of dt ms each and wait until the last one is presented. */
export async function stepFrames(page, n = 1, dt = 1000 / 60) {
  await page.evaluate(async ([n, dt]) => {
    const T = window.__T;
    await new Promise(res => requestAnimationFrame(() => { for (let i = 0; i < n; i++) T.advance(dt); res(); }));
    await new Promise(res => requestAnimationFrame(() => res()));
  }, [n, dt]);
}

/** Run the simulation (paused-stepping) for a number of frames without capturing. */
export async function warmup(page, frames, onFrame) {
  for (let f = 0; f < frames; f += 1) {
    if (onFrame) await onFrame(f);
    await stepFrames(page, 1);
  }
}

export function ffmpegWriter(outPath, { fps = 60, inputCodec = 'mjpeg', crf = 10, native = false } = {}) {
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', inputCodec, '-i', '-',
    ...(native ? [] : ['-vf', 'scale=1920:1080:flags=lanczos']), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-r', String(fps), outPath];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => proc.on('exit', code => code === 0 ? res() : rej(new Error('ffmpeg ' + code))));
  return {
    write: buf => new Promise(res => { if (!proc.stdin.write(buf)) proc.stdin.once('drain', res); else res(); }),
    close: async () => { proc.stdin.end(); await done; },
  };
}

/**
 * Records a shot. `timeline(frame, page)` runs before each frame is stepped.
 * Sound events are stored relative to the first recorded frame.
 */
export async function recordShot(page, { out, frames, timeline, speed = () => 1, format = 'jpeg', quality = 93, native = false }) {
  await mkdir(dirname(out), { recursive: true });
  await page.evaluate(() => { const T = window.__T; T.sounds = []; T.soundBase = T.dev.clock.now; T.recording = true; });
  const writer = ffmpegWriter(out, { inputCodec: format === 'png' ? 'png' : 'mjpeg', native, crf: native ? 12 : 10 });
  const t0 = Date.now();
  const simTimes = []; let sim = 0;
  for (let f = 0; f < frames; f += 1) {
    if (timeline) await timeline(f, page);
    const dt = 1000 / 60 * speed(f);
    await stepFrames(page, 1, dt);
    sim += dt; simTimes.push(sim);
    const buf = await page.screenshot({ type: format, ...(format === 'jpeg' ? { quality } : {}) });
    await writer.write(buf);
    if (f % 60 === 0) process.stdout.write(`  frame ${f}/${frames} (${((Date.now() - t0) / (f + 1)).toFixed(0)} ms/frame)\n`);
  }
  await writer.close();
  const sounds = await page.evaluate(() => { const T = window.__T; T.recording = false; return { events: T.sounds, assets: T.audioAssets }; });
  await writeFile(out.replace(/\.mp4$/, '.sounds.json'), JSON.stringify({ frames, fps: 60, simTimes, ...sounds }));
  console.log(`  recorded ${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${sounds.events.length} sound events`);
}

/** Frame-based keyframe helpers. */
export const ease = {
  linear: t => t,
  inOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
};
export function lerpKeys(keys, f, e = ease.inOut) {
  // keys: [[frame, value], ...] sorted
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (f <= keys[i][0]) {
      const [f0, v0] = keys[i - 1], [f1, v1] = keys[i];
      const t = e((f - f0) / (f1 - f0));
      return v0 + (v1 - v0) * t;
    }
  }
  return keys[keys.length - 1][1];
}
