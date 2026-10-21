import * as Phaser from 'phaser';
import { configureGpuLayerCameraTransform } from '../graphics/GpuLayerCameraTransform';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { mixColors } from '../effects/EffectUtils';
import { POWERUP_ITEM_ART, POWERUP_RENDER_SIZE } from './PowerUpConfig';
import { POWERUP_ITEM_DEPTH } from './PowerUpItemDepth';
import {
  ensurePowerUpItemFxTexture,
  POWERUP_ITEM_FX_FRAME,
  POWERUP_ITEM_FX_FRAME_SIZE,
} from './PowerUpItemArt';

const MAX_ITEMS = 256;
const UNDER_MEMBERS_PER_ITEM = 3;
const RING_TURN_MS = 9_000;
const GLOW_HALF_PERIOD_MS = 1_200;
const GLINT_HALF_PERIOD_MS = 1_700;
const PULSE_EASE = 'Sine.easeInOut';
const GLINT_EASE = 'Expo.easeIn';

type GpuMember = Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member>;

interface ItemGpuHandle {
  readonly slot: number;
  x: number;
  y: number;
  color: number;
}

/**
 * Persistent GPU decoration of lying power-ups: ground shadow, rotating ground ring, channel
 * glow, halo and a periodic glint. Members are edited only when an item appears, moves or
 * disappears; every idle animation runs on the layer clock.
 *
 * The shadow is ground material below the figures. Ring, glow and glint are self-lit and sit
 * just above the light map (band E), so a pickup stays legible at night and in fog while the
 * canopy still covers it.
 */
export class PowerUpItemGpuSystem {
  private destroyed = false;
  private readonly texture: Phaser.Textures.Texture;
  private readonly shadowLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly underLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly overLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly handles = new Map<number, ItemGpuHandle>();
  private readonly freeSlots: number[] = [];
  private nextSlot = 0;

  constructor(scene: Phaser.Scene) {
    this.texture = ensurePowerUpItemFxTexture(scene);
    this.shadowLayer = scene.add.spriteGPULayer(this.texture, MAX_ITEMS);
    this.shadowLayer.name = 'powerup-item-shadow';
    this.underLayer = scene.add.spriteGPULayer(this.texture, MAX_ITEMS * UNDER_MEMBERS_PER_ITEM);
    this.underLayer.name = 'powerup-item-glow';
    this.overLayer = scene.add.spriteGPULayer(this.texture, MAX_ITEMS);
    this.overLayer.name = 'powerup-item-glint';
    this.shadowLayer.setDepth(POWERUP_ITEM_DEPTH.shadow).setBlendMode(Phaser.BlendModes.NORMAL);
    this.underLayer.setDepth(POWERUP_ITEM_DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD);
    this.overLayer.setDepth(POWERUP_ITEM_DEPTH.glint).setBlendMode(Phaser.BlendModes.ADD);
    for (const layer of this.layers()) {
      layer.setVisible(false);
      layer.setAnimationEnabled('Linear', true);
      layer.setAnimationEnabled(PULSE_EASE, true);
      configureGpuLayerCameraTransform(layer);
    }
    this.overLayer.setAnimationEnabled(GLINT_EASE, true);
  }

  upsert(uid: number, x: number, y: number, color: number): void {
    if (this.destroyed) return;
    const existing = this.handles.get(uid);
    if (existing && existing.x === x && existing.y === y && existing.color === color) return;
    const append = !existing && this.freeSlots.length === 0;
    const slot = existing?.slot ?? this.allocateSlot();
    if (slot < 0) return;
    const handle = existing ?? { slot, x, y, color };
    handle.x = x; handle.y = y; handle.color = color;
    this.handles.set(uid, handle);
    this.writeSlot(handle, uid, append);
    this.syncVisibility();
  }

  remove(uid: number): void {
    const handle = this.handles.get(uid);
    if (!handle) return;
    this.shadowLayer.editMember(handle.slot, deadMember());
    this.overLayer.editMember(handle.slot, deadMember());
    const under = handle.slot * UNDER_MEMBERS_PER_ITEM;
    for (let index = 0; index < UNDER_MEMBERS_PER_ITEM; index += 1) {
      this.underLayer.editMember(under + index, deadMember());
    }
    this.handles.delete(uid);
    this.freeSlots.push(handle.slot);
    this.syncVisibility();
  }

  /** Day balance of the additive members, matching EmissiveScale's intent for persistent glow. */
  setEmissiveAlpha(alpha: number): void {
    this.underLayer.setAlpha(alpha);
    this.overLayer.setAlpha(alpha);
  }

  clear(): void {
    for (const uid of [...this.handles.keys()]) this.remove(uid);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    for (const layer of this.layers()) {
      if (layer.submitterNode?.programManager) disposeShaderWarmupNode(layer.submitterNode);
      layer.destroy();
    }
    this.destroyed = true;
  }

  getActiveCount(): number {
    return this.handles.size;
  }

  private layers(): Phaser.GameObjects.SpriteGPULayer[] {
    return [this.shadowLayer, this.underLayer, this.overLayer];
  }

