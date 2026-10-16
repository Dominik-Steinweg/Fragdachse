#!/usr/bin/env node
// Motion capture of the bomber squadron flight (Inspector ultimate) at the real 1920×1080 player camera:
// 60-Hz scenario steps, 30-fps video (webm + gif), stills, 1:1 crops and path plots. See README.md.
//   node tools/flight-recorder/record.mjs [--root <checkout>] [--port <n>] [--out <dir>] [--variant a,b]
// All generated files, including Vite/Chrome caches, stay inside --out (default build/flight-recorder).
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';

const argv = process.argv.slice(2), choices = ['base-day', 'base-night', 'full-day', 'full-night', 'cluster-day'];
let variants = choices, port = 8099;
let root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), outArg = 'build/flight-recorder';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--variant') variants = argv[++i].split(',');
  else if (argv[i] === '--port') port = Number(argv[++i]);
  else if (argv[i] === '--root') root = resolve(argv[++i]);
  else if (argv[i] === '--out') outArg = argv[++i];
  else throw Error(`Unknown argument ${argv[i]}`);
}
const out = resolve(root, outArg);
await mkdir(out, { recursive: true });
// 8080 and 8090 belong to the user's own dev servers (AGENTS.md).
if (!Number.isInteger(port) || [8080, 8090].includes(port)) throw Error(`Port ${port} is not allowed.`);
if (!variants.length || variants.some(v => !choices.includes(v))) throw Error('Unknown variant.');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright-core'), sharp = require('sharp');
const vp = require.resolve('vite/package.json'), pkg = JSON.parse(await readFile(vp, 'utf8'));
const { createServer } = await import(pathToFileURL(join(dirname(vp), pkg.exports['.'].import.default ?? pkg.exports['.'].import)).href);
// FFMPEG_PATH, then ffmpeg on PATH, then known local installs.
const onPath = () => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch { return null; } };
const ffmpeg = process.env.FFMPEG_PATH ?? onPath() ?? [
  'C:/Users/domin/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1-full_build/bin/ffmpeg.exe',
  'C:/Program Files/Steinberg/Cubase 14/Externals/FFmpeg/5.1.1/ffmpeg.exe',
].find(existsSync);
if (!ffmpeg) throw Error('FFmpeg not accessible; set FFMPEG_PATH.');
const viewport = { width: 1920, height: 1080 }, tmp = join(out, '.tmp');
await mkdir(tmp, { recursive: true });
const json = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
// Guard every recursive removal, including profile cleanup, against escaping the output directory.
async function removeOwned(path) {
  const r = relative(out, resolve(path));
  if (!r || r.startsWith('..') || isAbsolute(r)) throw Error(`Unsafe cleanup: ${path}`);
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const reportPath = join(out, 'report.json');
const prior = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, 'utf8')) : null;
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), viewport, simulationHz: 60, videoFps: 30, port, ffmpeg,
  measurement: 'Body world AABB intersects camera viewport, visible=true and renderer alpha>0.01. Heading and path-angle deltas use EVERY 60-Hz simulation frame. Late departure poses are derived from the renderer-retained replicated snapshot after status removal. No simulated gameplay overrides.',
  variants: prior?.variants?.filter(v => !variants.includes(v.id)) ?? [], errors: [] };
