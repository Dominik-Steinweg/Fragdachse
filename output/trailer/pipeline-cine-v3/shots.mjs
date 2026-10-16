// Shot recipes. Each shot opens its own scenario, stages the action and records a 4K master.
// Action shots are overcranked (OC: half simulation speed per frame) so the edit can ramp freely
// between real time (every 2nd frame) and slow motion.
import { open, run, status, step, until, record, path, ramp, drift, krakenPos, playerPos, follower } from './harness.mjs';

const OC = 1000 / 120;
const KRAKEN = { version: 1, classId: 'dachs_nukem', weapon1: 'HYDRA', weapon2: 'ROCKET_LAUNCHER', mapId: 'kraken-abyss-lab', seed: 12345, timeOfDay: 780,
  suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true };
const at = (s, gx, gy) => ({ x: s.metrics.offsetX + (gx + .5) * 32, y: s.metrics.offsetY + (gy + .5) * 32 });
const toGrid = (s, p) => ({ gridX: (p.x - s.metrics.offsetX) / 32 - .5, gridY: (p.y - s.metrics.offsetY) / 32 - .5 });
const world = (page, g) => page.evaluate(g => window.__C.world(g), g);
const shake = (c, f, amp = 2.5) => ({ x: c.x + drift(f, amp).x, y: c.y + drift(f, amp).y, zoom: c.zoom });
const mid = (a, b, t = .5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** krakenMission restarts the scenario with defaults, so options and the player are staged afterwards. */
async function kraken({ skipIntro = true, player = { gridX: 35, gridY: 33.6 }, time = 780 } = {}) {
  const { browser, page } = await open(KRAKEN);
  await run(page, { action: 'krakenMission', skipIntro });
  await page.waitForFunction(() => window.devScenario.status().ready);
  await run(page, { action: 'quality', level: 'high' });
  await run(page, { action: 'options', values: { refillHp: true, hideAim: true, hideTutorial: true, timeOfDay: time } });
  await run(page, { action: 'teleport', ...player });
  await page.evaluate(() => { window.__C.cleanHits = true; });
  await step(page, 2);
  return { browser, page, s: await status(page) };
}
/** Freezes the boss's decisions (no new attacks) so a shot can feature something else in its pond. */
const calmKraken = page => page.evaluate(async () => { const k = await window.__C.krakenHost(); k.chooseAction = () => {}; });
async function act(page, act, max = 900) {
  await run(page, { action: 'krakenAct', act });
  return until(page, s => { const a = s.krakenDevAction; if (a?.status === 'failed') throw Error(a.error); return a?.status === 'started'; }, max, 1);
}
async function session(open, body) { const ctx = await open(); try { await body(ctx); } finally { await ctx.browser.close(); } }
/** Spawns enemies at world points without the dev free-cell check (water starts submerged). */
const spawnRaw = (page, kind, points) => page.evaluate(([kind, points]) =>
  points.map(p => window.__C.dev.runtime.navigationLabPort.spawnEnemy(p.x, p.y, kind, false)), [kind, points]);
const enemies = (page, kind) => page.evaluate(k => window.devScenario.status().enemies.filter(e => !k || e.kind === k), kind);
const centroid = list => list.length ? { x: list.reduce((a, e) => a + e.x, 0) / list.length, y: list.reduce((a, e) => a + e.y, 0) / list.length } : null;
/** Opens a plain recipe with high quality and the trailer options. */
async function scene(recipe, extra = {}) {
  const r = await open({ version: 1, seed: 12345, suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true, refillHp: true, ...recipe });
  await run(r.page, { action: 'quality', level: 'high' });
  if (extra.canopy != null) await r.page.evaluate(a => { window.__C.canopyAlpha = a; }, extra.canopy);
  await run(r.page, { action: 'settle', frames: 60 }); await step(r.page, 2);
  return { ...r, s: await status(r.page) };
}
const spawnAt = async (page, kind, gx, gy, opts = {}) => { await run(page, { action: 'target', gridX: gx, gridY: gy }); await run(page, { action: 'findFree' }); await run(page, { action: 'spawn', kind, pinned: !!opts.pinned, ...(opts.hp ? { hp: opts.hp } : {}) }); };
/** A horde of n enemies on free cells around (gx, gy). */
async function horde(page, kind, gx, gy, n, { spread = 3, hp, pinned = false } = {}) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, r = spread * Math.sqrt((i + .5) / n);
    await run(page, { action: 'target', gridX: gx + Math.cos(a) * r, gridY: gy + Math.sin(a) * r });
    try { await run(page, { action: 'findFree' }); await run(page, { action: 'spawn', kind, pinned, ...(hp ? { hp } : {}) }); } catch (e) { console.log('  horde skip', e.message.slice(0, 60)); }
  }
}
const INSPECTOR = { classId: 'inspector_gadachs', mapId: '4', weapon1: 'HYDRA', weapon2: 'PLASMA_BURNER', timeOfDay: 760,
  upgrades: { inspector_construction_slots: 3, fire_control_relay_connections: 2, fire_control_relay_duration: 2, fire_control_relay_parallel: 1,
    unlock_fire_control_portal: 1, fire_control_portal_duration: 2, fire_control_portal_damage: 2, fire_control_portal_local_fire: 1,
    holo_offensive_duration: 3, holo_offensive_interval: 3, holo_offensive_rage_required: 3, holo_offensive_injector: 1,
    unlock_bomber_squadron: 1, bomber_squadron_size: 3, bomber_squadron_bomb_count: 3, bomber_squadron_fire_chunks: 3, bomber_squadron_second_pass: 1 },
  constructions: [{ id: 'rocket_turret', gridX: 40, gridY: 25 }, { id: 'machine_gun_turret', gridX: 44, gridY: 25 }, { id: 'flame_turret', gridX: 48, gridY: 25 }] };