  private allocateSlot(): number {
    const recycled = this.freeSlots.pop();
    if (recycled !== undefined) return recycled;
    if (this.nextSlot >= MAX_ITEMS) return -1;
    return this.nextSlot++;
  }

  private writeSlot(handle: ItemGpuHandle, uid: number, append: boolean): void {
    const art = POWERUP_ITEM_ART;
    const phaseMs = (uid * 389) % (GLOW_HALF_PERIOD_MS * 2);
    const ringScale = art.ringDiameter / POWERUP_ITEM_FX_FRAME_SIZE.ring;
    const haloScale = art.haloDiameter / POWERUP_ITEM_FX_FRAME_SIZE.halo;
    // The channel frame spans the same canvas as the token layer, so its ring lands in the groove.
    const channelScale = POWERUP_RENDER_SIZE / POWERUP_ITEM_FX_FRAME_SIZE.channel;
    const shadowScale = art.shadowDiameter / POWERUP_ITEM_FX_FRAME_SIZE.shadow;
    const glow = mixColors(handle.color, 0xffffff, 0.18);
    const shadow: GpuMember = {
      x: handle.x + art.shadowOffset.x,
      y: handle.y + art.shadowOffset.y,
      frame: this.texture.get(POWERUP_ITEM_FX_FRAME.shadow),
      scaleX: shadowScale,
      scaleY: shadowScale,
      alpha: 0.62,
    };
    const ring = tint({
      x: handle.x,
      y: handle.y,
      frame: this.texture.get(POWERUP_ITEM_FX_FRAME.ring),
      scaleX: ringScale,
      scaleY: ringScale,
      rotation: {
        base: (uid * 1.7) % (Math.PI * 2), amplitude: Math.PI * 2, duration: RING_TURN_MS,
        ease: 'Linear', loop: true, yoyo: false,
      },
      alpha: pulse(0.55, 0.8, GLOW_HALF_PERIOD_MS),
      creationTime: -phaseMs,
    }, glow);
    const channel = tint({
      x: handle.x,
      y: handle.y,
      frame: this.texture.get(POWERUP_ITEM_FX_FRAME.channel),
      scaleX: channelScale,
      scaleY: channelScale,
      alpha: pulse(0.55, 0.9, GLOW_HALF_PERIOD_MS),
      creationTime: -phaseMs,
    }, mixColors(handle.color, 0xffffff, 0.3));
    const halo = tint({
      x: handle.x,
      y: handle.y - art.hoverPx,
      frame: this.texture.get(POWERUP_ITEM_FX_FRAME.halo),
      scaleX: pulse(haloScale * 0.92, haloScale * 1.05, GLOW_HALF_PERIOD_MS),
      scaleY: pulse(haloScale * 0.92, haloScale * 1.05, GLOW_HALF_PERIOD_MS),
      alpha: pulse(0.26, 0.42, GLOW_HALF_PERIOD_MS),
      creationTime: -phaseMs,
    }, handle.color);
    // The glint keeps the pickup's own hue: a white star would read as a white flash.
    const glintPhase = (uid * 911) % (GLINT_HALF_PERIOD_MS * 2);
    const glint = tint({
      x: handle.x - 4.2,
      y: handle.y - art.hoverPx - 4.6,
      frame: this.texture.get(POWERUP_ITEM_FX_FRAME.glint),
      scaleX: { base: 0, amplitude: 0.3, duration: GLINT_HALF_PERIOD_MS, ease: GLINT_EASE, loop: true, yoyo: true },
      scaleY: { base: 0, amplitude: 0.3, duration: GLINT_HALF_PERIOD_MS, ease: GLINT_EASE, loop: true, yoyo: true },
      rotation: { base: 0, amplitude: Math.PI / 2, duration: GLINT_HALF_PERIOD_MS * 2, ease: 'Linear', loop: true, yoyo: false },
      alpha: 0.95,
      creationTime: -glintPhase,
    }, mixColors(handle.color, 0xffffff, 0.35));
    const under = [ring, channel, halo];
    if (append) {
      this.shadowLayer.addMember(shadow);
      for (const member of under) this.underLayer.addMember(member);
      this.overLayer.addMember(glint);
      return;
    }
    this.shadowLayer.editMember(handle.slot, shadow);
    const first = handle.slot * UNDER_MEMBERS_PER_ITEM;
    for (let index = 0; index < under.length; index += 1) this.underLayer.editMember(first + index, under[index]);
    this.overLayer.editMember(handle.slot, glint);
  }

  private syncVisibility(): void {
    const visible = this.handles.size > 0;
    for (const layer of this.layers()) layer.setVisible(visible);
  }
}

function pulse(min: number, max: number, duration: number): Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation {
  return { base: min, amplitude: max - min, duration, ease: PULSE_EASE, loop: true, yoyo: true };
}

function tint(member: GpuMember, color: number): GpuMember {
  member.tintBlend = 1;
  member.tintTopLeft = color;
  member.tintTopRight = color;
  member.tintBottomLeft = color;
  member.tintBottomRight = color;
  return member;
}

function deadMember(): GpuMember {
  return { x: 0, y: 0, scaleX: 0, scaleY: 0, alpha: 0 };
}