let server, context, profile, closed = false, child;
async function shutdown() {
  if (closed) return; closed = true;
  child?.kill(); // Only our own FFmpeg child.
  await context?.close();
  await server?.close();
  if (profile) await removeOwned(profile);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.once(signal, () => {
  void shutdown().finally(() => process.exit(130));
});
const encode = args => new Promise((res, rej) => {
  child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  child.on('error', rej); child.on('close', code => { child = null; code === 0 ? res() : rej(Error(`ffmpeg ${code}: ${stderr}`)); });
});

async function install(page) {
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').map(e => e.name);
    const mod = file => { const url = loaded.find(n => new URL(n).pathname === '/src/' + file); if (!url) throw Error(`Missing ${file}`); return import(url); };
    const { getRenderResolutionController } = await mod('graphics/RenderResolution.ts');
    const { getVisibleWorldView } = await mod('graphics/CameraWorldView.ts');
    const plan = await mod('systems/bomberSquadron/BomberSquadronPlan.ts');
    const { BomberSquadronRenderer } = await mod('effects/bomberSquadron/BomberSquadronRenderer.ts');
    const game = getRenderResolutionController().game, scene = game.scene.getScene('ArenaScene'), dev = scene.devScenario;
    const f = window.__flight = { game, scene, dev, plan, impacts: [], renderer: null };
    const original = BomberSquadronRenderer.prototype.update;
    BomberSquadronRenderer.prototype.update = function (...args) {
      f.renderer = this;
      if (!this.__flightWrapped) {
        const explode = this.ports.explode;
        this.ports.explode = (x, y, radius) => { f.impacts.push({ x, y, radius, now: f.currentNow, simulationMs: dev.clock.now }); return explode(x, y, radius); };
        // Capture the current update time, not the wrapping frame's time.
        this.__flightWrapped = true;
      }
      f.currentNow = args[1];
      return original.apply(this, args);
    };
    f.wait = () => new Promise((res, rej) => {
      const start = performance.now();
      const poll = () => {
        if (!dev.clock.pendingSteps) return res();
        if (performance.now() - start > 60000) return rej(Error('Step timeout'));
        setTimeout(poll, 2);
      }; poll();
    });
    f.run = async command => { const r = await window.devScenario.run(command); if (!r.ok) throw Error(r.error); await f.wait(); return r; };
    f.sample = () => {
      const status = window.devScenario.status(), iu = status.inspectorUltimates;
      const view = getVisibleWorldView(scene.cameras.main);
      const squadrons = iu?.squadrons ?? [], drones = [], corridors = [];
      for (const v of f.renderer?.squadrons.values() ?? []) {
        const s = v.snapshot;
        s.anchors.forEach((a, index) => {
          if (!a) return;
          const reported = squadrons.find(x => x.id === s.id)?.drones[index];
          const pose = reported?.pose ?? plan.bomberDronePose(s, index, a, iu.now);
          const body = v.drones[index]?.body, bounds = body?.getBounds();
          const renderer = body ? { x: body.x, y: body.y, alpha: body.alpha, visible: body.visible,
            rotation: body.rotation, displayWidth: body.displayWidth, displayHeight: body.displayHeight,
            bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, tint: body.tintTopLeft } : null;
          const visible = !!body && body.visible && body.alpha > .01 && bounds.right > view.x && bounds.x < view.right && bounds.bottom > view.y && bounds.y < view.bottom;
          drones.push({ squadronId: s.id, index, pose, poseSource: reported ? 'status' : 'retained-replicated-anchor',
            aimOffset: a.aimOffset, aimAngle: a.aimAngle, fadeFrom: v.fadeFrom[index], renderer, visible,
            screen: pose ? { x: (pose.x - view.x) / view.width * 1920, y: (pose.y - view.y) / view.height * 1080 } : null });
          corridors.push({ index, planned: plan.bomberCorridor(s, index, { ...a, aimOffset: 0, aimAngle: 0 }),
            entry: plan.bomberDroneEntryPoint(s, index, a),
            chosen: plan.bomberCorridor(s, index, a), drops: plan.bomberDrops(s, index, a),
            flightEndAt: plan.bomberDroneFlightEndAt(s, index) });
        });
      }
      const enemies = (dev.runtime.flow.getCoopMissionRuntime()?.enemyManager?.getAllEnemies() ?? []).map(e => e.getNetSnapshot());
      return { simulationMs: dev.clock.now, now: iu.now, inspectorUltimates: iu, drones, corridors, view,
        camera: status.camera, enemies, impacts: f.impacts.map(x => ({ ...x, now: iu.activatedAt + x.simulationMs - f.activationSim })) };
    };
  });
}

