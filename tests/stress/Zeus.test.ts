import { describe, expect, it } from 'vitest';
import { zeusFixture, zeusTarget } from '../ZeusTestHelper';

describe('dense multi-owner Zeus bursts', () => {
  it.each([10, 20])('preserves every salvo across %s contacts per owner', contacts => {
    const f = zeusFixture({ stormEnabled: 1, extraBolts: 12, groundEnabled: 1 });
    for (let i = 0; i < contacts; i++) f.targets.push(zeusTarget('enemy-' + i, 20 + i * 10));
    const started = performance.now();
    for (const owner of ['a', 'b']) {
      const use = f.runtime.createUse(owner, 0, 0, 1, 1, f.config);
      f.runtime.startBall(use, { ...f.movement, playerId: owner }, 0);
      f.runtime.move({ ...f.movement, playerId: owner, x: contacts * 10 + 40 }, 50);
      f.runtime.endBall(owner);
    }
    expect(f.damage).toHaveBeenCalledTimes(contacts * 2);
    expect(f.bolt).toHaveBeenCalledTimes(contacts * 2 * (f.config.boltCount + f.config.extraBolts));
    f.runtime.step(50); f.runtime.step(50 + f.config.groundDurationMs);
    expect(f.runtime.snapshot().ground).toEqual([]);
    f.runtime.destroy(); expect(f.runtime.snapshot().balls).toEqual([]);
    console.info(`Zeus: ${contacts * 2} contacts, ${f.bolt.mock.calls.length} bolts, ${(performance.now() - started).toFixed(2)} ms (headless rule processing)`);
  });
});
