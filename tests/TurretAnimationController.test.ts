import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { TurretAnimationController } from '../src/effects/TurretAnimationController';
import { WorldInteractionRenderer } from '../src/effects/WorldInteractionRenderer';
import { getTurretVisualSpec } from '../src/config/turretVisuals';
import { pipelineAnimationKey } from '../src/config/pipelineAssets';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { NET_TICK_INTERVAL_MS } from '../src/config';
import type { SyncedTeslaDome } from '../src/types';

vi.mock('phaser', () => ({ Math: { Vector2: class { constructor(public x: number, public y: number) {} } }, BlendModes: { ADD: 1 } }));
const glowFx = vi.hoisted(() => ({ add: vi.fn(() => ({})), remove: vi.fn() }));
vi.mock('../src/effects/PlayerGlow', () => ({ addPlayerGlow: glowFx.add }));
vi.mock('../src/utils/phaserFx', () => ({ removeInternalFx: glowFx.remove }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));

function sprite() {
  const events = new EventEmitter();
  const view = Object.assign(events, {
    active: true, texture: { key: '' }, frame: { name: 0 as string | number },
    anims: { isPlaying: false, currentAnim: null as null | { key: string },
      stop: vi.fn(() => { view.anims.isPlaying = false; }) },
    setTexture(key: string, frame: number) { this.texture.key = key; this.frame.name = frame; return this; },
    setOrigin() { return this; },
    x: 0, y: 0, rotation: 0,
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setRotation(angle: number) { this.rotation = angle; return this; },
    setFrame(frame: number) { this.frame.name = frame; return this; },
    play: vi.fn((key: string, ignoreIfPlaying = false) => {
      if (ignoreIfPlaying && view.anims.isPlaying && view.anims.currentAnim?.key === key) return view;
      view.anims.isPlaying = true;
      view.anims.currentAnim = { key };
      view.frame.name = 1;
      return view;
    }),
  });
  return { view, phaser: view as unknown as Phaser.GameObjects.Sprite };
}

