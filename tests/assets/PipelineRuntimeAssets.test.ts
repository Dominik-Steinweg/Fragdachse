import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import catalog from '../../scripts/asset-pipeline/catalog-v2.json';
import { validateEyeAnchors } from '../../scripts/asset-pipeline/eye-anchors.mjs';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../../src/config/coopDefenseEnemies';
import { getCoopDefenseUpgradeTextureKey } from '../../src/utils/coopDefenseUpgrades';
import { AutoTiler, MISSION_BARRIER_AUTOTILE } from '../../src/arena/AutoTiler';
import { getPipelineSpriteScale, pipelineAnimationKey, PIPELINE_ASSETS, PIPELINE_RUNTIME_ASSETS } from '../../src/config/pipelineAssets';
import { isBossRuntime, verifyBossRuntime } from '../../scripts/asset-pipeline/runtime-contract-v2.mjs';
import { packAtlas } from '../../scripts/asset-pipeline/atlas-v2.mjs';

async function bossFixture() {
  const entry = { category: 'boss-part', runtimeContract: 'boss', runtimeAtlas: true, runtimeBudgetMB: 1,
    targetSize: 16, sourceSizes: [16], pivot: [.5, .5], elevation: { min: -1, max: 2, scale: .5 },
    clips: [{ name: 'hatch', frameCount: 3, frameRate: 12, loop: false, end: 'terminal', markers: { release: 1 } }] };
  const clips = [{ ...entry.clips[0], frames: [1, 2, 3] }], files = new Map<string, Buffer>();
  const atlases: Record<string, Record<string, any>> = { color: {}, elevation: {} };
  const budget = { clips: {} as Record<string, { color: number; elevation: number; total: number }>, totals: { color: 0, elevation: 0, total: 0 } };
  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  for (const group of [{ name: '__rest', frames: [0] }, ...clips]) {
    const amounts = budget.clips[group.name] = { color: 0, elevation: 0, total: 0 };
    for (const pass of ['color', 'elevation'] as const) {
      const size = pass === 'color' ? 16 : 8;
      const image = await sharp({ create: { width: size, height: size, channels: 4, background: '#808080ff' } }).png().toBuffer();
      const frameNames = group.frames.map((_, i) => `${group.name}/${String(i).padStart(4, '0')}`);
      const pages = await packAtlas(group.frames.map(() => image), { size, frameNames, sourceFrames: group.frames, pivot: entry.pivot, prefix: `atlas/${pass}-${group.name}` });
      const records = pages.map(page => {
        const json = Buffer.from(JSON.stringify(page.metadata));
        files.set(page.image, page.png); files.set(page.json, json);
        amounts[pass] += page.gpuBytesRGBA8;
        return { image: page.image, json: page.json, width: page.width, height: page.height,
          gpuBytesRGBA8: page.gpuBytesRGBA8, sha256: hash(page.png), jsonSha256: hash(json), frameNames: Object.keys(page.metadata.frames) };
      });
      atlases[pass][group.name] = { pages: records, sourceSize: size, logicalSourceSize: 16, pivot: entry.pivot, frameNames, sourceFrames: group.frames };
    }
    amounts.total = amounts.color + amounts.elevation;
    for (const key of ['color', 'elevation', 'total'] as const) budget.totals[key] += amounts[key];
  }
  const asset = { ...entry, clips, idleFrame: 0, sourceSize: 16, atlases, budget,
    elevationPass: { ...entry.elevation, encoding: 'linear-unorm8-world-z', waterline: 0, alpha: 'beauty-coverage', colorSpace: 'non-color', premultiplied: false } };
  return { entry, asset, files, read: async (name: string) => files.get(name)! };
}

