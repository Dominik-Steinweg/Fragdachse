import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import { resolveConstructionPlacementRange } from '../../src/config/coopDefenseConstructions';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../../src/utils/coopDefenseUpgrades';
import {
  fireControlContributionId, isFireControlCopySourceId, type FireControlPortalDeploymentSnapshot,
} from '../../src/systems/fireControl/FireControlSnapshot';
import { decodeFireControlSnapshot, encodeFireControlSnapshot } from '../../src/network/fireControlSnapshotCodec';
import { ultimateHarness, START, STEP } from '../balance-lab/InspectorUltimateHarness';
import { HOLO_RAGE, INSPECTORS, inspectorUltimate } from '../balance-lab/InspectorUltimateConfigs';

// Counts come from authored upgrade limits; virtual time and fixed positions, no hardware thresholds.
const OWNERS = ['inspector', 'p2', 'p3', 'p4'] as const;
const TYPES = ['machine_gun_turret', 'rocket_turret', 'flame_turret'] as const;
const maxCopies = 1 + COOP_DEFENSE_UPGRADE_DEFINITIONS.fire_control_relay_connections.maxLevel;
const ENEMIES = 6;

type Fixture = ReturnType<typeof createFireControlWorldFixture>;
let f: Fixture;
afterEach(() => f?.destroy());

/** Four inspectors at their maximum sources, each with copies and a portal on one shared exit. */
function loaded(now = 1000) {
  f = createFireControlWorldFixture({ maxCopies, parallelEnabled: 1 }, { localFireEnabled: 1, damageBonus: 0.4 });
  const runtime = f.binding.fireControl!;
  const sources = new Map<string, number[]>();
  OWNERS.forEach((owner, k) => sources.set(owner, TYPES.map((type, i) => f.add(type, owner, 4 + i * 4, 4 + k * 5).id)));
  const first = f.point(f.placement.getRuntimeRock(sources.get('inspector')![0])!);
  const exit = { x: first.x + 1400, y: first.y };
  for (let i = 0; i < ENEMIES; i++) f.spawnEnemy(exit.x + 40 + i * 15, exit.y + (i % 3 - 1) * 30);
  const relay = f.config;
  const portalIds = new Map<string, number>();
  for (const owner of OWNERS) {
    const home = f.point(f.placement.getRuntimeRock(sources.get(owner)![0])!);
    expect(runtime.activateCopies({ ownerId: owner, ownerColor: 0xffffff, playerX: home.x, playerY: home.y,
      pointX: home.x + 60, pointY: home.y + 120, nowMs: now, config: { durationMs: relay.durationMs,
        cooldownMs: relay.cooldown, maxCopies, parallel: true, buildRangePx: resolveConstructionPlacementRange(),
        ringRadiusPx: relay.ringRadiusPx, clearanceRadiusPx: relay.clearanceRadiusPx,
        singleCopyOffsetPx: relay.singleCopyOffsetPx, materializeMs: relay.materializeMs } }).ok).toBe(true);
    const portal = runtime.activatePortal({ ownerId: owner, ownerColor: 0xffffff, originX: home.x, originY: home.y,
      restX: exit.x, restY: exit.y, nowMs: now, config: { durationMs: f.portalConfig.durationMs,
        cooldownMs: f.portalConfig.cooldown, damageBonus: 0.4, localFireRelease: true, exitClearanceRadiusPx: 12 } });
    if (!portal.ok) throw Error('portal');
    portalIds.set(owner, portal.deploymentId);
  }
  return { runtime, sources, exit, portalIds };
}

const portals = (at: number) => f.binding.getFireControlSnapshot(at).deployments
  .filter((d): d is FireControlPortalDeploymentSnapshot => d.kind === 'portal');

