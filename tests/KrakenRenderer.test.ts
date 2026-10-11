import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Filters: { Controller: class { params = {}; setPaddingOverride() {} destroy() {} } },
  Renderer: { WebGL: { RenderNodes: { BaseFilterShader: class {} } } },
}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: () => {} }));
vi.mock('../src/graphics/disposeShaderWarmupNode', () => ({ disposeShaderWarmupNode: () => {} }));
vi.mock('../src/effects/enemyClaw/EnemyClawGpuLayer', () => ({
  ClawVfxPass: { Ground: 0, Top: 1, Night: 2 }, createEnemyClawGpuLayer: () => null,
}));
vi.mock('../src/effects/kraken/KrakenTentacleShadow', () => ({ KrakenTentacleShadow: class {
  image = { setVisible: vi.fn() }; update = vi.fn(); destroy = vi.fn();
} }));
vi.mock('../src/effects/kraken/KrakenReviewDrainFilter', () => ({ addReviewDrain: () => ({ active: false }) }));
import { KrakenRenderer, KrakenSpriteView, KrakenEffects, KrakenEggFlightView, krakenSocket, sampleKrakenBody,
  sampleKrakenTentacle, sampleKrakenEgg, krakenRiseTiming, type KrakenPresentationAsset, type KrakenPresentationAssets } from '../src/effects/kraken/KrakenRenderer';