const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
async function board(rec) {
  const w = 640, h = 400, header = 80, cols = 3, rows = Math.ceil(rec.stills.length / cols);
  const layers = [];
  for (const [i, s] of rec.stills.entries()) {
    const left = (i % cols) * w, top = header + Math.floor(i / cols) * h;
    layers.push({ input: await sharp(join(out, s.file)).resize(w, 360).png().toBuffer(), left, top: top + 40 });
    layers.push({ input: Buffer.from(`<svg width="${w}" height="40"><text x="10" y="26" fill="white" font-family="Arial" font-size="17">${escape(s.label)} · ${(s.timeMs / 1000).toFixed(3)} s · f${s.frame}</text></svg>`), left, top });
  }
  layers.push({ input: Buffer.from(`<svg width="1920" height="80"><text x="16" y="31" fill="white" font-family="Arial" font-size="25">Bomberflug ${rec.id} · ${report.commit.slice(0, 8)} · 1920×1080 · Spieler-Kamera 1:1</text><text x="16" y="59" fill="#cbd5e1" font-family="Arial" font-size="17">60-Hz-Simulation / 30-fps-Video · Seed 12345 · ${rec.id.endsWith('night') ? '22:00' : '12:00'} · Maßstab der Kacheln 1:3</text></svg>`), left: 0, top: 0 });
  const detailTop = header + rows * h, detailRowHeight = 326;
  layers.push({ input: Buffer.from(`<svg width="1920" height="50"><text x="16" y="32" fill="white" font-family="Arial" font-size="23">Details 1:1 · je 480×270 Weltpixel · unverändert, nicht skaliert · bevorzugt Drohne 1</text></svg>`), left: 0, top: detailTop });
  for (const [i, c] of rec.crops.entries()) {
    const left = i % 4 * 480, top = detailTop + 50 + Math.floor(i / 4) * detailRowHeight;
    layers.push({ input: Buffer.from(`<svg width="480" height="56"><text x="10" y="21" fill="white" font-family="Arial" font-size="16">D${c.drone + 1} · ${escape(c.label)} · ${(c.timeMs / 1000).toFixed(3)} s</text><text x="10" y="43" fill="#cbd5e1" font-family="Arial" font-size="14">f${c.frame} · 1:1${c.clippedAtViewport ? ' · Körper am Bildrand angeschnitten' : ''}${c.drone ? ' · Ersatz für D1' : ''}</text></svg>`), left, top });
    layers.push({ input: await readFile(join(out, c.file)), left, top: top + 56 });
  }
  await sharp({ create: { width: cols * w, height: detailTop + 50 + Math.ceil(rec.crops.length / 4) * detailRowHeight, channels: 4, background: '#14202c' } }).composite(layers).png().toFile(join(out, `board__${rec.id}.png`));
}

async function detailCrops(rec, trace) {
  rec.crops = [];
  for (const name of ['edge', 'approach', 'entry', ...(rec.params.passCount > 1 ? ['turn'] : []), 'departure']) {
    const shot = rec.stills.find(s => s.file.endsWith(`__${name}.png`));
    const frame = trace.frames[shot.frame];
    if (Math.abs(frame.view.width - 1920) > .01 || Math.abs(frame.view.height - 1080) > .01) throw Error('1:1 crops require one screen pixel per world pixel');
    const drone = frame.drones.find(d => d.index === 0 && d.visible) ?? frame.drones.find(d => d.visible);
    if (!drone) throw Error(`No visible drone for ${rec.id}/${name} crop`);
    const rect = { left: Math.max(0, Math.min(1440, Math.round(drone.screen.x - 240))), top: Math.max(0, Math.min(810, Math.round(drone.screen.y - 135))), width: 480, height: 270 };
    const b = drone.renderer.bounds, v = frame.view;
    const file = `crop__${rec.id}__${name}.png`;
    await sharp(join(out, shot.file)).extract(rect).png().toFile(join(out, file));
    rec.crops.push({ file, source: shot.file, label: shot.label, frame: shot.frame, timeMs: shot.timeMs, drone: drone.index,
      rect, worldRect: { x: v.x + rect.left, y: v.y + rect.top, width: 480, height: 270 }, scale: 1,
      clippedAtViewport: b.x < v.x || b.y < v.y || b.x + b.width > v.right || b.y + b.height > v.bottom });
  }
}

