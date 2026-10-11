import { describe, expect, it, vi } from 'vitest';
import { CoopDefenseKrakenBroodSystem, type KrakenBroodDependencies } from '../src/systems/CoopDefenseKrakenBroodSystem';
import { KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import type { KrakenEggLandingRequest } from '../src/systems/KrakenState';

function setup() {
  const config = KRAKEN_BOSS_DEFAULTS.eggs;
  let alive = true, eggAlive = true, serial = 0;
  const deps: KrakenBroodDependencies = {
    isBossAlive: () => alive, readEgg: () => ({ alive: eggAlive, x: 400, y: 200 }),
    spawnEgg: vi.fn(() => ({ id: `egg-${++serial}`, generation: 1 })), removeEgg: vi.fn(), retireEgg: vi.fn(),
    landingFree: () => true, reserveChild: vi.fn(() => ({ status: 'valid', reservationId: 'child' })),
    spawnChild: vi.fn(), releaseChild: vi.fn(), cancelFlights: vi.fn(), random: () => .5,
  };
  const system = new CoopDefenseKrakenBroodSystem(config, deps);
  const request: KrakenEggLandingRequest = { projectileId: 1, x: 400, y: 200, landedAt: 100,
    provenance: { gameplaySourceId: 'boss', attributionId: 'boss', allegiance: { ownerId: 'boss' } },
    effect: { type: 'kraken_egg_land', boss: { kind: 'enemy', id: 'boss', scope: { worldRevision: 1, runtimeGeneration: 1 },
      instance: { entityGeneration: 1, activityRevision: 1 } }, castId: 'cast', eggId: 'flight-egg', broodTableId: config.broodTable.id, originId: 'encounter' } };
  const land = () => { system.reserveEgg(request.effect); system.released(request.effect, 1); return system.landEgg(request); };
  return { config, deps, system, request, land, killEgg: () => { eggAlive = false; }, killBoss: () => { alive = false; } };
}
describe('Kraken brood owner', () => {
  it('incubates from actual landing, then commits registry-selected brood only at the hatch marker', () => {
    const f = setup(); expect(f.land()).toBe('incubating');
    const egg = f.system.getEggs(f.request.effect.boss)[0];
    expect(egg.hatchStartedAt).toBe(f.request.landedAt + f.config.incubationMs);
    f.system.hostUpdate(egg.hatchStartedAt);
    expect(f.system.getEggs(f.request.effect.boss)[0].status).toBe('hatching');
    expect(f.deps.spawnChild).not.toHaveBeenCalled();
    vi.mocked(f.deps.spawnChild).mockImplementation(() => f.system.hostUpdate(egg.spawnAt));
    f.system.hostUpdate(egg.spawnAt);
    expect(f.deps.retireEgg).toHaveBeenCalledExactlyOnceWith(egg.eggId, egg.entityGeneration);
    expect(f.system.getEggs(f.request.effect.boss)[0].status).toBe('terminal');
    expect(f.deps.removeEgg).not.toHaveBeenCalled();
    f.system.hostUpdate(egg.spawnAt + 10000);
    expect(f.deps.spawnChild).toHaveBeenCalledExactlyOnceWith(f.config.broodTable.entries[0].enemyKind,
      expect.objectContaining({ x: f.request.x, y: f.request.y }), 'encounter', 'child');
    expect(f.system.landEgg(f.request)).toBe('stale');
  });
  it('death before the marker wins, including during child reservation', () => {
    const f = setup(); f.land(); const egg = f.system.getEggs(f.request.effect.boss)[0];
    vi.mocked(f.deps.reserveChild).mockImplementation(() => { f.killEgg(); return { status: 'valid', reservationId: 'reserved' }; });
    f.system.hostUpdate(egg.spawnAt);
    expect(f.deps.spawnChild).not.toHaveBeenCalled(); expect(f.deps.releaseChild).toHaveBeenCalledWith('reserved');
  });
  it('breaks invalid terminal positions without relocating and rejects old generations', () => {
    const f = setup(); f.deps.landingFree = () => false;
    expect(f.land()).toBe('broken'); expect(f.deps.spawnEgg).not.toHaveBeenCalled();
    const old = structuredClone(f.request); old.effect.boss.instance.entityGeneration++;
    expect(f.system.landEgg(old)).toBe('stale');
  });
  it('counts pending flights and live eggs together, and cancels without landing on boss death', () => {
    const f = setup(); f.land();
    for (let i = 1; i < f.config.maxPendingAndLive; i++) {
      const effect = { ...f.request.effect, eggId: `pending-${i}` };
      expect(f.system.reserveEgg(effect)).toBe(true); f.system.released(effect, i + 1);
    }
    expect(f.system.reserveEgg({ ...f.request.effect, eggId: 'over-cap' })).toBe(false);
    f.killBoss(); f.system.hostUpdate(100);
    expect(f.deps.cancelFlights).toHaveBeenCalledWith(Array.from({ length: f.config.maxPendingAndLive - 1 }, (_, i) => i + 2));
    expect(f.system.getEggs(f.request.effect.boss)).toEqual([]); expect(f.deps.spawnChild).not.toHaveBeenCalled();
  });
  it('retries occupied child placements once per step and expires instead of using unchecked offsets', () => {
    const f = setup(); f.land(); const egg = f.system.getEggs(f.request.effect.boss)[0];
    vi.mocked(f.deps.reserveChild).mockReturnValue({ status: 'pending' });
    f.system.hostUpdate(egg.spawnAt); f.system.hostUpdate(egg.spawnAt);
    expect(f.deps.reserveChild).toHaveBeenCalledTimes(1);
    f.system.hostUpdate(egg.spawnAt + f.config.spawnRetryWindowMs + 1);
    expect(f.deps.spawnChild).not.toHaveBeenCalled(); expect(f.system.getEggs(f.request.effect.boss)).toEqual([]);
  });
});
