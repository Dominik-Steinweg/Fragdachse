import { describe, expect, it } from 'vitest';
import { buildSpawnInstances } from '../src/effects/gpu/SpawnInstances';
import { SPAWN_FIELD_LIFE_S, SPAWN_FLASH_S, SPAWN_KIND, SPAWN_VARIANT } from '../src/effects/gpu/SpawnShader';

function seeded(seed = 7): () => number {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** When the shader stops drawing an instance (mirrors the vertex shader's lifetime window). */
function endOf(i: ReturnType<typeof buildSpawnInstances>['instances'][number]): number {
  const flash = SPAWN_FLASH_S[i.variant];
  if (i.kind === SPAWN_KIND.field) return SPAWN_FIELD_LIFE_S[i.variant];
  if (i.kind === SPAWN_KIND.gather) return flash * i.p3;
  if (i.kind === SPAWN_KIND.ember) return flash + i.p2 + i.p3;
  return flash + i.p3;
}

describe('spawn instances', () => {
  it.each([SPAWN_VARIANT.player, SPAWN_VARIANT.enemy])('keep every quad alive no longer than the spawn (variant %i)', (variant) => {
    // The stage drops a spawn after lifeS; a longer-lived particle would be cut off mid-flight.
    const { instances, lifeS } = buildSpawnInstances(10, 20, 0x88bbff, variant, 1, seeded());
    expect(instances.filter(i => i.kind === SPAWN_KIND.field)).toHaveLength(1);
    expect(instances.length).toBeGreaterThan(1);
    for (const instance of instances) {
      expect(instance.variant).toBe(variant);
      expect(endOf(instance)).toBeLessThanOrEqual(lifeS + 1e-9);
    }
  });

  it('thins the particles on low quality without dropping the field', () => {
    const full = buildSpawnInstances(0, 0, 0xffffff, SPAWN_VARIANT.player, 1, seeded()).instances;
    const low = buildSpawnInstances(0, 0, 0xffffff, SPAWN_VARIANT.player, 0.5, seeded()).instances;
    expect(low.length).toBeLessThan(full.length);
    expect(low.filter(i => i.kind === SPAWN_KIND.field)).toHaveLength(1);
  });
});
