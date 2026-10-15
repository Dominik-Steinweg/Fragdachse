#!/usr/bin/env node
// Fragdachse capture kit: labelled day/night boards of a dev scenario in one command.
// node tools/capture-kit/capture.mjs <spec.json> [--root <worktree>] [--port <n>] [--out <dir>]
//   [--layout 0,4] [--time day,night] [--headed] [--keep-going]
// See README.md next to this file for the spec format.
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const kitDir = dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = name => argv.includes(name);
const known = new Set(['--root', '--port', '--out', '--layout', '--time', '--headed', '--keep-going', '--help', '--probe', '--fresh-tabs']);
const valued = new Set(['--root', '--port', '--out', '--layout', '--time', '--probe']);
let specPath;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { if (!known.has(a)) throw Error(`Unknown flag ${a}`); if (valued.has(a)) i++; }
  else if (!specPath) specPath = a; else throw Error(`Unexpected argument ${a}`);
}
const probeMap = flag('--probe');
if (has('--help') || (!specPath && !probeMap)) {
  console.log('node tools/capture-kit/capture.mjs <spec.json> [--root <worktree>] [--port <n>] [--out <dir>] [--layout id,..] [--time id,..] [--headed] [--keep-going] [--fresh-tabs]');
  console.log('node tools/capture-kit/capture.mjs --probe <mapId>   # free-cell ASCII map + gridded overview for choosing positions');
  console.log('Port: --port, else CAPTURE_PORT, else the worktree\'s registry port (npm run worktree:new), else the first free port from 8098.');
  process.exit(has('--help') ? 0 : 1);
}
const root = resolve(flag('--root') ?? join(kitDir, '..', '..'));
if (!existsSync(join(root, 'dev-scenario.html'))) throw Error(`${root} is not a Fragdachse checkout (dev-scenario.html missing)`);
const port = await choosePort();
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('--port: 1024..65535');
if (port === 8090) throw Error('Port 8090 is reserved for a foreign process; choose another port.');

/** --port / CAPTURE_PORT win; else the registry port of the captured worktree; else the first free port from 8098. */
async function choosePort() {
  const explicit = flag('--port') ?? process.env.CAPTURE_PORT;
  if (explicit) return Number(explicit);
  let ports = null; // the registry helper is missing on branches older than the versioned kit
  for (const lib of [join(root, 'scripts/lib/worktree-ports.mjs'), join(kitDir, '../../scripts/lib/worktree-ports.mjs')]) {
    if (existsSync(lib)) { ports = await import(pathToFileURL(lib).href); break; }
  }
  const registered = ports?.portOf(root, root);
  if (registered) { console.log(`port ${registered} from the worktree registry`); return registered; }
  const { createServer: createNetServer } = await import('node:net');
  const free = ports?.isPortFree ?? (p => new Promise(done => { const s = createNetServer().once('error', () => done(false)); s.listen({ host: '127.0.0.1', port: p, exclusive: true }, () => s.close(() => done(true))); }));
  for (let p = 8098; p < 8200; p++) if (await free(p)) return p;
  throw Error('No free port in 8098..8199; pass --port');
}

// Resolve tooling from the target worktree so --root works for any checkout.
const requireRoot = createRequire(join(root, 'package.json'));
/** ESM entry of a package in the target worktree (honours package.json "exports"). */
const importEsm = async name => {
  const pkgPath = requireRoot.resolve(`${name}/package.json`), pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  let entry = pkg.exports?.['.'] ?? pkg.module ?? pkg.main;
  while (entry && typeof entry === 'object') entry = entry.import ?? entry.default;
  return import(pathToFileURL(join(dirname(pkgPath), entry)).href);
};
const { chromium } = requireRoot('playwright-core');
const sharp = requireRoot('sharp');
const { createServer } = await importEsm('vite');

