import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/effects/fireControl/FireControlPortalGpuLayer', () => ({ createFireControlPortalGpuLayer: () => null }));
vi.mock('../src/effects/fireControl/FireControlHologramFilter', () => ({ FireControlHologramFilter: class {} }));
vi.mock('../src/effects/TurretAnimationController', () => ({ TurretAnimationController: class { update() {} clear() {} } }));
import { FireControlRenderer } from '../src/effects/fireControl/FireControlRenderer';
import { FIRE_CONTROL_RELAY as asset, fireControlRelayFrame } from '../src/effects/fireControl/FireControlRelayAssets';
import type { FireControlCopiesDeploymentSnapshot } from '../src/systems/fireControl/FireControlSnapshot';

const deploy = asset.clips.find(c => c.name === 'deploy')!;
const duration = deploy.frames.length / deploy.frameRate * 1000;
const deployment: FireControlCopiesDeploymentSnapshot = {
  id: 1, ownerId: 'p1', ownerColor: 0x3dffd0, kind: 'copies', x: 10, y: 20,
  startedAt: 1000, expiresAt: 16000, parallel: false, copies: [],
};
function fixture(loaded = true) {
  const sprites: any[] = [];
  const scene = {
    textures: { exists: () => loaded },
    load: { spritesheet: vi.fn(), isLoading: () => false, start: vi.fn() },
    add: { sprite: (x: number, y: number, texture: string) => {
      const s: any = { x, y, texture, destroy: vi.fn() };
      for (const name of ['setOrigin', 'setDisplaySize', 'setDepth']) s[name] = vi.fn(() => s);
      s.setPosition = (x: number, y: number) => { Object.assign(s, { x, y }); return s; };
      s.setFrame = (frame: number) => { s.frame = frame; return s; };
      s.setAlpha = (alpha: number) => { s.alpha = alpha; return s; };
      sprites.push(s); return s;
    } },
  };
  const lights = new Set<string>();
  const lighting = { setLight: (key: string) => { lights.add(key); },
    releaseLight: (key: string) => { lights.delete(key); } };
  const renderer = new FireControlRenderer(scene as any, () => undefined, 'A', lighting as any);
  const update = (now: number, deployments = [deployment]) => renderer.update({ deployments }, now);
  return { renderer, sprites, lights, update, scene, loaded: () => { loaded = true; } };
}

describe('fire-control relay presentation', () => {
  it('samples deploy once and holds the authored idle on repeated snapshots', () => {
    const f = fixture();
    f.update(deployment.startedAt);
    expect(f.sprites[0].frame).toBe(deploy.frames[0]);
    f.update(deployment.startedAt + duration / 2);
    expect(f.sprites[0].frame).toBe(fireControlRelayFrame(duration / 2));
    f.update(deployment.startedAt + duration);
    expect(f.sprites[0].frame).toBe(asset.idleFrame);
    f.update(deployment.startedAt + duration * 5);
    expect(f.sprites).toHaveLength(1);
    expect(f.sprites[0].frame).toBe(asset.idleFrame);
    f.renderer.destroy();
  });
  it('uses snapshot age for late joins and after texture readiness', () => {
    const f = fixture(false);
    f.update(deployment.startedAt);
    expect(f.sprites).toHaveLength(0);
    expect(f.scene.load.spritesheet).toHaveBeenCalledOnce();
    f.loaded(); f.update(deployment.startedAt + duration * 2);
    expect(f.sprites[0].frame).toBe(asset.idleFrame);
    f.renderer.destroy();
  });
  it('owns one relay per deployment and cleans removal fades and teardown', () => {
    const f = fixture();
    f.update(1000, [deployment, { ...deployment, id: 2, x: 90 }]);
    expect(f.sprites).toHaveLength(2);
    expect(f.lights.size).toBe(2);
    f.update(1200, [deployment]); f.update(1300, [deployment]);
    expect(f.sprites[1].alpha).toBeGreaterThan(0);
    expect(f.sprites[1].alpha).toBeLessThan(1);
    f.update(3000, [deployment]);
    expect(f.sprites[1].destroy).toHaveBeenCalledOnce();
    expect(f.lights.size).toBe(1);
    f.renderer.destroy(); f.renderer.destroy();
    expect(f.sprites[0].destroy).toHaveBeenCalledOnce();
    expect(f.lights.size).toBe(0);
    f.update(4000);
    expect(f.sprites).toHaveLength(2);
  });
  it('does not create a missing deployment after an asynchronous load', () => {
    const f = fixture(false);
    f.update(1000); f.update(1200, []); f.loaded(); f.update(1500, []);
    expect(f.sprites).toHaveLength(0);
    f.renderer.destroy();
  });
});
