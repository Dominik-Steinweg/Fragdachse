import { describe, expect, it, vi } from 'vitest';
import { ResourceSystem } from '../src/systems/ResourceSystem';

describe('ResourceSystem diagnostic observers', () => {
  it('consumes representable fractional arrivals in every order without manufacturing rounded residuals', () => {
    const share = 3.5 / 3;
    const fragments = [share, share, 3.5 - share * 2];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const initial of [0, 10, 98.7]) for (const order of orders) {
      const resources = new ResourceSystem();
      resources.initPlayer('player'); resources.setAdrenaline('player', initial);
      for (const index of order) {
        const before = resources.getAdrenaline('player');
        const expected = Math.min(fragments[index], resources.getMaxAdrenaline('player') - before);
        expect(resources.commitResolvedAdrenalineGain('player', fragments[index])).toBe(expected);
      }
      expect(resources.getAdrenaline('player')).toBeCloseTo(Math.min(initial + 3.5, resources.getMaxAdrenaline('player')), 12);
    }
  });

  it('keeps a resolved arrival atomic when a passive resource observer throws', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('player'); resources.setAdrenaline('player', 0);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const remove = resources.addAdrenalineGainObserver(() => { throw new Error('diagnostic failure'); });
    const observer = vi.fn(); resources.addAdrenalineGainObserver(observer);
    expect(resources.commitResolvedAdrenalineGain('player', 3.5)).toBe(3.5);
    expect(resources.getAdrenaline('player')).toBe(3.5);
    expect(observer).toHaveBeenCalledExactlyOnceWith('player', 3.5, 3.5);
    remove();
    expect(resources.commitResolvedAdrenalineGain('player', 2)).toBe(2);
    expect(log).toHaveBeenCalledOnce(); log.mockRestore();
  });

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

    resources.drainAdrenaline('player-1', 60, 1_000);

    expect(resources.getAdrenaline('player-1')).toBe(10);
    expect(observer).toHaveBeenCalledWith('player-1', 60, 30);

    unsubscribe();
    resources.drainAdrenaline('player-1', 10, 1_000);
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('increments the adrenaline revision only when the stored value changes', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('player-1');
    expect(resources.getAdrenalineRevision('player-1')).toBe(0);

    resources.addAdrenaline('player-1', 0);
    expect(resources.getAdrenalineRevision('player-1')).toBe(0);

    resources.drainAdrenaline('player-1', 10, 1_000);
    expect(resources.getAdrenalineRevision('player-1')).toBe(1);
    resources.setAdrenaline('player-1', resources.getAdrenaline('player-1'));
    expect(resources.getAdrenalineRevision('player-1')).toBe(1);
  });

  it('freezes theoretical gain before flight, retains fractions after source removal, and commits without collector scaling', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('source');
    resources.initPlayer('collector');
    resources.setAdrenalineGainMultiplierResolver(id => id === 'source' ? 1.75 : 4);
    resources.setAdrenaline('source', resources.getMaxAdrenaline('source'));
    const basis = resources.captureAdrenalineGainBasis('source')!;
    const revision = resources.getAdrenalineRevision('source');
    expect(resources.resolveAdrenalineGain(basis, 2)).toBe(3.5);
    expect(resources.getAdrenalineRevision('source')).toBe(revision);
    resources.removePlayer('source');
    resources.setAdrenalineGainMultiplierResolver(() => 99);
    expect(resources.resolveAdrenalineGain(basis, 2)).toBe(3.5);
    expect(resources.captureAdrenalineGainBasis('source')).toBeNull();

    resources.setAdrenaline('collector', resources.getMaxAdrenaline('collector') - 2.25);
    const before = resources.getAdrenalineRevision('collector');
    const observer = vi.fn();
    resources.addAdrenalineGainObserver(observer);
    expect(resources.commitResolvedAdrenalineGain('collector', 3.5)).toBe(2.25);
    expect(resources.getAdrenalineRevision('collector')).toBe(before + 1);
    expect(observer).toHaveBeenCalledWith('collector', 3.5, 2.25);
    expect(resources.commitResolvedAdrenalineGain('collector', 3.5)).toBe(0);
    expect(resources.getAdrenalineRevision('collector')).toBe(before + 1);
  });

  it('rejects invalid resolved values without mutation or creating detached players', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('player');
    const basis = resources.captureAdrenalineGainBasis('player')!;
    const previous = resources.getAdrenaline('player');
    const observer = vi.fn();
    resources.addAdrenalineGainObserver(observer);
    for (const amount of [0, -1, NaN, Infinity]) {
      expect(resources.resolveAdrenalineGain(basis, amount)).toBe(0);
      expect(resources.commitResolvedAdrenalineGain('player', amount)).toBe(0);
    }
    expect(resources.commitResolvedAdrenalineGain('missing', 2)).toBe(0);
    expect(resources.captureAdrenalineGainBasis('missing')).toBeNull();
    expect(resources.getAdrenaline('player')).toBe(previous);
    expect(observer).not.toHaveBeenCalled();
    expect(resources.commitResolvedAdrenalineGain('player', 1e-30)).toBe(0);
    expect(resources.getAdrenaline('player')).toBe(previous);
    expect(observer).toHaveBeenCalledExactlyOnceWith('player', 1e-30, 0);
  });
});