// ---------- spec ----------
const spec = probeMap !== undefined ? {
  name: `probe-map${probeMap}`, hud: false, board: { columns: 1, tileWidth: 1280 },
  scenario: { mapId: probeMap, player: null }, layouts: [{ id: `map${probeMap}` }], times: [{ id: 'day', timeOfDay: 720 }],
  shots: [{ id: 'overview', label: 'overview (grid lines every 5 cells; see freemap txt)', do: [{ op: 'probe' }] }],
} : JSON.parse(await readFile(resolve(specPath), 'utf8'));
const specName = spec.name ?? basename(specPath, '.json');
const viewport = { width: 1280, height: 720, ...spec.viewport };
const board = { columns: 3, tileWidth: 640, ...spec.board };
const times = spec.times ?? [{ id: 'day', timeOfDay: 720 }];
const layouts = spec.layouts ?? [{ id: String(spec.scenario?.mapId ?? 'default') }];
const pick = (list, csv) => !csv ? list : list.filter(x => csv.split(',').includes(String(x.id)));
const variants = [];
for (const layout of pick(layouts, flag('--layout'))) for (const time of pick(times, flag('--time'))) {
  variants.push({ id: `${layout.id}-${time.id}`, layout, time });
}
if (!variants.length) throw Error('No variant selected (check --layout/--time ids)');
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "$name" strings (whole value) are replaced by layout.vars[name]; works at any depth. */
const subst = (value, vars) => {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1);
    if (!(key in vars)) throw Error(`Unknown variable ${value}`);
    return structuredClone(vars[key]);
  }
  if (Array.isArray(value)) return value.map(v => subst(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, subst(v, vars)]));
  return value;
};

