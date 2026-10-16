#!/usr/bin/env node
// Real two-browser late join: host A runs a dev scenario on a real PeerJS/WebRTC session, a fresh
// client B joins mid-deployment, and both peers must agree on the replicated state. See README.md.
//   node tools/latejoin/latejoin.mjs [--root <checkout>] [--port <n>] [--out <dir>] [--phase holo,bomber]
//                                    [--offline-smoke]
// No production files, network factories or snapshot providers are replaced.
// --offline-smoke exercises only the existing isolated scenario; it NEVER passes the late-join test.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const PHASES = ['holo', 'bomber'];
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
for (let i = 0; i < argv.length; i++) {
  if (['--root', '--port', '--out', '--phase'].includes(argv[i])) i++;
  else if (argv[i] !== '--offline-smoke') throw Error(`Unknown argument ${argv[i]}`);
}
const root = resolve(option('--root', resolve(dirname(fileURLToPath(import.meta.url)), '../..')));
const out = resolve(root, option('--out', 'build/latejoin'));
const offline = argv.includes('--offline-smoke');
const phases = option('--phase', PHASES.join(',')).split(',');
if (phases.some(name => !PHASES.includes(name))) throw Error(`Unknown phase; known: ${PHASES.join(', ')}`);
const port = Number(option('--port', 8099)), origin = `http://127.0.0.1:${port}`;
// 8080 and 8090 belong to the user's own dev servers (AGENTS.md).
if (!Number.isInteger(port) || [8080, 8090].includes(port)) throw Error(`Port ${port} is not allowed`);
const resultFile = join(out, offline ? 'offline-smoke-result.json' : 'latejoin-result.json');
const requireRoot = createRequire(join(root, 'package.json'));
const { chromium } = requireRoot('playwright-core');
const vitePackage = requireRoot.resolve('vite/package.json');
const viteMeta = JSON.parse(await readFile(vitePackage, 'utf8'));
let viteEntry = viteMeta.exports['.'];
while (typeof viteEntry === 'object') viteEntry = viteEntry.import ?? viteEntry.default;
const { createServer } = await import(pathToFileURL(join(dirname(vitePackage), viteEntry)).href);
const result = {
  mode: offline ? 'isolated-offline-smoke-NOT-latejoin' : 'real-peerjs-two-browser-latejoin',
  status: 'running', startedAt: new Date().toISOString(), port,
  commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  design: 'Two independent rounds/rooms and fresh client profiles: full Holo, then full Bomber. One ultimate slot per loadout.',
  clockScope: 'Scenario controller prepares/activates the fixture, then detaches before client creation. Its existing ScenarioClock alone drives ordinary host frames; zero-delta frames keep network/loading alive. No controller commands after handoff. Client Date.now follows the controlled host epoch. Real WebRTC, broker, handshake, stores and presentation run unchanged. Wall-clock/latency synchronization is NOT tested.',
  phases: [], events: [], cleanup: [], errors: [],
};
let server, activeStep = 'initialization', aborted = false;
const contexts = new Set(), profiles = new Set();
const stamp = () => new Date().toISOString();
function event(type, detail = {}) { result.events.push({ at: stamp(), step: activeStep, type, ...detail }); }
function announce(name) { activeStep = name; console.log(`[${stamp()}] ${name}`); event('step'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function timed(label, fn, ms = 60000) {
  announce(label); let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`Timeout after ${ms} ms: ${label}`)), ms);
  })]); } finally { clearTimeout(timer); }
}
function check(phase, name, passed, values) {
  phase.checks.push({ name, status: passed ? 'passed' : 'failed', values });
  if (!passed) throw Error(`Assertion failed: ${phase.name}/${name}`);
}
async function save() { await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n'); }
async function closeContexts() {
  // Close the late client first, so deliberate host teardown cannot look like a client failure.
  for (const context of [...contexts].reverse()) {
    try { await context.close(); contexts.delete(context); result.cleanup.push({ type: 'chrome', closed: true }); }
    catch (e) { result.errors.push(`Chrome cleanup: ${e.message}`); }
  }
  if (!contexts.size) for (const profile of [...profiles]) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); profiles.delete(profile);
      result.cleanup.push({ type: 'profile', path: profile, removed: !existsSync(profile) });
    } catch (e) { result.errors.push(`Profile cleanup: ${e.message}`); }
  }
}
async function cleanup() {
  await closeContexts();
  if (server) { try { await server.close(); server = null; result.cleanup.push({ type: 'vite', closed: true }); }
    catch (e) { result.errors.push(`Vite cleanup: ${e.message}`); } }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.once(signal, () => {
  aborted = true; result.status = 'interrupted'; result.errors.push(signal);
  void cleanup().then(save).finally(() => process.exit(130));
});

// This function is serialized as an ES module served by Vite. Imports resolve to the game's own singletons.
async function browserHarness() {
  const options = window.__LJ_OPTIONS__;
  const nativeNow = Date.now;
  const h = window.__lj = { options, events: [], impacts: [], genericExplosions: [], firstSeen: {}, plans: new Map(), frames: 0,
    clock: options.epoch, pumping: false, currentDrop: null, renderer: null, wireHistory: [], lastWire: '' };
  if (options.role === 'B') Date.now = () => h.clock;
  const { bridge } = await import('/src/network/bridge.ts');
  const { getActiveSession } = await import('/src/network/peer/session.ts');
  const { getRenderResolutionController } = await import('/src/graphics/RenderResolution.ts');
  const { PEER_PROTOCOL_VERSION } = await import('/src/network/peer/protocol.ts');
  const { BomberSquadronRenderer } = await import('/src/effects/bomberSquadron/BomberSquadronRenderer.ts');
  const { EffectSystem } = await import('/src/effects/EffectSystem.ts');
  const { bomberDrops } = await import('/src/systems/bomberSquadron/BomberSquadronPlan.ts');
  const { NET_TICK_INTERVAL_MS } = await import('/src/config.ts');
  const { inspectorUltimatesStatus } = await import('/src/dev/scenario/InspectorUltimatesReview.ts');
  h.bridge = bridge;
  h.scene = () => getRenderResolutionController()?.game?.scene.getScene('ArenaScene');
  const add = (type, detail = {}) => h.events.push({ type, at: Date.now(), wall: nativeNow(), ...detail });
  const effect = EffectSystem.prototype.playExplosionEffect;
  EffectSystem.prototype.playExplosionEffect = function (x, y, radius, color, style = 'default', ...rest) {
    h.genericExplosions.push({ at: Date.now(), x, y, radius, style });
    return effect.call(this, x, y, radius, color, style, ...rest);
  };
  // Observe the actual presentation port. drawDrops supplies identity/timing without changing decisions.
  const draw = BomberSquadronRenderer.prototype.drawDrops;
  if (typeof draw !== 'function') throw Error('BomberSquadronRenderer.drawDrops API drift');
  BomberSquadronRenderer.prototype.drawDrops = function (visual, previous, now, view, count) {
    const prior = h.currentDrop;
    h.currentDrop = { visual, previous, now, pending: visual.drops.filter(d => !d.done), observed: new Set() };
    try { return draw.call(this, visual, previous, now, view, count); } finally { h.currentDrop = prior; }
  };
  const update = BomberSquadronRenderer.prototype.update;
  BomberSquadronRenderer.prototype.update = function (snapshot, now) {
    h.renderer = this;
    if (!this.__ljObserved) {
      this.__ljObserved = true;
      const explode = this.ports.explode;
      this.ports.explode = (...args) => {
        const c = h.currentDrop;
        const drop = c?.pending.find(d => d.done && !c.observed.has(d) && d.x === args[0] && d.y === args[1] && d.impactAt <= c.now);
        if (drop) c.observed.add(drop);
        h.impacts.push({ at: c?.now, presentationNow: c?.now, deploymentId: c?.visual.snapshot.id,
          firstSeenAt: c?.visual.firstSeenAt, impactAt: drop?.impactAt ?? null, x: args[0], y: args[1], radius: args[2] });
        return explode(...args);
      };
    }
    const answer = update.call(this, snapshot, now);
    for (const [id, visual] of this.squadrons) if (!(id in h.firstSeen)) {
      h.firstSeen[id] = visual.firstSeenAt; add('bomber-first-presentation', { id, firstSeenAt: visual.firstSeenAt });
    }
    return answer;
  };
  // Diagnostic map content must also exist on the real client before materialization.
  // Exact authored fixture used by InspectorUltimatesReview; no gameplay/state is sent out-of-band.
  if (options.role === 'B') {
    const { registerDiagnosticMap } = await import('/src/config/coopDefenseMaps.ts');
    registerDiagnosticMap({ mapId: 'inspector-ultimates-review', arenaWidthCells: 90, arenaHeightCells: 70,
      timeOfDay: '12:00', rockFillRatio: 0, treeCount: 0, trackMode: 'none', tutorialDurationMs: 0,
      balanceReferenceDurationSec: 3600, objective: 'survive', surviveDurationSec: 3600, respawnsPerPlayer: 3,
      bases: [], persistentBase: { baseId: 'review-base', anchor: { gridX: 70, gridY: 54 } },
      encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [] });
  }
  if (options.offline) (await import('/src/utils/devScenarioMode.ts')).enableDevScenarioMode();
  h.connection = () => {
    const session = getActiveSession();
    return { protocol: PEER_PROTOCOL_VERSION, roomCode: session?.roomCode ?? null, host: session?.room.isHost() ?? null,
      links: session?.transport.getLinks().map(l => ({ remotePeerId: l.remotePeerId, open: l.isOpen,
        rtc: l.peerConnection?.connectionState, reliable: l.reliableChannel?.readyState,
        fast: l.unreliableChannel?.readyState })) ?? [] };
  };
  h.read = () => {
    const session = getActiveSession();
    if (!session) return { connection: h.connection(), body: document.body.innerText };
    const scene = h.scene(), initial = session.room.getGlobal('gsi'), fast = session.room.getGlobal('gs');
    for (const squadron of bridge.getBomberSquadronSnapshot().squadrons) squadron.anchors.forEach((anchor,index) => {
      if (anchor) for (const drop of bomberDrops(squadron,index,anchor)) h.plans.set(`${squadron.id}:${drop.drone}:${drop.pass}:${drop.bomb}`, {deploymentId:squadron.id,...drop});
    });
    return { connection: h.connection(), now: bridge.getSynchronizedNow(), localId: bridge.getLocalPlayerId(),
      phase: bridge.getGamePhase(), spectator: bridge.isLocalSpectator(), world: bridge.getWorldDescriptor(),
      gameMode: bridge.getGameMode(),
      activity: bridge.getActivityDescriptor(), readyLoadout: bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId()),
      fc: structuredClone(bridge.getFireControlSnapshot()), bq: structuredClone(bridge.getBomberSquadronSnapshot()),
      wire: { initial: initial && { _s: initial._s, _b: initial._b, fc: initial.fc, bq: initial.bq },
        fast: fast && { _s: fast._s, _b: fast._b, fc: fast.fc, bq: fast.bq } },
      loading: scene?.arenaRuntime?.getScenarioLoadingState(), frames: h.frames,
      firstSeen: { ...h.firstSeen }, impactCount: h.impacts.length,
      visuals: h.renderer ? { squadrons: h.renderer.squadrons.size, bombs: h.renderer.bombs.length } : null,
      controller: h.dev ? { attached: scene?.devScenario === h.dev, handedOff: !!h.handedOff,
        state: h.dev.state, message: h.dev.message, lastAction: h.dev.lastAction,
        arenaStarted: bridge.isArenaStarted(), terminated: scene.arenaRuntime.isMatchTerminated() } : null,
      scenario: h.dev ? inspectorUltimatesStatus(h.dev) : null };
  };
  h.finish = () => ({ ...h.read(), impacts: h.impacts, genericExplosions: h.genericExplosions, plannedDrops: [...h.plans.values()],
    events: h.events, wireHistory: h.wireHistory });
  h.wait = async (predicate, timeout = 45000) => {
    const start = performance.now();
    while (!predicate()) { if (performance.now() - start > timeout) throw Error('Browser-side wait timeout');
      await new Promise(r => setTimeout(r, 15)); }
  };
  h.attachHost = async () => {
    const session = getActiveSession();
    if (!session?.room.isHost() || (!options.offline && !/^[A-Z0-9]{6}$/.test(session.roomCode))) throw Error('Real host required');
    // Enable only AFTER real NetworkBridge.connect completed. Never call connect again.
    (await import('/src/utils/devScenarioMode.ts')).enableDevScenarioMode();
    const scene = h.scene();
    if (!scene?.arenaRuntime || !scene.ctx?.inputSystem) throw Error('ArenaScene runtime API drift');
    if (options.offline && scene.devScenario) {
      // Exercise the same late attachment branch as a real normal-entry host, not just the
      // controller automatically created by the isolated entry. This stays an offline smoke test.
      scene.devScenario.destroy(); scene.devScenario = null;
    }
    if (!scene.devScenario) {
      const { DevScenarioController } = await import('/src/dev/scenario/controller.ts');
      scene.devScenario = new DevScenarioController(scene, scene.arenaRuntime,
        (angle, trigger) => scene.ctx.inputSystem.setDiagnosticInput(angle, trigger), () => scene.lobbyOverlay.isRevealComplete());
    }
    h.dev = scene.devScenario;
    if (getActiveSession() !== session) throw Error('Scenario attachment replaced real session');
    h.frameClock = h.dev.clock;
    setInterval(() => { if (h.pumping && h.frameClock.paused && h.frameClock.pendingSteps === 0) h.frameClock.settle(1); }, 20);
    add('scenario-attached-to-existing-session', { roomCode: session.roomCode });
  };
  h.prepare = async ultimate => {
    const answer = await window.devScenario.run({ action: 'inspectorUltimates', phase: 'prepare', ultimate,
      arsenal: 'single', motion: 'stand', upgrades: 'full' });
    if (!answer.ok) throw Error(answer.error);
    h.dev.pause(); h.pumping = true;
    h.dev.setPanelCollapsed(true);
    return { ...h.read(), expectedUpgrades: h.dev.config.upgrades };
  };
  h.step = async frames => {
    if (h.handedOff) throw Error('Scenario controller commands forbidden after handoff');
    return h.advanceFrames(frames);
  };
  h.advanceFrames = async frames => {
    h.pumping = false;
    try {
      await h.wait(() => h.frameClock.pendingSteps === 0);
      if (h.handedOff) h.frameClock.step(frames);
      else h.dev.step(frames);
      await h.wait(() => h.frameClock.pendingSteps === 0);
    } finally { h.pumping = true; }
    return bridge.getSynchronizedNow();
  };
  h.handoff = async () => {
    h.pumping = false;
    await h.wait(() => h.frameClock.pendingSteps === 0);
    const scene = h.scene(), session = getActiveSession(), before = h.read();
    if (scene.devScenario !== h.dev || h.dev.state !== 'ready') throw Error('Expected ready attached controller before handoff');
    // update() uses isolated-host mutation ports, which reject a real late peer. Detach BEFORE
    // joining. Do not call stop/destroy: they cancel ultimate actions and restore the wall clock.
    scene.devScenario = null;
    clearInterval(h.dev.refreshTimer);
    window.removeEventListener('hashchange', h.dev.onHashChange);
    scene.ctx.inputSystem.setDiagnosticInput(0, null);
    bridge.sendLocalInput({ dx: 0, dy: 0, aim: 0, dashHeld: false });
    h.handedOff = true;
    let rejectedControllerStep = null;
    if (options.offline) {
      // Regression probe only: make the diagnostic controller unready, as in the reported run.
      // This changes no World/network state and cannot stand in for a real peer join.
      h.dev.state = 'error';
      h.dev.message = 'Offline regression probe: controller deliberately unready after detachment';
      try { h.dev.step(1); } catch (error) { rejectedControllerStep = error.message; }
      if (!rejectedControllerStep) throw Error('Offline probe expected controller readiness rejection');
    }
    if (getActiveSession() !== session) throw Error('Clock handoff replaced session');
    h.pumping = true;
    const after = h.read();
    add('controller-detached-clock-retained', { rejectedControllerStep, before: before.controller, after: after.controller });
    return { before, after, rejectedControllerStep };
  };
  h.activate = async () => {
    const answer = await window.devScenario.run({ action: 'inspectorUltimates', phase: 'activate' });
    if (!answer.ok) throw Error(answer.error);
    await h.step(1); return h.read();
  };
  h.networkTick = () => h.advanceFrames(Math.ceil(NET_TICK_INTERVAL_MS / (1000 / 60)) + 1);
  h.setClock = async value => {
    if (options.role !== 'B' || value < h.clock) throw Error('Non-monotone client test clock');
    h.clock = value;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  h.focus = (ultimate) => {
    const scene = h.scene();
    const camera = scene.cameras.main;
    // Presentation only: same unobstructed fixture view on both peers, without changing aim/state.
    const apply = () => { camera.stopFollow(); camera.removeBounds(); camera.setZoom(.8);
      camera.setScroll((ultimate === 'holo' ? 976 : 1250) - camera.width / 1.6, 976 - camera.height / 1.6); };
    scene.events.on('postupdate', apply); apply();
  };
  // Read-only receipt history, including the reliable bootstrap before the first rendered frame.
  setInterval(() => {
    const session = getActiveSession(); if (!session) return;
    const i = session.room.getGlobal('gsi'), f = session.room.getGlobal('gs');
    const key = `${i?._s}:${f?._s}`;
    if (key !== h.lastWire) { h.lastWire = key; h.wireHistory.push({ at: Date.now(), initial: i && { _s: i._s, _b: i._b, fc: i.fc, bq: i.bq },
      fast: f && { _s: f._s, _b: f._b, fc: f.fc, bq: f.bq } }); }
    const scene = h.scene();
    if (scene && !h.frameHook) { h.frameHook = true; scene.events.on('postupdate', () => h.frames++); }
  }, 20);
  add('instrumentation-installed-before-main');
  await import('/src/main.ts');
}

async function makeBrowser(phase, role, epoch) {
  const profile = await mkdtemp(join(out, `.profile-${phase.name}-${role}-`)); profiles.add(profile);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'de-DE',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'],
  }); contexts.add(context);
  await context.addInitScript(({ role, epoch, offline }) => { window.__LJ_OPTIONS__ = { role, epoch, offline }; }, { role, epoch, offline });
  const page = await context.newPage(); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(60000);
  for (const spare of context.pages()) if (spare !== page) await spare.close();
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) {
    const info={ phase: phase.name, peer: role, level: m.type(), text: m.text() }; event('console',info);
    if(m.type()==='error') phase.browserErrors.push({type:'console',...info});
  } });
  page.on('pageerror', e => { phase.browserErrors.push({ peer: role, type: 'pageerror', text: e.message }); event('pageerror', { peer: role, text: e.message }); });
  page.on('requestfailed', r => event('requestfailed', { peer: role, url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) { const info = { peer: role, status: r.status(), url: r.url() }; phase.browserErrors.push(info); event('http-error', info); } });
  page.on('websocket', ws => ws.on('socketerror', error => event('websocket-error', { peer: role, url: ws.url(), error: String(error) })));
  return page;
}
async function waitPage(page, label, condition, ms = 180000) {
  return timed(label, async () => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const bootError = await page.evaluate(() => window.__ljBootError);
      if (bootError) throw Error(bootError);
      const probe = await page.evaluate(condition);
      if (probe) return probe;
      const failure = await page.evaluate(() => document.body.innerText.includes('Verbindungsserver nicht erreichbar') ? document.body.innerText : null);
      if (failure) throw Error(failure);
      await sleep(100);
    }
    throw Error(`Condition timed out: ${label}`);
  }, ms + 2000);
}
const holoFacts = s => s.fc.deployments.filter(d => d.kind === 'holo').map(d => ({ id: d.id, owner: d.ownerId,
  seq: d.copies.map(c => c.seq).sort((a,b) => a-b) })).sort((a,b) => a.id-b.id);
