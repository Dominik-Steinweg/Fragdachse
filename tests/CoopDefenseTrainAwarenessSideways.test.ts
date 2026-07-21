import { describe, expect, it } from 'vitest';
import { CoopDefenseEnemyTrainAwarenessSystem } from '../src/systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { TrainManager } from '../src/train/TrainManager';
import type { TrainEventConfig } from '../src/types';

const TRACK_X = 960;
const MOVE_SPEED = 175;

function createEnemy(x: number): EnemyEntity {
  return {
    id: 'e1',
    // Der Alien-Dachs hat eine trainAwareness-Konfiguration; ohne die greift die Gleis-KI nicht.
    kind: 'alien-badger',
    sprite: { x, y: 100, active: true },
    getCollisionRadius: () => 15,
    getMoveSpeed: () => MOVE_SPEED,
  } as unknown as EnemyEntity;
}

/**
 * @param hazardStartsInMs Zeit bis der Zug diese Reihe erreicht. Groß = viel Luft zum Queren,
 *                         0 = der Zug ist bereits da.
 */
function createSystem(hazardStartsInMs: number, now: number) {
  const train = {
    isDestroyed: () => false,
    getTrackX: () => TRACK_X,
    getCrossingHazardWindowAt: () => ({
      startsAt: now + hazardStartsInMs,
      endsAt: now + hazardStartsInMs + 2_000,
    }),
    getNearestAttackPoint: () => null,
  } as unknown as TrainManager;

  return new CoopDefenseEnemyTrainAwarenessSystem(
    () => train,
    () => ({ trackX: TRACK_X, direction: 1, spawnAt: now } as TrainEventConfig),
    () => MOVE_SPEED,
  );
}

describe('Train awareness keeps the pathfinding intact along the track', () => {
  const now = 1_000_000;

  it('carries the vertical pathfinding component through a crossing', () => {
    const system = createSystem(30_000, now);
    // Gegner steht mitten im Gleisbereich, die Wegfindung will ihn nach unten schicken.
    const decision = system.resolveMovement(createEnemy(TRACK_X), 0, MOVE_SPEED, now);

    expect(decision.override).toBe(true);
    // Ohne die Y-Komponente könnte der Gegner in einem von Felsen gesäumten Gleisabschnitt
    // nur noch seitlich gegen den Stein drücken.
    expect(decision.vy).toBe(MOVE_SPEED);
  });

  it('carries it through an escape as well', () => {
    // Zug ist praktisch da: der Gegner kann nicht mehr räumen und flüchtet zur nächsten Seite.
    const system = createSystem(0, now);
    const decision = system.resolveMovement(createEnemy(TRACK_X + 10), 0, -MOVE_SPEED, now);

    expect(decision.override).toBe(true);
    expect(Math.abs(decision.vx)).toBe(MOVE_SPEED);
    expect(decision.vy).toBe(-MOVE_SPEED);
  });

  it('still drives the enemy sideways out of the danger zone', () => {
    const system = createSystem(30_000, now);
    const decision = system.resolveMovement(createEnemy(TRACK_X), MOVE_SPEED, 0, now);

    // Die Räumzeit hängt allein an der X-Achse – die muss weiterhin volles Tempo bekommen.
    expect(decision.vx).toBe(MOVE_SPEED);
  });

  it('leaves enemies outside the danger zone completely alone', () => {
    const system = createSystem(30_000, now);
    // Weit rechts vom Gleis und weiter nach rechts unterwegs: kein Grund einzugreifen.
    const decision = system.resolveMovement(createEnemy(TRACK_X + 400), MOVE_SPEED, 42, now);

    expect(decision.override).toBe(false);
    expect(decision.vy).toBe(42);
  });
});
