import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import EventEmitter from 'eventemitter3';

const pending = vi.hoisted(() => ({ hold: false, attacks: vi.fn() }));
vi.mock('phaser', async () => {
  const { default: Emitter } = await import('eventemitter3');
  return { Loader: { LoaderPlugin: class extends Emitter {
    queued: { key: string; url?: string; config?: unknown; atlas?: unknown }[] = [];
    constructor(readonly scene: ReturnType<typeof sceneFixture>) {
      super(); scene.ownedLoaders.push(this); scene.sys.events.once('boot', this.boot, this);
    }
    boot() {}
    spritesheet(key: string, _url: string, config: unknown) { this.queued.push({ key, config }); }
    atlas(key: string, url: string, atlas: unknown) { this.queued.push({ key, url, atlas }); }
    image(key: string, url: string) { this.queued.push({ key, url }); }
    start() {
      if (pending.hold) return;
      for (const entry of this.queued) this.scene.textures.live.add(entry.key);
      queueMicrotask(() => this.emit('complete'));
    }
    destroy() { this.removeAllListeners(); }
  } } };
});
import { KrakenReviewAssets } from '../src/dev/scenario/KrakenReviewAssets';
import { advanceReviewClip, type ReviewPlayback } from '../src/dev/scenario/KrakenReviewPlayback';
import { effectDefaults, effectOptions, effectPose, effectTiming } from '../src/dev/scenario/KrakenReviewEffectTimeline';
vi.mock('../src/effects/EnemyClawRenderer', () => ({ ENEMY_CLAW_HOSTILE_COLOR: 0xff0000,
  EnemyClawRenderer: class { clear() {} showAttack = pending.attacks; destroy() {} } }));
vi.mock('../src/graphics/disposeShaderWarmupNode', () => ({ disposeShaderWarmupNode: vi.fn() }));
import { disposeShaderWarmupNode } from '../src/graphics/disposeShaderWarmupNode';
import { KrakenReviewEffectRenderer, type KrakenReviewEffectFrame } from '../src/effects/kraken/KrakenReviewEffectRenderer';
vi.mock('../src/effects/kraken/submersionShader', () => ({}));
import { planKrakenApproach } from '../src/dev/scenario/KrakenReviewApproach';
import { KrakenTentacleShadow, tentacleShadowHeight } from '../src/effects/kraken/KrakenTentacleShadow';
import { reviewWaterMask } from '../src/dev/scenario/KrakenReviewSubmersion';
import { bodyEffectTiming, reviewEggTargets, sampleReviewEgg } from '../src/dev/scenario/KrakenReviewChoreography';

function sceneFixture(atlas = false) {
  return { sys: { events: new EventEmitter() }, ownedLoaders: [] as { queued: { key: string; url?: string; config?: unknown; atlas?: unknown }[] }[],
    load: { reset: vi.fn() },
    textures: { live: new Set<string>(), exists(key: string) { return this.live.has(key); },
      remove(key: string) { this.live.delete(key); },
      get: () => ({ has: (id: string) => ['__BASE', '1', '2', 'idle/0000', 'idle/0001'].includes(id), get: () => ({ realWidth: atlas ? 640 : 320 }) }) } };
}
const source = { run: 'review', asset: 'body', size: 320 };
const metadata = { manifest: { targetSize: 320, pivot: [.5, .5], clips: [
  { name: 'idle', frames: [1, 2], frameRate: 12, loop: true, markers: { impact: 1 } },
] }, sheets: { 320: { frameWidth: 320, frameHeight: 320, margin: 2, spacing: 4, frameCount: 3 } } };
function responses(atlas = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('export.json')
    ? Response.json(metadata) : atlas ? Response.json({ meta: { image: 'packed.png' }, frames: {} })
      : new Response('', { status: 404 })));
}
afterEach(() => { vi.unstubAllGlobals(); pending.hold = false; });