const bomberFacts = s => s.bq.squadrons.map(d => ({ id: d.id, owner: d.ownerId, stoppedAt: d.stoppedAt,
  anchors: d.anchors.map(a => a && ({ x: Math.round(a.x*10), y: Math.round(a.y*10) })) })).sort((a,b) => a.id-b.id);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
async function read(page) { return page.evaluate(() => window.__lj.read()); }
async function checkpoint(phase, a, b, name) {
  const facts = phase.name === 'holo' ? holoFacts : bomberFacts;
  const pair = await timed(`${phase.name}: compare ${name}`, async () => {
    for (let n=0;n<100;n++) {
      const [host, client] = await Promise.all([read(a), read(b)]);
      if (equal(facts(host), facts(client))) return { host, client };
      await sleep(50);
    }
    return { host: await read(a), client: await read(b) };
  });
  phase.samples.push({ name, ...pair });
  check(phase, `${name}: replicated identities/seq or stoppedAt/anchors`, equal(facts(pair.host), facts(pair.client)), { host: facts(pair.host), client: facts(pair.client) });
  check(phase, `${name}: real WebRTC links open`, [pair.host, pair.client].every(s => s.connection.links.some(l => l.open && l.rtc === 'connected' && l.reliable === 'open' && l.fast === 'open')), { host: pair.host.connection, client: pair.client.connection });
  check(phase, `${name}: ${name === 'end' ? 'both slices empty' : 'deployment alive on both peers'}`,
    name === 'end' ? [pair.host,pair.client].every(s => !s.fc.deployments.length && !s.bq.squadrons.length)
      : facts(pair.host).length > 0 && facts(pair.client).length > 0, { host: facts(pair.host), client: facts(pair.client) });
  for (const [role,page] of [['A',a],['B',b]]) {
    const file = `${phase.name}-${role}-${name}.png`;
    await page.screenshot({ path: join(out,file) }); phase.screenshots.push(file);
  }
  await save(); return pair;
}
async function advance(a, b, target) {
  while ((await read(a)).now < target) {
    const now = await a.evaluate(() => window.__lj.advanceFrames(3));
    if (b) await b.evaluate(now => window.__lj.setClock(now), now);
  }
}
async function runPhase(name) {
  const phase = { name, status: 'running', checks: [], samples: [], screenshots: [], browserErrors: [],
    coverage: { realJoin: 'not-run', afterJoin: 'not-run', middle: 'not-run', end: 'not-run',
      historicalImpactSuppression: name === 'bomber' ? 'not-run' : 'not-applicable' } };
  result.phases.push(phase); let a,b;
  try {
    a = await timed(`${name}: launch host Chrome`, () => makeBrowser(phase,'A',null));
    await timed(`${name}: normal main.ts boot / PeerJS host registration`, () => a.goto(`${origin}/__latejoin__.html`));
    await waitPage(a, `${name}: host connected and scene/lobby ready`, () => {
      const h=window.__lj, c=h?.connection?.(), s=h?.scene?.();
      return c?.host && s?.arenaRuntime && s.lobbyOverlay?.isRevealComplete();
    });
    phase.hostConnection = await a.evaluate(() => window.__lj.connection());
    check(phase, 'transport precondition', offline ? phase.hostConnection.roomCode === 'DEV' : /^[A-Z0-9]{6}$/.test(phase.hostConnection.roomCode), phase.hostConnection);
    await timed(`${name}: attach existing scenario controller AFTER network boot`, () => a.evaluate(() => window.__lj.attachHost()));
    const prepared = await timed(`${name}: full-upgrade profile / regular Ready and round start`, () => a.evaluate(name => window.__lj.prepare(name),name), 210000);
    phase.prepared = prepared;
    check(phase, 'Coop round / Inspector committed loadout', prepared.phase === 'ARENA' && prepared.gameMode === 'coop_defense'
      && prepared.readyLoadout?.coopDefenseClassId === 'inspector_gadachs'
      && prepared.readyLoadout?.ultimate === (name === 'holo' ? 'HOLO_OFFENSIVE' : 'BOMBER_SQUADRON'), prepared.readyLoadout);
    check(phase, 'full upgrades survived regular Ready commit', Object.entries(prepared.expectedUpgrades).every(([id,level]) =>
      prepared.readyLoadout.coopDefenseProfile?.upgrades[id]?.level === level), { expected: prepared.expectedUpgrades,
      actual: Object.fromEntries(Object.keys(prepared.expectedUpgrades).map(id=>[id,prepared.readyLoadout.coopDefenseProfile?.upgrades[id]])) });
    await a.evaluate(name => window.__lj.focus(name), name);
    const active = await timed(`${name}: activate through scenario ultimate action port`, () => a.evaluate(() => window.__lj.activate()));
    phase.activation = active;
    const deployment = name === 'holo' ? active.fc.deployments.find(d=>d.kind==='holo') : active.bq.squadrons[0];
    check(phase, 'activation produced authoritative deployment', !!deployment, active.scenario);
    const startedAt = deployment.startedAt, endAt = name === 'holo' ? deployment.expiresAt : deployment.endsAt;
    // Bomber: one second after the replicated approach, so impacts already happened before the join (GU3: approach 1.5 s).
    const joinAt = name === 'holo' ? startedAt + 2500 : startedAt + deployment.params.approachMs + 1000;
    await timed(`${name}: advance to live late-join point`, () => advance(a,null,joinAt));
    const before = await a.evaluate(() => window.__lj.finish()); phase.beforeJoin = before;
    check(phase, 'live deployment before client creation', (name === 'holo' ? holoFacts(before) : bomberFacts(before)).length > 0, { now:before.now, endAt });
    if (name === 'bomber') check(phase, 'historical impacts exist (non-vacuous)', before.impacts.length > 0, before.impacts);
    phase.handoff = await timed(`${name}: detach isolated scenario controller before peer join`, () => a.evaluate(() => window.__lj.handoff()));
    check(phase, 'handoff preserves live authoritative state and clock',
      !phase.handoff.after.controller.attached && phase.handoff.after.controller.handedOff
      && phase.handoff.before.now === phase.handoff.after.now
      && equal(phase.handoff.before.fc, phase.handoff.after.fc) && equal(phase.handoff.before.bq, phase.handoff.after.bq),
      { before: phase.handoff.before.controller, after: phase.handoff.after.controller, now: phase.handoff.after.now });
    if (offline) {
      const tickNow = await timed(`${name}: offline ordinary network tick without ready controller`, () => a.evaluate(() => window.__lj.networkTick()));
      check(phase, 'unready controller does not block ordinary frames', !!phase.handoff.rejectedControllerStep && tickNow > before.now,
        { controllerRejection: phase.handoff.rejectedControllerStep, before: before.now, after: tickNow });
      await timed(`${name}: offline host continuation only`, () => advance(a,null,endAt+500));
      phase.offlineEnd = await a.evaluate(() => window.__lj.finish());
      check(phase,'offline host slices empty',!phase.offlineEnd.fc.deployments.length&&!phase.offlineEnd.bq.squadrons.length,phase.offlineEnd.scenario);
      check(phase,'offline observation hooks / no browser errors', !phase.browserErrors.length && (name==='holo' || phase.offlineEnd.impacts.every(e=>Number.isFinite(e.impactAt))), { browserErrors:phase.browserErrors, impacts:phase.offlineEnd.impacts.length });
      phase.status = 'offline-host-smoke-only'; return;
    }
    b = await timed(`${name}: launch fresh late client Chrome`, () => makeBrowser(phase,'B',before.now));
    phase.joinCutoff = before.now;
    await timed(`${name}: B joins room ${before.connection.roomCode} via #r=`, () => b.goto(`${origin}/__latejoin__.html#r=${before.connection.roomCode}`));
    await waitPage(b,`${name}: real client handshake completed`,()=>window.__lj?.connection?.().host===false,45000);
    phase.coverage.realJoin='connected-awaiting-evidence';
    // Join requests a reliable full snapshot; zero-delta frames alone cannot cross the network throttle.
    const bootstrapNow=await timed(`${name}: ordinary host network tick publishes requested bootstrap`,()=>a.evaluate(()=>window.__lj.networkTick()));
    await b.evaluate(now=>window.__lj.setClock(now),bootstrapNow);
    await waitPage(b,`${name}: client receives live bootstrap and materializes World`,()=>{
      const h=window.__lj, s=h?.scene?.(); if (!s?.arenaRuntime || !h.connection?.().roomCode || h.connection().host) return false;
      const r=h.read(); return r.phase==='ARENA' && r.spectator && r.loading?.terrainSnapshotReady && r.loading?.combatPresentationPrepared
        && (h.options.role==='B') && (r.fc.deployments.length || r.bq.squadrons.length) && h.frames>5;
    });
    await b.evaluate(name=>window.__lj.focus(name),name);
    if(name==='bomber') await waitPage(b,'bomber: client renderer has seen the active squadron',()=>Object.keys(window.__lj.firstSeen).length>0);
    const joined = await checkpoint(phase,a,b,'after-join');
    phase.coverage.afterJoin='passed';
    check(phase,'same real room / distinct player identities', joined.host.connection.roomCode===joined.client.connection.roomCode && joined.host.localId!==joined.client.localId && !joined.client.connection.host, { A:joined.host.localId, B:joined.client.localId, room:joined.client.connection.roomCode });
    phase.coverage.realJoin='passed';
    const wire = joined.client.wire.initial;
    check(phase,'reliable full bootstrap carries relevant wire slice', name==='holo' ? wire?.fc?.some(d=>d[0]===2) : Array.isArray(wire?.bq)&&wire.bq.length>0, wire);
    if(name==='bomber') {
      const first=await b.evaluate(()=>window.__lj.finish()); phase.clientAtJoin=first;
      check(phase,'no explosion replay while clock held at join',first.impacts.length===0,first.impacts);
      check(phase,'no generic explosion replay while clock held at join',first.genericExplosions.length===0,first.genericExplosions);
    }
    await timed(`${name}: continue synchronized simulation to middle`,()=>advance(a,b,(before.now+endAt)/2),120000);
    const middle=await checkpoint(phase,a,b,'middle');
    phase.coverage.middle='passed';
    check(phase,'post-join replica changes',!equal(name==='holo'?holoFacts(joined.client):bomberFacts(joined.client),name==='holo'?holoFacts(middle.client):bomberFacts(middle.client)), { joined: name==='holo'?holoFacts(joined.client):bomberFacts(joined.client), middle:name==='holo'?holoFacts(middle.client):bomberFacts(middle.client) });
    await timed(`${name}: continue until both slices end`,()=>advance(a,b,endAt+500),120000);
    await checkpoint(phase,a,b,'end');
    phase.coverage.end='passed';
    phase.hostFinal=await a.evaluate(()=>window.__lj.finish()); phase.clientFinal=await b.evaluate(()=>window.__lj.finish());
    if(name==='bomber') {
      const impacts=phase.clientFinal.impacts;
      check(phase,'all actual client explosions attributed to planned impacts',impacts.length>0&&impacts.every(e=>Number.isFinite(e.impactAt)),impacts);
      check(phase,'no historical impact replay after continuation',impacts.every(e=>e.impactAt>phase.joinCutoff&&e.impactAt>e.firstSeenAt),{joinCutoff:phase.joinCutoff,impacts});
      check(phase,'future impacts presented on both peers',phase.hostFinal.impacts.some(e=>e.impactAt>phase.joinCutoff)&&impacts.some(e=>e.impactAt>phase.joinCutoff),{host:phase.hostFinal.impacts.length,client:impacts.length});
      check(phase,'client effects match the host plan',impacts.every(e=>phase.hostFinal.plannedDrops.some(d=>d.deploymentId===e.deploymentId
        && Math.abs(d.impactAt-e.impactAt)<.01 && Math.hypot(d.x-e.x,d.y-e.y)<.15)),{clientImpacts:impacts.length,hostPlannedDrops:phase.hostFinal.plannedDrops.length});
      phase.coverage.historicalImpactSuppression='passed';
    }
    check(phase,'no browser page/HTTP errors',!phase.browserErrors.length,phase.browserErrors);
    phase.status='passed';
  } catch(e) {
    phase.status='failed';phase.failure={step:activeStep,message:e.message,stack:e.stack};
    for(const [role,page] of [['A',a],['B',b]]) if(page&&!page.isClosed()) {
      try { phase[`${role}FailureState`]=await page.evaluate(()=>window.__lj?.finish?.()??{body:document.body.innerText});
        await page.screenshot({path:join(out,`${offline?'offline-':''}${name}-${role}-failure.png`)}); } catch(error){event('failure-evidence-error',{peer:role,text:error.message});}
    }
    throw e;
  } finally { await closeContexts(); await save(); }
}

