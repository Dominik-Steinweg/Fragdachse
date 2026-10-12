import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const config = JSON.parse(await readFile(new URL('../../src/config/krakenBoss.json', import.meta.url), 'utf8'));
const suns = [{ azimuth: 135, elevation: 28 }, { azimuth: 315, elevation: 45 }];
const scenes = ['swim', 'dive', 'tentacle-strike', 'tentacle-sink', 'spines', 'eggs', 'ink', 'ashore', 'lunge-player', 'lunge-water'];

/** Live host recipes only: no renderer patching, manual animation poses or boss teleport. */
export async function runKrakenV13({ args, page, report, out, command, status, step, settle, grid, capture, boards, save }) {
  const smoke = args.smoke === 'true';
  const selected = args.scene ? args.scene.split(',') : smoke ? ['ink'] : scenes;
  if (selected.some(s => !scenes.includes(s))) throw Error(`Unknown v13 scene; choose ${scenes.join(',')}`);
  report.recipe = { version: 1, smoke, scenes: selected, suns: smoke ? suns.slice(0, 1) : suns,
    config, note: 'Host simulation at 60 Hz; original PNGs at DPR 1, camera zoom 1 and 2. Contact sheets are previews.' };
  report.evidence = {};
  if (smoke && !report.selection.some(a => a.id === 'abyssal-kraken-spine')) {
    report.expectedMissingSpines.push('No selected abyssal-kraken-spine asset in the v12b smoke fixture');
  }
  const state = s => s.krakenResidency?.state;
  const now = s => s.krakenResidency.hostNow;
  const wait = async (predicate, description, frames = 1800) => {
    let s = await status();
    for (let i = 0; !predicate(s); i++) {
      if (i >= frames) throw Error(`${description}: timed out; ${JSON.stringify({ phase: state(s)?.phase, dev: s.krakenDevAction })}`);
      if (s.krakenDevAction?.status === 'failed') throw Error(s.krakenDevAction.error);
      s = await step(1);
    }
    return s;
  };
  const advanceTo = async at => {
    let s = await status();
    while (now(s) + .01 < at) s = await step(Math.min(30, Math.max(1, Math.ceil((at - now(s) - .01) * .06))));
    return s;
  };
  const target = async (gridX, gridY) => { await command({ action: 'krakenTarget', gridX, gridY }); };
  const targetWorld = async p => {
    const { gridX, gridY } = grid(p, await status());
    await target(gridX, gridY);
  };
  const act = async name => {
    await command({ action: 'krakenAct', act: name });
    return wait(s => s.krakenDevAction?.act === name && s.krakenDevAction.status === 'started', `Start ${name}`);
  };
  const reset = async sun => {
    await command({ action: 'krakenMission', skipIntro: true });
    await page.waitForFunction(() => window.devScenario.status().ready && window.devScenario.status().paused);
    await command({ action: 'quality', level: report.quality });
    await command({ action: 'figureSun', ...sun });
    await command({ action: 'options', values: { refillHp: true, hideAim: true, hideTutorial: true, timeOfDay: 720 } });
    await target(39, 36);
    await settle();
    return step(1); // Publish player intent after placement, before requesting a host action.
  };
  const series = async (group, start, offsets, focus, verify = () => {}) => {
    const rows = [];
    for (const [i, offset] of offsets.entries()) {
      const s = await advanceTo(start + offset);
      verify(s);
      await capture(group, s, typeof focus === 'function' ? focus(s) : focus);
      rows.push({ index: i, hostNow: now(s), position: s.krakenResidency.hostPosition,
        phase: state(s).phase, action: state(s).bodyAction, geometry: s.krakenDevGeometry,
        tentacles: state(s).tentacles, spines: state(s).spines, player: s.player });
    }
    report.evidence[group] = rows;
    await save();
    return rows;
  };
  const fractions = duration => Array.from({ length: 9 }, (_, i) => duration * i / 8);
  const midpoint = s => ({ x: (s.krakenResidency.hostPosition.x + s.player.x) / 2,
    y: (s.krakenResidency.hostPosition.y + s.player.y) / 2 });
  const exit = async () => {
    const s = await status();
    await command({ action: 'krakenHp', hp: s.krakenResidency.maxHp * config.phaseTwoHpRatio });
    return act('ashore');
  };
  const onLand = async () => {
    await exit();
    return wait(s => state(s)?.phase.kind === 'land', 'Complete legal exit');
  };
  const dive = async () => {
    await target(39, 44); await step(1);
    await act('dive');
    return wait(s => state(s)?.tentacles.length > 0, 'First lurking tentacle');
  };

  for (const sun of report.recipe.suns) for (const scene of selected) {
    report.currentScene = `${scene}-sun-${sun.azimuth}-${sun.elevation}`;
    const group = report.currentScene;
    console.log(`V13 SCENE ${group}${smoke ? ' (v12b smoke)' : ''}`);
    let s = await reset(sun);
    if (scene === 'swim') {
      await target(65, 44); s = await step(1);
      const focus = { ...s.krakenResidency.hostPosition };
      const rows = await series(group, now(s), fractions(8000), focus);
      if (!rows.some(r => Math.hypot(r.position.x - rows[0].position.x, r.position.y - rows[0].position.y) > 10)) throw Error('No swimming trajectory observed');
      // Separate evidence overlay; preserve every original screenshot unchanged.
      if (args.captures !== 'false') for (const view of ['game', 'close']) {
        const first = report.captures.find(c => c.group === group), v = first.views[view];
        const { width: w, height: h } = v.rendererSize, { scrollX, scrollY, zoomX: z } = v.camera;
        const points = rows.map(r => ({ x: (r.position.x - scrollX - w / 2) * z + w / 2,
          y: (r.position.y - scrollY - h / 2) * z + h / 2 }));
        const svg = `<svg width="${w}" height="${h}"><polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#ffcc45" stroke-width="3"/>${points.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#ffcc45"/><text x="${p.x + 9}" y="${p.y - 9}" fill="white" font-size="18">${i}s</text>`).join('')}</svg>`;
        await sharp(path.join(out, `${first.name}-${view}.png`)).composite([{ input: Buffer.from(svg) }]).png().toFile(path.join(out, `${group}-${view}-trajectory.png`));
      }
    } else if (scene === 'spines') {
      // South-east bank, outside the ink cone's reach but within spine acquisition range.
      await target(45, 40); await step(1); s = await act('spines');
      const a = state(s).bodyAction, focus = midpoint(s);
      if (a?.kind !== 'spines') throw Error('Expected spine action');
      const offsets = smoke ? [0, a.releaseAt[0] - a.startedAt + 17, a.endsAt - a.startedAt]
        : [0, a.raiseAt - a.startedAt, ...a.releaseAt.map(t => t - a.startedAt), a.endsAt - a.startedAt];
      await series(group, a.startedAt, offsets, focus);
      if (!smoke) {
        const last = a.releaseAt.at(-1), end = last + config.spines.regrowDelayMs + config.spines.regrowMs;
        await series(`${group}-flight-regrowth`, now(await status()), fractions(end - now(await status()) + 17), focus);
      }
      report.evidence[`${group}-releases`] = report.samples.flatMap(x => state(x)?.spines ?? [])
        .filter(p => p.castId === a.castId).reduce((all, p) => ({ ...all, [p.index]: p }), {});
      if (Object.keys(report.evidence[`${group}-releases`]).length !== config.spines.volleyCount) throw Error('Incomplete spine release evidence');
    } else if (scene === 'eggs') {
      s = await act('eggs'); const a = state(s).bodyAction;
      if (a?.kind !== 'eggs') throw Error('Expected egg action');
      const release = a.releaseAt - a.startedAt;
      await series(group, a.startedAt, [0, release / 2, release, release + 150, release + 350,
        release + 550, release + 750, release + config.eggs.flightMs, release + config.eggs.flightMs + 550], midpoint(s));
      if (!report.samples.some(x => state(x)?.eggs.length)) throw Error('No landed eggs observed');
    } else if (scene === 'ink') {
      // Start near enough that the normal water approach can put the mouth in range.
      await target(37, 34); await step(1); s = await act('ink');
      const a = state(s).bodyAction, claw = s.krakenResidency.claw?.attack;
      if (a?.kind !== 'ink' || claw?.pose.geometry.kind !== 'sector') throw Error('Expected ink sector');
      report.evidence[`${group}-range`] = claw.pose;
      if (claw.pose.geometry.range !== config.ink.range) throw Error('Ink range differs from authored host config');
      await series(group, a.startedAt, smoke ? [0, 1180, 1630] : [0, 250, 650, 950, 1050, 1180, 1300, 1530, 1900], midpoint(s));
    } else if (scene === 'dive') {
      s = await act('dive'); const p = state(s).phase;
      if (!s.krakenDevGeometry.diveInterior) throw Error('Dive started outside the pond interior');
      await series(group, p.startedAt, [0, 200, 450, 700, 950, 1200, 1450, 1800, 2300], s.krakenResidency.hostPosition);
    } else if (scene.startsWith('tentacle-')) {
      s = await dive(); const part = state(s).tentacles[0], id = part.contact.identity.partId;
      const current = x => state(x).tentacles.find(t => t.contact.identity.partId === id);
      const focus = { x: part.contact.x, y: part.contact.y + 90 };
      if (scene === 'tentacle-sink') {
        await series(group, part.startedAt, [0, config.tentacles.riseMs / 2, part.hoverAt - part.startedAt,
          part.hoverAt - part.startedAt + 300, part.retractAt - part.startedAt - 17,
          part.retractAt - part.startedAt, part.retractAt - part.startedAt + 150,
          part.endsAt - part.startedAt - 17, part.endsAt - part.startedAt + 17], focus,
        x => { if (current(x)?.claw.attack) throw Error('Sink-without-strike fixture acquired a target'); });
      } else {
        await capture(group, s, focus);
        s = await advanceTo(part.hoverAt + 100); await capture(group, s, focus);
        if (current(s)?.claw.attack) throw Error('Tentacle did not lurk before targeting');
        let placed = false;
        for (const angle of [Math.PI / 4, Math.PI * 3 / 4, Math.PI / 3, Math.PI * 2 / 3]) {
          for (const distance of [220, 270, 300]) {
            const p = { x: part.contact.x + Math.cos(angle) * distance, y: part.contact.y + Math.sin(angle) * distance };
            const r = await page.evaluate(c => window.devScenario.run(c), { action: 'krakenTarget', ...grid(p, s) });
            if (r.ok) { placed = true; break; }
          }
          if (placed) break;
        }
        if (!placed) throw Error('No legal diagonal player position for tentacle');
        s = await wait(x => !!current(x)?.claw.attack, 'Diagonal tentacle telegraph', 60);
        const attack = current(s).claw.attack;
        if (Math.abs(Math.sin(attack.pose.angle) * Math.cos(attack.pose.angle)) < .15) throw Error('Tentacle strike is not diagonal');
        await series(group, attack.startedAt, [0, 350, attack.strikeAt - attack.startedAt - 17,
          attack.strikeAt - attack.startedAt, attack.hitAt - attack.startedAt,
          attack.endsAt - attack.startedAt, attack.endsAt - attack.startedAt + config.tentacles.retractMs - 17], focus);
      }
    } else if (scene === 'ashore') {
      s = await exit(); const p = state(s).phase;
      await series(group, p.startedAt, [0, 450, p.moveAt - p.startedAt, p.gripAt - p.startedAt - 17,
        p.gripAt - p.startedAt + 100, p.heaveAt - p.startedAt,
        p.endsAt - p.startedAt - 17, p.endsAt - p.startedAt, p.recoveryEndsAt - p.startedAt + 17],
      x => x.krakenResidency.hostPosition);
    } else {
      s = await onLand();
      if (scene === 'lunge-player') {
        const p = s.krakenResidency.hostPosition;
        await targetWorld({ x: p.x + 260, y: p.y + 80 }); await step(1);
      } else {
        // Let real land navigation bring the body around the south-west shoreline.
        // Move the target across the shallow southern chord only once both positions are dry.
        await target(23, 31);
        s = await wait(x => state(x)?.phase.kind === 'land' && !state(x).bodyAction
          && x.krakenResidency.hostPosition.x < x.metrics.offsetX + 30 * x.metrics.widthPx / x.metrics.gridCols,
        'Navigate to the west bank', 3600);
        await target(47, 31);
        s = await wait(x => !state(x).bodyAction && x.krakenDevGeometry?.dryBody && !x.krakenDevGeometry.fullLungeDry
          && Math.hypot(x.player.x - x.krakenResidency.hostPosition.x, x.player.y - x.krakenResidency.hostPosition.y)
            <= config.bodyRadiusPx + config.slam.length, 'Dry bank facing water within claw range', 3600);
      }
      s = await act('lunge'); const attack = s.krakenResidency.claw?.attack, from = s.krakenResidency.hostPosition;
      if (attack?.weaponId !== 'kraken-slam') throw Error('Expected land claw');
      if (scene === 'lunge-water' && s.krakenDevGeometry.fullLungeDry) throw Error('Regression setup does not intersect water');
      const rows = await series(group, attack.startedAt, [0, 250, 530, 550, 625, 700, 800, 850, 1000], midpoint(s),
        x => { if (state(x).phase.kind !== 'land' || !x.krakenDevGeometry.dryBody) throw Error('Phase-2 Kraken entered water'); });
      const travelled = Math.hypot(rows.at(-1).position.x - from.x, rows.at(-1).position.y - from.y);
      if (travelled >= config.slam.lungeDistancePx - 1) throw Error('Lunge did not stop before the obstacle/player');
      report.evidence[`${group}-stop`] = { from, travelled, fullDistance: config.slam.lungeDistancePx, attack };
    }
    await save();
  }
  report.coverage = Object.fromEntries([...new Set(report.captures.map(c => c.group))]
    .map(g => [g, report.captures.filter(c => c.group === g).length]));
  if (!smoke && Object.values(report.coverage).some(n => n < 8 || n > 9)) throw Error('Expected 8–9 samples for every v13 scene');
  if (args.captures !== 'false') await boards();
  report.completed = true;
  await writeFile(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Kraken v13 live</title><style>body{background:#17202b;color:white;font:16px system-ui}img{max-width:100%}a{color:#ffcc45}</style><h1>Kraken ${smoke ? 'v12b smoke' : 'v13 live'}</h1><p>Original PNGs: zoom 1 / zoom 2, DPR 1. <a href="report.json">Host evidence and diagnostics</a></p>${Object.keys(report.coverage).map(g => `<h2>${g}</h2>${['game', 'close'].map(v => `<a href="${g}-${v}-sheet.png"><img src="${g}-${v}-sheet.png"></a>`).join('')}`).join('')}`);
}