import { KrakenIntroRenderer } from '../src/effects/kraken/KrakenIntroRenderer';
import { KRAKEN_WORLD_EXPOSURE, krakenWaterMask } from '../src/effects/kraken/submersionShader';
import { KRAKEN_RISE_INTRO } from '../src/config/bossIntros';
import { getCameraFocusOverride } from '../src/graphics/cameraFocusOverride';
import { normalizePipelineAsset, type PipelineBossAsset } from '../src/config/pipelineAssetContracts';
import { KRAKEN_ASSET_REQUIREMENTS, KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import type { KrakenState, KrakenTentacleState, KrakenEggState } from '../src/systems/KrakenState';
import type { CombatPartHitReceipt } from '../src/combat/CombatPartContact';

/** Deliberately different marker/frame counts from the review exports; only the D contract matters. */
function asset(role: keyof typeof KRAKEN_ASSET_REQUIREMENTS): KrakenPresentationAsset {
  const required = KRAKEN_ASSET_REQUIREMENTS[role];
  const a: PipelineBossAsset = {
    runtimeContract: 'boss', id: role, textureKey: role, category: 'enemy', gameIds: [], revision: 'fixture', variant: 'test',
    sourceSize: 32, targetSize: 16, displayScale: 2, forward: 'north', pivot: [.4, .6], idleFrame: 0,
    sockets: Object.fromEntries(required.sockets.map(s => [s, [.3, .8]])), runtimeBudgetMB: 8,
    socketFrames: Array.from({ length: 52 }, () => Object.fromEntries(required.sockets.map(s => [s, { x: .3, y: .8, z: 0 }]))),
    elevation: { min: -2, max: 3, scale: .5 }, elevationPass: { encoding: 'linear-unorm8-world-z', min: -2, max: 3,
      scale: .5, waterline: 0, alpha: 'beauty-coverage', colorSpace: 'non-color', premultiplied: false },
    clips: Object.entries(required.clips).map(([name, markers]) => ({ name,
      frames: Array.from({ length: 12 }, (_, i) => 40 + i), frameRate: 12, loop: ['idle', 'move', 'hover'].includes(name),
      markers: Object.fromEntries(markers.map((m, i) => [m, 3 + i * 4])),
    })), atlases: { color: {}, elevation: {} }, budget: { clips: {}, totals: { color: 0, elevation: 0, total: 0 } },
  };
  for (const c of [{ name: '__rest', frames: [a.idleFrame] }, ...a.clips]) {
    for (const pass of ['color', 'elevation'] as const) {
      const size = pass === 'color' ? 32 : 16, names = c.frames.map((_, i) => `${c.name}/${String(i).padStart(4, '0')}`);
      // Independent page membership: the renderer must borrow resolved pairs, never guess same page keys.
      a.atlases[pass][c.name] = { sourceSize: size, logicalSourceSize: 32, pivot: a.pivot, sourceFrames: c.frames,
        frameNames: names, pages: [{ image: `./assets/${role}/${pass}/${c.name}.png`, json: `./assets/${role}/${pass}/${c.name}.json`,
          sha256: 'a'.repeat(64), jsonSha256: 'b'.repeat(64), width: size, height: size, gpuBytesRGBA8: size * size * 4, frameNames: names }] };
    }
    const bytes = { color: 4096, elevation: 1024, total: 5120 };
    a.budget.clips[c.name] = bytes;
    for (const key of ['color', 'elevation', 'total'] as const) a.budget.totals[key] += bytes[key];
  }
  const metadata = normalizePipelineAsset(a) as PipelineBossAsset;
  return { metadata, frame: vi.fn((clip, index) => ({ key: `${role}:color`, frame: metadata.atlases.color[clip].frameNames[index],
    elevationKey: `${role}:elevation-other-page`, elevationFrame: metadata.atlases.elevation[clip].frameNames[index] })) };
}
const assets = (): KrakenPresentationAssets => ({ water: asset('water'), land: asset('land'), tentacle: asset('tentacle'), egg: asset('egg') });
const boss: KrakenState['boss'] = { kind: 'enemy', id: 'boss', scope: { worldRevision: 2, runtimeGeneration: 3 },
  instance: { entityGeneration: 4, activityRevision: 5 } };
function part(id: string): KrakenTentacleState {
  return { contact: { identity: { boss, partId: id, partGeneration: 1, cycleId: 1 }, contactId: id,
    hitboxProfileId: 'exposed', x: 70, y: 80, angle: .5, targetableFrom: 100, targetableUntil: 2800 },
    revision: 1, phase: 'hover', startedAt: 0, hoverAt: 500, retractAt: 2300, endsAt: 3000,
    claw: { revision: 1, attack: { attackId: `${id}:slam`, weaponId: 'tentacle', presentation: 'tentacle',
      pose: { originX: 100, originY: 90, angle: .5, geometry: { kind: 'lane', length: 240, width: 80 } },
      startedAt: 0, strikeAt: 1600, hitAt: 1800, endsAt: 2100 } } };
}
function state(): KrakenState {
  return { boss, revision: 1, cycleId: 1, habitatId: 'pond', phase: { kind: 'submerged', startedAt: 0, stopSpawningAt: 3000 },
    phaseTwoPending: false, bodyTargetability: { revision: 1, effectiveAt: 0, mode: 'hidden' }, movement: 'water-anchored',
    bodyAction: null, inkClouds: [], tentacles: [part('a'), part('b')], eggs: [] };
}
function egg(): KrakenEggState {
  return { eggId: 'egg', entityGeneration: 1, bossId: boss.id, bossGeneration: 4, castId: 'cast', originId: 'encounter',
    broodTableId: 'brood', enemyKind: 'rabid-badger', landedAt: 100, hatchStartedAt: 600, spawnAt: 800, endsAt: 1200, status: 'hatching' };
}

function sceneFixture() {
  const sprites: any[] = [], shaders: any[] = [], masks: any[] = [];
  const frame = (key: string, name: string) => ({ texture: { key }, name, realWidth: 32, realHeight: 32 });
  const make = () => {
    const filters = { internal: { list: [] as any[], add(f: any) { this.list.push(f); },
      remove(f: any) { this.list.splice(this.list.indexOf(f), 1); f.destroy(); } } };
    const s: any = { x: 0, y: 0, rotation: 0, originX: .5, originY: .5, displayWidth: 32, displayHeight: 32,
      visible: true, destroyed: false, alpha: 1, tint: 0xffffff, scene, filters,
      setPosition(x: number, y: number) { Object.assign(this, { x, y }); return this; },
      setRotation(rotation: number) { this.rotation = rotation; return this; },
      setOrigin(originX: number, originY: number) { Object.assign(this, { originX, originY }); return this; },
      setDisplaySize(displayWidth: number, displayHeight: number) { Object.assign(this, { displayWidth, displayHeight }); return this; },
      setVisible(visible: boolean) { this.visible = visible; return this; },
      setAlpha(alpha: number) { this.alpha = alpha; return this; }, setDepth(depth: number) { this.depth = depth; return this; },
      setTint(tint: number) { this.tint = tint; return this; }, clearTint() { this.tint = 0xffffff; return this; },
      setTexture(key: string, name: string) { this.texture = { key }; this.frame = frame(key, name); return this; },
      enableFilters() { return this; }, once() { return this; }, destroy: vi.fn(function(this: any) { this.destroyed = true; this.visible = false; }),
    };
    return s;
  };
  const scene: any = { time: { now: 0 }, sys: { renderer: { gl: {}, renderNodes: { addNodeConstructor: vi.fn() } } },
    textures: { exists: vi.fn(() => true), getFrame: vi.fn(frame), createCanvas(key: string, w: number, h: number) {
      const m = { key, context: { createImageData: (x: number, y: number) => ({ data: new Uint8ClampedArray(x * y * 4) }),
        putImageData: vi.fn() }, refresh: vi.fn(), destroy: vi.fn(), width: w, height: h };
      masks.push(m); return m;
    } },
    add: { sprite() { const s = make(); sprites.push(s); return s; }, shader(config: any) {
      const s = make(); s.uniforms = () => { const u: any = {}; config.setupUniforms((key: string, value: any) => { u[key] = value; }); return u; };
      shaders.push(s); return s;
    } },
  };
  return { scene, sprites, shaders, masks };
}

describe('host timelines and D asset projection', () => {
  it('joins the exit on the water side until grip, then starts exactly at the land grip marker', () => {
    const s = state(), a = assets(), pose = { x: 100, y: 120, angle: 1 };
    s.phase = { kind: 'ashore', corridorId: 'shore', startedAt: 0, moveAt: 1200, gripAt: 1900,
      heaveAt: 3150, endsAt: 3600, recoveryEndsAt: 4200, blocked: false };
    s.bodyTargetability.mode = 'protected';
    expect(sampleKrakenBody(s, pose, a, 300).sample.clip).toBe('idle');
    expect(sampleKrakenBody(s, pose, a, 800).sample.frame).not.toBe(sampleKrakenBody(s, pose, a, 300).sample.frame);
    const swim = sampleKrakenBody(s, pose, a, 1800); expect(swim.asset).toBe(a.water); expect(swim.sample.clip).toBe('move');
    const grip = sampleKrakenBody(s, pose, a, s.phase.gripAt);
    expect(grip.asset).toBe(a.land); expect(grip.sample.frame).toBe(a.land.metadata.clips.find(c => c.name === 'ashore')!.markers!.grip);
    expect(sampleKrakenBody(s, pose, a, s.phase.heaveAt).sample.frame).toBe(a.land.metadata.clips.find(c => c.name === 'ashore')!.markers!.heave);
  });
  it('joins a lunge using the frozen attack clock and maps strike/impact to exported markers', () => {
    const s = state(), a = assets(), attack = { ...part('body').claw.attack!, presentation: 'slam' as const };
    s.phase = { kind: 'land', startedAt: 0 }; s.bodyAction = { kind: 'slam', attackId: attack.attackId };
    const pose = { x: 240, y: 120, angle: attack.pose.angle, claw: { revision: 1, attack } };
    const clip = a.land.metadata.clips.find(c => c.name === 'slam')!;
    expect(sampleKrakenBody(s, pose, a, attack.strikeAt).sample.frame).toBe(clip.markers!.strike);
    expect(sampleKrakenBody(s, pose, a, attack.hitAt).sample.frame).toBe(clip.markers!.impact);
    expect(sampleKrakenBody(s, pose, a, (attack.strikeAt + attack.hitAt) / 2).pose).toEqual(pose);
  });
  it('hides an unavailable atlas pair without creating filters or repeating diagnostics', () => {
    const f = sceneFixture(), diagnostic = vi.fn(); f.scene.textures.exists.mockReturnValue(false);
    const view = new KrakenSpriteView(f.scene, asset('water'), () => 0, diagnostic);
    for (const now of [0, 16]) expect(view.show({ clip: 'idle', frame: 0 }, { x: 0, y: 0, angle: 0 }, now)).toBe(false);
    expect(diagnostic).toHaveBeenCalledOnce(); expect(view.sprite.visible).toBe(false);
    expect(f.masks).toHaveLength(0); view.destroy();
  });
  it('takes over the emerged body while the intro camera is still returning', () => {
    const s = state(), a = assets(), pose = { x: 10, y: 20, angle: 0 };
    s.phase = { kind: 'intro', startedAt: 0, emergeAt: 2000, cameraReturnedAt: 3000 };
    expect(sampleKrakenBody(s, pose, a, 1999).visible).toBe(false);
    expect(sampleKrakenBody(s, pose, a, 2000).visible).toBe(true);
  });
  it('advances retract from its cancellation anchor and degrades safely before atlas import', () => {
    const a = asset('tentacle'), t = part('cancelled');
    t.phase = 'retract'; t.retractAt = 900; t.endsAt = 1300; t.claw.attack = null;
    expect(sampleKrakenTentacle(t, a.metadata, 1100).frame).toBeGreaterThan(0);
    const f = sceneFixture(), diagnostic = vi.fn();
    const renderer = new KrakenRenderer(f.scene, { assets: null, waterAt: () => 0,
      readEggPose: () => null, diagnostic });
    expect(() => { renderer.sync(state(), null, 1000); renderer.sync(state(), null, 1016); renderer.destroy(); }).not.toThrow();
    expect(diagnostic).toHaveBeenCalledOnce();
  });
  it('retimes semantic markers without following exported next clips or source frame numbers', () => {
    const s = state(), a = assets(), pose = { x: 10, y: 20, angle: .8 };
    s.tentacles = []; s.phase = { kind: 'diving', startedAt: 100, submergedAt: 800, endsAt: 1200 };
    s.bodyTargetability = { revision: 1, effectiveAt: 800, mode: 'hidden' };
    const at = sampleKrakenBody(s, pose, a, 800);
    expect(at.sample).toEqual({ clip: 'dive', frame: a.water.metadata.clips.find(c => c.name === 'dive')!.markers!.submerged });
    expect(at.visible).toBe(false);
    s.phase = { kind: 'surfacing', startedAt: 1300, vulnerableAt: 1800, endsAt: 2200, recoveryEndsAt: 2500 };
    expect(sampleKrakenBody(s, pose, a, 1500).visible).toBe(true);
    expect(sampleKrakenBody(s, pose, a, 1800).sample.frame).toBe(a.water.metadata.clips.find(c => c.name === 'surface')!.markers!['eyes-open']);
    s.phase = { kind: 'dying', startedAt: 2200, endsAt: 2600, asset: 'water', submerged: true,
      terminalPose: { x: 99, y: 88, angle: 1 } };
    expect(sampleKrakenBody(s, pose, a, 2300)).toMatchObject({ visible: false, pose: s.phase.terminalPose });
    const t = part('a'), slam = a.tentacle.metadata.clips.find(c => c.name === 'slam')!;
    expect(sampleKrakenTentacle(t, a.tentacle.metadata, t.claw.attack!.strikeAt)).toEqual({ clip: 'slam', frame: slam.markers!.strike });
    expect(sampleKrakenTentacle(t, a.tentacle.metadata, t.claw.attack!.hitAt).frame).toBe(slam.markers!.impact);
    expect(sampleKrakenTentacle(t, a.tentacle.metadata, t.endsAt + 100).clip).toBe('retract');
    expect(sampleKrakenEgg(egg(), a.egg.metadata, egg().spawnAt).frame).toBe(a.egg.metadata.clips.find(c => c.name === 'hatch')!.markers!.spawn);
    const immediate = { ...egg(), spawnAt: egg().hatchStartedAt };
    expect(sampleKrakenEgg(immediate, a.egg.metadata, immediate.spawnAt).frame).toBe(a.egg.metadata.clips.find(c => c.name === 'hatch')!.markers!.spawn);
  });
  it('uses the full logical socket and +X orientation independently of trimming', () => {
    const a = asset('tentacle').metadata;
    const p = { x: 50, y: 60, angle: 0 }, socket = krakenSocket(a, p, 'waterEntry');
    const size = a.targetSize * a.displayScale!;
    expect(socket.x).toBeCloseTo(p.x - (a.sockets.waterEntry[1] - a.pivot[1]) * size);
    expect(socket.y).toBeCloseTo(p.y + (a.sockets.waterEntry[0] - a.pivot[0]) * size);
    const timing = krakenRiseTiming(asset('water').metadata, 'surface', 100, 100, 2000, 800);
    expect(timing.eyesAt).toBe(800);
    expect(timing.armsAt).toBeLessThan(timing.eyesAt); // optional cosmetic markers are not AP0 prerequisites
  });
  it('rotates the world water mask through logical space without tinting the dry shoreline', () => {
    const transform = { x: 0, y: 0, rotation: Math.PI / 2, originX: .5, originY: .5, displayWidth: 8, displayHeight: 4 };
    const pixels = krakenWaterMask(4, 2, transform, (_x, y) => y);
    expect(Array.from(pixels.filter((_, i) => i % 4 === 0))).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
  });
});

describe('Kraken renderer ownership', () => {
  it('announces once and only shakes on live marker crossings, including without resident assets', () => {
    const f = sceneFixture(), s = state(), announceExit = vi.fn(), feedback = { request: vi.fn(), cancel: vi.fn() };
    const c = KRAKEN_BOSS_DEFAULTS.exit;
    s.phase = { kind: 'ashore', corridorId: 'shore', startedAt: 0, moveAt: c.warningMs, gripAt: c.warningMs + c.gripAfterMs,
      heaveAt: c.warningMs + c.heaveAfterMs, endsAt: c.warningMs + c.durationMs,
      recoveryEndsAt: c.warningMs + c.durationMs + c.recoveryMs, blocked: false }; s.tentacles = [];
    const pose = { x: 0, y: 0, angle: 0 };
    const options = { assets: null, waterAt: () => 0, readEggPose: () => null, diagnostic: vi.fn(), announceExit, feedback: feedback as never };
    const renderer = new KrakenRenderer(f.scene, options);
    renderer.sync(s, pose, c.roarAfterMs - 50); renderer.sync(s, pose, c.roarAfterMs);
    renderer.sync(s, pose, c.roarAfterMs); expect(announceExit).toHaveBeenCalledOnce(); expect(feedback.request).toHaveBeenCalledOnce();
    renderer.destroy(); feedback.request.mockClear(); announceExit.mockClear();
    const joined = new KrakenRenderer(f.scene, options); joined.sync(s, pose, s.phase.gripAt + 200);
    expect(announceExit).not.toHaveBeenCalled(); expect(feedback.request).not.toHaveBeenCalled(); joined.destroy();
  });
  it('advances land movement frames by distance and idles when the body stops', () => {
    const f = sceneFixture(), a = assets(), s = state();
    s.phase = { kind: 'land', startedAt: 0 }; s.bodyTargetability.mode = 'exposed'; s.tentacles = [];
    const renderer = new KrakenRenderer(f.scene, { assets: a, waterAt: () => 0, readEggPose: () => null, diagnostic: vi.fn() });
    renderer.sync(s, { x: 0, y: 0, angle: 0 }, 0);
    const step = KRAKEN_BOSS_DEFAULTS.landMoveSpeedPxPerSec / 10;
    renderer.sync(s, { x: step, y: 0, angle: 0 }, 100);
    expect(vi.mocked(a.land.frame).mock.calls.at(-1)?.[0]).toBe('move');
    const firstFrame = vi.mocked(a.land.frame).mock.calls.at(-1)![1];
    renderer.sync(s, { x: step * 2, y: 0, angle: 0 }, 300);
    const secondFrame = vi.mocked(a.land.frame).mock.calls.at(-1)![1];
    expect(secondFrame).toBeGreaterThan(firstFrame);
    renderer.sync(s, { x: step * 2, y: 0, angle: 0 }, 400);
    expect(vi.mocked(a.land.frame).mock.calls.at(-1)?.[0]).toBe('idle'); renderer.destroy();
  });
  it('binds matching passes, uses exposure on land and releases the filter before its owned mask', () => {
    const f = sceneFixture(), a = asset('land'), diagnostic = vi.fn();
    const v = new KrakenSpriteView(f.scene, a, () => 0, diagnostic);
    v.show({ clip: 'idle', frame: 2 }, { x: 20, y: 30, angle: 0 }, 100);
    const s = f.sprites[0], filter = s.filters.internal.list[0];
    expect(s.frame.name).toBe('idle/0002');
    expect(filter.elevationFrame.name).toBe(s.frame.name);
    expect(filter.elevationFrame.texture.key).not.toBe(s.texture.key);
    expect(filter.params.exposure).toBe(KRAKEN_WORLD_EXPOSURE);
    expect(s.displayWidth).toBe(a.metadata.targetSize * a.metadata.displayScale!);
    expect(f.masks[0].context.putImageData.mock.calls[0][0].data[0]).toBe(0);
    v.destroy(); v.destroy();
    expect(s.filters.internal.list).toHaveLength(0);
    expect(s.destroy).toHaveBeenCalledTimes(1); expect(f.masks[0].destroy).toHaveBeenCalledTimes(1);
  });
  it('reports clip unavailability once and recovers from paired resident rest frames without loading assets', () => {
    const f = sceneFixture(), a = asset('water'), original = a.frame, diagnostic = vi.fn();
    let ready = false;
    a.frame = (clip, index) => clip === '__rest' || ready ? original(clip, index) : null;
    const v = new KrakenSpriteView(f.scene, a, () => 1, diagnostic);
    const sample = { clip: 'idle', frame: 3 }, pose = { x: 0, y: 0, angle: 0 };
    v.show(sample, pose, 100); v.show(sample, pose, 120);
    expect(f.sprites[0].frame.name).toBe('__rest/0000'); expect(diagnostic).toHaveBeenCalledTimes(1);
    ready = true; v.show(sample, pose, 150);
    expect(f.sprites[0].frame.name).toBe('idle/0003');
    v.destroy();
  });
  it('keeps multiple parts independent, rejects feedback for removed parts, and tears down all owned resources', () => {
    const f = sceneFixture(), s = state(), a = assets();
    const r = new KrakenRenderer(f.scene, { assets: a, waterAt: () => 1, diagnostic: vi.fn(), readEggPose: () => null });
    r.sync(s, { x: 0, y: 0, angle: 0 }, 700);
    expect(f.sprites.filter(s => s.visible)).toHaveLength(2);
    const receipt: CombatPartHitReceipt = { event: { scope: boss.scope, activityRevision: 5, eventId: 'shot' },
      part: s.tentacles[0].contact.identity, contactId: 'a', x: 70, y: 80, outcomeId: 'hit' };
    r.confirmContact(receipt, 700); r.confirmContact(receipt, 700);
    r.sync(s, { x: 0, y: 0, angle: 0 }, 710);
    expect(f.sprites.filter(s => s.visible && s.tint !== 0xffffff)).toHaveLength(1);
    const cancelled = { ...s, revision: 2, tentacles: [s.tentacles[1]] };
    r.sync(cancelled, null, 720); r.confirmContact(receipt, 730);
    expect(f.sprites.filter(s => s.visible)).toHaveLength(1);
    r.sync(s, null, 750); // stale complete baseline cannot recreate part a
    expect(f.sprites.filter(s => s.visible)).toHaveLength(1);
    r.destroy(); r.destroy();
    expect(f.sprites.every(s => s.destroyed)).toBe(true);
    expect(f.shaders.every(s => s.destroyed)).toBe(true);
    expect(f.masks.every(m => m.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('samples aged ink after the action slot clears, with frozen geometry and independent concurrent masks', () => {
    const f = sceneFixture(), effects = new KrakenEffects(f.scene, x => x > 0 ? 1 : 0);
    const cloud = { attackId: 'ink', spitAt: 100, cloudEndsAt: 900,
      pose: { originX: 10, originY: 20, angle: .8, geometry: { kind: 'sector' as const, range: 280, arcDegrees: 60 } } };
    effects.begin(); effects.ink(cloud, 500); effects.ink({ ...cloud, attackId: 'two', pose: { ...cloud.pose, originX: -400 } }, 500);
    const visible = f.shaders.filter(s => s.visible);
    expect(visible).toHaveLength(2); expect(f.masks).toHaveLength(2);
    expect(visible[0].uniforms().uAge).toBe(.4);
    expect(visible[0].uniforms().uShape[2]).toBe(cloud.pose.geometry.range);
    effects.begin(); effects.ink(cloud, 900);
    expect(f.shaders.some(s => s.visible)).toBe(false);
    effects.destroy();
  });
  it('changes body asset under one boss identity and samples eggs without writing back hatch or spawn', () => {
    const f = sceneFixture(), s = state(), a = assets(), e = egg();
    s.tentacles = []; s.eggs = [e]; s.phase = { kind: 'surfaced', startedAt: 0, nextDiveAt: 4000 };
    s.bodyTargetability.mode = 'exposed';
    const read = vi.fn(() => ({ x: 40, y: 50, angle: 0 }));
    const r = new KrakenRenderer(f.scene, { assets: a, waterAt: () => 0, diagnostic: vi.fn(), readEggPose: read });
    r.sync(s, { x: 10, y: 20, angle: 0 }, 200);
    const waterBody = f.sprites.find(s => s.texture?.key === 'water:color');
    r.sync({ ...s, revision: 2, phase: { kind: 'land', startedAt: 500 } }, { x: 30, y: 35, angle: 1 }, e.spawnAt);
    expect(waterBody.destroyed).toBe(true);
    expect(f.sprites.filter(s => s.visible).map(s => s.texture.key).sort()).toEqual(['egg:color', 'land:color']);
    expect(e.status).toBe('hatching'); expect(read).toHaveBeenCalledWith(e);
    r.clear(); expect(f.sprites.some(s => s.visible)).toBe(false);
    r.destroy();
  });
});

describe('intro and egg flight presentation', () => {
  it('focuses only during the active intro, hands off at emergence and releases the override on abort', () => {
    const f = sceneFixture(), a = asset('water');
    const intro = { preset: 'kraken-rise' as const, habitatId: 'pond', waterAnchorId: 'anchor', x: 50, y: 60, seed: 7, startedAtMs: 100 };
    const r = new KrakenIntroRenderer(f.scene, a, () => 1, vi.fn());
    const feedback = { request: vi.fn(), cancel: vi.fn() }; r.setCameraFeedback(feedback as never);
    r.sync(intro, 1100);
    expect(getCameraFocusOverride(f.scene)).toMatchObject({ x: intro.x, y: intro.y });
    expect(f.sprites[0].visible).toBe(true);
    r.sync(intro, intro.startedAtMs + KRAKEN_RISE_INTRO.emergeAtMs);
    expect(f.sprites[0].visible).toBe(false);
    r.sync(null, 3200); expect(getCameraFocusOverride(f.scene)).toBeNull();
    r.sync(intro, intro.startedAtMs + KRAKEN_RISE_INTRO.durationMs + 1);
    expect(getCameraFocusOverride(f.scene)).toBeNull();
    expect(feedback.request).not.toHaveBeenCalled();
    r.destroy(); r.destroy();
    expect(f.sprites[0].destroy).toHaveBeenCalledTimes(1);
  });
  it('takes flight XY from the projectile, samples only visual height and never creates a landed entity', () => {
    const f = sceneFixture(), a = asset('egg'); let now = 150;
    const view = new KrakenEggFlightView(f.scene, a, vi.fn(), { releasedAt: 100, landsAt: 500, target: { x: 90, y: 100 } }, () => now);
    view.update(10, 20, 3, 40, 50);
    expect(f.sprites[0]).toMatchObject({ x: 10, y: 20, visible: true });
    expect(f.sprites[0].displayWidth).toBeGreaterThan(a.metadata.sourceSize);
    now = 500; view.update(80, 90, 3, 0, 0);
    expect(f.sprites[0].visible).toBe(false);
    expect(f.shaders.every(q => !q.visible)).toBe(true);
    view.destroy(); expect(f.sprites[0].destroy).toHaveBeenCalledTimes(1);
  });
});