try {
  await mkdir(out,{recursive:true});
  await timed(`preflight: port ${port} must be free`,async()=>{
    const raw=execFileSync('netstat',['-ano'],{encoding:'utf8'}).split('\n').filter(l=>l.includes(`:${port}`));
    event('netstat',{lines:raw});
    await new Promise((res,rej)=>{const socket=net.createServer();socket.once('error',rej);socket.listen(port,'127.0.0.1',()=>socket.close(res));});
  });
  const html=(await readFile(join(root,'index.html'),'utf8')).replace('/src/main.ts','/__latejoin-browser.mjs');
  const browserSource=`(${browserHarness.toString()})().catch(error => { window.__ljBootError = String(error.stack || error); console.error(error); });`;
  server=await timed(`Vite in-process on ${port}`,()=>createServer({root,configLoader:'runner',cacheDir:join(out,'.vite-cache'),logLevel:'warn',clearScreen:false,
    server:{host:'127.0.0.1',port,strictPort:true,open:false,hmr:false,watch:null},plugins:[{name:'latejoin-build-only-harness',
      resolveId(id){if(id==='/__latejoin-browser.mjs')return '\0latejoin-browser';},
      load(id){if(id==='\0latejoin-browser')return browserSource;},
      configureServer(vite){
      vite.middlewares.use(async(req,res,next)=>{
        const pathname=req.url?.split('?')[0];
        if(pathname==='/__latejoin__.html'){try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/index.html',html));}catch(e){next(e);}}
        else next();
      });
    }}]}));
  await timed('Vite listen and HTTP 200',async()=>{await server.listen();const r=await fetch(`${origin}/__latejoin__.html`);if(r.status!==200)throw Error(`HTTP ${r.status}`);});
  for(const name of phases) await runPhase(name);
  result.status=offline?'offline-smoke-complete-NOT-latejoin':'passed';
} catch(e) {
  result.status='failed';result.failure={step:activeStep,message:e.message,stack:e.stack};
  console.error(`[FAIL] ${activeStep}: ${e.message}`); process.exitCode=1;
} finally {
  if(!aborted){announce('cleanup: close own browsers, Vite and profiles');await cleanup();
    result.endedAt=stamp();result.notRunPhases=phases.filter(name=>!result.phases.some(p=>p.name===name));
    if(result.errors.length){result.status='failed';process.exitCode=1;}await save();
    console.log(`${result.status} -> ${resultFile}`);}
}
