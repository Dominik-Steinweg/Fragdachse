import { describe, expect, it } from 'vitest';

import { ROCK_HP_MAX } from '../src/config';
import { RockHpRegistry } from '../src/arena/RockHpRegistry';
import {
  LOBBY_AMBIENT_ROCK_IDS,
  LOBBY_ROCK_ROLES,
  MENU_ARENA_PREVIEW_CONFIG,
} from '../src/arena/MenuArenaPreviewConfig';
import {
  applyRadialEnvironmentDamage,
  type EnvironmentRockSink,
} from '../src/systems/EnvironmentDamageResolver';
import { CELL_SIZE } from '../src/config';

const layout = MENU_ARENA_PREVIEW_CONFIG.layout;
const { bounds } = MENU_ARENA_PREVIEW_CONFIG.view;

function worldOf(rockId: number): { x: number; y: number } {
  const cell = layout.rocks[rockId];
  return {
    x: bounds.offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2,
    y: bounds.offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2,
  };
}

/**
 * Genau die Verdrahtung, die der Ambient-Gefechtsraum benutzt: Fels-HP ohne Netzwerkschicht
 * und ein Zielstatus-Trichter, der strukturelle Felsen abweist.
 */
function createAmbientSink(): {
  sink: EnvironmentRockSink;
  hp: RockHpRegistry;
  destroyed: Set<number>;
  alive: Set<number>;
} {
  const hp = new RockHpRegistry(layout);
  const destroyed = new Set<number>();
  const alive = new Set<number>(layout.rocks.map((_, id) => id));

  const sink: EnvironmentRockSink = {
    forEachActiveRock(visit) {
      for (const id of alive) {
        const world = worldOf(id);
        visit(id, world.x, world.y);
      }
    },
    resolveRockDamage: (rockId, damage) => (LOBBY_ROCK_ROLES[rockId] === 'structural' ? 0 : damage),
    applyRockDamage: (rockId, damage) => hp.applyDamage(rockId, damage),
    onRockDestroyed: (rockId) => {
      hp.remove(rockId);
      alive.delete(rockId);
      destroyed.add(rockId);
    },
  };

  return { sink, hp, destroyed, alive };
}

describe('lobby ambient rock rules', () => {
  it('never damages a structural rock, however close the blast', () => {
    const structuralId = LOBBY_ROCK_ROLES.findIndex((role) => role === 'structural');
    expect(structuralId).toBeGreaterThanOrEqual(0);

    const { sink, hp, destroyed } = createAmbientSink();
    const centre = worldOf(structuralId);
    applyRadialEnvironmentDamage(
      sink,
      { x: centre.x, y: centre.y, radius: 3 * CELL_SIZE, damage: ROCK_HP_MAX * 10, rockDamageMult: 1 },
      'ambient',
    );

    expect(hp.getHP(structuralId)).toBe(ROCK_HP_MAX);
    expect(destroyed.has(structuralId)).toBe(false);
  });

  it('uses the normal landscape rock state for ambient rocks', () => {
    const ambientId = LOBBY_AMBIENT_ROCK_IDS[0];
    const { sink, hp } = createAmbientSink();

    expect(hp.getMaxHP(ambientId)).toBe(ROCK_HP_MAX);

    const centre = worldOf(ambientId);
    applyRadialEnvironmentDamage(
      sink,
      { x: centre.x, y: centre.y, radius: CELL_SIZE * 0.4, damage: 30, rockDamageMult: 1 },
      'ambient',
    );
    expect(hp.getHP(ambientId)).toBe(ROCK_HP_MAX - 30);
  });

  it('hits several ambient rocks at once with correct falloff', () => {
    const { sink, hp, alive } = createAmbientSink();
    // Mitten in der Felslandschaft unter dem Panel steht garantiert eine geschlossene Fläche.
    const centreId = LOBBY_AMBIENT_ROCK_IDS[Math.floor(LOBBY_AMBIENT_ROCK_IDS.length / 2)];
    const centre = worldOf(centreId);

    const result = applyRadialEnvironmentDamage(
      sink,
      {
        x: centre.x,
        y: centre.y,
        radius: CELL_SIZE * 2.5,
        damage: 80,
        rockDamageMult: 1,
        falloff: { minDamage: 20 },
      },
      'ambient',
    );

    expect(result.damagedRockIndices.length).toBeGreaterThan(1);
    // Der Fels im Zentrum nimmt mehr Schaden als der äusserste getroffene.
    const outer = result.damagedRockIndices[result.damagedRockIndices.length - 1];
    expect(ROCK_HP_MAX - hp.getHP(centreId)).toBeGreaterThan(ROCK_HP_MAX - hp.getHP(outer));
    for (const id of result.destroyedRockIndices) expect(alive.has(id)).toBe(false);
  });

  it('refuses to revive a destroyed rock with the repair beam', () => {
    const ambientId = LOBBY_AMBIENT_ROCK_IDS[0];
    const { sink, hp } = createAmbientSink();
    const centre = worldOf(ambientId);

    applyRadialEnvironmentDamage(
      sink,
      { x: centre.x, y: centre.y, radius: CELL_SIZE * 0.4, damage: ROCK_HP_MAX, rockDamageMult: 1 },
      'ambient',
    );
    expect(hp.isDestroyed(ambientId)).toBe(true);

    // Reparatur greift nur bei HP > 0 – ein zerstörter Fels braucht einen echten Neubau.
    hp.setHP(ambientId, ROCK_HP_MAX);
    expect(hp.getHP(ambientId)).toBe(0);

    hp.register(ambientId, ROCK_HP_MAX);
    expect(hp.getHP(ambientId)).toBe(ROCK_HP_MAX);
    expect(hp.getMaxHP(ambientId)).toBe(ROCK_HP_MAX);
    expect(hp.isDestroyed(ambientId)).toBe(false);
  });

  it('repairs a damaged rock only up to its normal maximum', () => {
    const ambientId = LOBBY_AMBIENT_ROCK_IDS[0];
    const hp = new RockHpRegistry(layout);

    hp.applyDamage(ambientId, 40);
    hp.setHP(ambientId, hp.getHP(ambientId) + 10);
    expect(hp.getHP(ambientId)).toBe(ROCK_HP_MAX - 30);

    hp.setHP(ambientId, ROCK_HP_MAX * 5);
    expect(hp.getHP(ambientId)).toBe(ROCK_HP_MAX);
  });
});