// ---------- output ----------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
// Output and the disposable profile stay in the captured checkout's ignored build/ folder.
const outDir = join(resolve(flag('--out') ?? process.env.CAPTURE_OUT ?? join(root, 'build/capture-kit/out')), specName, stamp);
await mkdir(outDir, { recursive: true });
const tmpRoot = join(root, 'build/capture-kit/.tmp');
await mkdir(tmpRoot, { recursive: true });
let commit = null;
try { commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
let dirty = null;
try { dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', 'src', 'public'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch {}
const log = { spec: specName, specPath: specPath ? resolve(specPath) : `--probe ${probeMap}`, root, port, commit, dirtySrcFiles: dirty, viewport,
  startedAt: new Date(started).toISOString(), browser: null, renderer: null, variants: [], errors: [], timings: {} };

// ---------- lifecycle ----------
let server = null, context = null, profileDir = null, closed = false;
const shutdown = async () => {
  if (closed) return; closed = true;
  await context?.close().catch(e => console.error('chrome close:', e.message));
  await server?.close().catch(e => console.error('vite close:', e.message));
  if (profileDir) await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(e => console.error('profile cleanup:', e.message));
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.once(signal, () => { void shutdown().finally(() => process.exit(130)); });
const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');

// ---------- page-side kit (installed after the scenario is ready) ----------
async function installKit(page) {
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').map(e => e.name);
    // Import the exact module instances the game loaded (same URL => same singleton).
    const mod = file => {
      const url = loaded.find(n => new URL(n).pathname === '/src/' + file);
      if (!url) throw Error(`module /src/${file} not loaded by the page`);
      return import(url);
    };
    const { getRenderResolutionController } = await mod('graphics/RenderResolution.ts');
    const { bridge } = await mod('network/bridge.ts');
    const game = getRenderResolutionController()?.game;
    const scene = game?.scene.getScene('ArenaScene');
    const dev = scene?.devScenario;
    if (!dev) throw Error('ArenaScene.devScenario not found (API drift?)');
    const ck = window.__ck = { game, scene, dev, bridge, names: {}, warnings: [], explosions: [], markSim: 0 };
    // Read-only event log: every presented explosion (combo, mortar impact, ...) with its style.
    const { EffectSystem } = await mod('effects/EffectSystem.ts');
    const proto = EffectSystem.prototype;
    if (!proto.__ckWrapped) {
      const original = proto.playExplosionEffect;
      proto.playExplosionEffect = function (x, y, radius, color, visualStyle = 'default', ...rest) {
        const k = window.__ck;
        if (k) k.explosions.push({ x, y, radius, style: visualStyle, simulationMs: k.dev.clock.now, grid: k.dev.grid({ x, y }) });
        return original.call(this, x, y, radius, color, visualStyle, ...rest);
      };
      proto.__ckWrapped = true;
    }
    const mission = () => dev.runtime.flow.getCoopMissionRuntime();
    ck.world = p => { const m = dev.runtime.getWorldMetrics(); return { x: m.offsetX + p.gridX * 32 + 16, y: m.offsetY + p.gridY * 32 + 16 }; };
    ck.grid = p => dev.grid(p);
    ck.timeOfDay = () => { try { return dev.runtime.getCurrentTimeOfDayMinutes(); } catch { return null; } };
    ck.host = () => {
      const m = mission(), mgr = m?.enemyManager, now = bridge.getSynchronizedNow();
      const nameOf = Object.fromEntries(Object.entries(ck.names).map(([k, v]) => [v, k]));
      const firestarter = {};
      const fsys = m?.coopDefenseFirestarterSystem;
      for (const [id, s] of fsys?.states ?? []) {
        firestarter[id] = { lance: s.lance, committed: s.committed, lastAttack: s.lastAttack, lastAttackAt: s.lastAttackAt,
          lanceReadyAt: s.lanceReadyAt, ballReadyAt: s.ballReadyAt, charges: s.charges?.getSnapshot?.(now) ?? null };
      }
      const mortarStrikes = m?.getMortarSnapshot?.() ?? [];
      const enemies = (mgr?.getAllEnemies() ?? []).map(e => {
        const snap = e.getNetSnapshot();
        return { ...snap, name: nameOf[e.id] ?? null, pinned: dev.pinned.has(e.id), alive: e.getHp() > 0,
          grid: dev.grid({ x: snap.x, y: snap.y }), firestarter: firestarter[e.id] ?? null,
          mortarStrikes: mortarStrikes.filter(s => s.sourceEnemyId === e.id) };
      });
      const named = {};
      for (const [name, id] of Object.entries(ck.names)) named[name] = enemies.find(e => e.id === id) ?? { id, alive: false, gone: true };
      const player = dev.runtime.navigationLabPort.getPlayerPosition();
      const obs = dev.runtime.getScenarioObservation();
      return { now, simulationMs: dev.clock.now, sinceMarkMs: dev.clock.now - ck.markSim, explosions: ck.explosions.slice(-40),
        explosionsSinceMark: ck.explosions.filter(x => x.simulationMs >= ck.markSim), timeOfDay: ck.timeOfDay(), player: player && { ...player, grid: dev.grid(player) },
        enemies, named, mortarStrikes, firestarter, burningCells: obs.burningCells, meteors: obs.meteors,
        lights: obs.lights, camera: { zoom: dev.zoom, aim: dev.aim } };
    };
    ck.waitSteps = () => new Promise((res, rej) => {
      const t0 = performance.now();
      const poll = () => {
        if (dev.clock.pendingSteps === 0) return res();
        if (performance.now() - t0 > 60000) return rej(Error('steps did not drain within 60 s'));
        setTimeout(poll, 4);
      };
      poll();
    });
    ck.step = async frames => {
      let left = frames;
      while (left > 0) { const n = Math.min(600, left); const r = window.devScenario.run({ action: 'step', frames: n }); if (!r.ok) throw Error(r.error); left -= n; await ck.waitSteps(); }
    };
    ck.until = async (src, maxFrames, every = 1) => {
      const fn = new Function('host', 'e', `return (${src});`);
      for (let i = 0; ; i += every) {
        const h = ck.host();
        let hit;
        try { hit = !!fn(h, h.named); } catch (error) { throw Error(`until "${src}": ${error.message}`); }
        if (hit) return { ok: true, frames: i };
        if (i >= maxFrames) return { ok: false, frames: i };
        await ck.step(every);
      }
    };
    ck.spawn = ({ kind, at, pinned = false, hp = null, allied = false, name }) => {
      if (!allied) {
        const r = window.devScenario.run({ action: 'spawn', kind, pinned, ...(hp == null ? {} : { hp }), ...(at ?? {}) });
        if (!r.ok) throw Error(`spawn ${kind}: ${r.error}`);
        if (name) ck.names[name] = r.status.lastAction.enemyId;
        return r.status.lastAction.enemyId;
      }
      // Allied units use the same host path as necromancy revives (EnemyManager.hostSpawnAllyAtWorld),
      // reached through the navigation-lab port's allied flag.
      const p = ck.world(at ?? dev.aim);
      const id = dev.runtime.navigationLabPort.spawnEnemy(p.x, p.y, kind, true);
      if (!id) throw Error(`allied spawn ${kind} failed`);
      if (hp != null) dev.runtime.devScenarioPort.setEnemyHp(id, hp);
      if (pinned) dev.pinned.set(id, p);
      if (name) ck.names[name] = id;
      return id;
    };
    ck.entityPoint = ref => {
      if (ref === 'player') { const p = dev.runtime.navigationLabPort.getPlayerPosition(); if (!p) throw Error('no player'); return p; }
      if (typeof ref === 'string') {
        const id = ck.names[ref];
        const enemy = id && mission()?.enemyManager?.getEnemy(id);
        if (!enemy) throw Error(`entity "${ref}" not found`);
        return { x: enemy.sprite.x, y: enemy.sprite.y };
      }
      if (ref && 'gridX' in ref) return ck.world(ref);
      if (ref && 'x' in ref) return ref;
      throw Error(`bad entity reference ${JSON.stringify(ref)}`);
    };
    /** World point -> CSS pixel in the screenshot (DPR 1; canvas fills the viewport). */
    ck.toScreen = ref => {
      // Same math as src/graphics/CameraWorldView.ts: the arena camera uses origin (0,0),
      // which Phaser's own worldView ignores at zoom != 1.
      const p = ck.entityPoint(ref), cam = scene.cameras.main, box = game.canvas.getBoundingClientRect();
      const zx = cam.zoomX ?? cam.zoom, zy = cam.zoomY ?? cam.zoom, ox = cam.width * cam.originX, oy = cam.height * cam.originY;
      const width = cam.width / zx, height = cam.height / zy;
      const view = { x: cam.scrollX + ox + (cam.width * .5 - ox) / zx - width / 2, y: cam.scrollY + oy + (cam.height * .5 - oy) / zy - height / 2, width, height };
      return { x: box.left + (p.x - view.x) / view.width * box.width, y: box.top + (p.y - view.y) / view.height * box.height,
        pxPerWorld: box.width / view.width };
    };
    ck.hud = visible => { const c = scene.clarityCamera; if (c) c.setVisible(visible); return !!c; };
    ck.renderer = () => {
      const gl = game.renderer?.gl, ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    };
  });
}

// ---------- capture loop ----------
// Consecutive variants of the same layout reuse the tab: devScenario 'start' rebuilds the world and
// resets the visual-test reseed, but skips module/asset loading. --fresh-tabs reloads every variant.
let tab = null;
async function runVariant(origin, variant, index) {
  const { layout, time } = variant;
  const vars = { ...(spec.vars ?? {}), ...(layout.vars ?? {}) };
  const scenario = subst({ version: 1, seed: 12345, classId: 'inspector_gadachs', hideAim: true, hideTutorial: true,
    suppressWaves: true, freezeMission: true, ...spec.scenario, ...layout.scenario, timeOfDay: time.timeOfDay }, vars);
  const label = time.label ?? hhmm(time.timeOfDay);
  const record = { id: variant.id, layout: layout.id, time: time.id, timeOfDay: time.timeOfDay, timeLabel: label,
    mapId: scenario.mapId, scenario, shots: [], console: [], pageErrors: [], httpErrors: [], warnings: [], error: null, timings: {} };
  log.variants.push(record);
  const t0 = Date.now();
  console.log(`[${index + 1}/${variants.length}] ${variant.id}: map ${scenario.mapId}, ${label}`);
  const reuse = !!tab && tab.layoutId === layout.id && !has('--fresh-tabs');
  if (tab && !reuse) { await tab.page.close().catch(() => {}); tab = null; }
  if (!tab) {
    const t = { page: await context.newPage(), layoutId: layout.id, record };
    // Loaded machines (parallel worktree suites) can need longer: CAPTURE_TIMEOUT_MS overrides.
    t.page.setDefaultTimeout(Number(process.env.CAPTURE_TIMEOUT_MS) || 180000);
    t.page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') t.record.console.push({ type: m.type(), text: m.text().slice(0, 2000) }); });
    t.page.on('pageerror', e => t.record.pageErrors.push(String(e.stack ?? e.message).slice(0, 4000)));
    t.page.on('crash', () => t.record.pageErrors.push('page crashed'));
    t.page.on('response', r => { if (r.status() >= 400) t.record.httpErrors.push(`${r.status()} ${r.url()}`); });
    tab = t;
  }
  tab.record = record;
  record.reusedTab = reuse;
  const page = tab.page;
  const watchdog = setTimeout(() => { record.pageErrors.push('variant exceeded 15 minutes'); void page.close(); }, 15 * 60000);
  const run = async c => {
    const r = await page.evaluate(c => window.devScenario.run(c), c);
    if (!r.ok) throw Error(`${JSON.stringify(c)}: ${r.error}`);
    if (c.action === 'step' || c.action === 'settle') await page.evaluate(() => window.__ck ? window.__ck.waitSteps() : null);
    return r;
  };
  const settle = async () => {
    const s0 = Date.now();
    for (;;) {
      await page.evaluate(() => { const r = window.devScenario.run({ action: 'settle', frames: 12 }); if (!r.ok) throw Error(r.error); });
      await page.evaluate(() => window.__ck.waitSteps());
      const work = await page.evaluate(() => window.devScenario.status().loading?.work);
      if (!work || (work.renderReady && work.pending === 0)) return;
      if (Date.now() - s0 > 60000) throw Error('render work did not settle within 60 s');
    }
  };
  let markSim = 0;
  const shotMeta = { cameraAim: null };
  const op = async (o, ctx) => {
    if (o.action) { await run(o); return; }
    switch (o.op) {
      case 'step': await page.evaluate(n => window.__ck.step(n), o.frames ?? 1); return;
      case 'ms': await page.evaluate(n => window.__ck.step(n), Math.max(1, Math.round((o.ms ?? 0) * 60 / 1000))); return;
      case 'settle': await settle(); return;
      case 'mark': markSim = await page.evaluate(() => (window.__ck.markSim = window.__ck.dev.clock.now)); return;
      case 'until': {
        const r = await page.evaluate(([src, max, every]) => window.__ck.until(src, max, every), [o.expr, o.maxFrames ?? 900, o.every ?? 1]);
        ctx.until.push({ expr: o.expr, ...r });
        if (!r.ok) {
          const msg = `until timed out after ${r.frames} frames: ${o.expr}`;
          if (o.optional) { record.warnings.push(msg); ctx.warnings.push(msg); } else throw Error(msg);
        }
        return;
      }
      case 'spawn': await page.evaluate(s => window.__ck.spawn(s), o); return;
      case 'camera': {
        if (o.zoom !== undefined) await run({ action: 'camera', zoom: o.zoom, focusTarget: true });
        const at = o.follow ? await page.evaluate(ref => window.__ck.grid(window.__ck.entityPoint(ref)), o.follow) : o.at;
        if (at) {
          const point = { gridX: at.gridX + (o.offset?.gridX ?? 0), gridY: at.gridY + (o.offset?.gridY ?? 0) };
          await run({ action: 'target', ...point });
          await run({ action: 'camera', focusTarget: true });
          shotMeta.cameraAim = point;
        }
        return;
      }
      case 'probe': {
        // Fit the whole map, then dump a free-cell map (player-sized clearance) for picking positions.
        const info = await page.evaluate(async () => {
          const ck = window.__ck, dev = ck.dev, m = dev.runtime.getWorldMetrics();
          const { NavigationGeometry } = await import(performance.getEntriesByType('resource').map(e => e.name)
            .find(n => new URL(n).pathname === '/src/systems/navigation/NavigationGeometry.ts'));
          const geometry = new NavigationGeometry(dev.runtime.navigationLabPort.getGeometry());
          const player = dev.runtime.navigationLabPort.getPlayerPosition(), pg = player && dev.grid(player);
          const rows = [];
          for (let y = 0; y < m.gridRows; y++) {
            let row = '';
            for (let x = 0; x < m.gridCols; x++) {
              const p = ck.world({ gridX: x, gridY: y });
              row += pg && Math.round(pg.gridX) === x && Math.round(pg.gridY) === y ? 'P' : geometry.isFree(p.x, p.y, 16) ? '.' : '#';
            }
            rows.push(row);
          }
          const designWidth = ck.scene.cameras.main.worldView.width * dev.zoom;
          const zoom = Math.max(.25, Math.min(8, designWidth / (m.gridCols * 32 + 64)));
          return { cols: m.gridCols, rows, player: pg, zoom, centre: { gridX: (m.gridCols - 1) / 2, gridY: (m.gridRows - 1) / 2 } };
        });
        await run({ action: 'camera', zoom: info.zoom, focusTarget: true });
        await run({ action: 'target', ...info.centre });
        await page.evaluate(() => window.__ck.step(2));
        const NL = String.fromCharCode(10);
        const header = '     ' + Array.from({ length: info.cols }, (_, x) => x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' ').join('') + NL
          + '     ' + Array.from({ length: info.cols }, (_, x) => String(x % 10)).join('') + NL;
        await writeFile(join(outDir, `freemap__${variant.id}.txt`), `map ${scenario.mapId}: '.' free for a 16 px radius, '#' blocked, 'P' default player spawn ${JSON.stringify(info.player)}` + NL
          + header + info.rows.map((r, y) => String(y).padStart(4) + ' ' + r).join(NL) + NL);
        shotMeta.gridOverlay = true;
        return;
      }
      case 'hud': await page.evaluate(v => window.__ck.hud(v), o.visible !== false); return;
      case 'js': await page.evaluate(src => new Function('ck', 'dev', 'host', `return (async () => { ${src} })();`)(window.__ck, window.devScenario, window.__ck.host()), o.code); return;
      default: throw Error(`Unknown op ${JSON.stringify(o)}`);
    }
  };
  try {
    const hash = '#scenario=' + encodeURIComponent(JSON.stringify(scenario));
    if (reuse) await page.evaluate(sc => { const r = window.devScenario.run({ action: 'start', scenario: sc }); if (!r.ok) throw Error(r.error); }, scenario);
    else await page.goto(`${origin}/dev-scenario.html?visual-test=1${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const s = window.devScenario?.status();
      if (s?.state === 'error') throw Error(String(s.message));
      return s?.paused && s.ready;
    }, null, { polling: 100 });
    record.timings.readyMs = Date.now() - t0;
    console.log(`  ready after ${(record.timings.readyMs / 1000).toFixed(1)} s${reuse ? ' (same tab, scenario restart)' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    if (!reuse) await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}' });
    await installKit(page);
    log.renderer ??= await page.evaluate(() => window.__ck.renderer());
    await page.evaluate(v => window.__ck.hud(v), spec.hud !== false);
    // Warm-up mirrors scripts/visual/run.mjs: worker barrier, 2 s of sim, sun crossfade.
    const warm = subst(spec.warmup ?? [], vars);
    for (const o of warm) await op(o, { until: [], warnings: [] });
    await settle();
    await page.evaluate(n => window.__ck.step(n), spec.warmupFrames ?? 120);
    await settle();
    await page.evaluate(() => window.__ck.step(60));
    await settle();
    const setup = subst(spec.setup ?? [], vars);
    for (const o of setup) await op(o, { until: [], warnings: [] });
    markSim = await page.evaluate(() => (window.__ck.markSim = window.__ck.dev.clock.now));
    record.timings.setupMs = Date.now() - t0 - record.timings.readyMs;
    for (const raw of spec.shots) {
      const shot = subst(raw, vars);
      const ctx = { until: [], warnings: [] };
      const s0 = Date.now();
      for (const o of shot.do ?? []) await op(o, ctx);
      await settle();
      const host = await page.evaluate(() => window.__ck.host());
      const status = await page.evaluate(() => {
        const s = window.devScenario.status();
        return { simulationMs: s.simulationMs, paused: s.paused, pendingSteps: s.pendingSteps, camera: s.camera, player: s.player,
          sun: s.sun, quality: s.quality, rendererSize: s.rendererSize, mission: s.mission, effects: { ...s.effects, burningGround: undefined, constructions: undefined } };
      });
      if (status.pendingSteps !== 0 || !status.paused) throw Error(`shot ${shot.id}: scenario not paused/drained`);
      if (host.timeOfDay !== null && host.timeOfDay !== time.timeOfDay) {
        const msg = `shot ${shot.id}: time of day drifted to ${host.timeOfDay} (requested ${time.timeOfDay})`;
        record.warnings.push(msg); ctx.warnings.push(msg);
      }
      const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      const file = `${variant.id}__${String(record.shots.length + 1).padStart(2, '0')}-${shot.id}.png`;
      await writeFile(join(outDir, file), png);
      let gridFile = null;
      if (shotMeta.gridOverlay) {
        shotMeta.gridOverlay = false;
        gridFile = file.replace(/\.png$/, '__grid.png');
        const lines = await page.evaluate(() => {
          const ck = window.__ck, m = ck.dev.runtime.getWorldMetrics(), out = [];
          for (let x = 0; x <= m.gridCols; x += 5) out.push({ v: true, n: x, a: ck.toScreen({ gridX: x, gridY: 0 }), b: ck.toScreen({ gridX: x, gridY: m.gridRows - 1 }) });
          for (let y = 0; y <= m.gridRows; y += 5) out.push({ v: false, n: y, a: ck.toScreen({ gridX: 0, gridY: y }), b: ck.toScreen({ gridX: m.gridCols - 1, gridY: y }) });
          return out;
        });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}">` + lines.map(l =>
          `<line x1="${l.a.x}" y1="${l.a.y}" x2="${l.b.x}" y2="${l.b.y}" stroke="${l.n % 10 ? '#ffffff55' : '#ffe08aaa'}" stroke-width="1"/>`
          + `<text x="${l.v ? l.a.x + 2 : 2}" y="${l.v ? 12 : l.a.y - 2}" font-family="Arial" font-size="11" fill="#ffe08a">${l.n}</text>`).join('') + '</svg>';
        await sharp(png).composite([{ input: Buffer.from(svg) }]).png().toFile(join(outDir, gridFile));
      }
      const crops = [];
      for (const [ci, crop] of (shot.crops ?? []).entries()) {
        try {
          const c = await page.evaluate(ref => window.__ck.toScreen(ref), crop.of);
          const [w, h] = Array.isArray(crop.size) ? crop.size : [crop.size ?? 160, crop.size ?? 160];
          const left = Math.round(Math.min(Math.max(c.x - w / 2 + (crop.offset?.[0] ?? 0), 0), viewport.width - w));
          const top = Math.round(Math.min(Math.max(c.y - h / 2 + (crop.offset?.[1] ?? 0), 0), viewport.height - h));
          const scale = crop.scale ?? 3;
          const cropFile = file.replace(/\.png$/, `__crop${ci + 1}.png`);
          await sharp(png).extract({ left, top, width: w, height: h })
            .resize(w * scale, h * scale, { kernel: 'nearest' }).png().toFile(join(outDir, cropFile));
          crops.push({ file: cropFile, of: crop.of, rect: { left, top, width: w, height: h }, scale, label: crop.label ?? `${typeof crop.of === 'string' ? crop.of : 'point'} ×${scale}` });
        } catch (error) {
          const msg = `shot ${shot.id} crop ${ci + 1}: ${error.message}`; record.warnings.push(msg); ctx.warnings.push(msg);
        }
      }
      const rel = Math.round(status.simulationMs - markSim);
      record.shots.push({ id: shot.id, label: shot.label ?? shot.id, file, gridFile, crops, simulationMs: status.simulationMs,
        sinceMarkMs: rel, sinceMarkFrames: Math.round(rel * 60 / 1000), until: ctx.until, warnings: ctx.warnings,
        wallMs: Date.now() - s0, host, status });
      console.log(`  shot ${shot.id}: +${rel} ms${ctx.until.length ? ` (until ${ctx.until.map(u => u.frames + 'f').join(', ')})` : ''}${ctx.warnings.length ? ' WARN ' + ctx.warnings.join('; ') : ''}`);
    }
  } catch (error) {
    record.error = String(error.stack ?? error);
    console.error(`  ERROR ${variant.id}: ${error.message}`);
    await page.screenshot({ path: join(outDir, `${variant.id}__error.png`) }).catch(() => {});
    record.errorStatus = await page.evaluate(() => { try { return { host: window.__ck?.host(), status: window.devScenario?.status() }; } catch (e) { return String(e); } }).catch(() => null);
  } finally {
    clearTimeout(watchdog);
    // A failed variant leaves unknown state behind: never reuse its tab.
    if (record.error) { await page.close().catch(() => {}); tab = null; }
    record.timings.totalMs = Date.now() - t0;
  }
  if (record.shots.length) {
    const t1 = Date.now();
    record.board = await makeBoard(record, scenario);
    record.timings.boardMs = Date.now() - t1;
  }
  console.log(`  ${variant.id}: ${record.shots.length} shots in ${(record.timings.totalMs / 1000).toFixed(1)} s${record.board ? ' -> ' + record.board : ''}`);
}