function approachCrossings(trace) {
  const plans = new Map(), lines = new Map();
  const squad = trace.frames.find(f => f.inspectorUltimates.squadrons?.length).inspectorUltimates.squadrons[0];
  const normal = { x: -Math.sin(squad.angle), y: Math.cos(squad.angle) };
  const across = p => p.x * normal.x + p.y * normal.y;
  for (const f of trace.frames) {
    for (const c of f.corridors) plans.set(c.index, c);
    for (const d of f.drones) if (d.pose) {
      const line = lines.get(d.index) ?? [];
      if (d.pose.phase === 'approach' || d.pose.phase === 'run' && line.at(-1)?.phase === 'approach') line.push(d.pose);
      lines.set(d.index, line);
    }
  }
  const entries = [...plans.values()].map(c => ({ drone: c.index + 1, entryAcross: across(c.entry), corridorAcross: across(c.chosen.start) }));
  const order = field => [...entries].sort((a,b) => a[field]-b[field]).map(e => e.drone);
  const reversedPairs = [], geometricPairs = [];
  const cross = (a,b) => a.x*b.y-a.y*b.x;
  for (let i=0;i<entries.length;i++) for (let j=i+1;j<entries.length;j++) {
    const a=entries[i],b=entries[j];
    if ((a.entryAcross-b.entryAcross)*(a.corridorAcross-b.corridorAcross)<-0.0001) reversedPairs.push([a.drone,b.drone]);
    const la=lines.get(a.drone-1),lb=lines.get(b.drone-1); let hit;
    for(let u=1;u<la.length&&!hit;u++) for(let v=1;v<lb.length&&!hit;v++) {
      const p=la[u-1],q=lb[v-1],r={x:la[u].x-p.x,y:la[u].y-p.y},s={x:lb[v].x-q.x,y:lb[v].y-q.y};
      const denominator=cross(r,s); if(Math.abs(denominator)<1e-9)continue;
      const qp={x:q.x-p.x,y:q.y-p.y},t=cross(qp,s)/denominator,w=cross(qp,r)/denominator;
      if(t>0&&t<1&&w>0&&w<1)hit={drones:[a.drone,b.drone],x:p.x+t*r.x,y:p.y+t*r.y};
    }
    if(hit)geometricPairs.push(hit);
  }
  return { method: 'One-based drone numbers. Lateral order at exact planned entry vs chosen corridor start; geometric intersections of sampled approach polylines (not simultaneous collision tests).',
    entries, entryOrder: order('entryAcross'), corridorOrder: order('corridorAcross'), reversedPairs, geometricPairs,
    crosses: reversedPairs.length>0 || geometricPairs.length>0 };
}