describe('Entfernen von Quellen, Einsatzende, Besitzerentfernung und World-Wechsel hinterlassen weder Portale noch Pausen; Clients und Late Join sehen den richtigen Zustand', () => {
  it('keeps participants per owner bounded under full overlap; copies never enter the construction list', () => {
    const { sources, portalIds } = loaded();
    let routedShots = 0;
    for (let at = 1000; at <= 1000 + f.config.durationMs - 1; at += 250) {
      const before = f.projectile.spawn.mock.calls.length;
      f.tick(at);
      expect(f.binding.getTurretDefinitions().some(def => isFireControlCopySourceId(def.id))).toBe(false);
      for (const portal of portals(at)) {
        const own = new Set(sources.get(portal.ownerId)!);
        expect(portal.entries.length).toBeLessThanOrEqual(own.size * (1 + maxCopies));
        for (const entry of portal.entries) expect(own.has(entry.identityId)).toBe(true);
      }
      for (const [request] of f.projectile.spawn.mock.calls.slice(before)) {
        const route = request.fireControlRoute;
        if (!route) continue;
        routedShots++;
        const owner = request.provenance.allegiance.ownerId;
        expect(route.ownerId).toBe(owner);
        expect(route.contributionId).toBe(fireControlContributionId(portalIds.get(owner)!));
        expect(own(sources, owner).has(Number(request.provenance.sourceTurretId))).toBe(true);
      }
    }
    expect(routedShots).toBeGreaterThan(OWNERS.length);
  });

  it('shares the exit line of fire per deployment and tick and renews it on the next tick', () => {
    loaded();
    const exit = portals(1000)[0];
    f.tick(1000 + f.config.materializeMs);
    const spy = vi.spyOn(f.combat, 'hasClearLineOfFire');
    const count = () => spy.mock.calls.filter(([sx, sy]) => sx === exit.x && sy === exit.y).length;
    f.tick(1000 + f.config.materializeMs + 250);
    const first = count();
    const participants = portals(1000).reduce((sum, p) => sum + p.entries.length, 0);
    expect(participants).toBeGreaterThan(OWNERS.length);
    expect(first).toBeGreaterThan(0);
    // All exits overlap: the checks scale with deployments × targets, not with the sources.
    expect(first).toBeLessThanOrEqual(OWNERS.length * (ENEMIES + 1));
    spy.mockClear();
    f.tick(1000 + f.config.materializeMs + 500);
    expect(count()).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('converges for late join, and cleanup leaves neither portals nor pauses nor routed shots', () => {
    const { runtime } = loaded();
    for (let at = 1000; at <= 2500; at += 250) f.tick(at);
    const snapshot = f.binding.getFireControlSnapshot(2500);
    const joined = decodeFireControlSnapshot(encodeFireControlSnapshot(snapshot))!;
    expect(joined.deployments.map(d => [d.id, d.kind, d.kind === 'portal' ? d.entries.length : d.copies.length]))
      .toEqual(snapshot.deployments.map(d => [d.id, d.kind, d.kind === 'portal' ? d.entries.length : d.copies.length]));
    f.action.removePlayer('inspector');
    runtime.removeOwner('p2');
    f.tick(2750);
    expect(portals(2750).map(p => p.ownerId).sort()).toEqual(['p3', 'p4']);
    f.binding.clearActivityBindings();
    expect(f.binding.getFireControlSnapshot(2750).deployments).toEqual([]);
    const before = f.projectile.spawn.mock.calls.length;
    f.tick(3000); f.tick(4000);
    expect(f.binding.getTurretFireSources().every(source => !source.portal && source.fireState === 'active')).toBe(true);
    expect(f.projectile.spawn.mock.calls.slice(before).some(([request]) => request.fireControlRoute)).toBe(false);
  });
});

function own(sources: Map<string, number[]>, owner: string): Set<number> {
  return new Set(sources.get(owner) ?? []);
}

describe('Holo and relay combined combat load', () => {
  it('keeps every temporary source firing on its own sequence within the full fc budget', () => {
    const config = inspectorUltimate('HOLO_OFFENSIVE', true);
    if (config.type !== 'holo_offensive') throw Error('Expected Holo config');
    const h = ultimateHarness('dense', INSPECTORS);
    try {
      h.addArsenal('mixed');
      // Surround the ring as well as the frontal group so even rear short-range flame copies have targets.
      for (const p of h.players.values()) for (const dx of [-180, 180]) for (const dy of [-100, 100]) {
        h.f.spawnEnemy(p.x + dx, p.y + dy).setHp(1e9, 1e9, true);
      }
      for (const owner of INSPECTORS) {
        expect(h.f.combat.isAlive(owner), owner).toBe(true);
        expect(h.f.binding.getHoloOffensiveCapability()!.tryActivate({ playerId: owner, nowMs: START,
          config, consumedRage: HOLO_RAGE })).toEqual({ ok: true });
      }
      const spawnMs = HOLO_RAGE / config.ragePerSpawnSecond * 1000;
      const expectedPeak = INSPECTORS.length * Math.min(Math.ceil(spawnMs / config.spawnIntervalMs),
        Math.ceil(config.copyLifetimeMs / config.spawnIntervalMs));
      const sequences = new Map<string, string | number>();
      let peakHolo = 0, peakRelay = 0, maxBytes = 0, simultaneous = false, relayActivated = false;
      const began = performance.now();
      for (let at = START; at <= START + spawnMs + config.copyLifetimeMs + 3000; at += STEP) {
        // Relay lifetime is shorter than Holo's ramp-up; activate when Holo approaches its peak.
        if (!relayActivated && at >= START + spawnMs / 2) {
          relayActivated = true;
          for (const owner of INSPECTORS) {
            const p = h.players.get(owner)!, relay = h.f.config;
            expect(h.f.binding.fireControl!.activateCopies({ ownerId: owner, ownerColor: p.color,
              playerX: p.x, playerY: p.y, pointX: p.x + 220, pointY: p.y, nowMs: at,
              config: { ...relay, maxCopies, parallel: true, cooldownMs: relay.cooldown,
                buildRangePx: resolveConstructionPlacementRange() } }).ok).toBe(true);
          }
        }
        h.advance(at);
        const snapshot = h.f.binding.getFireControlSnapshot(at);
        const holo = snapshot.deployments.filter(d => d.kind === 'holo').flatMap(d => d.copies);
        const relay = snapshot.deployments.filter(d => d.kind === 'copies').flatMap(d => d.copies);
        peakHolo = Math.max(peakHolo, holo.length); peakRelay = Math.max(peakRelay, relay.length);
        simultaneous ||= holo.length === expectedPeak && relay.length === INSPECTORS.length * maxCopies;
        const wire = encodeFireControlSnapshot(snapshot);
        maxBytes = Math.max(maxBytes, new TextEncoder().encode(JSON.stringify(wire)).byteLength);
        expect(decodeFireControlSnapshot(wire)).not.toBeNull();
        for (const source of h.f.binding.getTurretFireSources()) if (source.projection || isFireControlCopySourceId(source.id)) {
          sequences.set(String(source.id), source.sequenceKey);
          expect(source.sequenceKey).toBe(source.id);
        }
      }
      // Relay damage retains original identity; its visual ID identifies the actual firing copy.
      const fired = new Set(h.f.projectile.spawn.mock.calls.map(([r]) => r.presentation?.turretVisualId ?? r.provenance.sourceTurretId));
      expect(peakHolo).toBe(expectedPeak);
      expect(peakRelay).toBe(INSPECTORS.length * maxCopies);
      expect(simultaneous).toBe(true);
      expect(sequences.size).toBe(INSPECTORS.length * (Math.ceil(spawnMs / config.spawnIntervalMs) + maxCopies));
      expect(new Set(sequences.values()).size).toBe(sequences.size);
      for (const id of sequences.keys()) expect(fired.has(id), `source ${id} never fired`).toBe(true);
      expect(h.events.length).toBeGreaterThan(0);
      // Measured peak ~3.8 KiB; 6 KiB leaves ~59% for longer IDs/timestamps/coordinates.
      // Same cap as FireControlNetwork: full replacement at 20 Hz <= 120 KiB/s.
      expect(maxBytes).toBeLessThan(6 * 1024);
      console.info('HOLO_RELAY_STRESS ' + JSON.stringify({ peakHolo, peakRelay, sources: sequences.size,
        fcBytes: maxBytes, elapsedMs: Math.round(performance.now() - began) }));
    } finally { h.destroy(); }
  }, 20000);
});