describe('Kraken review asset ownership and export contract', () => {
  it('offsets body markers by anticipation and seeks eggs across flight, incubation, hatch and cleanup', () => {
    const idle = { name: 'idle', frames: [0, 1, 2], frameRate: 3, loop: true };
    const hatch = { ...idle, name: 'hatch', loop: false };
    const intro = { ...idle, name: 'intro-rise', markers: { 'arms-break': 1, 'eyes-open': 2, roar: 2 } };
    const o = effectOptions({ effect: 'intro', intro: { lead: .4 } }, effectDefaults);
    expect(bodyEffectTiming(o, [intro]).armsBreak.seconds).toBeCloseTo(.4 + 1 / 3);
    expect(bodyEffectTiming(o, [intro]).armsBreak.source).toBe('intro-rise:arms-break');
    const from = { x: 0, y: 0 }, target = { x: 100, y: 150 }, release = .8, look = o.eggFlight;
    const sample = (t: number) => sampleReviewEgg(t, release, from, target, look, hatch, idle);
    expect(sample(release - .001).visible).toBe(false);
    expect(sample(release)).toMatchObject({ ...from, visible: true, scale: 1, clip: 'idle' });
    const mid = sample(release + look.flight * .5);
    expect(mid.scale).toBeGreaterThan(1); expect(mid.x).toBeCloseTo(50);
    const landed = release + look.flight, hatching = landed + look.incubation;
    expect(sample(landed)).toMatchObject({ ...target, clip: 'idle' });
    expect(sample(hatching - .001).clip).toBe('idle');
    expect(sample(hatching)).toMatchObject({ clip: 'hatch', frame: 0 });
    expect(sample(hatching + hatch.frames.length / hatch.frameRate + look.residue + .01).visible).toBe(false);
    expect(sample(release + look.flight * .5)).toEqual(mid);
    const water = (x: number, y: number) => 100 - Math.hypot(x, y);
    const targets = reviewEggTargets(from, .7, look.count, look.landInset, water);
    expect(targets).toHaveLength(look.count);
    expect(targets.every(p => water(p.x, p.y) <= 0)).toBe(true);
    expect(() => effectOptions({ eggTargets: [{ x: NaN, y: 0 }] }, o)).toThrow();
    expect(() => effectOptions({ eggFlight: { count: 9 } }, o)).toThrow();
  });
  it('approaches a dry target within speed/turn limits, retains its water footprint and seeks deterministically', () => {
    const look = { ...effectDefaults.approach, bodyRadius: 30, shoreDistance: 40, speed: 60, turnRate: 30 };
    const water = (x: number, y: number) => 300 - Math.hypot(x, y);
    const plan = planKrakenApproach({ x: 0, y: 0 }, { x: 0, y: 440 }, water, look, 70, -90);
    const first = plan.sample(.25), next = plan.sample(.5), end = plan.sample(plan.duration);
    expect(Math.hypot(next.x - first.x, next.y - first.y)).toBeLessThanOrEqual(look.speed * .25);
    expect(Math.abs(next.angle - first.angle)).toBeLessThanOrEqual(look.turnRate * Math.PI / 180 * .25 + 1e-8);
    expect(water(end.x, end.y)).toBeGreaterThan(look.bodyRadius);
    expect(plan.shore.y - end.y - 70).toBeCloseTo(look.shoreDistance);
    expect(end.angle).toBeCloseTo(Math.PI / 2);
    expect(end.attacking).toBe(true); expect(end.attackTime).toBe(0);
    expect(plan.sample(plan.duration - .001).attacking).toBe(false);
    expect(end.y + 70 + effectDefaults.ink.range).toBeGreaterThan(plan.target.y);
    plan.sample(100); expect(plan.sample(.25)).toEqual(first);
    expect(() => planKrakenApproach({ x: 0, y: 0 }, { x: 0, y: 10 }, water, look, 70, 90)).toThrow();
  });
  it('projects elevated silhouettes farther, excludes submerged heights and collapses at authored contact', () => {
    expect(tentacleShadowHeight(0, -2, 4, 0)).toBe(0);
    const low = tentacleShadowHeight(.5, -2, 4, 0);
    expect(tentacleShadowHeight(1, -2, 4, 0)).toBeGreaterThan(low);
    expect(tentacleShadowHeight(1, -2, 4, 0, 0)).toBe(0);
    expect(tentacleShadowHeight(1, -2, 4, 1)).toBeLessThan(tentacleShadowHeight(1, -2, 4, 0));
  });
  it('keeps authored clocks and markers when displaying a static authoring preview, and owns its texture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ spec: { pivot: [.5, .5] }, indices: [44], clips: metadata.manifest.clips })));
    const scene = sceneFixture(), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const asset = await loader.load({ ...source, previewFrame: 44 });
    expect(asset.pose('idle', 0)).toEqual(asset.pose('idle', 1));
    expect(asset.clips[0].markers).toEqual({ impact: 1 });
    expect(asset.sourceUrl(asset.key)).toBe('/art/poc/pipeline-v2/previews/review/body/frame-0044.png');
    expect(scene.ownedLoaders[0].queued).toHaveLength(1);
    loader.destroy(); expect(scene.textures.live.size).toBe(0);
  });
  it('projects only silhouette pixels, weakens water receivers and releases its bounded shadow once', () => {
    const source = new Uint8ClampedArray(128 * 128 * 4);
    const center = (64 * 128 + 64) * 4;
    source[center] = 255; source[center + 3] = 255;
    const scratch = { width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: source }) }) };
    vi.stubGlobal('document', { createElement: () => scratch });
    let pixels = new Uint8ClampedArray(), wet = 0;
    const texture = { key: 'shadow', width: 0, height: 0, destroy: vi.fn(), refresh: vi.fn(),
      setSize(w: number, h: number) { this.width = w; this.height = h; }, context: {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => { pixels = image.data; },
      } };
    const image = { visible: false, destroy: vi.fn(), filters: { internal: { addBlur: vi.fn() } },
      enableFilters() {}, setDepth() { return this; }, setVisible(v: boolean) { this.visible = v; return this; },
      setTexture() { return this; }, setPosition() { return this; }, setDisplaySize() { return this; } };
    const frame = { source: { image: {} }, cutX: 0, cutY: 0, cutWidth: 128, cutHeight: 128, x: 0, y: 0, realWidth: 128, realHeight: 128 };
    const sprite = { x: 0, y: 0, rotation: 0, originX: .5, originY: .5, displayWidth: 128, displayHeight: 128,
      visible: true, frame, scene: { add: { image: () => image }, textures: { createCanvas: () => texture, getFrame: () => frame } } };
    const shadow = new KrakenTentacleShadow(sprite as unknown as Phaser.GameObjects.Sprite, { elevation: { min: 0, max: 2 } }, () => wet);
    const pose = { key: 'color', frame: 'hover', elevationKey: 'height' };
    const alpha = () => Array.from(pixels).filter((_, i) => i % 4 === 3);
    shadow.update(pose, 0); const dry = alpha().reduce((max, a) => Math.max(max, a), 0);
    expect(dry).toBeGreaterThan(0); expect(alpha().filter(a => a > 0).length).toBeLessThan(100);
    expect(texture.width).toBeLessThanOrEqual(768);
    shadow.update(pose, 0); expect(texture.refresh).toHaveBeenCalledTimes(1);
    wet = 1; sprite.x = 1; shadow.update(pose, 0);
    expect(alpha().reduce((max, a) => Math.max(max, a), 0)).toBeLessThan(dry);
    sprite.visible = false; shadow.update(pose, 0); expect(image.visible).toBe(false);
    shadow.destroy(); shadow.destroy(); expect(image.destroy).toHaveBeenCalledTimes(1); expect(texture.destroy).toHaveBeenCalledTimes(1);
  });
  it('seeks effects without growing render resources and releases every private quad and water mask once', () => {
    const callbacks: (() => void)[] = [], quads: { visible: boolean; uniforms: Record<string, unknown>; capture: () => void }[] = [];
    const mask = { key: 'water', destroy: vi.fn(), refresh() {}, context: {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
    } };
    const scene = { textures: { createCanvas: () => mask }, add: {
      shader: (config: { setupUniforms: (set: (name: string, value: unknown) => void) => void }) => {
        let destroy: (() => void) | undefined;
        const q = { x: 0, y: 0, rotation: 0, visible: false, renderNode: {}, uniforms: {} as Record<string, unknown>,
          setDepth() { return this; }, setVisible(v: boolean) { this.visible = v; return this; },
          setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
          setRotation(v: number) { this.rotation = v; return this; }, setDisplaySize() { return this; },
          once(_event: string, fn: () => void) { destroy = fn; }, destroy() { destroy?.(); },
          capture() { config.setupUniforms((name, value) => { this.uniforms[name] = structuredClone(value); }); },
        };
        callbacks.push(() => q.destroy()); quads.push(q); return q;
      },
    } };
    const disposeBefore = vi.mocked(disposeShaderWarmupNode).mock.calls.length;
    const renderer = new KrakenReviewEffectRenderer(scene as unknown as Phaser.Scene, () => 1);
    const frame: KrakenReviewEffectFrame = { ...effectDefaults, effect: 'ink', time: 1, angle: .8,
      mouth: { x: 90, y: 70 }, shores: [{ x: 110, y: 120 }], charge: .3, spit: .5, impact: .6, retract: 2,
      length: 200, width: 70 };
    renderer.render({ ...frame, time: 0 });
    expect(pending.attacks).toHaveBeenLastCalledWith('ink', expect.objectContaining({ startedAt: 0, telegraphOnly: true, hitAt: 500 }));
    expect(quads.every(q => !q.visible)).toBe(true);
    renderer.render({ ...frame, effect: 'erupt', time: 0 });
    expect(quads.some(q => q.visible)).toBe(true);
    renderer.render(frame); quads[0].capture();
    const first = structuredClone(quads[0].uniforms), count = quads.length;
    renderer.render({ ...frame, time: 50 }); expect(quads.every(q => !q.visible)).toBe(true);
    renderer.render({ ...frame, effect: 'slam', time: .7 });
    renderer.render({ ...frame, effect: 'intro', time: 1, bodyMotion: {
      center: frame.mouth, radius: 100, lead: .2, arms: .5, keel: .8, roar: 1.2, submerged: .6,
      lifetime: 1, foamOpacity: .6, sprayCount: 50, spraySpeed: 100, shadowOpacity: .1,
    } });
    expect(quads.some(q => q.visible)).toBe(true);
    renderer.render({ ...frame, effect: 'egg-throw', eggs: [{ point: frame.mouth, visible: true,
      height: .5, landingAge: -.2, hatchAge: -3, alpha: 1, radius: 20 }] });
    expect(quads.filter(q => q.visible)).toHaveLength(1);
    renderer.render({ ...frame, effect: 'none' }); expect(quads.every(q => !q.visible)).toBe(true);
    renderer.render(frame); quads[0].capture();
    expect(quads[0].uniforms).toEqual(first); expect(quads.length).toBe(count);
    renderer.destroy(); renderer.destroy();
    expect(mask.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(disposeShaderWarmupNode).mock.calls.length - disposeBefore).toBe(count);
  });
  it('resolves authored markers before fallbacks and supports reverse effect seeks without wrapping', () => {
    const clips = [
      { name: 'rise', frames: [1, 2], frameRate: 2, loop: false },
      { name: 'hover', frames: [3, 4], frameRate: 2, loop: true },
      { name: 'slam', frames: [5, 6], frameRate: 2, loop: false, markers: { impact: 1, strike: 0 } },
      { name: 'retract', frames: [7, 8], frameRate: 2, loop: false },
    ];
    const body = { ...clips[0], name: 'ink-spit', markers: { charge: 0, spit: 1 } };
    const timing = effectTiming(effectDefaults, body, clips[2], clips);
    expect(timing.spit).toEqual({ seconds: .5, source: 'ink-spit:spit' });
    expect(timing.impact).toEqual({ seconds: .5, source: 'slam:impact' });
    expect(timing.retract.seconds).toBe(3);
    expect(effectTiming(effectDefaults, body, clips[2], clips, true).impact.seconds).toBe(2.5);
    expect(effectTiming(effectDefaults).spit.source).toBe('fallback');
    expect(effectPose(clips, 'rise', 2.5, true)).toEqual({ clip: 'slam', frame: 1 });
    expect(effectPose(clips, 'rise', 1, true)).toEqual({ clip: 'hover', frame: 0 });
    expect(effectPose(clips, 'rise', 100, true)).toEqual({ clip: 'retract', frame: 1 });
    expect(effectPose(clips, 'rise', 0, true)).toEqual({ clip: 'rise', frame: 0 });
  });
  it('merges bounded effect tuning without mutating defaults or retaining invalid resources', () => {
    const next = effectOptions({ effect: 'ink', ink: { hold: 1.15 } }, effectDefaults);
    expect(next.ink.range).toBe(effectDefaults.ink.range);
    expect(next.ink.hold).toBe(1.15);
    expect(next.ink).not.toBe(effectDefaults.ink);
    for (const raw of [{ erupt: { count: 4 } }, { ink: { travel: 0 } }, { effectTime: NaN },
      { approach: { speed: 0 } }, { approach: { turnRate: 0 } }, { ink: { unknown: 1 } }, { slam: { decalLifetime: -1 } }, { playback: 'loop' }, { erupt: { sprayCount: 97 } },
      { erupt: { sprayCount: 1.5 } }, { slam: { whipDelay: 10 } }, { ink: { sheen: 2 } }]) {
      expect(() => effectOptions(raw, effectDefaults)).toThrow();
    }
  });
  it('selects matching color/elevation names across independent trimmed clip pages and resolves sibling images', async () => {
    const group = (pass: string) => ({ pages: [0, 1].map(i => ({ json: `atlas/320/${pass}-idle-${i}.json` })),
      frameNames: ['idle/0000', 'idle/0001'], sourceFrames: [1, 2] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('export.json') ? Response.json({ ...metadata,
      manifest: { ...metadata.manifest, elevation: { min: -1, max: 2, previewWaterLevel: .38 } },
      atlases: { 320: { color: { idle: group('color') }, elevation: { idle: group('elevation') } } },
    }) : Response.json({ meta: { image: url.split('/').at(-1)!.replace('.json', '.png') },
      frames: { [url.endsWith('-0.json') ? 'idle/0000' : 'idle/0001']: {} } })));
    const scene = sceneFixture(true), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const asset = await loader.load(source), a = asset.pose('idle', 0), b = asset.pose('idle', 1);
    expect(a.key).not.toBe(b.key); expect(a.elevationKey).not.toBe(b.elevationKey);
    expect(b.frame).toBe(b.elevationFrame); expect(b.frame).toBe('idle/0001');
    expect(asset.sourceUrl(b.key)).toContain('atlas/320/color-idle-1.png');
    expect(asset.elevation?.previewWaterLevel).toBe(.38);
    expect(scene.ownedLoaders[0].queued.map(q => q.url)).toEqual(expect.arrayContaining([
      '/art/poc/pipeline-v2/runs/review/body/standard/atlas/320/elevation-idle-1.png',
    ]));
    loader.destroy(); expect(scene.textures.live.size).toBe(0);
  });

  it('honors next and terminal clips, reports crossed markers and can play a loop once in a sequence', () => {
    const clips = [
      { name: 'rise', frames: [1, 2], frameRate: 2, loop: false, end: 'free' as const, next: 'hover' },
      { name: 'hover', frames: [1, 2], frameRate: 2, loop: true },
      { name: 'slam', frames: [1, 2], frameRate: 2, loop: false, end: 'terminal' as const, markers: { impact: 1 } },
    ];
    const state: ReviewPlayback = { clip: 'rise', position: 0, playing: true, markers: [] };
    advanceReviewClip(state, clips, 1.25);
    expect(state).toMatchObject({ clip: 'hover', position: .5, playing: true });
    advanceReviewClip(state, clips, 2, ['rise', 'hover', 'slam']);
    expect(state).toMatchObject({ clip: 'slam', position: 1, playing: false, markers: ['slam:impact'] });
    const rest: ReviewPlayback = { clip: 'rise', position: 0, playing: true, markers: [] };
    advanceReviewClip(rest, [{ ...clips[0], end: 'rest', next: undefined }], 2);
    expect(rest).toMatchObject({ playing: false, rest: true });
  });

  it('samples world water with offset, scale, pivot and rotation and keeps land black', () => {
    const model = { sample: (x: number, _y: number) => x - 10 };
    const sprite = { x: 110, y: 200, originX: .5, originY: 1, scaleX: 2, scaleY: 2, rotation: Math.PI / 2 };
    const mask = reviewWaterMask(model, 2, 2, sprite, { x: 100, y: 200 });
    expect([mask[0], mask[4], mask[8], mask[12]]).toEqual([255, 255, 255, 255]);
    sprite.rotation = -Math.PI / 2;
    expect(Array.from(reviewWaterMask(model, 2, 2, sprite, { x: 100, y: 200 })).filter((_, i) => i % 4 === 0)).toEqual([0, 0, 0, 0]);
  });
  it('uses authored sheet gutters and clip frame IDs, then releases its textures and boot hook', async () => {
    responses(); const scene = sceneFixture(), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const asset = await loader.load(source);
    expect(scene.ownedLoaders[0].queued[0].config).toMatchObject({ margin: 2, spacing: 4, endFrame: 2 });
    expect(asset.frame(asset.clips[0].frames[0])).toBe(1);
    expect(asset.clips[0].markers).toEqual({ impact: 1 });
    expect(scene.sys.events.listenerCount('boot')).toBe(0);
    expect(scene.load.reset).not.toHaveBeenCalled();
    loader.destroy(); expect(scene.textures.live.size).toBe(0);
  });

  it('loads trimmed color and elevation atlases and scales by untrimmed source size', async () => {
    responses(true); const scene = sceneFixture(true), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const asset = await loader.load({ ...source, elevationAtlas: 'elevation.json' });
    expect(asset.format).toBe('atlas'); expect(asset.frame(1)).toBe('1');
    expect(asset.scale).toBe(.5); expect(asset.elevationKey).toBeTruthy();
    expect(scene.ownedLoaders[0].queued.filter(file => file.atlas)).toHaveLength(2);
    loader.destroy(); expect(scene.textures.live.size).toBe(0);
  });

  it('cancels a pending owned loader without leaving scene hooks or resetting gameplay loading', async () => {
    responses(); pending.hold = true;
    const scene = sceneFixture(), loader = new KrakenReviewAssets(scene as unknown as Phaser.Scene);
    const loading = loader.load(source);
    const result = expect(loading).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(scene.ownedLoaders.length).toBe(1));
    loader.destroy(); await result;
    expect(scene.sys.events.listenerCount('boot')).toBe(0);
    expect(scene.load.reset).not.toHaveBeenCalled(); expect(scene.textures.live.size).toBe(0);
  });
});