async function paths(rec, trace) {
  const color = index => `hsl(${(index * 137.508) % 360},75%,38%)`;
  const pts = trace.frames.flatMap(f => f.drones.filter(d => d.pose).map(d => d.pose));
  const v = trace.frames[0].view, corridors = new Map();
  for (const f of trace.frames) for (const c of f.corridors) corridors.set(c.index, c);
  pts.push({ x: v.x, y: v.y }, { x: v.right, y: v.bottom });
  const left = Math.floor(Math.min(...pts.map(p => p.x)) / 100) * 100 - 100;
  const top = Math.floor(Math.min(...pts.map(p => p.y)) / 100) * 100 - 100;
  const right = Math.ceil(Math.max(...pts.map(p => p.x)) / 100) * 100 + 100;
  const bottom = Math.ceil(Math.max(...pts.map(p => p.y)) / 100) * 100 + 100;
  const width = Math.ceil((right - left) / 2), height = Math.ceil((bottom - top) / 2) + 150;
  const x = n => (n - left) / 2, y = n => (n - top) / 2 + 150;
  const line = (a, b, attrs) => `<line x1="${x(a.x)}" y1="${y(a.y)}" x2="${x(b.x)}" y2="${y(b.y)}" ${attrs}/>`;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>`,
    `<g font-family="Arial" fill="#222"><text x="20" y="30" font-size="23">Bomberflug ${rec.id} · Bahnen aus 60-Hz-Trace · Maßstab 1:2</text>`,
    '<text x="20" y="56" font-size="15">Anflug: gestrichelt · Lauf: durchgehend · Wende: gepunktet · Rückflug: lang gestrichelt · Abflug: Strich/Punkt</text>',
    '<text x="20" y="79" font-size="15">Grau dünn: Grundkorridor (aim=0) · Farbe kräftig: gewählter Korridor · Kreuze: Abwurf-Zielpunkte · Schwarz: Gegner</text>',
    '<text x="20" y="101" font-size="15">Pfeil: Flugrichtung beim Start · Quadrate: Phasenbeginn · Rechteck: Viewport bei Aktivierung · Raster: 200 Weltpixel</text></g>'];
  for (let gx = Math.ceil(left / 200) * 200; gx <= right; gx += 200) svg.push(line({ x: gx, y: top }, { x: gx, y: bottom }, 'stroke="#eeeeee"'));
  for (let gy = Math.ceil(top / 200) * 200; gy <= bottom; gy += 200) svg.push(line({ x: left, y: gy }, { x: right, y: gy }, 'stroke="#eeeeee"'));
  svg.push(`<rect x="${x(v.x)}" y="${y(v.y)}" width="${v.width / 2}" height="${v.height / 2}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  for (const c of corridors.values()) {
    const col = color(c.index);
    svg.push(`<defs><marker id="arrow${c.index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10Z" fill="${col}"/></marker></defs>`);
    svg.push(`<text x="${20+(c.index%12)*100}" y="${125+Math.floor(c.index/12)*20}" font-family="Arial" font-size="15" fill="${col}">━ D${c.index+1}</text>`);
    svg.push(line(c.planned.start, c.planned.end, 'stroke="#aaa" stroke-width="1"'));
    svg.push(line(c.chosen.start, c.chosen.end, `stroke="${col}" stroke-width="4" opacity=".65"`));
    for (const d of c.drops.filter(d => d.pass === 0)) svg.push(`<path d="M${x(d.x)-4},${y(d.y)-4}l8,8m-8,0l8,-8" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    let phase, segment = [];
    const dash = { approach: '6 4', run: '', turn: '2 4', return: '13 6', departure: '9 3 2 3' };
    const flush = () => { if (segment.length) svg.push(`<polyline points="${segment.map(p => `${x(p.x)},${y(p.y)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="${dash[phase]}"/>`); };
    let first = true;
    for (const f of trace.frames) {
      const p = f.drones.find(d => d.index === c.index)?.pose; if (!p) continue;
      if (first) {
        const q = { x: p.x + Math.cos(p.heading)*60, y: p.y + Math.sin(p.heading)*60 };
        svg.push(line(p, q, `stroke="${col}" stroke-width="2" marker-end="url(#arrow${c.index})"`)); first = false; }
      if (phase !== p.phase) { flush(); segment = segment.length ? [segment.at(-1)] : []; phase = p.phase;
        svg.push(`<rect x="${x(p.x)-3}" y="${y(p.y)-3}" width="6" height="6" fill="${col}"/>`); }
      segment.push(p);
    } flush();
  }
  const enemies = trace.frames.find(f => f.enemies.length)?.enemies ?? [];
  for (const e of enemies) svg.push(`<circle cx="${x(e.x)}" cy="${y(e.y)}" r="4" fill="#111" stroke="white"/>`);
  svg.push('</svg>');
  await sharp(Buffer.from(svg.join(''))).png().toFile(join(out, `paths__${rec.id}.png`));
}