// ---------- board ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textSvg = (width, height, lines, { bg = '#14181d', fg = '#f0ece2', size = 18, sub = '#9fb0bf' } = {}) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${bg}"/>` +
  lines.map((l, i) => `<text x="10" y="${size + 4 + i * (size + 6)}" font-family="Segoe UI, Arial, sans-serif" font-size="${i ? size - 4 : size}" font-weight="${i ? 400 : 600}" fill="${i ? sub : fg}">${esc(l)}</text>`).join('') + '</svg>');

async function makeBoard(record, scenario) {
  const tileW = board.tileWidth, tileH = Math.round(tileW * viewport.height / viewport.width), labelH = 52, gap = 8;
  const tiles = [];
  for (const shot of record.shots) {
    const flags = [shot.until.length ? `until ${shot.until.map(u => u.frames + 'f').join('+')}` : null, shot.warnings.length ? 'WARN' : null].filter(Boolean).join(' · ');
    tiles.push({ path: join(outDir, shot.gridFile ?? shot.file), fit: 'fill', lines: [shot.label, `t+${shot.sinceMarkMs} ms (f+${shot.sinceMarkFrames}) · sim ${Math.round(shot.simulationMs)} ms${flags ? ' · ' + flags : ''}`] });
    for (const crop of shot.crops) tiles.push({ path: join(outDir, crop.file), fit: 'contain', lines: [`${shot.label} — ${crop.label}`, `${crop.rect.width}×${crop.rect.height} px @ ${crop.rect.left},${crop.rect.top} · nearest ×${crop.scale}`] });
  }
  const cols = Math.min(board.columns, tiles.length), rows = Math.ceil(tiles.length / cols);
  const headerH = 64, width = cols * tileW + (cols + 1) * gap, height = headerH + rows * (tileH + labelH + gap) + gap;
  const header = [`${specName} · ${record.id} · map ${scenario.mapId} · ${record.timeLabel} (fixed)`,
    `seed ${scenario.seed} · ${viewport.width}×${viewport.height} native · commit ${commit ?? '?'}${dirty ? ` (+${dirty} dirty src files)` : ''} · ${new Date().toISOString().slice(0, 16)}Z${record.error ? ' · ERROR: ' + record.error.split('\n')[0].slice(0, 120) : ''}`];
  const layers = [{ input: textSvg(width, headerH, header, { size: 22 }), left: 0, top: 0 }];
  for (const [i, tile] of tiles.entries()) {
    const x = gap + (i % cols) * (tileW + gap), y = headerH + Math.floor(i / cols) * (tileH + labelH + gap);
    layers.push({ input: textSvg(tileW, labelH, tile.lines, { bg: '#1e252c', size: 17 }), left: x, top: y });
    const meta = await sharp(tile.path).metadata();
    const upscale = meta.width < tileW && meta.height < tileH;
    const img = await sharp(tile.path).resize(tileW, tileH, { fit: tile.fit, background: '#0b0e11', kernel: upscale ? 'nearest' : 'lanczos3' }).png().toBuffer();
    layers.push({ input: img, left: x, top: y + labelH });
  }
  const file = `board__${record.id}.png`;
  await sharp({ create: { width, height, channels: 3, background: '#0f1215' } }).composite(layers).png().toFile(join(outDir, file));
  return file;
}

