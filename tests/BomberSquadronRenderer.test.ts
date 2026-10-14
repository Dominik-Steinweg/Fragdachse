import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/config/pipelineAssets', () => ({
  getPipelineAsset: () => ({ textureKey: 'body', sheetTextureKey: 'body-sheet', clips: [{ frames: [0, 1], frameRate: 10 }] }),
}));
vi.mock('../src/effects/AttackDroneRenderer', () => ({
  ensureAttackDroneEffectTextures: () => {}, applyAttackDroneBodyFrame: () => {},
  ATTACK_DRONE_SHADOW_TEXTURE: 'shadow', ATTACK_DRONE_BOMB_TEXTURE: 'bomb',
}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: () => {} }));
import { BomberSquadronRenderer } from '../src/effects/bomberSquadron/BomberSquadronRenderer';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { BomberSquadronUltimateConfig } from '../src/loadout/LoadoutTypes';
import { bomberDrops, bomberPlanParamsFromConfig } from '../src/systems/bomberSquadron/BomberSquadronPlan';
import type { BomberSquadronDeploymentSnapshot } from '../src/systems/bomberSquadron/BomberSquadronSnapshot';

const config = ULTIMATE_CONFIGS.BOMBER_SQUADRON as BomberSquadronUltimateConfig;
const params = bomberPlanParamsFromConfig(config);
const WORLD = { width: 4000, height: 4000 };

function squadron(anchors: BomberSquadronDeploymentSnapshot['anchors'], extra: Partial<BomberSquadronDeploymentSnapshot> = {}):
  BomberSquadronDeploymentSnapshot {
  return { id: 1, ownerId: 'p1', ownerColor: 0x3dffd0, startedAt: 1000, angle: 0, params, anchors,
    stoppedAt: null, endsAt: 9000, ...extra };
}

function fixture(worldBounds = WORLD) {
  const created: any[] = [];
  const factory = (_x?: number, _y?: number, texture?: unknown) => {
    const o: any = { destroy: vi.fn(), visible: true, texture };
    for (const name of ['setDisplaySize', 'setDepth', 'setRotation', 'setTint', 'setFillStyle', 'setActive'])
      o[name] = vi.fn(() => o);
    o.setPosition = (x: number, y: number) => { o.x = x; o.y = y; return o; };
    o.setAlpha = (alpha: number) => { o.alpha = alpha; return o; };
    o.setVisible = (visible: boolean) => { o.visible = visible; return o; };
    created.push(o); return o;
  };
  const scene = {
    add: { image: factory, circle: factory },
    cameras: { main: { width: 100000, height: 100000, originX: .5, originY: .5, zoom: 1, scrollX: -48000, scrollY: -48000 } },
  };
  const explode = vi.fn();
  const renderer = new BomberSquadronRenderer(scene as any, {
    explode, playSound: vi.fn(), cameraFeedback: () => null, worldBounds: () => worldBounds, tintAt: () => 0xffffff,
  });
  return { renderer, created, explode };
}

const allAnchors = (): BomberSquadronDeploymentSnapshot['anchors'] =>
  Array.from({ length: params.droneCount }, () => ({ x: 1000, y: 2000 }));

describe('Bomber squadron presentation', () => {
  it('draws only launched drones and plays every in-world impact exactly once', () => {
    const f = fixture();
    const first = squadron([{ x: 1000, y: 2000 }, ...Array(params.droneCount - 1).fill(null)]);
    f.renderer.update({ squadrons: [first] }, 1300);
    // One launched drone: body, shadow and marker; the unlaunched ones do not exist.
    expect(f.created.filter(o => o.texture !== 'bomb')).toHaveLength(3);
    const expected = bomberDrops(first, 0, first.anchors[0]!);
    let now = 1300;
    for (const impactAt of [...expected.map(drop => drop.impactAt)].sort((a, b) => a - b)) {
      now = impactAt; f.renderer.update({ squadrons: [first] }, now);
    }
    f.renderer.update({ squadrons: [first] }, now + 500);
    expect(f.explode).toHaveBeenCalledTimes(expected.length);
  });

  it('never replays impacts that happened before a late joiner first saw the squadron', () => {
    const f = fixture();
    const late = squadron(allAnchors());
    const drops = Array.from({ length: params.droneCount }, (_, drone) => bomberDrops(late, drone, late.anchors[drone]!)).flat();
    const seenAt = drops[Math.floor(drops.length / 2)].impactAt;
    f.renderer.update({ squadrons: [late] }, seenAt);
    f.renderer.update({ squadrons: [late] }, seenAt + 1);
    expect(f.explode).not.toHaveBeenCalled();
  });

  it('drops impacts outside the World instead of clamping them to the edge', () => {
    const f = fixture({ width: 1, height: 1 });
    const outside = squadron(allAnchors());
    for (let now = 1000; now < 12000; now += 16) f.renderer.update({ squadrons: [outside] }, now);
    expect(f.explode).not.toHaveBeenCalled();
  });

  it('lets drones fly out after a natural end but releases a squadron removed early at once', () => {
    const natural = fixture(), early = fixture();
    const s = squadron(allAnchors());
    natural.renderer.update({ squadrons: [s] }, 8900);
    natural.renderer.update({ squadrons: [] }, s.endsAt);
    expect(natural.created.filter(o => o.texture !== 'bomb' && o.destroy.mock.calls.length > 0))
      .toHaveLength(0);
    early.renderer.update({ squadrons: [s] }, 3000);
    early.renderer.update({ squadrons: [] }, 3016);
    expect(early.created.filter(o => o.texture !== 'bomb').every(o => o.destroy.mock.calls.length === 1)).toBe(true);
    natural.renderer.destroy(); natural.renderer.destroy();
    expect(natural.created.every(o => o.destroy.mock.calls.length <= 1)).toBe(true);
    expect(natural.created.every(o => o.destroy.mock.calls.length === 1)).toBe(true);
  });
});