function measurements(rec, trace) {
  const firstSeen = new Map(), maxima = new Map(), previous = new Map();
  const delta = (a, b) => Math.abs(Math.atan2(Math.sin(a-b), Math.cos(a-b))) * 180 / Math.PI;
  for (const f of trace.frames) for (const d of f.drones) {
    if (d.visible && !firstSeen.has(d.index)) firstSeen.set(d.index, { drone: d.index, frame: f.frame, timeMs: f.timeMs,
      x: d.pose?.x, y: d.pose?.y, screen: d.screen, alpha: d.renderer.alpha, phase: d.pose?.phase,
      fallback: d.fadeFrom != null, fadedAtFirstVisibility: d.renderer.alpha < 1 });
    const p = d.pose; if (!p) continue;
    const last = previous.get(d.index), max = maxima.get(d.index) ?? { drone: d.index, heading: { degrees: 0 }, path: { degrees: 0 } };
    if (last && f.frame === last.frame + 1) {
      const change = delta(p.heading, last.pose.heading);
      if (change > max.heading.degrees) max.heading = { degrees: change, phase: p.phase, fromPhase: last.pose.phase, frame: f.frame, timeMs: f.timeMs, x: p.x, y: p.y };
      const direction = Math.atan2(p.y - last.pose.y, p.x - last.pose.x);
      if (last.direction != null) {
        const turn = delta(direction, last.direction);
        if (turn > max.path.degrees) max.path = { degrees: turn, phase: p.phase, fromPhase: last.pose.phase, frame: f.frame, timeMs: f.timeMs, x: p.x, y: p.y };
      }
      previous.set(d.index, { pose: p, frame: f.frame, direction });
    } else previous.set(d.index, { pose: p, frame: f.frame });
    maxima.set(d.index, max);
  }
  rec.firstVisibleMs = Math.min(...[...firstSeen.values()].map(d => d.timeMs));
  rec.firstImpactMs = trace.frames.find(f => f.impacts.length)?.impacts[0].simulationMs - trace.activationSim;
  rec.firstVisibilityByDrone = [...firstSeen.values()];
  rec.fadeFallbacks = rec.firstVisibilityByDrone.filter(d => d.fallback || d.fadedAtFirstVisibility);
  rec.maxDirectionChangePerSimulationFrame = [...maxima.values()];
  rec.aim = [...new Map(trace.frames.flatMap(f => f.drones.map(d => [d.index, { drone: d.index, aimOffset: d.aimOffset, aimAngle: d.aimAngle, aimDegrees: d.aimAngle * 180 / Math.PI }]))).values()];
  rec.approachCrossings = approachCrossings(trace);
}

