import { describe, expect, it, vi } from 'vitest';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { DeploymentLayoutCache } from '../src/world/deployment/DeploymentLayoutCache';
import { InlineDeploymentLayoutGenerator, type DeploymentLayoutGenerator } from '../src/world/deployment/DeploymentLayoutGenerator';
import type { ArenaLayout } from '../src/types';

function fakeGenerator(fail = false): DeploymentLayoutGenerator & { generate: ReturnType<typeof vi.fn> } {
  return {
    kind: 'inline',
    generate: vi.fn(async ({ seed }: { seed: number }) => {
      if (fail) throw new Error('no layout');
      return { seed, rocks: [{ gridX: 1, gridY: 2 }], trees: [], tracks: [], dirt: [], powerUpPedestals: [] } as ArenaLayout;
    }),
    destroy: vi.fn(),
  };
}

describe('DeploymentLayoutCache', () => {
  const map18 = getCoopDefenseMapConfig('18');
  const map19 = getCoopDefenseMapConfig('19');

  it('generates a map and seed once, shares concurrent requests and hands out clones', async () => {
    const generator = fakeGenerator();
    const cache = new DeploymentLayoutCache(generator);
    const [first, second] = await Promise.all([cache.request(map18, 5), cache.request(map18, 5)]);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(first.layout).toEqual(second.layout);
    first.layout.rocks.push({ gridX: 9, gridY: 9 });
    expect(cache.peek('18', 5)!.layout.rocks).toHaveLength(1);
    expect(cache.peek('18', 5)!.fingerprint).toBe(ArenaGenerator.fingerprint(second.layout));
    expect(cache.peek('18', 6)).toBeNull();
  });

  it('keeps the two latest keys and retries a failed generation', async () => {
    const generator = fakeGenerator();
    const cache = new DeploymentLayoutCache(generator);
    await cache.request(map18, 1);
    await cache.request(map19, 1);
    await cache.request(map18, 2);
    expect(cache.peek('18', 1)).toBeNull();
    expect(cache.peek('19', 1)).not.toBeNull();

    const failing = fakeGenerator(true);
    const broken = new DeploymentLayoutCache(failing);
    await expect(broken.request(map18, 1)).rejects.toThrow('no layout');
    await expect(broken.request(map18, 1)).rejects.toThrow('no layout');
    expect(failing.generate).toHaveBeenCalledTimes(2);
  });

  it('generates the round layout through the inline fallback', async () => {
    const cache = new DeploymentLayoutCache(new InlineDeploymentLayoutGenerator());
    const layout = await cache.request(map18, 77);
    expect(layout.fingerprint).toBe(ArenaGenerator.fingerprint(layout.layout));
    cache.destroy();
    await expect(cache.request(map18, 78)).rejects.toThrow();
  });
});
