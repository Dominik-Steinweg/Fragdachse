import { describe, expect, it } from 'vitest';
import raw from '../src/config/dawn/nightModifiers.json';
import { validateDawnNightModifiers } from '../src/config/dawn/dawnNightModifiers';
import { getDawnArenaTemplate, getDawnNightModifier, getDawnSchedule, getDawnThreatCurve, getDawnWaveBlocks, getDawnWaveBlock } from '../src/config/dawn/dawnContent';
import { DAWN_NIGHT_MODIFIER_IDS } from '../src/dawn/contracts/DawnContentIds';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnNightCurve, selectDawnNightModifier } from '../src/dawn/composition/DawnNightModifierComposition';
import { resolveDawnScenario } from '../src/dawn/resolution/DawnScenarioResolution';
import { resolveDawnNightEnvironment } from '../src/dawn/resolution/DawnNightModifierResolution';
import { getDawnPhaseStartMs } from '../src/dawn/rules/DawnPhase';
import { buildDawnHudModel } from '../src/ui/DawnHudModel';
import { defaultScenario, parseScenario } from '../src/dev/scenario/config';

describe('Dawn night modifiers', () => {
  it('validates complete IDs, ordered probabilities and real content references', () => {
    const validate = (value: unknown) => validateDawnNightModifiers(value, getDawnWaveBlocks());
    expect(validate(raw)).toHaveLength(DAWN_NIGHT_MODIFIER_IDS.length);
    for (const alter of [
      (v: typeof raw) => { v.modifiers.pop(); },
      (v: typeof raw) => { v.modifiers[1].id = v.modifiers[0].id; },
      (v: typeof raw) => { v.modifiers[0].chanceByThreat[0] = 0.1; },
      (v: typeof raw) => { v.modifiers[0].chanceByThreat[9] = NaN; },
      (v: typeof raw) => { v.modifiers.forEach(m => { m.chanceByThreat[9] = 0.5; }); },
      (v: typeof raw) => { v.modifiers[0].nightBudgetMultiplier = 0; },
      (v: typeof raw) => { v.modifiers[3].additionalBlocks = ['missing']; },
      (v: typeof raw) => { v.modifiers[1].fogStrength = 3; },
      // Each diegetic effect has exactly one modifier owner (D-47).
      (v: typeof raw) => { Object.assign(v.modifiers[1], { moonlight: v.modifiers[0].moonlight }); },
      (v: typeof raw) => { delete (v.modifiers[3] as { groundFire?: unknown }).groundFire; },
      (v: typeof raw) => { v.modifiers[3].groundFire.ignitions[1].startRatio = 0.01; },
      (v: typeof raw) => { v.modifiers[0].moonlight.tint = [1, 2, 1]; },
      (v: typeof raw) => { v.modifiers[2].airstrikes.runSpeedPxPerSec = 50; },
    ]) {
      const value = structuredClone(raw); alter(value);
      expect(() => validate(value)).toThrow('Night modifiers');
    }
  });

  it('uses a reproducible independent selection stream and leaves low threats clear', () => {
    for (let threat = 1; threat <= 10; threat++) {
      const selected = new Set<string | undefined>();
      for (let seed = 0; seed < 1024; seed++) {
        const id = selectDawnNightModifier(seed, threat);
        expect(selectDawnNightModifier(seed, threat)).toBe(id);
        selected.add(id);
      }
      expect(selected.has(undefined)).toBe(true);
      if (threat <= 2) expect([...selected]).toEqual([undefined]);
      else for (const id of DAWN_NIGHT_MODIFIER_IDS) expect(selected.has(id)).toBe(true);
    }
  });

  it.each(DAWN_NIGHT_MODIFIER_IDS)('%s keeps World, daytime and site assaults unchanged; resolves identically on peers', id => {
    const input = { seed: 91, threat: 8, dayNumber: 2 };
    const normal = composeDawnRoundPlans({ ...input, nightModifier: 'none' });
    const special = composeDawnRoundPlans({ ...input, nightModifier: id });
    expect(special.activity.nightModifierId).toBe(id);
    expect(special.world).toEqual(normal.world);
    const schedule = getDawnSchedule(special.activity.scheduleId);
    const start = getDawnPhaseStartMs(schedule, 'night'), end = getDawnPhaseStartMs(schedule, 'dawn');
    const unaffected = (plan: typeof special) => plan.activity.waves.filter(w => 'siteId' in w || w.atMs < start);
    expect(unaffected(special)).toEqual(unaffected(normal));
    const resolved = resolveDawnScenario(special.world, special.activity);
    const baseline = resolveDawnScenario(normal.world, normal.activity);
    expect(resolved.world).toEqual(baseline.world);
    expect(resolveDawnScenario(JSON.parse(JSON.stringify(special.world)), JSON.parse(JSON.stringify(special.activity)))).toEqual(resolved);
    expect(resolveDawnNightEnvironment(special.activity, start - 1)).toBeNull();
    expect(resolveDawnNightEnvironment(special.activity, end)).toBeNull();
    expect(resolveDawnNightEnvironment(special.activity, start)?.modifierId).toBe(id);
    if (id === 'fog') {
      expect(resolveDawnNightEnvironment(special.activity, start)?.fogStrength).toBe(getDawnNightModifier(id).fogStrength);
      expect(resolved.activity.encounters).toEqual(baseline.activity.encounters);
    }
    if (id === 'bombers') {
      expect(resolved.activity.mapEvents!.length).toBeGreaterThan(0);
      const nightFronts = new Set(special.activity.waves.flatMap(w => 'front' in w && w.atMs >= start && w.atMs < end ? [w.front] : []));
      for (const event of resolved.activity.mapEvents!) {
        expect(event.type).toBe('airstrike');
        expect(event.start.type).toBe('time');
        if (event.start.type === 'time') {
          expect(event.start.atMs).toBeGreaterThanOrEqual(start);
          expect(event.start.atMs + getDawnNightModifier(id).airstrikes!.endClearanceMs).toBeLessThan(end);
        }
        // Bombers come in from a front of this night, so the run crosses the base zone (D-47).
        if (event.type !== 'airstrike' || !event.run) throw new Error(`${event.id} has no bomber run`);
        const heading = event.run.headingDeg;
        expect([...nightFronts].some(front => {
          const inward = { west: 0, north: 90, east: 180, south: 270 }[front];
          return Math.abs(((heading - inward + 540) % 360) - 180) <= 25;
        }), `${event.id} heading ${heading}`).toBe(true);
      }
    }
    if (id === 'fire') {
      const fires = resolved.activity.mapEvents!;
      expect(fires.length).toBe(getDawnNightModifier(id).groundFire!.ignitions.length);
      for (const event of fires) {
        if (event.type !== 'ground-hazard' || event.start.type !== 'time' || event.area.type !== 'random-patches') {
          throw new Error(`${event.id} is no timed random-patch fire`);
        }
        // Fires start at night, spread radially, burn out at dawn and are ordinary flames.
        expect(event.start.atMs).toBeGreaterThanOrEqual(start);
        expect(event.start.atMs + event.durationMs!).toBe(end);
        expect(event.spread?.direction).toBe('radial');
        expect(event.effect.visualStyle).toBe('normal');
      }
      const extra = resolved.activity.encounters!.filter(e => !baseline.activity.encounters!.some(b => b.id === e.id));
      expect(extra.length).toBeGreaterThan(0);
      expect(extra.flatMap(e => e.groups).some(g => g.enemyKind === 'firestarter-badger')).toBe(true);
      expect(extra.every(e => e.start.type === 'time' && e.start.atMs >= start && e.start.atMs < end)).toBe(true);
    }
    if (id === 'blood-moon') {
      const curve = getDawnThreatCurve(input.threat), modified = resolveDawnNightCurve(curve, id);
      expect(modified.nightBudget).toBe(curve.nightBudget * getDawnNightModifier(id).nightBudgetMultiplier);
      expect(modified.enemyWeights['spore-warden'] / modified.enemyWeights['zombie-badger'])
        .toBeGreaterThan(curve.enemyWeights['spore-warden'] / curve.enemyWeights['zombie-badger']);
      const cost = (plan: typeof special) => plan.activity.waves.filter(w => 'front' in w && w.atMs >= start)
        .reduce((sum, w) => sum + getDawnWaveBlock(w.blockId).cost, 0);
      expect(cost(special)).toBeGreaterThan(cost(normal));
      expect(cost(special)).toBeLessThanOrEqual(modified.nightBudget);
      expect(resolved.activity.encounters).not.toEqual(baseline.activity.encounters);
    }
  });

  it('projects modifier name and optional texture key from dusk until dawn', () => {
    const schedule = getDawnSchedule('standard');
    for (const phase of ['day', 'dusk', 'night', 'dawn'] as const) {
      const model = buildDawnHudModel({ schedule, elapsedMs: getDawnPhaseStartMs(schedule, phase),
        sharedScrap: 0, threat: 3, dayNumber: 1, sites: [], objectives: null, clockMinutes: 0, nightModifierId: 'fog' });
      expect(model.nightModifier).toEqual(phase === 'dusk' || phase === 'night'
        ? { id: 'fog', nameKey: 'ui.dawn.nightModifier.fog', iconKey: 'night-fog' } : null);
    }
  });

  it('validates explicit dev overrides including none', () => {
    const { mapId: _, ...recipe } = defaultScenario('dachs_nukem');
    for (const nightModifier of [...DAWN_NIGHT_MODIFIER_IDS, 'none'] as const) {
      expect(parseScenario({ ...recipe, dawn: { threat: 1, nightModifier } }).dawn?.nightModifier).toBe(nightModifier);
      expect(composeDawnRoundPlans({ seed: 1, threat: 1, dayNumber: 1, nightModifier }).activity.nightModifierId)
        .toBe(nightModifier === 'none' ? undefined : nightModifier);
    }
    expect(() => parseScenario({ ...recipe, dawn: { threat: 3, nightModifier: 'typo' } })).toThrow('nightModifier');
  });
});