const TURRETS = [{ kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'machine_gun_turret' }, { kind: 'construction', id: 'flame_turret' }];
/** Dawn round (threat 7) with a forced night modifier and two bots; Dawn runs its own clock and light. */
async function dawnScene(nightModifier) {
  const r = await open({ version: 1, classId: 'dachs_nukem', dawn: { threat: 4, nightModifier }, seed: 12345, weapon1: 'PLASMA', weapon2: 'ROCKET_LAUNCHER',
    suppressWaves: false, freezeMission: false, hideAim: true, hideTutorial: true, refillHp: true, refillAdrenaline: true,
    bots: [{ name: 'Grimbart', weapon1: 'HYDRA', weapon2: 'FLAMETHROWER' }, { name: 'Frieda', weapon1: 'LEAF_BLOWER', weapon2: 'ROCKET_LAUNCHER' }] });
  await run(r.page, { action: 'quality', level: 'high' });
  return { ...r, s: await status(r.page) };
}
/** dawnSkip needs the live loop. Skips in stages and clears the day enemies so the undefended base survives. */
async function skip(page, phase, offsetMs) {
  const stages = [...[20, 40, 60, 80, 100, 120].map(t => ['day', t * 1000]), ['dusk', 0], ['dusk', 20000], ...(phase === 'night' ? [['night', 0], ['night', 6000]] : [])];
  const target = phase === 'dusk' ? 135000 + offsetMs : phase === 'night' ? 165000 + offsetMs : offsetMs;
  const res = await page.evaluate(async ([stages, phase, offsetMs]) => {
    const dev = window.devScenario, log = [];
    dev.run({ action: 'resume' });
    await new Promise(r => setTimeout(r, 500));
    for (const [p, o] of [...stages, [phase, offsetMs]]) {
      const r = dev.run({ action: 'dawnSkip', phase: p, offsetMs: o }), out = r.then ? await r : r;
      log.push(p + o + ':' + out.ok + (out.error ? ' ' + out.error : ''));
      if (p !== phase || o !== offsetMs) dev.run({ action: 'clearEnemies' });
    }
    dev.run({ action: 'pause' });
    return log;
  }, [stages.filter(([p, o]) => (p === 'day' ? o : p === 'dusk' ? 135000 + o : 165000 + o) < target), phase, offsetMs]);
  console.log('  skip', res.join(' | '));
  await step(page, 2);
}
/** Wounds every enemy of a kind to a fraction of its max HP (host vitals; max HP stays). */
const wound = (page, kind, fraction) => page.evaluate(([kind, fraction]) => {
  const m = window.__C.scene.arenaRuntime.flow.getCoopMissionRuntime().enemyManager;
  for (const e of window.devScenario.status().enemies.filter(e => e.kind === kind)) {
    const ent = m.getEnemy(e.id); m.hostSetVitalsBaseline(e.id, ent.getMaxHp() * fraction, ent.getMaxHp());
  }
}, [kind, fraction]);
/** X-ray canopies around world points (like the game does above the local player). */
const canopyFocus = (page, points) => page.evaluate(p => { window.__C.canopyFocus = p; }, points);
const enemy = (page, kind) => page.evaluate(k => window.devScenario.status().enemies.find(e => e.kind === k) ?? null, kind);