describe('selected runtime asset package', () => {
  it('publishes the Dawn scavenger as a fleeing enemy with standard animation names', () => {
    const asset = PIPELINE_ASSETS.find(a => a.id === 'enemy_dawn_scavenger')!;
    expect(asset).toMatchObject({ category: 'enemy', gameIds: [], textureKey: 'enemy_dawn_scavenger', sheetTextureKey: 'enemy_dawn_scavenger_walking' });
    expect(asset.clips.map(c => c.name).sort()).toEqual(['idle', 'move']);
    expect(asset.clips.every(c => c.loop)).toBe(true);
    expect(asset.clips.map(c => pipelineAnimationKey(asset, c))).toEqual(['enemy_dawn_scavenger_walking_idle', 'enemy_dawn_scavenger_walk']);
  });

  it('ships a marked one-shot pounce beyond the body circle, with anchors for all poses', async () => {
    for (const asset of PIPELINE_ASSETS.filter(a => a.category === 'enemy'
      && catalog.assets.find(c => c.id === a.id)!.requiredClips.includes('claw'))) {
      const clip = asset.clips.find(c => c.name === 'claw')!;
      expect(clip, asset.id).toBeDefined();
      expect(clip.loop).toBe(false);
      const authored = catalog.assets.find(a => a.id === asset.id)!;
      expect(getPipelineSpriteScale(asset.textureKey)).toBe(authored.displayScale ?? 1);
      expect(getPipelineSpriteScale(asset.sheetTextureKey)).toBe(getPipelineSpriteScale(asset.textureKey));
      const markers = (clip as typeof clip & { markers: { strike: number; impact: number } }).markers;
      expect(markers.strike).toBeGreaterThan(0);
      expect(markers.impact).toBeGreaterThan(markers.strike);
      expect(markers.impact).toBeLessThan(clip.frames.length - 1);
      for (const frame of clip.frames) expect(asset.eyeAnchors!.frames[frame]).toBeDefined();
      const { data, info } = await sharp(`public/${asset.sheetPath.replace(/^\.\//, '')}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pose = (frame: number) => {
        const size = asset.sourceSize, layout = asset.layout;
        const x = layout.margin + frame % layout.columns * (size + layout.spacing);
        const y = layout.margin + Math.floor(frame / layout.columns) * (size + layout.spacing);
        let sum = 0, count = 0, top = size;
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
          if (data[((y + py) * info.width + x + px) * 4 + 3] < 128) continue;
          sum += py; count++; top = Math.min(top, py);
        }
        expect(count).toBeGreaterThan(0);
        return { center: sum / count, top };
      };
      const idle = pose(asset.idleFrame), impact = pose(clip.frames[markers.impact]);
      expect(pose(clip.frames[markers.strike]).center, asset.id).toBeGreaterThan(idle.center);
      expect(impact.center, asset.id).toBeLessThan(idle.center);
      expect(pose(clip.frames[markers.impact + 1]).center, asset.id).toBeLessThan(impact.center);
      expect(impact.top, asset.id).toBeLessThan(asset.sourceSize * (0.5 - 0.5 / getPipelineSpriteScale(asset.textureKey)));
      expect(pose(clip.frames.at(-1)!).center, asset.id).toBeCloseTo(idle.center, 1);
    }
  });
  it('binds complete eye poses to every enemy image revision', () => {
    for (const asset of PIPELINE_ASSETS.filter(a => a.category === 'enemy')) {
      expect(() => validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount, asset)).not.toThrow();
      if (!isBossRuntime(catalog.assets.find(c => c.id === asset.id)!)) {
        for (const id of asset.gameIds) expect(COOP_DEFENSE_ENEMY_CONFIGS[id].eyeGlow).toBeDefined();
      }
      expect(() => validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount + 1, asset)).toThrow();
      expect(() => validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount, { ...asset, revision: 'foreign' })).toThrow();
      expect(() => validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount,
        { ...asset, hashes: { ...asset.hashes, sheet: 'foreign' } })).toThrow();
      const invalid = structuredClone(asset.eyeAnchors!);
      invalid.frames[0].left.x = Number.NaN;
      expect(() => validateEyeAnchors(invalid, asset.layout.frameCount, asset)).toThrow();
      expect(() => validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount, asset,
        asset.eyeAnchors!.source.blendSha256)).not.toThrow();
      expect(() => validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount, asset, '0'.repeat(64))).toThrow();
    }
  });
  it('checks published boss atlases, markers and resident memory instead of claw centroids', async () => {
    for (const asset of PIPELINE_RUNTIME_ASSETS.filter(a => a.runtimeContract === 'boss')) {
      const entry = catalog.assets.find(c => c.id === asset.id)!;
      await verifyBossRuntime(entry, asset, name => readFile(`public/${name.replace(/^\.\//, '')}`));
    }
    const f = await bossFixture();
    expect(f.asset.clips.some(c => c.name === 'claw')).toBe(false);
    await expect(verifyBossRuntime(f.entry, f.asset, f.read)).resolves.toEqual(f.asset.budget);
    await expect(verifyBossRuntime({ ...f.entry, runtimeBudgetMB: .00001 }, { ...f.asset, runtimeBudgetMB: .00001 }, f.read)).rejects.toThrow(/exceeded/);
    await expect(verifyBossRuntime(f.entry, { ...f.asset, clips: [{ ...f.asset.clips[0], markers: { release: 2 } }] }, f.read)).rejects.toThrow(/markers/);
    await expect(verifyBossRuntime(f.entry, { ...f.asset, atlases: { color: f.asset.atlases.color } }, f.read)).rejects.toThrow(/atlases/);
    await expect(verifyBossRuntime(f.entry, { ...f.asset, budget: { ...f.asset.budget, totals: { color: 0, elevation: 0, total: 0 } } }, f.read)).rejects.toThrow(/budget/);
    const broken = structuredClone(f.asset);
    broken.atlases.elevation.hatch.frameNames[0] = 'foreign';
    await expect(verifyBossRuntime(f.entry, broken, f.read)).rejects.toThrow(/mapping/);
    const missingOwnership = structuredClone(f.asset);
    delete (missingOwnership.atlases.color.hatch.pages[0] as { frameNames?: string[] }).frameNames;
    await expect(verifyBossRuntime(f.entry, missingOwnership, f.read)).rejects.toThrow(/ownership/);
    const page = f.asset.atlases.color.hatch.pages[0];
    const json = JSON.parse(f.files.get(page.json)!.toString());
    json.frames['hatch/0000'].sourceSize.w = 8;
    const bytes = Buffer.from(JSON.stringify(json));
    f.files.set(page.json, bytes); page.jsonSha256 = createHash('sha256').update(bytes).digest('hex');
    await expect(verifyBossRuntime(f.entry, f.asset, f.read)).rejects.toThrow(/canvas/);
  });
  it('ships the mission barrier blob frames with transparent spare slots and seamless straight runs', async () => {
    const { data, info } = await sharp('public/assets/sprites/missionbarrier47blob.png')
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([11 * 32, 5 * 32]);
    const usedFrames = new Set(MISSION_BARRIER_AUTOTILE.bitmaskToFrame);
    const pixel = (frame: number, x: number, y: number, channel: number) =>
      data[((Math.floor(frame / 11) * 32 + y) * info.width + (frame % 11) * 32 + x) * 4 + channel];
    for (let frame = 0; frame < 55; frame++) {
      let visiblePixels = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (pixel(frame, x, y, 3) > 0) visiblePixels++;
      }
      expect(visiblePixels > 0).toBe(usedFrames.has(frame));
    }
    const vertical = AutoTiler.getFrame(1 | 16, MISSION_BARRIER_AUTOTILE);
    const horizontal = AutoTiler.getFrame(4 | 64, MISSION_BARRIER_AUTOTILE);
    for (let t = 0; t < 32; t++) for (let c = 0; c < 4; c++) {
      expect(pixel(vertical, t, 0, c)).toBe(pixel(vertical, t, 31, c));
      expect(pixel(horizontal, 0, t, c)).toBe(pixel(horizontal, 31, t, c));
    }
  });

  it('keeps the wall material on the identical 32-pixel grid with byte-identical alpha', async () => {
    const [rock, wall] = await Promise.all(['rocks', 'walls'].map(key =>
      sharp(`public/assets/sprites/${key}47blob.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    expect(wall.info).toEqual(rock.info);
    expect(wall.info.width % 32).toBe(0); expect(wall.info.height % 32).toBe(0);
    for (let i = 0; i < rock.data.length; i += 4) {
      expect(wall.data[i + 3]).toBe(rock.data[i + 3]);
    }
  });
  it('resolves every smoke upgrade alias to a shipped PNG', async () => {
    const ids = ['smoke_grenade_radius', 'smoke_grenade_duration', 'smoke_grenade_storm',
      'smoke_grenade_disorientation', 'smoke_grenade_vulnerability', 'smoke_grenade_discharge', 'smoke_grenade_growth'];
    for (const id of ids) {
      const key = getCoopDefenseUpgradeTextureKey(id);
      expect(key).toBeTruthy();
      const metadata = await sharp(`public/assets/sprites/Loadout/${key}.png`).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
    }
  });
  it('covers catalog assets bound to game IDs with unique runtime textures', () => {
    // Unbound designs can be produced and reviewed before gameplay integration.
    for (const entry of catalog.assets.filter(a => a.gameIds.length > 0)) expect(PIPELINE_RUNTIME_ASSETS.some(a => a.id === entry.id)).toBe(true);
    const keys = PIPELINE_RUNTIME_ASSETS.flatMap(a => a.runtimeContract === 'sheet' ? [a.textureKey, a.sheetTextureKey] : [a.textureKey]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const asset of PIPELINE_RUNTIME_ASSETS) {
      expect(asset.gameIds).toEqual(catalog.assets.find(a => a.id === asset.id)!.gameIds);
      if (asset.category === 'enemy' && asset.runtimeContract === 'sheet') {
        for (const id of asset.gameIds) {
          expect(COOP_DEFENSE_ENEMY_CONFIGS[id as keyof typeof COOP_DEFENSE_ENEMY_CONFIGS].imageKey).toBe(asset.textureKey);
        }
      }
    }
  });

  it('ships unchanged selected PNGs, valid gutters, idle cells and explicit clip frames', async () => {
    for (const asset of PIPELINE_ASSETS) {
      const { layout } = asset;
      expect(layout.frameWidth).toBe(asset.sourceSize);
      expect(layout.frameHeight).toBe(asset.sourceSize);
      expect(asset.pivot).toEqual([0.5, 0.5]);
      for (const field of ['idle', 'sheet'] as const) {
        const file = `public/${asset[`${field}Path`].replace(/^\.\//, '')}`;
        await access(file);
        const bytes = await readFile(file);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.hashes[field]);
        expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', hasAlpha: true,
          width: field === 'idle' ? asset.sourceSize : layout.width,
          height: field === 'idle' ? asset.sourceSize : layout.height });
      }
      for (const clip of asset.clips) {
        expect(clip.frameRate).toBeGreaterThan(0);
        // A quiet device may loop its single authored rest pose. Action clips still
        // need their own sampled motion; do not duplicate idle pixels to satisfy a count.
        if (clip.name === 'idle') {
          expect(clip.frames.length).toBeGreaterThan(0);
          expect(clip.loop).toBe(true);
        } else {
          expect(clip.frames.length).toBeGreaterThan(1);
          expect(clip.frames).not.toContain(asset.idleFrame);
        }
        for (const frame of [asset.idleFrame, ...clip.frames]) {
          expect(Number.isInteger(frame) && frame >= 0 && frame < layout.frameCount).toBe(true);
          const x = layout.margin + frame % layout.columns * (layout.frameWidth + layout.spacing);
          const y = layout.margin + Math.floor(frame / layout.columns) * (layout.frameHeight + layout.spacing);
          expect(x + layout.frameWidth).toBeLessThanOrEqual(layout.width);
          expect(y + layout.frameHeight).toBeLessThanOrEqual(layout.height);
        }
      }
      const idle = await sharp(`public/${asset.idlePath.slice(2)}`).raw().toBuffer();
      const sheetIdle = await sharp(`public/${asset.sheetPath.slice(2)}`)
        .extract({ left: layout.margin, top: layout.margin, width: layout.frameWidth, height: layout.frameHeight }).raw().toBuffer();
      // Sheet compositing may round RGB by one level on partially transparent edges.
      // Compare visible premultiplied color; transparent RGB is not visual information.
      let maxVisibleDifference = 0;
      let maxAlphaDifference = 0;
      for (let i = 0; i < idle.length; i += 4) {
        maxAlphaDifference = Math.max(maxAlphaDifference, Math.abs(idle[i + 3] - sheetIdle[i + 3]));
        for (let channel = 0; channel < 3; channel++) {
          maxVisibleDifference = Math.max(maxVisibleDifference,
            Math.abs(idle[i + channel] * idle[i + 3] - sheetIdle[i + channel] * sheetIdle[i + 3]) / 255);
        }
      }
      expect(maxAlphaDifference).toBe(0);
      expect(maxVisibleDifference).toBeLessThanOrEqual(1);
    }
  });
});