describe('Dawn night modifiers stay diegetic (D-47)', () => {
  it('lights the blood moon through the sun owner and only at night', () => {
    const plans = composeDawnRoundPlans({ seed: 3, threat: 6, dayNumber: 1, nightModifier: 'blood-moon' });
    const schedule = getDawnSchedule(plans.activity.scheduleId);
    const night = getDawnPhaseStartMs(schedule, 'night');
    expect(resolveDawnNightEnvironment(plans.activity, night + 1000)?.moonlight).toEqual(getDawnNightModifier('blood-moon').moonlight);
    expect(resolveDawnNightEnvironment(plans.activity, night - 1000)).toBeNull();
    for (const id of ['fog', 'bombers', 'fire'] as const) expect(getDawnNightModifier(id).moonlight).toBeUndefined();
  });

  it('keeps every fire off the base core and the lanes from all fronts', () => {
    const plans = composeDawnRoundPlans({ seed: 17, threat: 8, dayNumber: 3, nightModifier: 'fire' });
    const template = getDawnArenaTemplate(plans.world.templateId);
    const anchor = template.world.persistentBase.anchor;
    const fire = getDawnNightModifier('fire').groundFire!;
    for (const event of resolveDawnScenario(plans.world, plans.activity).activity.mapEvents!) {
      if (event.type !== 'ground-hazard' || event.area.type !== 'random-patches') throw new Error(event.id);
      const capsules = event.area.keepClear!;
      expect(capsules).toContainEqual({ from: anchor, to: anchor, radiusCells: fire.coreClearanceCells });
      for (const front of new Set(template.fronts)) {
        // One lane per front runs from that arena edge to the base anchor.
        const same = (a: { gridX: number; gridY: number }, b: typeof a) => a.gridX === b.gridX && a.gridY === b.gridY;
        const lane = capsules.find(capsule => same(capsule.to, anchor) && !same(capsule.from, anchor)
          && ({ west: capsule.from.gridX === 0, east: capsule.from.gridX === template.world.arenaWidthCells! - 1,
            north: capsule.from.gridY === 0, south: capsule.from.gridY === template.world.arenaHeightCells! - 1 })[front]);
        expect(lane?.radiusCells, `${template.id} ${front}`).toBe(fire.laneClearanceCells);
      }
    }
  });

  it('colours the existing ground fog at night only, never through a screen overlay', () => {
    const plans = composeDawnRoundPlans({ seed: 3, threat: 6, dayNumber: 1, nightModifier: 'blood-moon' });
    const schedule = getDawnSchedule(plans.activity.scheduleId);
    const night = getDawnPhaseStartMs(schedule, 'night') + 1000;
    expect(resolveDawnNightEnvironment(plans.activity, night)?.fogTint).toEqual(getDawnNightModifier('blood-moon').fogTint);
    expect(resolveDawnNightEnvironment(plans.activity, getDawnPhaseStartMs(schedule, 'night') - 1000)).toBeNull();
    const fog = getDawnNightModifier('fog');
    expect(fog.fogStrength).toBeGreaterThan(1);
    for (const tint of [getDawnNightModifier('blood-moon').fogTint!, fog.fogTint!]) {
      expect(tint.every(channel => channel >= 0 && channel <= 1.25)).toBe(true);
    }
  });

  it('rejects malformed fog tints', () => {
    const blocks = getDawnWaveBlocks();
    const broken = structuredClone(raw) as { modifiers: { fogTint?: unknown }[] };
    broken.modifiers[0].fogTint = [1, 2, 1];
    expect(() => validateDawnNightModifiers(broken, blocks)).toThrow(/fogTint/);
  });
});
