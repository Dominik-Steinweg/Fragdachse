import { describe, expect, it } from 'vitest';
import { models, constructionsFor, resolveSource, sampleFrame, supportsHeldView, assetFromExport,
  samplePose, advancePlayback, reviewDefaults, readReviewSettings, writeReviewSettings } from '../../scripts/asset-pipeline/viewer/library.mjs';

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
  it('preserves logical pose identity across clip atlases, including rest and unequal A/B sample counts', () => {
    const a = resolveSource(library, { id: 'enemy' });
    const b = resolveSource(library, { id: 'enemy', construction: '2/old' });
    b.source.atlases = { color: { move: { sourceFrames: [1, 2], frameNames: ['move/0000', 'move/0001'] },
      __rest: { sourceFrames: [0], frameNames: ['__rest/0000'] } } };
    expect(samplePose(b, 'move', 2 / 12, false, a.variant.clips[0])).toEqual({ logicalFrame: 2, clip: 'move', frameName: 'move/0001' });
    expect(samplePose(b, 'missing', 0, false, a.variant.clips[0])).toEqual({ logicalFrame: 0, clip: '__rest', frameName: '__rest/0000' });
    expect(samplePose(b, 'move', 2 / 12, true, a.variant.clips[0]).logicalFrame).toBe(0);
    delete b.source.atlases;
  });
  it('projects optional data passes without changing archived metadata or the pivot', () => {
    const report = { manifest: { id: 'part', label: 'Part', category: 'boss-part', revision: 'test', variant: 'standard',
      pivot: [.2,.7], targetSize: 320, idleFrame: 0, frames: [{ file: 'frames/rest.png' }],
      clips: [], elevation: { min: -1, max: 2, scale: .5 } }, sheets: { 64: { frameWidth: 64, frameHeight: 64 } },
      atlases: { 64: { color: { __rest: { pages: [{ image: 'atlas/rest.png' }] } } } } };
    const before = JSON.stringify(report);
    const model = assetFromExport(report, '/art/poc/isolated/standard/export.json');
    expect(model.pivot).toEqual(report.manifest.pivot);
    expect(model.variants[0].sources[0]).toMatchObject({ size: 64, exportBase: '/art/poc/isolated/standard/',
      elevation: { min: -1, max: 2, scale: .5, frames: ['/art/poc/isolated/standard/elevation/frames-64/frame-0000.png'] },
      atlases: report.atlases[64] });
    expect(models({ constructions: [{ assets: [model] }] }, 'boss-part')).toEqual([model]);
    expect(JSON.stringify(report)).toBe(before);
  });
  it('honors rest, free/next and terminal one-shot ends without dropping elapsed time', () => {
    const clips = [
      { name: 'rise', frames: [1,2], frameRate: 2, end: 'free', next: 'hover' },
      { name: 'hover', frames: [3,4], frameRate: 2, loop: true },
      { name: 'death', frames: [5,6], frameRate: 2, end: 'terminal' },
      { name: 'free', frames: [7,8], frameRate: 2, end: 'free' },
      { name: 'legacy', frames: [9,10], frameRate: 2 },
    ];
    const state = { clip: 'rise', elapsed: .9, playing: true, idle: false };
    expect(advancePlayback(clips, state, .3)).toMatchObject({ clip: 'hover', elapsed: expect.closeTo(.2), playing: true });
    for (const clip of ['death','free']) expect(advancePlayback(clips, {...state,clip}, .3)).toMatchObject({ clip, elapsed: .5, playing: false, idle: false });
    expect(advancePlayback(clips, {...state,clip:'legacy'}, .3)).toMatchObject({ elapsed: 0, playing: false, idle: true });
  });
  it('round trips every new review control and rejects malformed numeric URL values', () => {
    const settings = {...reviewDefaults, background: 'pond', waterLevel: .3, grid: true, scalePlayer: true,
      lane: true, laneX: -50, laneY: 10, laneAngle: 37, laneWidth: 128, laneDock: false, submersion: false};
    expect(readReviewSettings(writeReviewSettings(new URLSearchParams(),settings))).toEqual(settings);
    expect(readReviewSettings(new URLSearchParams('waterLevel=NaN&laneWidth=99999&background=missing')))
      .toMatchObject({waterLevel:reviewDefaults.waterLevel,laneWidth:320,background:reviewDefaults.background});
  });
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
