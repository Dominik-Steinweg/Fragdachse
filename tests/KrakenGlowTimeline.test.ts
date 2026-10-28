import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Filters: { Controller: class {} }, Renderer: { WebGL: { RenderNodes: { BaseFilterShader: class {} } } }, BlendModes: { NORMAL: 0, ADD: 1 },
}));
import { KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import { krakenExitRoarAt } from '../src/systems/CoopDefenseKrakenMotion';
import type { KrakenEggState, KrakenState, KrakenTentacleState } from '../src/systems/KrakenState';
import { KRAKEN_GLOW, krakenBodySuckers, krakenDeepEmber, krakenEggGlowState, krakenEyeDrive, krakenIgnite, krakenIntroEyeDrive,
  krakenSuckerWave, krakenTentacleSuckers } from '../src/effects/kraken/KrakenGlowTimeline';
import { KRAKEN_BROOD, krakenBroodGlow } from '../src/effects/kraken/submersionShader';
import { KRAKEN_LIGHT_RIG_CAPACITY, KrakenLightRig } from '../src/effects/kraken/KrakenLightRig';
import { krakenEmissiveRect } from '../src/effects/kraken/KrakenEmissionQuad';

const boss: KrakenState['boss'] = { kind: 'enemy', id: 'boss', scope: { worldRevision: 1, runtimeGeneration: 1 },
  instance: { entityGeneration: 1, activityRevision: 1 } };
function state(phase: KrakenState['phase'], bodyAction: KrakenState['bodyAction'] = null): KrakenState {
  return { boss, revision: 1, cycleId: 1, habitatId: 'pond', phase, phaseTwoPending: false,
    bodyTargetability: { revision: 1, effectiveAt: 0, mode: phase.kind === 'submerged' ? 'hidden' : 'exposed' },
    movement: 'water-anchored', bodyAction, inkClouds: [], tentacles: [], eggs: [], spines: [] };
}
function tentacle(): KrakenTentacleState {
  return { contact: { identity: { boss, partId: 'a', partGeneration: 1, cycleId: 1 }, contactId: 'a', hitboxProfileId: 'shore-arm',
    x: 0, y: 0, angle: 0, targetableFrom: 300, targetableUntil: 3000 }, revision: 1, phase: 'hover',
    startedAt: 0, hoverAt: 900, retractAt: 3000, endsAt: 3850,
    claw: { revision: 1, attack: { attackId: 'a:1', weaponId: 'tentacle', presentation: 'tentacle',
      pose: { originX: 0, originY: 0, angle: 0, geometry: { kind: 'lane', length: 320, width: 112 } },
      startedAt: 1200, strikeAt: 2300, hitAt: 2470, endsAt: 2970 } } };
}

describe('kraken glow timeline', () => {
  it('keeps the intro eyes dark until they open, ignites with an overshoot and flares on the roar', () => {
    const timing = { eyesAt: 2285, roarAt: 2643 };
    expect(krakenIntroEyeDrive(timing, 2284)).toBe(0);
    expect(krakenIgnite(2285 + KRAKEN_GLOW.eye.igniteRiseMs, 2285)).toBeCloseTo(KRAKEN_GLOW.eye.igniteOvershoot);
    expect(krakenIntroEyeDrive(timing, timing.roarAt)).toBeCloseTo(KRAKEN_GLOW.eye.roarPeak, 1);
    expect(krakenIntroEyeDrive(timing, timing.roarAt + 2000)).toBeLessThan(1.2);
  });

  it('never lights a hidden kraken: submerged, waiting or diving below the surface means no glow at all', () => {
    const now = 5000, hidden = state({ kind: 'submerged', startedAt: 0, stopSpawningAt: 9000 });
    expect(krakenEyeDrive(hidden, now)).toBe(0);
    expect(krakenEyeDrive(state({ kind: 'waiting', startsAt: 9000 }), now)).toBe(0);
    expect(krakenEyeDrive(state({ kind: 'diving', startedAt: 4000, submergedAt: 4950, endsAt: 5200 }), now)).toBe(0);
    expect(krakenBodySuckers(hidden, now).level).toBe(0);
    expect(krakenDeepEmber(hidden, now)).toBe(0);
  });

  it('heats the eyes through an ink charge and samples identically for a late joiner', () => {
    const ink = state({ kind: 'surfaced', startedAt: 0, nextDiveAt: 99999 },
      { kind: 'ink', attackId: 'ink', startedAt: 1000, chargeAt: 1200, spitAt: 2180, endsAt: 2630 });
    const charged = krakenEyeDrive(ink, 2170), rest = krakenEyeDrive(ink, 1100);
    expect(charged).toBeGreaterThan(rest);
    expect(charged).toBeLessThanOrEqual(KRAKEN_GLOW.eye.inkPeak * (1 + KRAKEN_GLOW.eye.breathDepth) + 1e-6);
    // Pure in the replicated anchors and the synchronized clock: the same moment gives the same light.
    expect(krakenEyeDrive(ink, 1777)).toBe(krakenEyeDrive(structuredClone(ink), 1777));
  });

  it('lets ember rise from the deep before a surfacing body opens its eyes, then ignites them at the vulnerable anchor', () => {
    const p = { kind: 'surfacing', startedAt: 1000, vulnerableAt: 1900, endsAt: 2400, recoveryEndsAt: 3000 } as const;
    expect(krakenDeepEmber(state(p), 1000)).toBe(0);
    expect(krakenDeepEmber(state(p), 1800)).toBeGreaterThan(.5);
    expect(krakenEyeDrive(state(p), 1899)).toBe(0);
    expect(krakenEyeDrive(state(p), 1900 + KRAKEN_GLOW.eye.igniteRiseMs)).toBeGreaterThan(1);
  });

  it('burns hotter ashore with a roar peak and goes out over the death', () => {
    const exit = { kind: 'ashore', corridorId: 'c', startedAt: 1000, moveAt: 2200, endsAt: 3400, recoveryEndsAt: 4000,
      gripAt: 1700, heaveAt: 2950, blocked: false } as const;
    const roar = krakenExitRoarAt(exit, KRAKEN_BOSS_DEFAULTS.exit), land = state({ kind: 'land', startedAt: 0 });
    expect(krakenEyeDrive(state(exit), roar)).toBeGreaterThan(krakenEyeDrive(land, roar + 5000));
    expect(krakenBodySuckers(state(exit), roar).level).toBeGreaterThan(krakenBodySuckers(land, roar).level);
    const dying = state({ kind: 'dying', startedAt: 1000, endsAt: 3600, terminalPose: { x: 0, y: 0, angle: 0 }, asset: 'land', submerged: false });
    expect(krakenEyeDrive(dying, 1000 + 1400)).toBe(0);
  });

  it('wakes strike-arm cups with the rise, races them to the tip through the telegraph, flashes on impact and fades with the sink', () => {
    const arm = tentacle(), a = arm.claw.attack!;
    expect(krakenTentacleSuckers(arm, -1).level).toBe(0);
    expect(krakenTentacleSuckers(arm, 600).level).toBeLessThanOrEqual(KRAKEN_GLOW.sucker.riseLevel);
    const early = krakenTentacleSuckers(arm, a.startedAt + 100), late = krakenTentacleSuckers(arm, a.strikeAt - 10);
    expect(late.level).toBeGreaterThan(early.level);
    expect(late.hz).toBeGreaterThan(early.hz);
    expect(early.direction).toBe(1);
    expect(krakenTentacleSuckers(arm, a.hitAt).level).toBeCloseTo(KRAKEN_GLOW.sucker.hitFlash);
    expect(krakenTentacleSuckers(arm, arm.retractAt + 400).direction).toBe(-1);
    expect(krakenTentacleSuckers(arm, arm.endsAt).level).toBe(0);
    // The wave travels from root to tip: a point further out reaches the same phase later.
    const drive = { level: 1, hz: 1, direction: 1 as const };
    expect(krakenSuckerWave(.5, .3, drive)).toBeCloseTo(krakenSuckerWave(0, .3 - .8, drive));
  });

  it('keeps the established brood heartbeat while incubating and flashes once while the shell splits', () => {
    const egg: KrakenEggState = { eggId: 'e', entityGeneration: 1, bossId: 'boss', bossGeneration: 1, castId: 'c', originId: 'o',
      broodTableId: 'b', enemyKind: 'rabid-rabbit', landedAt: 1000, hatchStartedAt: 4500, spawnAt: 4900, endsAt: 5167, status: 'incubating' };
    const now = 3000, age = (now - egg.landedAt) / 1000, incubation = (now - egg.landedAt) / (egg.hatchStartedAt - egg.landedAt);
    const beat = Math.sin(age * (5 + incubation * 7)), glow = krakenEggGlowState(egg, now);
    expect(glow.glow).toBeCloseTo(krakenBroodGlow(beat, incubation));
    expect(glow.pulse).toBeCloseTo(beat * KRAKEN_BROOD.pulse * incubation);
    expect(glow.hatchFlash).toBe(0);
    expect(krakenEggGlowState(egg, egg.hatchStartedAt + KRAKEN_GLOW.egg.hatchFlashMs / 2).hatchFlash).toBeCloseTo(1);
    expect(krakenEggGlowState(egg, egg.spawnAt + 250).glow).toBe(0);
  });
});

describe('kraken emissive companion', () => {
  it('covers only what glows: open eyes, brood discs or the whole egg, and nothing for closed eyes', () => {
    const eyes = { x: 164, y: 120, width: 56, height: 17, realWidth: 384, realHeight: 384 };
    const closed = { ...eyes, x: 0, y: 0, width: 1, height: 1 };
    const rect = krakenEmissiveRect(eyes, { eye: 1, alpha: 1 }, [0, 0])!;
    expect(rect[0]).toBeCloseTo(164 / 384); expect(rect[3]).toBeCloseTo(137 / 384);
    expect(krakenEmissiveRect(closed, { eye: 1, alpha: 1 }, [.01, .01])).toBeNull();
    expect(krakenEmissiveRect(closed, { eye: 1, alpha: 1, glow: { strength: .3, whole: true } }, [0, 0])).toEqual([0, 0, 1, 1]);
    const brood = krakenEmissiveRect(closed, { eye: 0, alpha: 1, glow: { strength: .3, whole: false },
      brood: { tint: [1, 1, 1, 1], scale: 1, discs: [[.2, .3, .05, 0]] } }, [0, 0])!;
    expect(brood[0]).toBeCloseTo(.15); expect(brood[3]).toBeCloseTo(.35);
  });
});

describe('kraken light rig', () => {
  it('stays within its capacity and releases its ground-glow owner', () => {
    const setGroundGlowLights = vi.fn(), rig = new KrakenLightRig({ setGroundGlowLights } as never);
    rig.begin();
    for (let i = 0; i < 100; i++) rig.add(i, i, 40, 1, 0xffffff);
    rig.commit();
    expect(rig.size).toBe(KRAKEN_LIGHT_RIG_CAPACITY);
    expect(setGroundGlowLights.mock.calls.at(-1)![1].lightCount).toBe(KRAKEN_LIGHT_RIG_CAPACITY);
    rig.begin(); rig.commit();
    expect(setGroundGlowLights).toHaveBeenLastCalledWith(rig, null);
    rig.begin(); rig.add(0, 0, 40, 1, 0); rig.commit(); rig.clear();
    expect(setGroundGlowLights).toHaveBeenLastCalledWith(rig, null);
  });
});