/** CHROME_PATH, else the usual install locations, else Playwright's lookup of the installed Chrome. */
function chromeExecutable() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH };
  const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(dir => join(dir, 'Google/Chrome/Application/chrome.exe'))
    .concat(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']);
  const found = candidates.find(path => existsSync(path));
  return found ? { executablePath: found } : { channel: 'chrome' };
}

// ---------- main ----------
try {
  const t = Date.now();
  server = await createServer({ root, configLoader: 'runner', cacheDir: join(tmpRoot, 'vite-cache'), logLevel: 'warn', clearScreen: false,
    define: { __BUILD_TIMESTAMP__: JSON.stringify('2023-11-14T22:13:20Z') },
    // No HMR and no watcher: concurrent source edits must not reload a running capture.
    server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false, watch: null } });
  await server.listen();
  const origin = `http://127.0.0.1:${port}`;
  const probe = await fetch(origin + '/dev-scenario.html');
  if (probe.status !== 200) throw Error(`Vite returned HTTP ${probe.status}`);
  log.timings.viteMs = Date.now() - t;
  console.log(`vite ${origin} (${log.timings.viteMs} ms), output ${outDir}`);
  profileDir = await mkdtemp(join(tmpRoot, 'chrome-profile-'));
  const t2 = Date.now();
  context = await chromium.launchPersistentContext(profileDir, {
    ...chromeExecutable(),
    headless: !has('--headed'),
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb',
      ...(spec.chromeArgs ?? [])],
    viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce',
  });
  log.browser = context.browser()?.version() ?? 'chrome (persistent)';
  log.timings.chromeMs = Date.now() - t2;
  for (const page of context.pages()) await page.close();
  for (const [i, variant] of variants.entries()) {
    await runVariant(origin, variant, i);
    const rec = log.variants.at(-1);
    if (rec.error && !has('--keep-going')) { log.errors.push(`aborted after ${variant.id}`); break; }
  }
} catch (error) {
  log.errors.push(String(error.stack ?? error));
  console.error(error);
} finally {
  await shutdown();
  log.timings.totalMs = Date.now() - started;
  log.profileRemoved = profileDir ? !existsSync(profileDir) : null;
  await writeJson(join(outDir, 'log.json'), log);
  const failed = log.errors.length + log.variants.filter(v => v.error).length;
  const noisy = log.variants.reduce((n, v) => n + v.pageErrors.length + v.console.filter(c => c.type === 'error').length, 0);
  console.log(`done in ${(log.timings.totalMs / 1000).toFixed(1)} s: ${log.variants.length} variants, ${failed} failed, ${noisy} page/console errors -> ${outDir}`);
  for (const v of log.variants) if (v.board) console.log(`  ${join(outDir, v.board)}`);
  process.exitCode = failed ? 1 : 0;
}