async function capture(id) {
  const rec = { id, console: [], pageErrors: [], httpErrors: [], requestErrors: [], shaderErrors: [], stills: [] };
  report.variants.push(rec);
  const page = await context.newPage(), frameDir = join(tmp, `frames-${id}`);
  await removeOwned(frameDir);
  await mkdir(frameDir, { recursive: true });
  page.setDefaultTimeout(180000);
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) { const e = { type: m.type(), text: m.text() }; rec.console.push(e); if (/shader|GL_INVALID|WebGL.*error/i.test(e.text)) rec.shaderErrors.push(e); } });
  page.on('pageerror', e => rec.pageErrors.push(String(e.stack ?? e)));
  page.on('response', r => { if (r.status() >= 400) rec.httpErrors.push({ status: r.status(), url: r.url() }); });
  page.on('requestfailed', r => rec.requestErrors.push({ url: r.url(), error: r.failure()?.errorText }));
  const run = command => page.evaluate(c => window.__flight.run(c), command);
  const settle = async () => {
    const start = Date.now();
    for (;;) {
      await run({ action: 'settle', frames: 12 });
      const work = await page.evaluate(() => window.devScenario.status().loading?.work);
      if (!work || work.renderReady && work.pending === 0) return;
      if (Date.now() - start > 60000) throw Error('Settle timeout');
    }
  };
  console.log(`${id}: boot`);
  try {
    const scenario = { version: 1, mapId: '1', classId: 'inspector_gadachs', seed: 12345, timeOfDay: id.endsWith('night') ? 1320 : 720,
      hideAim: true, hideTutorial: true, suppressWaves: true, freezeMission: true };
    await page.goto(`http://127.0.0.1:${port}/dev-scenario.html?visual-test=1#scenario=${encodeURIComponent(JSON.stringify(scenario))}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const s = window.devScenario?.status(); if (s?.state === 'error') throw Error(s.message); return s?.paused && s.ready; });
    await install(page);
    await run({ action: 'inspectorUltimates', phase: 'prepare', ultimate: 'bomber', motion: 'stand', upgrades: id.startsWith('full') ? 'full' : 'base', targets: id.startsWith('cluster') ? 'cluster' : 'spread' });
    await run({ action: 'camera', focusTarget: false, zoom: 1 });
    await page.addStyleTag({ content: '#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}' });
    await page.evaluate(() => {
      window.__flight.scene.clarityCamera.setVisible(false);
      // The presentation frame reactivates this world-space HUD every frame; camera exclusion persists.
      window.__flight.scene.cameras.main.ignore(window.__flight.scene.playerStatusRing.container);
      return document.fonts.ready;
    });
    await settle(); await run({ action: 'step', frames: 120 }); await settle(); await run({ action: 'step', frames: 60 }); await settle();
    // Align activation to a whole 50-ms boundary: avoids different 16/17-ms host-clock rounding by variant.
    rec.clockAlignmentFrames = await page.evaluate(() => (3 - Math.round(window.__flight.dev.clock.now * 60 / 1000) % 3) % 3);
    if (rec.clockAlignmentFrames) { await run({ action: 'step', frames: rec.clockAlignmentFrames }); await settle(); }
    rec.renderer = await page.evaluate(() => { const gl = window.__flight.game.renderer.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    const activationSim = await page.evaluate(() => window.__flight.activationSim = window.__flight.dev.clock.now);
    await run({ action: 'inspectorUltimates', phase: 'activate' });
    await settle();
    const trace = { id, commit: report.commit, activationSim, samplingHz: 60, screenshotEveryFrames: 2, frames: [] };
    let frame = 0, imageCount = 0, endAt = Infinity, firstSquad, stop = false;
    const rawName = n => join(frameDir, `${String(n).padStart(6, '0')}.png`);
    while (!stop) {
      const s = await page.evaluate(() => window.__flight.sample());
      s.frame = frame; s.timeMs = s.simulationMs - activationSim; s.videoFrame = frame % 2 === 0 ? imageCount : null;
      trace.frames.push(s);
      if (!firstSquad && s.inspectorUltimates.squadrons?.length) {
        firstSquad = s.inspectorUltimates.squadrons[0];
        const p = firstSquad.params, runMs = p.corridorLengthPx / p.runSpeedPxPerSec * 1000;
        endAt = Math.max(firstSquad.endsAt, firstSquad.startedAt + (p.droneCount - 1)*p.launchIntervalMs + p.approachMs + p.passCount*runMs + (p.passCount-1)*p.turnMs + p.departureMs) + 1000;
        rec.squadronEndsMs = firstSquad.endsAt - s.inspectorUltimates.activatedAt;
        rec.flightEndsMs = endAt - 1000 - s.inspectorUltimates.activatedAt;
        rec.params = p;
      }
      if (frame % 2 === 0) {
        await page.locator('canvas').first().screenshot({ path: rawName(imageCount), animations: 'allow', caret: 'hide' });
        if (await page.evaluate(() => window.__flight.dev.clock.now) !== s.simulationMs) throw Error('Screenshot advanced simulation');
        imageCount++;
      }
      if (!rec.stills.length && s.drones.some(d => d.visible)) {
        const file = `still__${id}__edge.png`;
        await page.locator('canvas').first().screenshot({ path: join(out, file), animations: 'allow' });
        rec.stills.push({ file, label: 'Erste sichtbare Drohne / Bildrand', frame, timeMs: s.timeMs });
      }
      if (frame % 120 === 0) console.log(`${id}: t=${(s.timeMs/1000).toFixed(1)}s, ${imageCount} frames`);
      if (frame > 2400) throw Error('No squadron end within 40 simulation seconds');
      stop = s.now >= endAt && frame % 2 === 0;
      if (!stop) { await run({ action: 'step', frames: 1 }); frame++; }
    }
    if (!firstSquad || !rec.stills.length) throw Error('No visible bomber');
    const p = firstSquad.params, runMs = p.corridorLengthPx / p.runSpeedPxPerSec * 1000;
    const start = firstSquad.startedAt - trace.frames[0].inspectorUltimates.activatedAt;
    const shots = [ ['approach', 'Mitte Anflug', start+p.approachMs/2], ['entry', 'Korridoreintritt', start+p.approachMs],
      ['carpet', 'Erster Teppich', start+p.approachMs+runMs*(p.bombsPerPass-.5)/p.bombsPerPass+p.bombFallMs] ];
    if (p.passCount > 1) shots.push(['turn', 'Tropfenwende', start+p.approachMs+runMs+p.turnMs/2], ['return', 'Rückflug', start+p.approachMs+runMs+p.turnMs+runMs/2]);
    shots.push(['departure', 'Abflug', start+p.approachMs+p.passCount*runMs+(p.passCount-1)*p.turnMs+p.departureMs*.15]);
    for (const [name, label, target] of shots) {
      const s = trace.frames.filter(f => f.videoFrame != null).reduce((a,b) => Math.abs(a.timeMs-target)<Math.abs(b.timeMs-target) ? a:b);
      const file = `still__${id}__${name}.png`; await copyFile(rawName(s.videoFrame), join(out, file));
      rec.stills.push({ file, label, frame: s.frame, timeMs: s.timeMs });
    }
    rec.stills.sort((a,b) => a.frame-b.frame);
    measurements(rec, trace);
    rec.simulationFrames = trace.frames.length; rec.videoFrames = imageCount; rec.videoSeconds = imageCount/30;
    rec.capturedThroughMs = trace.frames.at(-1).timeMs;
    await writeFile(join(out, `trace__${id}.json`), JSON.stringify(trace) + '\n');
    await detailCrops(rec, trace); await paths(rec, trace); await board(rec);
    console.log(`${id}: encoding ${imageCount} frames`);
    await encode(['-framerate', '30', '-i', join(frameDir, '%06d.png'), '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-cpu-used', '4', '-row-mt', '1', '-threads', '4', '-pix_fmt', 'yuv420p', join(out, `flight__${id}.webm`)]);
    await encode(['-framerate', '30', '-i', join(frameDir, '%06d.png'), '-filter_complex', '[0:v]fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0', join(out, `flight__${id}.gif`)]);
    rec.webmBytes = (await stat(join(out, `flight__${id}.webm`))).size;
    rec.gifBytes = (await stat(join(out, `flight__${id}.gif`))).size;
    await removeOwned(frameDir); rec.rawFramesRemoved = true;
    console.log(`${id}: done; visible ${rec.firstVisibleMs.toFixed(1)}ms, impact ${rec.firstImpactMs.toFixed(1)}ms, fades ${rec.fadeFallbacks.length}`);
  } catch (e) { rec.error = String(e.stack ?? e); throw e; }
  finally { await page.close(); await json(reportPath, report); }
}

try {
  // Preflight binds and releases only our probe socket. strictPort protects against races afterwards.
  await new Promise((res, rej) => { const probe = net.createServer(); probe.once('error', rej); probe.listen(port, '127.0.0.1', () => probe.close(res)); });
  server = await createServer({ root, configLoader: 'runner', cacheDir: join(tmp, 'vite-cache'), logLevel: 'warn', clearScreen: false,
    define: { __BUILD_TIMESTAMP__: JSON.stringify('2023-11-14T22:13:20Z') },
    server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false, watch: null } });
  await server.listen();
  if ((await fetch(`http://127.0.0.1:${port}/dev-scenario.html`)).status !== 200) throw Error('HTTP readiness failed');
  profile = await mkdtemp(join(tmp, 'chrome-'));
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'] });
  report.browser = context.browser()?.version();
  for (const p of context.pages()) await p.close();
  for (const id of variants) await capture(id);
} catch (e) { report.errors.push(String(e.stack ?? e)); console.error(e); process.exitCode = 1; }
finally {
  await shutdown(); report.profileRemoved = profile ? !existsSync(profile) : null;
  report.finishedAt = new Date().toISOString(); await json(reportPath, report);
}
