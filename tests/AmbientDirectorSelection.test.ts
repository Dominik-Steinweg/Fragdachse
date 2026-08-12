import { describe, expect, it } from 'vitest';

import {
  AMBIENT_TEMPLATES,
  orderAmbientTemplateCandidates,
  resolveRockDestructionBudget,
  type AmbientTemplate,
} from '../src/lobby/AmbientSequenceCatalog';
import { AmbientSequenceHistory } from '../src/lobby/AmbientSequenceHistory';
import { buildAmbientWeaponPool, pickAmbientWeapon, AMBIENT_WEAPON_IDS } from '../src/lobby/AmbientWeaponPool';

/** Deterministischer Zufall, damit die Simulation reproduzierbar bleibt. */
function createRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

const ZONES = ['top_left', 'top_right', 'left_gap', 'right_gap', 'bottom_band'];

interface SimulatedSequence {
  template: AmbientTemplate;
  zoneId: string;
  atMs: number;
  destroyedRocks: number;
}

/** Fährt den Auswahlpfad des Directors über viele künstliche Sequenzen. */
function simulate(count: number, seed = 20260812): SimulatedSequence[] {
  const rng = createRng(seed);
  const history = new AmbientSequenceHistory();
  const result: SimulatedSequence[] = [];
  let nowMs = 4_000; // Initialruhe

  for (let index = 0; index < count; index += 1) {
    const candidates = orderAmbientTemplateCandidates(history, nowMs, rng);
    expect(candidates.length).toBeGreaterThan(0);
    const template = candidates[0];
    const zoneId = ZONES[Math.floor(rng() * ZONES.length)];

    const [minRocks, maxRocks] = resolveRockDestructionBudget(template.rockHazard);
    const destroyedRocks = minRocks + Math.floor(rng() * (maxRocks - minRocks + 1));

    const pool = buildAmbientWeaponPool(['AK47', 'BITE']);
    const weapon = pickAmbientWeapon(pool, rng, (entry) => history.weaponPenalty(entry));

    history.record({
      template: template.id,
      zoneId,
      intensity: template.intensity,
      weaponIds: weapon ? [weapon.id] : [],
      weaponFamilies: weapon ? [weapon.family] : [],
      enemyKinds: [],
      destroyedRocks,
      usedLoadoutFocus: weapon?.id === 'AK47' || weapon?.id === 'BITE',
      atMs: nowMs,
    });
    result.push({ template, zoneId, atMs: nowMs, destroyedRocks });

    // Gefecht plus Ruhephase laut GDD.
    nowMs += 3_000 + Math.floor(rng() * 3_000) + 6_000 + Math.floor(rng() * 6_000);
  }

  return result;
}

describe('ambient director selection', () => {
  const run = simulate(2_000);

  it('never repeats the same template twice in a row', () => {
    for (let index = 1; index < run.length; index += 1) {
      expect(run[index].template.id).not.toBe(run[index - 1].template.id);
    }
  });

  it('keeps every template in rotation without letting one dominate', () => {
    const counts = new Map<string, number>();
    for (const entry of run) counts.set(entry.template.id, (counts.get(entry.template.id) ?? 0) + 1);

    for (const template of AMBIENT_TEMPLATES) {
      expect(counts.get(template.id) ?? 0).toBeGreaterThan(0);
    }
    const share = Math.max(...counts.values()) / run.length;
    expect(share).toBeLessThan(0.25);
  });

  it('holds strong sequences apart by at least their lockout', () => {
    const strongTimes = run.filter((entry) => entry.template.intensity === 'strong').map((entry) => entry.atMs);
    expect(strongTimes.length).toBeGreaterThan(0);
    for (let index = 1; index < strongTimes.length; index += 1) {
      expect(strongTimes[index] - strongTimes[index - 1]).toBeGreaterThanOrEqual(45_000);
    }
  });

  it('plans destruction inside the documented budgets', () => {
    for (const entry of run) {
      const [min, max] = resolveRockDestructionBudget(entry.template.rockHazard);
      expect(entry.destroyedRocks).toBeGreaterThanOrEqual(min);
      expect(entry.destroyedRocks).toBeLessThanOrEqual(max);
      if (entry.template.intensity !== 'strong') expect(max).toBeLessThanOrEqual(4);
    }
  });

  it('counts an inspector appearance as its own attention event', () => {
    const history = new AmbientSequenceHistory();
    expect(history.canRunStrong(100_000)).toBe(true);
    history.recordInspectorAppearance(100_000);
    expect(history.canRunStrong(100_000)).toBe(false);
    expect(history.canRunStrong(112_000)).toBe(true);
  });
});

describe('ambient weapon pool', () => {
  it('only offers weapons whose fire type runs through the shared executor', () => {
    // Flammenwerfer, Laubbläser, Tesla-Kuppel und Co. werden nicht vereinfacht nachgebaut.
    for (const excluded of ['FLAMETHROWER', 'LAUBBLAESER', 'TESLA_DOME', 'ENERGY_SHIELD', 'HEALING_AURA', 'ENERGIEINJEKTOR', 'OVERCHARGE_CORE']) {
      expect(AMBIENT_WEAPON_IDS).not.toContain(excluded);
    }
    expect(AMBIENT_WEAPON_IDS).toContain('AK47');
    expect(AMBIENT_WEAPON_IDS).toContain('ASMD_PRIM');
    expect(AMBIENT_WEAPON_IDS).toContain('BITE');
    // Der Reparaturstrahl bleibt dem Inspector vorbehalten.
    expect(AMBIENT_WEAPON_IDS).not.toContain('REPARATURSTRAHL');
  });

  it('boosts the selected loadout only when the weapon is ambient compatible', () => {
    const compatible = buildAmbientWeaponPool(['AK47']);
    expect(compatible.find((entry) => entry.id === 'AK47')?.weight).toBeGreaterThan(1);

    // Eine inkompatible Wahl bekommt keinen Ersatz und keinen Bonus – sie fehlt schlicht.
    const incompatible = buildAmbientWeaponPool(['FLAMETHROWER']);
    expect(incompatible.every((entry) => entry.weight === 1)).toBe(true);
    expect(incompatible.some((entry) => entry.id === 'FLAMETHROWER')).toBe(false);
  });

  it('lets anti-repetition outweigh the loadout bonus', () => {
    const history = new AmbientSequenceHistory();
    const pool = buildAmbientWeaponPool(['AK47']);
    const focus = pool.find((entry) => entry.id === 'AK47')!;
    const plain = pool.find((entry) => entry.id !== 'AK47' && entry.family === focus.family)!;

    // Frisch: Der Fokus wirkt und macht die gewählte Waffe klar wahrscheinlicher.
    expect(history.weaponPenalty(focus)).toBe(history.weaponPenalty(plain));
    expect(focus.weight * history.weaponPenalty(focus))
      .toBeGreaterThan(2 * plain.weight * history.weaponPenalty(plain));

    for (let index = 0; index < 3; index += 1) {
      history.record({
        template: 'short_duel',
        zoneId: 'left_gap',
        intensity: 'normal',
        weaponIds: [focus.id],
        weaponFamilies: [focus.family],
        enemyKinds: [],
        destroyedRocks: 0,
        usedLoadoutFocus: true,
        atMs: index * 10_000,
      });
    }

    const focusScore = focus.weight * history.weaponPenalty(focus);
    const plainScore = plain.weight * history.weaponPenalty(plain);
    expect(focusScore).toBeLessThan(plainScore);
  });
});
