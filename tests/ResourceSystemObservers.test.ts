import { describe, expect, it, vi } from 'vitest';
import { ResourceSystem } from '../src/systems/ResourceSystem';

describe('ResourceSystem diagnostic observers', () => {
  it('reports the actual adrenaline gain after modifiers and the maximum cap', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('player-1');
    resources.setAdrenaline('player-1', resources.getMaxAdrenaline('player-1') - 5);
    resources.setAdrenalineGainMultiplierResolver(() => 2);
    const observer = vi.fn();
    resources.addAdrenalineGainObserver(observer);

    resources.addAdrenaline('player-1', 10);

    expect(resources.getAdrenaline('player-1')).toBe(resources.getMaxAdrenaline('player-1'));
    expect(observer).toHaveBeenCalledWith('player-1', 10, 5);
  });

  it('reports the actual adrenaline drain after cost modifiers and can unsubscribe', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('player-1');
    resources.setAdrenaline('player-1', 40);
    resources.setAdrenalineCostMultiplierResolver(() => 0.5);
    const observer = vi.fn();
    const unsubscribe = resources.addAdrenalineDrainObserver(observer);

    resources.drainAdrenaline('player-1', 60);

    expect(resources.getAdrenaline('player-1')).toBe(10);
    expect(observer).toHaveBeenCalledWith('player-1', 60, 30);

    unsubscribe();
    resources.drainAdrenaline('player-1', 10);
    expect(observer).toHaveBeenCalledTimes(1);
  });
});