describe('turret animation lifecycle', () => {
  it('marks only the local candidate and releases occupant glow on exit, rebinding and world teardown', () => {
    glowFx.add.mockClear(); glowFx.remove.mockClear();
    const element = () => {
      const view: any = { visible: true, destroy: vi.fn() };
      for (const method of ['setDepth', 'setOrigin', 'clear', 'setPosition', 'lineStyle', 'strokePoints', 'setText', 'setAlpha', 'setScale', 'setColor',
        'fillStyle', 'fillRoundedRect', 'strokeRoundedRect', 'fillCircle', 'fillTriangle']) view[method] = vi.fn(() => view);
      view.setVisible = (visible: boolean) => { view.visible = visible; return view; };
      return view;
    };
    const graphics: any[] = [], texts: any[] = [];
    const scene = { add: { graphics: () => { const g = element(); graphics.push(g); return g; }, text: () => { const x = element(); texts.push(x); return x; } } };
    const turret = sprite(); Object.assign(turret.view, { scene, displayWidth: 48, displayHeight: 48 });
    const controller = new TurretAnimationController(); controller.bind('7', turret.phaser, 'TURRET_TESLA');
    const selection = new WorldInteractionRenderer(scene as never);
    selection.sync({ focus: { key: 'turret:7', label: 'Bemannen', subject: 'Raketenturm',
      footprint: { left: 4, top: 14, right: 36, bottom: 46 } }, alternatives: [] });
    const [, brackets] = graphics;
    controller.syncControl([]);
    expect(brackets.visible).toBe(true); expect(texts.some(text => text.setText.mock.calls.some(([value]: [string]) => value === 'Bemannen'))).toBe(true);
    controller.syncControl([{ id: '7', color: 0x22ddff }]); selection.sync({ focus: null, alternatives: [] });
    expect(brackets.visible).toBe(false);
    expect(glowFx.add).toHaveBeenCalledWith(turret.phaser, 0x22ddff, expect.any(Number), expect.any(Number), { rim: 0 });
    const [, , scale, strength] = glowFx.add.mock.calls[0]; expect(scale).toBeGreaterThan(1); expect(strength).toBeGreaterThan(4);
    controller.syncControl([{ id: '7', color: 0x22ddff }]); expect(glowFx.add).toHaveBeenCalledOnce();
    controller.syncControl([]); expect(glowFx.remove).toHaveBeenCalledOnce();
    controller.syncControl([{ id: '7', color: 1 }]);
    controller.unbind('7'); expect(brackets.visible).toBe(false); expect(glowFx.remove).toHaveBeenCalledTimes(2);
    controller.bind('7', turret.phaser, 'TURRET_TESLA');
    controller.syncControl([{ id: '7', color: 1 }]);
    controller.clear(); expect(glowFx.remove).toHaveBeenCalledTimes(3);
    selection.clear(); selection.clear();
    for (const object of [...graphics, ...texts]) expect(object.destroy).toHaveBeenCalledOnce();
  });
  it.each(['7', 'base:turret'])('interpolates confirmed poses across wrap and holds on packet loss (%s)', id => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    controller.bind(id, phaser, 'TURRET_MG');
    const start = 179 * Math.PI / 180;
    controller.syncPose(id, 10, 20, start, true);
    expect(view.rotation).toBeCloseTo(start);
    controller.syncPose(id, 10, 20, -179 * Math.PI / 180, true);
    expect(view.rotation).toBeCloseTo(start);
    controller.update(NET_TICK_INTERVAL_MS / 2);
    expect(view.rotation).toBeCloseTo(Math.PI);
    // Repeated snapshots do not restart an in-flight interpolation.
    controller.syncPose(id, 10, 20, -179 * Math.PI / 180, true);
    controller.update(NET_TICK_INTERVAL_MS / 2);
    expect(view.rotation).toBeCloseTo(181 * Math.PI / 180);
    controller.update(1000);
    expect(view.rotation).toBeCloseTo(181 * Math.PI / 180);
    controller.syncPose(id, 30, 40, 1, true);
    expect(view.rotation).toBe(1);
    expect([view.x, view.y]).toEqual([30, 40]);
  });

  it('sets immediate host/legacy poses and clears interpolation with the sprite lifetime', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    controller.bind('7', phaser, 'TURRET_MG');
    controller.syncPose('7', 0, 0, 0, false);
    controller.syncPose('7', 0, 0, 2, false);
    expect(view.rotation).toBe(2);
    controller.syncPose('7', 0, 0, 1, true);
    view.emit('destroy');
    controller.update(NET_TICK_INTERVAL_MS);
    expect(view.rotation).toBe(2);
    controller.bind('7', phaser, 'TURRET_MG');
    controller.syncPose('7', 0, 0, -1, true);
    expect(view.rotation).toBe(-1);
    controller.syncPose('7', 0, 0, 0, true);
    controller.clear();
    controller.update(1000);
    expect(view.rotation).toBe(-1);
  });

  it('restarts discrete recoil, preserves it through a repeated binding and returns to idle', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    const asset = getTurretVisualSpec('TURRET_ROCKET_BURST').asset;
    controller.bind('base:rocket', phaser, 'TURRET_ROCKET_BURST');
    controller.onShot('base:rocket');
    controller.bind('base:rocket', phaser, 'TURRET_ROCKET_BURST');
    expect(view.frame.name).toBe(1);
    controller.onShot('base:rocket');
    expect(view.play).toHaveBeenCalledTimes(2);
    expect(view.play).toHaveBeenLastCalledWith(pipelineAnimationKey(asset, asset.clips[0]));
    view.anims.isPlaying = false;
    controller.update(16);
    expect(view.frame.name).toBe(asset.idleFrame);
  });

  it('keeps sustained fire active between discharges and stops after its network grace period', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    controller.bind('7', phaser, 'TURRET_FLAME');
    controller.onShot('7');
    controller.update(WEAPON_CONFIGS.TURRET_FLAME.cooldown);
    expect(view.anims.isPlaying).toBe(true);
    controller.onShot('7');
    controller.update(WEAPON_CONFIGS.TURRET_FLAME.cooldown + 2 * NET_TICK_INTERVAL_MS);
    expect(view.anims.isPlaying).toBe(false);
    expect(view.frame.name).toBe(0);
  });

  it('uses only the matching construction dome for Tesla activity', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    controller.bind('7', phaser, 'TURRET_TESLA');
    controller.onShot('7');
    expect(view.anims.isPlaying).toBe(false);
    controller.syncTesla([{ ownerId: 'tesla-turret:7' }] as SyncedTeslaDome[]);
    controller.update(16);
    expect(view.anims.isPlaying).toBe(true);
    controller.syncTesla([{ ownerId: 'player-7' }] as SyncedTeslaDome[]);
    controller.update(16);
    expect(view.anims.isPlaying).toBe(false);
  });

  it('releases old bindings on replacement, destruction and world teardown', () => {
    const controller = new TurretAnimationController();
    const first = sprite(), replacement = sprite();
    controller.bind('7', first.phaser, 'TURRET_FLAME');
    controller.onShot('7');
    controller.bind('7', replacement.phaser, 'TURRET_MG');
    expect(first.view.anims.isPlaying).toBe(false);
    expect(first.view.listenerCount('destroy')).toBe(0);
    // Phaser clears anims in preDestroy while active can still be true.
    Object.assign(replacement.view, { isDestroyed: true, anims: undefined });
    replacement.view.emit('destroy');
    controller.onShot('7');
    expect(replacement.view.play).not.toHaveBeenCalled();
    controller.bind('7', first.phaser, 'TURRET_TESLA');
    controller.clear();
    expect(first.view.listenerCount('destroy')).toBe(0);
    controller.onShot('7');
    expect(first.view.play).toHaveBeenCalledTimes(1);
  });

  it('keeps the emission glow of a turret on its frame and pose, flares its light with a shot and ends with the binding', () => {
    const asset = getTurretVisualSpec('SPORE_TURRET_PLASMA').asset;
    const glow: any = { frame: { name: 0 as string | number }, visible: true, destroy: vi.fn() };
    for (const method of ['setOrigin', 'setBlendMode', 'setDepth', 'setPosition', 'setRotation', 'setScale', 'setFlip', 'setAlpha']) glow[method] = vi.fn(() => glow);
    glow.setVisible = (visible: boolean) => { glow.visible = visible; return glow; };
    glow.setFrame = (frame: number) => { glow.frame.name = frame; return glow; };
    const scene = { textures: { exists: () => true }, add: { sprite: vi.fn(() => glow) } };
    const turret = sprite(); Object.assign(turret.view, { scene, visible: true, alpha: 1, scaleX: .25, scaleY: .25, flipX: false, flipY: false });
    const pulse = vi.fn();
    const controller = new TurretAnimationController();
    controller.setLightingSystem({ pulse });
    controller.bind('3', turret.phaser, 'SPORE_TURRET_PLASMA');
    expect(scene.add.sprite).toHaveBeenCalledWith(0, 0, `${asset.sheetTextureKey}_emission`, asset.idleFrame);
    controller.syncPose('3', 80, 40, .5, false);
    controller.onShot('3');
    expect(pulse).toHaveBeenCalledWith('turretGlow', 80, 40, expect.objectContaining({ color: expect.any(Number) }));
    controller.update(16);
    expect(glow.frame.name).toBe(turret.view.frame.name);
    expect(glow.setPosition).toHaveBeenLastCalledWith(80, 40);
    controller.unbind('3');
    expect(glow.destroy).toHaveBeenCalledTimes(1);
  });
});