export const shots = {
  /** Spine volley, close: the kraken rears in the pond, the spines fan out, ride them in and land on the badger. */
  spinesClose: (frames = 600) => session(() => kraken({ player: { gridX: 52, gridY: 37 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 52, gridY: 37 });
    await step(page, 2);
    const p = await playerPos(page), k0 = await krakenPos(page);
    let started = null;
    await record(page, 'spinesClose', frames, async f => {
      if (f === 6) await run(page, { action: 'krakenAct', act: 'spines' });
      if (f > 6 && started === null) { const a = (await status(page)).krakenDevAction; if (a?.status === 'failed') throw Error(a.error); if (a?.status === 'started') { started = f; console.log('  spines started', f); } }
      if (f === 300) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      const k = await krakenPos(page) ?? k0, t = started === null ? 0 : f - started;
      if (f % 6 === 0) await run(page, { action: 'target', ...toGrid(s, k) });
      // Tight on the rearing body, whip along the volley, close on the badger for the hits.
      const cam = t < 120 ? { ...k, zoom: 3.3 - .2 * t / 120 }
        : t < 230 ? (() => { const e = (t - 120) / 110, q = e * e * (3 - 2 * e); return { ...mid(k, p, q), zoom: 3.1 - .35 * Math.sin(Math.PI * q) }; })()
        : { x: p.x, y: p.y - 30, zoom: 3.1 };
      return { dt: OC, cam: shake(cam, f, 2.5) };
    });
  }),

  /** Phase two ink: ashore, it rears and spits its ink cone across the bank onto the badger. */
  landInk: (frames = 600) => session(() => kraken({ player: { gridX: 30, gridY: 41 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenHp', hp: 5400 });
    await act(page, 'ashore', 1800);
    await until(page, st => st.krakenResidency?.state?.phase?.kind === 'land', 2400);
    await step(page, 60);
    const k0 = await krakenPos(page), p0 = { x: k0.x + 330, y: k0.y + 60 };
    await run(page, { action: 'teleport', ...toGrid(s, p0) });
    await run(page, { action: 'krakenTarget', ...toGrid(s, p0) });
    await step(page, 20);
    await calmKraken(page);
    const follow = follower(.07);
    await record(page, 'landInk', frames, async f => {
      if (f === 8) { await page.evaluate(async () => { const k = await window.__C.krakenHost(); delete k.chooseAction; }); await run(page, { action: 'krakenAct', act: 'ink' }); }
      if (f === 40) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (f === 120) await calmKraken(page);
      const k = await krakenPos(page) ?? k0, c = follow(mid(k, p0, .45));
      if (f % 6 === 0) await run(page, { action: 'target', ...toGrid(s, k) });
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 2.4 }], [600, { x: 0, y: 0, zoom: 2.15 }]], f).zoom }, f, 3) };
    });
  }),

  /** Quacksalber combo: it hops after its wounded horde, rests among it, threads healing tendrils and lashes the badger. */
  toadCombo: (frames = 1200) => session(() => scene({ classId: 'dachs_nukem', mapId: '4', timeOfDay: 760, weapon1: 'HYDRA', player: { gridX: 52.5, gridY: 27.5 } }), async ({ page, s }) => {
    for (const [gx, gy] of [[55, 29.5], [56, 31], [54, 30.8], [55.8, 28.2], [54.3, 28.6]]) await spawnAt(page, 'zombie-badger', gx, gy, { hp: 500, pinned: true });
    await wound(page, 'zombie-badger', .3);
    await spawnAt(page, 'plague-medic', 61, 34, { hp: 6000 });
    await canopyFocus(page, [{ ...(await world(page, { gridX: 56, gridY: 30 })), r: 440 }]);
    const p = await playerPos(page), follow = follower(.08);
    await record(page, 'toadCombo', frames, async f => {
      const t = await enemy(page, 'plague-medic'), zs = await enemies(page, 'zombie-badger');
      if (f % 150 === 0) await wound(page, 'zombie-badger', .3);
      if (f === 300) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (f === 700) await run(page, { action: 'stop' });
      if (f % 6 === 0 && zs.length) await run(page, { action: 'target', ...toGrid(s, zs.reduce((a, e) => Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? e : a)) });
      if (f % 60 === 0) console.log('  f', f, JSON.stringify(t && [Math.round(t.x), Math.round(t.y), t.attacking, Math.round(Math.hypot(t.x - p.x, t.y - p.y))]));
      const c = follow(t ? mid(t, p, .3) : p);
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 3.4 }], [1200, { x: 0, y: 0, zoom: 3.0 }]], f).zoom }, f, 2) };
    });
  }),

  /** Brood throw: the kraken rears and hurls its eggs over the bank; they land, pulse and hatch Mini-Kraken. */
  eggsThrow: (frames = 840) => session(() => kraken({ player: { gridX: 35, gridY: 37 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 35, gridY: 37 });
    const k0 = await krakenPos(page), p = await playerPos(page);
    const follow = follower(.1);
    let hatched = null, thrown = null;
    await record(page, 'eggsThrow', frames, async f => {
      if (f === 12) await run(page, { action: 'krakenAct', act: 'eggs' });
      if (f > 12 && thrown === null) { const a = (await status(page)).krakenDevAction; if (a?.status === 'failed') throw Error(a.error); if (a?.status === 'started') { thrown = f; console.log('  throw started', f); await calmKraken(page); } }
      const m = await enemies(page, 'mini-kraken');
      if (m.length && hatched === null) { hatched = f; console.log('  hatched at', f); }
      if (hatched !== null && f === hatched + 80) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (hatched !== null && f % 4 === 0 && m.length) await run(page, { action: 'target', ...toGrid(s, m[0]) });
      // Boss and bank in one frame through windup (700 ms) and flight (900 ms), then a time-lapse incubation, then the hatch.
      const both = mid(k0, p, .42), landed = thrown !== null && f > thrown + 230;
      let cam;
      if (hatched !== null) { const k = Math.min(1, (f - hatched) / 70), e = k * k * (3 - 2 * k), c = follow(mid(p, centroid(m) ?? p, .55)); cam = { ...c, zoom: 2.6 + .4 * e }; }
      else if (!landed) cam = { ...both, zoom: 1.72 + .22 * Math.min(1, f / 380) };
      else { const k = Math.min(1, (f - thrown - 230) / 40), e = k * k * (3 - 2 * k); cam = { x: both.x + (p.x - both.x) * e, y: both.y + (p.y - 30 - both.y) * e, zoom: 2.05 + .55 * e }; }
      return { dt: hatched === null && landed && f > thrown + 270 ? 1000 / 60 * 4 : OC, cam: shake(cam, f) };
    });
  }),

  /** Mini-Kraken swim: the boss sinks out of sight, then its brood glides through the empty void pond and leaps ashore. */
  minisSwim: (frames = 1080) => session(() => kraken({ player: { gridX: 51, gridY: 34 } }), async ({ page, s }) => {
    const p = await playerPos(page), follow = follower(.06);
    let sunk = null, leap = null, k0 = await krakenPos(page);
    await record(page, 'minisSwim', frames, async f => {
      if (f === 6) await run(page, { action: 'krakenAct', act: 'dive' });
      const k = await krakenPos(page);
      if (sunk === null && k?.phase === 'submerged') {
        sunk = f; console.log('  submerged at', f);
        // While the pack swims the boss stays down: no new decisions, no tentacle strikes.
        console.log('  parts before stub', await page.evaluate(async () => { const h = await window.__C.krakenHost(); const n = h.parts.size; h.chooseAction = () => {}; h.deps.habitat.reserveTentacles = () => []; for (const part of [...h.parts.values()]) h.retractPart(part.state.contact.identity); return n; }));
        await spawnRaw(page, 'mini-kraken', [at(s, 27, 21), at(s, 26, 24), at(s, 28.5, 26)]);
      }
      const m = sunk === null ? [] : await enemies(page, 'mini-kraken'), lead = m[0];
      if (leap === null && m.some(e => Math.hypot(e.vx, e.vy) > 500)) { leap = f; console.log('  leap at', f); }
      if (leap !== null && f === leap + 40) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (f % 4 === 0 && m.length) await run(page, { action: 'target', ...toGrid(s, m.reduce((a, e) => Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? e : a)) });
      if (f % 60 === 0) console.log('  f', f, k?.phase, JSON.stringify(m.map(e => [Math.round(e.x), Math.round(e.y)])));
      if (k) k0 = k;
      if (sunk === null || f < sunk + 50) return { dt: OC, cam: shake({ ...follow(k0), zoom: 2.4 }, f, 2) };
      const pack = centroid(m) ?? p, near = Math.hypot(pack.x - p.x, pack.y - p.y), q = Math.min(1, Math.max(0, (420 - near) / 220)), e = q * q * (3 - 2 * q);
      const c = follow(mid(pack, p, .45 * e)), arrive = Math.min(1, (f - sunk - 50) / 60);
      return { dt: OC, cam: shake({ x: c.x + 40, y: c.y, zoom: 2.4 + (4.0 - .9 * e - 2.4) * arrive * arrive * (3 - 2 * arrive) }, f, 2) };
    });
  }),

  /** Quacksalber hop: the toad itself – crouch, leap, landing shock – without heal links in the way. */
  toadHop: (frames = 840) => session(() => scene({ classId: 'dachs_nukem', mapId: '4', timeOfDay: 760, weapon1: 'HYDRA', player: { gridX: 50, gridY: 23.5 } }), async ({ page, s }) => {
    await spawnAt(page, 'plague-medic', 59, 26, { hp: 6000 });
    await canopyFocus(page, [{ ...(await world(page, { gridX: 54, gridY: 24.5 })), r: 380 }]);
    const p = await playerPos(page), follow = follower(.12);
    await record(page, 'toadHop', frames, async f => {
      const t = await enemy(page, 'plague-medic');
      if (f % 60 === 0) console.log('  f', f, JSON.stringify(t && [Math.round(t.x), Math.round(t.y), t.attacking]));
      if (f === 520) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (t && f % 6 === 0) await run(page, { action: 'target', ...toGrid(s, t) });
      const c = follow(t ? mid(t, p, .25) : p);
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 4.0 }], [840, { x: 0, y: 0, zoom: 3.4 }]], f).zoom }, f, 2) };
    });
  }),

  /** Dawn teaser 1: time-lapse from late afternoon into the blood-moon night over the base (shadows sweep). */
  dawnLapse: (frames = 300) => session(() => dawnScene('blood-moon'), async ({ page, s }) => {
    await skip(page, 'dusk', 0);
    const p = await playerPos(page);
    console.log('base', JSON.stringify(p), JSON.stringify((await status(page)).mission ?? null).slice(0, 300));
    await record(page, 'dawnLapse', frames, f => ({ dt: 1000 / 60 * ramp([[0, 6], [120, 14], [300, 10]], f),
      cam: path([[0, { x: p.x - 60, y: p.y - 40, zoom: .95 }], [300, { x: p.x, y: p.y, zoom: 1.15 }]], f) }));
  }),

  /** Dawn teaser 2: the blood-moon horde hits the base, the badgers hold the line. */
  dawnNight: (frames = 720) => session(() => dawnScene('blood-moon'), async ({ page, s }) => {
    await skip(page, 'night', 14000);
    const p = await playerPos(page), follow = follower(.04);
    await run(page, { action: 'holdWeapon', slot: 'weapon1' });
    for (let i = 0; i < 2; i++) await run(page, { action: 'bot', index: i, fire: 'weapon1' }).catch(() => {});
    console.log('enemies', (await enemies(page)).length);
    await record(page, 'dawnNight', frames, async f => {
      const list = await enemies(page), near = list.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 700);
      if (f % 6 === 0 && near.length) {
        const t = near.reduce((a, e) => Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? e : a);
        await run(page, { action: 'target', ...toGrid(s, t) });
        for (let i = 0; i < 2; i++) await run(page, { action: 'bot', index: i, aim: toGrid(s, near[(i + f) % near.length]) }).catch(() => {});
      }
      if (f % 60 === 0) console.log('  f', f, list.length, near.length);
      const c = follow(near.length ? mid(p, centroid(near), .35) : p);
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 1.5 }], [720, { x: 0, y: 0, zoom: 1.8 }]], f).zoom }, f, 3) };
    });
  }),

  /** Quacksalber: the toad hops along with its wounded horde, rests among it and threads healing tendrils into it. */
  toad: (frames = 1080) => session(() => scene({ classId: 'dachs_nukem', mapId: '4', timeOfDay: 760, weapon1: 'HYDRA', player: { gridX: 66, gridY: 31 } }), async ({ page, s }) => {
    for (const [gx, gy] of [[53, 27], [54, 29.5], [52.5, 31], [55.5, 27.5], [56, 30.5], [54.5, 25.5]]) await spawnAt(page, 'zombie-badger', gx, gy, { hp: 500 });
    await wound(page, 'zombie-badger', .3);
    await spawnAt(page, 'plague-medic', 50, 28.5, { hp: 4000 });
    await canopyFocus(page, [{ ...(await world(page, { gridX: 57, gridY: 28 })), r: 420 }]);
    const follow = follower(.07);
    await record(page, 'toad', frames, async f => {
      const t = await enemy(page, 'plague-medic'), zs = await enemies(page, 'zombie-badger'), z = centroid(zs);
      if (f % 150 === 0) await wound(page, 'zombie-badger', .3);
      if (f === 360) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (f % 6 === 0 && zs.length) await run(page, { action: 'target', ...toGrid(s, zs[0]) });
      if (f % 60 === 0) console.log('  f', f, JSON.stringify(t && [Math.round(t.x), Math.round(t.y), t.attacking]), zs.map(e => Math.round(e.hp)).join(','));
      const c = follow(t ? mid(t, z ?? t, .3) : z);
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 3.3 }], [1080, { x: 0, y: 0, zoom: 2.9 }]], f).zoom }, f) };
    });
  }),

  /** Brandstifter: the firestarter and its target in one frame – orbs drift across, the lance ignites them. */
  fire: (frames = 1200) => session(() => scene({ classId: 'dachs_nukem', mapId: '4', timeOfDay: 760, weapon1: 'HYDRA', player: { gridX: 77, gridY: 26 } }), async ({ page, s }) => {
    await spawnAt(page, 'firestarter-badger', 66, 30, { pinned: true, hp: 6000 });
    await step(page, 20);
    const e = await enemy(page, 'firestarter-badger'), t = e.intent?.point ?? await playerPos(page);
    console.log('firestarter', Math.round(e.x), Math.round(e.y), 'target', JSON.stringify(t));
    await canopyFocus(page, [{ ...mid(t, e), r: 360 }]);
    await run(page, { action: 'target', ...toGrid(s, e) });
    const c = mid(t, e, .5);
    await record(page, 'fire', frames, async f => {
      if (f === 900) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      return { dt: OC, cam: shake(path([[0, { ...c, zoom: 1.6 }], [1200, { x: c.x - 20, y: c.y, zoom: 1.8 }]], f), f, 3) };
    });
  }),

  /** Mortar: close on the badger as it takes position and fires, ride the shell to the blast, then widen to show both. */
  mortar: (frames = 1200) => session(() => scene({ classId: 'dachs_nukem', mapId: '4', timeOfDay: 760, weapon1: 'HYDRA', player: { gridX: 75, gridY: 26 },
    bots: [{ name: 'Grimbart', weapon1: 'PLASMA', weapon2: 'ROCKET_LAUNCHER', player: { gridX: 76.5, gridY: 28 } }] }), async ({ page, s }) => {
    await spawnAt(page, 'mortar-badger', 58, 33, { hp: 8000 });
    const strikes = () => page.evaluate(() => { const b = window.__C.bridge; return { now: b.getSynchronizedNow(), list: b.getLatestGameState()?.mortarStrikes ?? [] }; });
    const follow = follower(.08);
    let shot = null, cam = null, phase = 'track', since = 0;
    await record(page, 'mortar', frames, async f => {
      const m = await enemy(page, 'mortar-badger') ?? shot?.src, { now, list } = await strikes();
      if (!shot && list.length) { const k = list[0]; shot = { ...k, src: { x: k.sourceX, y: k.sourceY }, dst: { x: k.targetX, y: k.targetY } }; console.log('  strike at', f, JSON.stringify(k)); await canopyFocus(page, [{ ...shot.dst, r: 260 }, { ...shot.src, r: 200 }]); }
      if (phase === 'track' && shot && now >= shot.launchAt) { phase = 'flight'; since = f; }
      if (phase === 'flight' && now >= shot.impactAt) { phase = 'impact'; since = f; }
      if (phase === 'impact' && f - since > 110) { phase = 'wide'; since = f; }
      if (f % 20 === 0 && m) await canopyFocus(page, [{ x: m.x, y: m.y, r: 220 }, ...(shot ? [{ ...shot.dst, r: 260 }] : [])]);
      if (f === 500) { await run(page, { action: 'holdWeapon', slot: 'weapon1' }); await run(page, { action: 'bot', index: 0, aim: toGrid(s, m), fire: 'weapon1' }); }
      if (f % 6 === 0 && m) await run(page, { action: 'target', ...toGrid(s, m) });
      if (phase === 'track') cam = { ...follow(m), zoom: 2.7 };
      else if (phase === 'flight') { const k = Math.min(1, (now - shot.launchAt) / (shot.impactAt - shot.launchAt)), e = k * k * (3 - 2 * k); cam = { ...mid(shot.src, shot.dst, e), zoom: 2.7 - .6 * e }; }
      else if (phase === 'impact') cam = { ...shot.dst, zoom: 2.1 - .1 * Math.min(1, (f - since) / 110) };
      else { const both = mid(shot.src, shot.dst), z = Math.min(1.6, 1700 / (Math.abs(shot.src.x - shot.dst.x) + 380), 940 / (Math.abs(shot.src.y - shot.dst.y) + 300));
        const k = Math.min(1, (f - since) / 120), e = k * k * (3 - 2 * k); cam = { x: shot.dst.x + (both.x - shot.dst.x) * e, y: shot.dst.y + (both.y - shot.dst.y) * e, zoom: 2.0 + (z - 2.0) * e }; }
      return { dt: OC, cam: shake(cam, f, 3) };
    });
  }),

  /** Alien fan: the void wave bends around a rock – the clipped telegraph and the impulse react to cover. */
  alien: (frames = 900) => session(() => scene({ classId: 'dachs_nukem', mapId: '12', weapon1: 'PLASMA', timeOfDay: 1060, player: { gridX: 103, gridY: 11 } }), async ({ page, s }) => {
    await spawnAt(page, 'alien-badger', 96, 11, { hp: 5000 });
    await run(page, { action: 'target', gridX: 96, gridY: 11 });
    const c = await world(page, { gridX: 101, gridY: 11 });
    await record(page, 'alien', frames, async f => {
      const e = await enemy(page, 'alien-badger');
      if (f % 6 === 0 && e) await run(page, { action: 'target', ...toGrid(s, e) });
      if (f === 90) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      return { dt: OC, cam: shake(path([[0, { ...c, zoom: 2.0 }], [900, { x: c.x, y: c.y, zoom: 2.35 }]], f), f, 2.5) };
    });
  }),

  /** Turmkopien: a horde marches on the base; hologram copies materialise at the projector and tear into it. */
  copies: (frames = 720) => session(() => scene({ ...INSPECTOR, tools: [{ kind: 'utility', id: 'FIRE_CONTROL_RELAY' }, ...TURRETS], player: { gridX: 42, gridY: 31 } }), async ({ page, s }) => {
    await horde(page, 'zombie-badger', 58, 27, 26, { spread: 4.5, hp: 260 });
    await horde(page, 'rabid-badger', 60, 31, 8, { spread: 2.5, hp: 200 });
    await canopyFocus(page, [{ ...(await world(page, { gridX: 52, gridY: 27 })), r: 420 }]);
    await run(page, { action: 'target', gridX: 45, gridY: 29.5 });
    const c = await world(page, { gridX: 49.5, gridY: 27.5 });
    await record(page, 'copies', frames, async f => {
      if (f === 10) await run(page, { action: 'utility' }).catch(e => console.log('  utility', e.message));
      if (f === 30) await run(page, { action: 'target', gridX: 55, gridY: 28 });
      if (f === 60) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      return { dt: OC, cam: shake(path([[0, { x: c.x - 120, y: c.y + 30, zoom: 2.6 }], [200, { x: c.x - 60, y: c.y + 10, zoom: 2.1 }], [720, { x: c.x, y: c.y, zoom: 1.75 }]], f), f, 2.5) };
    });
  }),

  /** Holo-Offensive: Gadachs runs across open ground; ever more hologram turrets erupt around him and fight with him. */
  holo: (frames = 1200) => session(async () => {
    const r = await open({ version: 1, seed: 12345, classId: 'inspector_gadachs', mapId: '4', weapon1: 'HYDRA', weapon2: 'PLASMA_BURNER', suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true, refillHp: true });
    await run(r.page, { action: 'inspectorUltimates', phase: 'prepare', ultimate: 'holo', arsenal: 'mixed', upgrades: 'full' });
    await r.page.waitForFunction(() => window.devScenario.status().ready && window.devScenario.status().inspectorUltimates?.phase === 'prepared', null, { timeout: 300000 });
    await run(r.page, { action: 'quality', level: 'high' });
    await run(r.page, { action: 'options', values: { hideAim: true, hideTutorial: true, refillHp: true, timeOfDay: 760 } });
    await run(r.page, { action: 'settle', frames: 60 }); await step(r.page, 2);
    return { ...r, s: await status(r.page) };
  }, async ({ page, s }) => {
    // Hordes converge from all sides; Gadachs circles in the open while the holo arsenal piles up around him.
    const home = await playerPos(page), g0 = toGrid(s, home);
    const wave = async () => { for (const [dx, dy, n] of [[16, 0, 8], [-14, 6, 6], [2, 15, 7], [4, -14, 6]]) await horde(page, 'zombie-badger', g0.gridX + dx, g0.gridY + dy, n, { spread: 3, hp: 700 }); };
    await wave();
    const follow = follower(.05), loop = [[1, .25], [.25, 1], [-1, .25], [-.25, -1]];
    await record(page, 'holo', frames, async f => {
      const p = await playerPos(page), list = await enemies(page);
      if (f === 10) await run(page, { action: 'ultimate', phase: 'press' }).catch(e => console.log('  ultimate', e.message));
      if (f === 14) await run(page, { action: 'ultimate', phase: 'release' }).catch(() => {});
      if (f === 40) await run(page, { action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 30 && f % 150 === 30) { const [dx, dy] = loop[((f - 30) / 150) % 4]; await run(page, { action: 'move', dx, dy, durationMs: 650 }); }
      if (f > 0 && f % 300 === 0) await wave();
      if (f % 6 === 0 && list.length) { const t = list.reduce((a, e) => Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? e : a); await run(page, { action: 'target', ...toGrid(s, t) }); }
      if (f % 30 === 0) await canopyFocus(page, [{ ...p, r: 460 }]);
      const c = follow(mid(p, home, .45));
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 2.5 }], [300, { x: 0, y: 0, zoom: 2.0 }], [1200, { x: 0, y: 0, zoom: 1.6 }]], f).zoom }, f, 3) };
    });
  }),

  /** Portale: the throw opens a far exit; the turrets turn, fire into their muzzle portals and the rockets emerge at the horde. */
  portal: (frames = 1080) => session(() => scene({ ...INSPECTOR, tools: [{ kind: 'utility', id: 'FIRE_CONTROL_PORTAL' }, ...TURRETS], player: { gridX: 42, gridY: 33 } }), async ({ page, s }) => {
    await horde(page, 'zombie-badger', 65.5, 33, 16, { spread: 2.8, hp: 1400, pinned: true });
    await canopyFocus(page, [{ x: 1952, y: 1072, r: 300 }, { x: 2130, y: 1088, r: 200 }]);
    await run(page, { action: 'target', gridX: 62, gridY: 33 });
    await step(page, 10);
    const p = await playerPos(page), src = await world(page, { gridX: 42, gridY: 25 }), exit = await world(page, { gridX: 60, gridY: 33 });
    const fc = () => page.evaluate(() => window.__C.dev.runtime.devScenarioPort.readFireControl());
    await record(page, 'portal', frames, async f => {
      if (f === 10) await run(page, { action: 'utility' }).catch(e => console.log('  utility', e.message));
      if (f % 60 === 0) { const r = await fc(); console.log('  f', f, JSON.stringify(r?.snapshot?.deployments?.map(d => [Math.round(d.x), Math.round(d.y), d.entries.map(e => e.mode).join('/')]) ?? null)); }
      return { dt: 1000 / 60 * ramp([[0, .5], [250, .5], [300, .25], [700, .25], [760, .5]], f),
        cam: shake(path([[0, { x: p.x + 40, y: p.y, zoom: 2.4 }], [150, { x: exit.x - 40, y: exit.y, zoom: 2.2 }], [250, { ...exit, zoom: 2.6 }],
          [320, { ...src, zoom: 3.3 }], [520, { x: src.x + 20, y: src.y, zoom: 3.0 }], [600, { x: exit.x + 90, y: exit.y, zoom: 2.6 }], [1080, { x: exit.x + 110, y: exit.y, zoom: 2.3 }]], f), f, 2) };
    });
  }),

  /** Bombergeschwader: fourteen bomber drones sweep in from behind Gadachs and carpet the horde. */
  bomber: (frames = 900) => session(() => scene({ ...INSPECTOR, ultimate: 'BOMBER_SQUADRON', tools: TURRETS, constructions: [], player: { gridX: 38, gridY: 22 } }), async ({ page, s }) => {
    await horde(page, 'zombie-badger', 55, 22, 36, { spread: 7, hp: 300 });
    await run(page, { action: 'target', gridX: 55, gridY: 22 });
    const c = await world(page, { gridX: 51, gridY: 22 });
    await canopyFocus(page, [{ ...c, r: 520 }]);
    await record(page, 'bomber', frames, async f => {
      if (f === 20) await run(page, { action: 'ultimate', phase: 'press' }).catch(e => console.log('  ultimate', e.message));
      if (f === 24) await run(page, { action: 'ultimate', phase: 'release' }).catch(() => {});
      return { dt: OC, cam: shake(path([[0, { x: c.x - 420, y: c.y, zoom: 2.4 }], [200, { x: c.x - 380, y: c.y, zoom: 2.3 }], [330, { x: c.x - 60, y: c.y, zoom: 2.0 }], [470, { x: c.x, y: c.y, zoom: 1.3 }], [900, { x: c.x + 30, y: c.y, zoom: 1.2 }]], f), f, 3) };
    });
  }),

  /** Mini-Kraken: a pack swims submerged toward the bank, surfaces and leaps at the badger; the boss lurks. */
  minis: (frames = 720) => session(() => kraken({ player: { gridX: 35, gridY: 37.5 } }), async ({ page, s }) => {
    await calmKraken(page);
    await step(page, 30);
    const ids = await spawnRaw(page, 'mini-kraken', [at(s, 32, 30.2), at(s, 35, 29.6), at(s, 38, 30.2)]);
    await step(page, 2);
    console.log('minis', JSON.stringify(await enemies(page, 'mini-kraken')));
    const p = await playerPos(page), follow = follower(.05);
    await run(page, { action: 'target', gridX: 35, gridY: 30 });
    let fire = null;
    await record(page, 'minis', frames, async f => {
      const m = await enemies(page, 'mini-kraken'), c = centroid(m) ?? p;
      const leap = m.some(e => Math.hypot(e.vx, e.vy) > 500);
      if (leap && fire === null) { fire = f; console.log('  leap at', f); }
      if (fire !== null && f === fire + 30) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (f % 4 === 0 && m.length) { const near = m.reduce((a, e) => Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? e : a); await run(page, { action: 'target', ...toGrid(s, near) }); }
      if (f % 30 === 0) console.log('  f', f, JSON.stringify(m.map(e => [Math.round(e.x), Math.round(e.y), Math.round(Math.hypot(e.vx, e.vy)), e.attacking ? 'A' : ''])));
      const focus = follow(mid(c, p, .35));
      return { dt: OC, cam: shake({ ...focus, zoom: path([[0, { x: 0, y: 0, zoom: 4.2 }], [300, { x: 0, y: 0, zoom: 3.4 }], [720, { x: 0, y: 0, zoom: 3.0 }]], f).zoom }, f) };
    });
  }),

  /** Cold open: still water, slow-motion eruption, pull back to reveal its size. */
  rise: (frames = 560) => session(() => kraken({ skipIntro: false }), async ({ page, s }) => {
    const pond = at(s, 35, 22), wide = at(s, 35, 26.5);
    await record(page, 'rise', frames, f => ({
      dt: 1000 / 60 * ramp([[0, 1], [40, .32], [300, .32], [380, 1]], f),
      cam: shake(path([[0, { x: pond.x, y: pond.y + 10, zoom: 2.7 }], [300, { x: pond.x, y: pond.y + 20, zoom: 2.95 }],
        [470, { x: wide.x, y: wide.y, zoom: 1.6 }], [560, { x: wide.x, y: wide.y - 10, zoom: 1.55 }]], f), f),
    }));
  }),

  /** It dives; arms burst out of the pond at the bank and hammer down next to the badger. */
  tentacles: (frames = 960) => session(() => kraken({ player: { gridX: 36, gridY: 34 } }), async ({ page, s }) => {
    await run(page, { action: 'target', gridX: 35, gridY: 26 });
    await act(page, 'dive');
    await until(page, st => st.krakenResidency?.state?.phase?.kind === 'submerged', 900);
    const p = await playerPos(page);
    await run(page, { action: 'holdWeapon', slot: 'weapon1' });
    await record(page, 'tentacles', frames, f => ({ dt: OC,
      cam: shake(path([[0, { x: p.x, y: p.y - 130, zoom: 2.6 }], [960, { x: p.x, y: p.y - 110, zoom: 2.9 }]], f), f, 3) }));
  }),

  /** Ink: the kraken spits across the bank, the badger is engulfed. */
  ink: (frames = 640) => session(() => kraken({ player: { gridX: 40, gridY: 34 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 40, gridY: 34 });
    await run(page, { action: 'target', gridX: 36, gridY: 24 });
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    await act(page, 'ink');
    const p = await playerPos(page), follow = follower(.06);
    await record(page, 'ink', frames, async f => {
      const k = await krakenPos(page), c = follow(mid(k, p, .5));
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 1.75 }], [200, { x: 0, y: 0, zoom: 1.85 }], [640, { x: 0, y: 0, zoom: 1.95 }]], f).zoom }, f) };
    });
  }),

  /** Spine volley: the kraken rears and fires six homing spines at the badger. */
  spines: (frames = 560) => session(() => kraken({ player: { gridX: 52, gridY: 37 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 52, gridY: 37 });
    await act(page, 'spines');
    const p = await playerPos(page), follow = follower(.05);
    await record(page, 'spines', frames, async f => {
      // Close on the rearing body for the launch, then ride with the spines to the badger.
      const k = await krakenPos(page), t = Math.min(1, Math.max(0, (f - 150) / 230)), e = t * t * (3 - 2 * t);
      const c = follow(mid(k, p, .08 + .8 * e));
      return { dt: OC, cam: shake({ ...c, zoom: 2.5 - .7 * e }, f) };
    });
  }),

  /** Brood: six eggs arc over the bank and land around the badger; the hatchlings go straight for it. */
  eggs: (frames = 720) => session(() => kraken({ player: { gridX: 35, gridY: 37 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 35, gridY: 37 });
    await act(page, 'eggs');
    await calmKraken(page);
    const p = await playerPos(page), follow = follower(.08);
    let hatched = null;
    await record(page, 'eggs', frames, async f => {
      const m = await enemies(page, 'mini-kraken');
      if (m.length && hatched === null) { hatched = f; console.log('  hatched at', f, JSON.stringify(m.map(e => [Math.round(e.x), Math.round(e.y)]))); }
      if (hatched !== null && f === hatched + 70) await run(page, { action: 'holdWeapon', slot: 'weapon1' });
      if (hatched !== null && f % 4 === 0 && m.length) await run(page, { action: 'target', ...toGrid(s, m[0]) });
      const k = hatched === null ? 0 : Math.min(1, (f - hatched) / 90), e = k * k * (3 - 2 * k);
      const c = follow(m.length ? mid(p, centroid(m), .5 - .2 * e) : { x: p.x, y: p.y - 60 });
      return { dt: f < 230 ? 1000 / 60 : OC, cam: shake({ ...c, zoom: hatched === null ? path([[0, { x: 0, y: 0, zoom: 1.7 }], [230, { x: 0, y: 0, zoom: 2.0 }]], f).zoom : 2.0 + 1.0 * e }, f) };
    });
  }),

  /** Phase two: it hauls itself out of the pond and comes for the badger. */
  ashore: (frames = 960) => session(() => kraken({ player: { gridX: 37, gridY: 41 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenHp', hp: 5400 });
    await run(page, { action: 'holdWeapon', slot: 'weapon1' });
    await act(page, 'ashore', 1800);
    const follow = follower(.05);
    await record(page, 'ashore', frames, async f => {
      const k = await krakenPos(page), c = follow({ x: k.x, y: k.y + 60 });
      if (f % 8 === 0) await run(page, { action: 'target', ...toGrid(s, k) });
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 2.35 }], [960, { x: 0, y: 0, zoom: 2.0 }]], f).zoom }, f) };
    });
  }),

  /** On land: telegraph, then the claw lunge tears across the ground. */
  lunge: (frames = 520) => session(() => kraken({ player: { gridX: 30, gridY: 41 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenHp', hp: 5400 });
    await act(page, 'ashore', 1800);
    await until(page, st => st.krakenResidency?.state?.phase?.kind === 'land', 2400);
    await step(page, 60);
    // Badger level with the kraken, away from the map's bottom edge; give it time to turn before the lunge.
    const k0 = await krakenPos(page), p0 = { x: k0.x + 430, y: k0.y + 40 };
    await run(page, { action: 'teleport', ...toGrid(s, p0) });
    await run(page, { action: 'krakenTarget', ...toGrid(s, p0) });
    await step(page, 20);
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    await act(page, 'lunge', 600);
    const follow = follower(.07);
    await record(page, 'lunge', frames, async f => {
      const k = await krakenPos(page), c = follow(mid(k, p0, .4));
      return { dt: OC, cam: shake({ x: c.x, y: Math.min(c.y, s.metrics.offsetY + 36.5 * 32), zoom: path([[0, { x: 0, y: 0, zoom: 2.05 }], [520, { x: 0, y: 0, zoom: 2.35 }]], f).zoom }, f, 3) };
    });
  }),

  /** Map 10: a void meteor tears down and the inferno colossus rises from the crater. */
  meteor: (frames = 900) => session(async () => {
    const r = await open({ version: 1, classId: 'dachs_nukem', mapId: '10', seed: 4242, timeOfDay: 1260,
      suppressWaves: false, freezeMission: false, hideAim: true, hideTutorial: true });
    return r;
  }, async ({ page }) => {
    let intro = null;
    for (let i = 0; i < 40 && !intro; i++) {
      await run(page, { action: 'clearEnemies' });
      await step(page, 20);
      intro = await page.evaluate(() => window.__C.bridge.getRoundState?.()?.coopDefenseBossIntro ?? null);
    }
    if (!intro) throw Error('boss intro did not start');
    console.log('intro', JSON.stringify(intro));
    // Map 10 drops the meteor near the west edge: keep the view inside the map (no black void) and
    // let the edit push in on the impact (zx/zy logged below).
    const m = (await status(page)).metrics;
    const inside = c => { const hw = 960 / c.zoom + 10, hh = 540 / c.zoom + 10;
      return { x: Math.min(Math.max(c.x, m.offsetX + hw), m.maxX - hw), y: Math.min(Math.max(c.y, m.offsetY + hh), m.maxY - hh), zoom: c.zoom }; };
    const keys = [[0, { x: intro.x, y: intro.y - 40, zoom: 1.3 }], [900, { x: intro.x, y: intro.y, zoom: 1.5 }]];
    const c0 = inside(path(keys, 700));
    console.log('impact frame position', JSON.stringify({ zx: +(.5 + (intro.x - c0.x) * c0.zoom / 1920).toFixed(3), zy: +(.5 + (intro.y - c0.y) * c0.zoom / 1080).toFixed(3) }));
    await record(page, 'meteor', frames, f => ({ dt: OC, cam: inside(shake(path(keys, f), f, 4)) }));
  }),

  /** Shield charger: two badgers pour fire into the raised shield, then it drops it and charges. */
  charger: (frames = 900) => session(() => open({ ...KRAKEN, weapon2: 'NEGEV', player: { gridX: 31, gridY: 37.5 },
    bots: [{ name: 'Grimbart', weapon1: 'GLOCK', weapon2: 'AK47', player: { gridX: 29.5, gridY: 36.4 } }] }),
  async ({ page }) => {
    await run(page, { action: 'quality', level: 'high' });
    await run(page, { action: 'spawn', kind: 'shield-charger-badger', pinned: false, hp: 6000, gridX: 48, gridY: 37.5 }); // far enough to finish its slow turn
    await run(page, { action: 'settle', frames: 60 }); await step(page, 2);
    const s = await status(page), p = await playerPos(page), follow = follower(.08), fast = follower(.2);
    // Phases: approach (tight on the shield) → windup (corridor and badger) → charge (ride the streak).
    let windup = null, charge = null, last = null;
    await record(page, 'charger', frames, async f => {
      const e = await enemy(page, 'shield-charger-badger') ?? last; last = e;
      // Open fire once it faces the badgers, so every round lands on the shield.
      if (f === 200) { await run(page, { action: 'holdWeapon', slot: 'weapon2' }); await run(page, { action: 'bot', index: 0, fire: 'weapon2' }); }
      const speed = Math.hypot(e.vx, e.vy);
      if (!windup && f > 40 && !e.moving) { windup = f; console.log('  windup at', f, JSON.stringify({ e, p: await playerPos(page) })); }
      if (windup && !charge && speed > 300) { charge = f; console.log('  charge at', f); }
      if (windup && f === windup + 24) await run(page, { action: 'move', dx: -.3, dy: -1, durationMs: 420 }); // dive out of the lane
      if (!charge && f % 6 === 0) { const g = toGrid(s, e); await run(page, { action: 'target', ...g }); await run(page, { action: 'bot', index: 0, aim: g }); }
      const k = windup ? Math.min(1, (f - windup) / 50) : 0, ease = k * k * (3 - 2 * k);
      const focus = charge ? e : mid(e, p, .2 + .3 * ease);
      const c = charge ? fast(focus) : follow(focus);
      return { dt: OC, cam: shake({ ...c, zoom: charge ? 2.8 : 4.2 - 1.3 * ease }, f, charge ? 4 : 2.5) };
    });
  }),

  /** The watchtower: the badger fires down into a horde, then the tower collapses. */
  tower: (frames = 840) => session(async () => {
    const r = await open({ version: 1, classId: 'dachs_nukem', mapId: '1', seed: 12345, timeOfDay: 760,
      suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true });
    await run(r.page, { action: 'watchtowerReview', step: 'start' });
    await r.page.waitForFunction(() => window.devScenario.status().ready);
    await run(r.page, { action: 'options', values: { hideAim: true, hideTutorial: true, refillHp: true, timeOfDay: 760 } });
    return r;
  }, async ({ page }) => {
    await run(page, { action: 'watchtowerReview', step: 'enter' }); await step(page, 10);
    await run(page, { action: 'watchtowerReview', step: 'hunters' });
    for (const gx of [11, 14, 22, 25]) for (const gy of [5, 8]) { await run(page, { action: 'target', gridX: gx, gridY: gy }); await run(page, { action: 'spawn', kind: 'zombie-badger', pinned: false }); }
    await run(page, { action: 'target', gridX: 18.5, gridY: 9 });
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    const tower = await world(page, { gridX: 18.5, gridY: 13 });
    await record(page, 'tower', frames, async f => {
      if (f === 600) await run(page, { action: 'watchtowerReview', step: 'collapse' }).catch(() => {});
      return { dt: OC, cam: shake(path([[0, { ...tower, zoom: 2.3 }], [560, { x: tower.x, y: tower.y - 30, zoom: 1.95 }], [840, { x: tower.x, y: tower.y + 10, zoom: 1.85 }]], f), f, f > 600 ? 6 : 2.5) };
    });
  }),
};
