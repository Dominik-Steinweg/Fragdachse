import { describe, expect, it } from 'vitest';
import { models, constructionsFor, resolveSource, sampleFrame, supportsHeldView } from '../../scripts/asset-pipeline/viewer/library.mjs';

function asset(id: string, variants = ['standard'], frames = [1, 2, 3, 4]) {
  return { id, label: id, category: id === 'player' ? 'character' : 'enemy', targetSize: 32,
    variants: variants.map(variant => ({ variant, idleFrame: 0, clips: [{ name: 'move', frames, frameRate: 12, loop: true }],
      sources: [64, 128].map(size => ({ size, url: `/${id}/${variant}/${size}.png` })) })) };
}
const library = { constructions: [
  { key: '2/new', run: 'new', version: 2, assets: [asset('enemy'), asset('player')] },
  { key: '2/old', run: 'old', version: 2, assets: [asset('enemy', ['calm', 'rich'], [1, 2])] },
] };

describe('model library review contracts', () => {
  it('offers utility models with held composition but treats loadout-only references as standalone icons', () => {
    const utility = { ...asset('zeus'), category: 'utility', heldItem: { referenceSize: 32, grip: [16, 24], muzzle: [16, 15] } };
    const lib = { constructions: [{ key: '2/new', version: 2, assets: [utility] }] };
    expect(models(lib, 'utility').map((a: { id: string }) => a.id)).toEqual(['zeus']);
    expect(supportsHeldView(utility)).toBe(true);
    expect(supportsHeldView(utility, true)).toBe(false);
    expect(supportsHeldView({ heldItem: { ...utility.heldItem, referenceGrip: [3, 6] } }, true)).toBe(true);
    expect(supportsHeldView(asset('player'))).toBe(false);
    expect(sampleFrame(resolveSource(lib, { id: 'zeus' }), 'fire', 1, true)).toBe(0);
  });
  it('keeps one model entry across constructions and searches within its category', () => {
    expect(models(library).map((a: { id: string }) => a.id)).toEqual(['enemy', 'player']);
    expect(models(library, 'enemy', 'ENe').map((a: { id: string }) => a.id)).toEqual(['enemy']);
    expect(constructionsFor(library, 'enemy').map((c: { key: string }) => c.key)).toEqual(['2/new', '2/old']);
  });
  it('resolves stale choices to available sources without requiring two variants', () => {
    const current = resolveSource(library, { id: 'enemy', construction: 'gone', variant: 'rich', size: 999 });
    expect(current).toMatchObject({ construction: { key: '2/new' }, variant: { variant: 'standard' }, source: { size: 128 } });
    expect(resolveSource(library, { id: 'missing' })).toBeNull();
    const old = resolveSource(library, { id: 'enemy', construction: '2/old', variant: 'rich', size: 64 });
    expect(old).toMatchObject({ variant: { variant: 'rich' }, source: { size: 64 } });
    expect(old.key).not.toBe(current.key);
  });
  it('synchronizes equal gait phases across different frame counts and handles static comparisons', () => {
    const a = resolveSource(library, { id: 'enemy' });
    const b = resolveSource(library, { id: 'enemy', construction: '2/old' });
    const clip = a.variant.clips[0];
    expect(sampleFrame(a, 'move', 2 / 12, false, clip)).toBe(3);
    expect(sampleFrame(b, 'move', 2 / 12, false, clip)).toBe(2);
    expect(sampleFrame(b, 'fire', 0, false, clip)).toBe(0);
    expect(sampleFrame(a, 'move', 0, true, clip)).toBe(0);
  });
});
