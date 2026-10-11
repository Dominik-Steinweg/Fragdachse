import type { KrakenState, KrakenPhase, KrakenTentacleState } from '../src/systems/KrakenState';
import type { EnemyAreaClawEvent } from '../src/systems/EnemyClawAttack';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import { encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';

export const boss = { kind: 'enemy' as const, id: 'e1', scope: { worldRevision: 2, runtimeGeneration: 3 },
  instance: { entityGeneration: 4, activityRevision: 5 } };
export const phases: KrakenPhase[] = [
  { kind: 'waiting', startsAt: 0 },
  { kind: 'intro', startedAt: 0, emergeAt: 10, cameraReturnedAt: 20 },
  { kind: 'surfaced', startedAt: 0, nextDiveAt: 100 },
  { kind: 'diving', startedAt: 0, submergedAt: 10, endsAt: 20 },
  { kind: 'submerged', startedAt: 0, stopSpawningAt: 100 },
  { kind: 'surfacing', startedAt: 0, vulnerableAt: 10, endsAt: 20, recoveryEndsAt: 30 },
  { kind: 'ashore', corridorId: 'exit', startedAt: 0, moveAt: 10, gripAt: 20, heaveAt: 30,
    endsAt: 40, recoveryEndsAt: 50, blocked: true },
  { kind: 'land', startedAt: 0 },
  { kind: 'dying', startedAt: 0, endsAt: 10, terminalPose: { x: 20, y: 30, angle: .7 }, asset: 'water', submerged: true },
  { kind: 'removed', removedAt: 10 },
];
export function part(partId: string): KrakenTentacleState {
  return { contact: { identity: { boss, partId, partGeneration: 1, cycleId: 1 }, contactId: partId,
    hitboxProfileId: 'exposed', x: 12, y: 15, angle: Math.PI / 3, targetableFrom: 10, targetableUntil: 100 },
    revision: 2, phase: 'hover', startedAt: 0, hoverAt: 10, retractAt: 80, endsAt: 120,
    claw: { revision: 1, attack: { attackId: `${partId}:slam`, weaponId: 'kraken-tentacle', presentation: 'tentacle',
      pose: { originX: 14, originY: 18, angle: Math.PI / 3, geometry: { kind: 'lane', length: 150, width: 40 } },
      startedAt: 10, strikeAt: 30, hitAt: 40, endsAt: 70 } } };
}
export function kraken(phase: KrakenPhase = phases[4]): KrakenState {
  return { boss, revision: 6, cycleId: 1, habitatId: 'pond', phase, phaseTwoPending: true,
    bodyTargetability: { revision: 3, effectiveAt: 0, mode: phase.kind === 'submerged' ? 'hidden' : 'protected' },
    movement: 'water-anchored', bodyAction: null,
    tentacles: phase.kind === 'submerged' ? [part('left'), part('right')] : [],
    eggs: phase.kind === 'removed' ? [] : [{ eggId: 'e2', entityGeneration: 2, bossId: boss.id,
      bossGeneration: 4, castId: 'cast', originId: 'encounter', broodTableId: 'brood', enemyKind: 'rabid-badger',
      landedAt: 5, hatchStartedAt: 10, spawnAt: 12, endsAt: 15, status: 'incubating' }],
    inkClouds: phase.kind === 'removed' ? [] : [{ attackId: 'ink', spitAt: 10, cloudEndsAt: 25,
      pose: { originX: 1, originY: 2, angle: .37, geometry: { kind: 'sector', range: 120, arcDegrees: 45 } } }],
  };
}
export function event(partId = 'left'): EnemyAreaClawEvent {
  return { worldRevision: 2, activityRevision: 5, enemyId: boss.id, entityGeneration: 4,
    slot: { kind: 'part', partId, partGeneration: 1, cycleId: 1 }, state: part(partId).claw };
}
export function packet(state: KrakenState | null = kraken(), sequence = 1) {
  return { worldRevision: 2, activityRevision: 5, sequence, kraken: state };
}
export function enemies() {
  const u: Array<number | string> = [];
  encodeEnemyUpsert(u, { id: boss.id, entityGeneration: 4, x: 30, y: 50, hp: 100, maxHp: 100, kind: 'zombie-badger' });
  return { c: 1, u, r: [], a: [1] };
}
export function gameState(state: KrakenState | null = kraken()): Parameters<NetworkBridge['publishGameState']>[0] {
  return { kraken: state, roundStartTime: 0, players: {}, projectiles: null, enemies: enemies(), rocks: null,
    placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
    remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
    nukes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
    coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
    guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
    targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] } };
}
