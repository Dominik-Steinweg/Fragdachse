import * as Phaser from 'phaser';
import type { TerrainColorSnapshot } from '../../arena/TerrainColorSnapshot';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { mixColors } from '../EffectUtils';
import type { LightingSystem } from '../LightingSystem';
import {
  PORTAL_PASS_DEPTHS, PortalApertureKind, PortalGpuLayer, PortalMoteKind,
  type PortalApertureInstance, type PortalMoteInstance, type PortalPassDepths,
} from '../gpu/PortalGpuLayer';
import { PORTAL_STYLES, type PortalStyle, type PortalStyleId } from './PortalStyle';
import { findPortalEndAt, portalPartnerDirection, type PortalEndView, type PortalTransferEvent } from './PortalViews';

export type PortalLightingPort = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'pulse' | 'getArtificialLightFactor'>;

/** Ambient motes per end at full density, by graphics quality. */
const AMBIENT_MOTES = { high: 18, medium: 11, low: 5 } as const;
const DIRECTION_MOTES = { high: 5, medium: 3, low: 1 } as const;
const BURST_MOTES = { high: 16, medium: 10, low: 5 } as const;
const TIME_WRAP_S = 1000;
const SWALLOW_S = 0.42, RELEASE_S = 0.55, COMET_S = 0.36, COLLAPSE_S = 0.5;
const MAX_EVENTS = 96;

type Quality = keyof typeof AMBIENT_MOTES;
interface PortalEvent {
  readonly kind: 'swallow' | 'release' | 'collapse';
  readonly x: number; readonly y: number; readonly radius: number;
  readonly dirX: number; readonly dirY: number;
  readonly rim: number; readonly hot: number;
  readonly t0: number; readonly life: number; readonly strength: number;
  /** Collapse pull radius; the swallowed motes come from this far out. */
  readonly reach: number;
  readonly seed: number;
}

/**
 * The one portal presentation of a World. Translocator pairs, fire-control portals and generator
 * portals submit their ends each frame under their own owner key; this class owns the GPU layer,
 * the transfer and collapse events, the steady portal lights and the destination ground texture.
 * It reads presentation state only and never decides who or what may pass.
 */
export class PortalPresentation {
  private readonly layer: PortalGpuLayer;
  private readonly owners = new Map<string, readonly PortalEndView[]>();
  private readonly events: PortalEvent[] = [];
  private readonly lightKeys = new Set<string>();
  private readonly seenLights = new Set<string>();
  private readonly view = createVisibleWorldView();
  private readonly aperture: PortalApertureInstance = {
    x: 0, y: 0, radius: 0, extent: 0, open: 0, strength: 0, seed: 0, dx: 0, dy: 0, ground: 0,
    meter: -1, charge: -1, flash: 0, t0: 0, rim: 0, hot: 0, angle: 0, aspect: 1, pulse: 0, kind: PortalApertureKind.Portal,
  };
  private readonly mote: PortalMoteInstance = {
    x: 0, y: 0, radius: 0, kind: PortalMoteKind.SpiralIn, seed: 0, t0: 0, dx: 0, dy: 0, strength: 0, size: 0,
    rim: 0, hot: 0, life: 0, reach: 0,
  };
  private terrain: Phaser.Textures.Texture | null = null;
  private terrainRect: [number, number, number, number] = [0, 0, 1, 1];
  private terrainKey: string | null = null;
  private eventSeed = 0;
  private destroyed = false;
  private static instances = 0;
  private readonly id = PortalPresentation.instances++;

  constructor(private readonly scene: Phaser.Scene, private lighting: PortalLightingPort | null = null,
    depths: PortalPassDepths = PORTAL_PASS_DEPTHS) {
    this.layer = new PortalGpuLayer(scene, depths);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setLightingSystem(lighting: PortalLightingPort | null): void {
    if (lighting === this.lighting) return;
    this.releaseLights();
    this.lighting = lighting;
  }

  /** Replaces this owner's ends; owners call it every frame they present portals. */
  submit(owner: string, ends: readonly PortalEndView[]): void {
    if (this.destroyed) return;
    if (ends.length) this.owners.set(owner, ends);
    else this.owners.delete(owner);
  }

  clear(owner: string): void { this.owners.delete(owner); }

  /** World teardown: every owner's ends, pending events and lights go; the terrain stays. */
  clearAll(): void {
    this.owners.clear();
    this.events.length = 0;
    this.releaseLights();
  }

  /** Every currently submitted end, for markers or event attribution. */
  *ends(): Iterable<PortalEndView> {
    for (const ends of this.owners.values()) yield* ends;
  }

  /** A transfer seen at one end: swallow at the entry, release at the exit, both along `dir`. */
  playTransfer(event: PortalTransferEvent): void {
    const style = PORTAL_STYLES[event.style];
    const length = Math.hypot(event.dirX, event.dirY);
    const dirX = length > 1e-6 ? event.dirX / length : 0, dirY = length > 1e-6 ? event.dirY / length : 0;
    const strength = Math.max(0.05, Math.min(1, event.strength ?? 1));
    this.pushEvent(event.side === 'enter' ? 'swallow' : 'release', event.x, event.y, event.radius,
      dirX, dirY, style.rim, style.hot, strength, 0);
    this.pulseLight(event.x, event.y, style, event.radius, strength * (event.side === 'exit' ? 1 : 0.7));
  }

  /**
   * Teleport flash reported by the transport (a point and a colour). The end found there gives
   * the transfer its style and direction; a flash away from every known end stays undirected.
   */
  playFlashAt(x: number, y: number, color: number, type: 'start' | 'end'): void {
    const end = findPortalEndAt(this.ends(), x, y);
    const toPartner = end ? portalPartnerDirection(end) : null;
    if (end && toPartner) {
      // One world direction for the whole teleport: entry -> exit.
      const dirX = type === 'start' ? toPartner.x : -toPartner.x;
      const dirY = type === 'start' ? toPartner.y : -toPartner.y;
      this.playTransfer({ x: end.x, y: end.y, radius: end.radius, style: end.style,
        side: type === 'start' ? 'enter' : 'exit', dirX, dirY });
      return;
    }
    const hot = mixColors(color, 0xffffff, 0.7);
    this.pushEvent(type === 'start' ? 'swallow' : 'release', x, y, end?.radius ?? 16, 0, 0, color, hot, 1, 0);
    this.lighting?.pulse('teleportFlash', x, y, { color: mixColors(color, 0xffffff, 0.55), radiusPx: type === 'start' ? 110 : 150 });
  }

  /** Both apertures implode; generator portals also show their pull radius. */
  playCollapse(points: readonly { x: number; y: number }[], radius: number, style: PortalStyleId, reach = radius): void {
    const s = PORTAL_STYLES[style];
    for (const point of points) {
      this.pushEvent('collapse', point.x, point.y, radius, 0, 0, s.rim, s.hot, 1, Math.max(radius, reach));
      this.pulseLight(point.x, point.y, s, Math.max(radius, reach * 0.5), 1);
    }
  }

  /** The World's coarse ground colours; the aperture shows its partner's ground through it. */
  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void {
    if (this.terrainKey) this.scene.textures.remove(this.terrainKey);
    this.terrain = null;
    this.terrainKey = null;
    if (!snapshot || this.destroyed) return;
    const rgba = new Uint8Array(snapshot.width * snapshot.height * 4);
    for (let i = 0, j = 0; i < snapshot.data.length; i += 3, j += 4) {
      rgba[j] = snapshot.data[i]; rgba[j + 1] = snapshot.data[i + 1]; rgba[j + 2] = snapshot.data[i + 2]; rgba[j + 3] = 255;
    }
    const key = `__portal_terrain_${this.id}_${Date.now()}`;
    const texture = this.scene.textures.addUint8Array(key, rgba, snapshot.width, snapshot.height);
    if (!texture) return;
    // Bilinear: the coarse snapshot must read as soft ground, not as blocks.
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.terrain = texture;
    this.terrainKey = key;
    this.terrainRect = [snapshot.worldOffsetX, snapshot.worldOffsetY, snapshot.width * snapshot.scale, snapshot.height * snapshot.scale];
  }

  get debugCounts(): { owners: number; ends: number; events: number; apertures: number; motes: number } {
    let ends = 0;
    for (const list of this.owners.values()) ends += list.length;
    return { owners: this.owners.size, ends, events: this.events.length, ...this.layer.counts };
  }

  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean { return this.layer.prepare(context); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.releaseLights();
    this.owners.clear();
    this.events.length = 0;
    this.layer.destroy();
    if (this.terrainKey) this.scene.textures.remove(this.terrainKey);
    this.terrain = null;
    this.terrainKey = null;
    this.lighting = null;
  }

  private now(): number { return (this.scene.time.now / 1000) % TIME_WRAP_S; }

  private pushEvent(kind: PortalEvent['kind'], x: number, y: number, radius: number, dirX: number, dirY: number,
    rim: number, hot: number, strength: number, reach: number): void {
    if (this.destroyed) return;
    if (this.events.length >= MAX_EVENTS) this.events.shift();
    const life = kind === 'swallow' ? SWALLOW_S : kind === 'release' ? RELEASE_S : COLLAPSE_S;
    this.events.push({ kind, x, y, radius, dirX, dirY, rim, hot, t0: this.now(), life, strength, reach,
      seed: (this.eventSeed = (this.eventSeed + 1) % 4096) * 7.31 });
  }

  private pulseLight(x: number, y: number, style: PortalStyle, radius: number, strength: number): void {
    this.lighting?.pulse('teleportFlash', x, y, {
      color: mixColors(style.light, 0xffffff, 0.35), radiusPx: Math.max(90, radius * 6), intensity: 0.85 * strength,
    });
  }

  private render(): void {
    if (this.destroyed) return;
    const t = this.now();
    const quality = getGraphicsQualityProfile(this.scene).level as Quality;
    const night = Math.max(0, Math.min(1, this.lighting?.getArtificialLightFactor() ?? 0));
    this.layer.begin({ time: t, night, detail: quality === 'low' ? 0 : 1, terrain: this.terrain, terrainRect: this.terrainRect });
    const camera = this.scene.cameras?.main;
    const view = camera ? getVisibleWorldView(camera, this.view) : null;
    const visible = (x: number, y: number, extent: number) => !view
      || (x + extent >= view.x && y + extent >= view.y && x - extent <= view.right && y - extent <= view.bottom);
    this.seenLights.clear();
    for (const [owner, ends] of this.owners) {
      for (const end of ends) {
        this.light(owner, end);
        if (visible(end.x, end.y, end.radius * 4 + 16)) this.drawEnd(end, quality);
      }
    }
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      let age = t - event.t0;
      if (age < -1) age += TIME_WRAP_S;
      if (age > event.life + 0.05) { this.events.splice(i, 1); continue; }
      if (visible(event.x, event.y, Math.max(event.radius * 4, event.reach) + 16)) this.drawEvent(event, quality);
    }
    this.layer.end();
    for (const key of this.lightKeys) {
      if (this.seenLights.has(key)) continue;
      this.lighting?.releaseLight(key);
      this.lightKeys.delete(key);
    }
  }

  private drawEnd(end: PortalEndView, quality: Quality): void {
    const style = PORTAL_STYLES[end.style];
    const seed = seedOf(end.key);
    const toPartner = end.partner ? { x: end.partner.x - end.x, y: end.partner.y - end.y } : { x: 0, y: 0 };
    const charging = end.charge !== undefined;
    const open = Math.max(0, Math.min(1, charging ? 0.35 + 0.65 * (end.charge ?? 0) : end.open));
    const intensity = Math.max(0, Math.min(1, end.intensity ?? 1));
    const a = this.aperture;
    a.x = end.x; a.y = end.y; a.radius = end.radius; a.extent = end.radius * 4 + 10;
    a.open = open; a.strength = intensity; a.seed = seed;
    a.dx = toPartner.x; a.dy = toPartner.y; a.ground = end.ground ?? 0;
    a.meter = end.meter === undefined ? -1 : Math.max(0, Math.min(1, end.meter));
    a.charge = charging ? Math.max(0, Math.min(1, end.charge ?? 0)) : -1;
    a.flash = Math.max(0, Math.min(1, end.flash ?? 0)); a.t0 = 0;
    a.rim = style.rim; a.hot = style.hot;
    a.angle = end.ellipse?.angle ?? 0; a.aspect = Math.max(1, end.ellipse?.aspect ?? 1);
    a.pulse = end.pulse ? 1 : 0; a.kind = PortalApertureKind.Portal;
    this.layer.addAperture(a);

    const density = Math.max(0, Math.min(1, end.particles ?? 1)) * intensity * Math.min(1, open * 1.3);
    if (density < 0.05) return;
    const m = this.mote;
    m.x = end.x; m.y = end.y; m.radius = end.radius * open; m.t0 = 0;
    m.rim = style.rim; m.hot = style.hot; m.life = 0; m.reach = 0;
    m.size = Math.max(1.9, Math.min(4.2, end.radius * 0.13));
    const ambient = Math.round(AMBIENT_MOTES[quality] * density * (charging ? 0.5 : 1));
    m.kind = end.flow === 'out' ? PortalMoteKind.SpiralOut : PortalMoteKind.SpiralIn;
    m.dx = 0; m.dy = 0; m.strength = 0.85 * intensity;
    for (let i = 0; i < ambient; i++) { m.seed = seed * 0.37 + i * 13.17; this.layer.addMote(m); }
    const dir = charging ? null : portalPartnerDirection(end);
    if (!dir) return;
    m.kind = PortalMoteKind.Direction; m.dx = dir.x; m.dy = dir.y; m.radius = end.radius;
    m.strength = 0.75 * intensity; m.size *= 0.85;
    const directed = Math.max(1, Math.round(DIRECTION_MOTES[quality] * density));
    for (let i = 0; i < directed; i++) { m.seed = seed * 0.61 + i * 29.3 + 400; this.layer.addMote(m); }
  }

  private drawEvent(event: PortalEvent, quality: Quality): void {
    const a = this.aperture;
    a.x = event.x; a.y = event.y; a.radius = event.radius; a.open = 1; a.strength = event.strength; a.seed = event.seed;
    a.dx = event.dirX; a.dy = event.dirY; a.ground = 0; a.meter = event.life; a.charge = -1; a.flash = 0; a.t0 = event.t0;
    a.rim = event.rim; a.hot = event.hot; a.angle = 0; a.aspect = 1; a.pulse = 0;
    const directed = event.dirX !== 0 || event.dirY !== 0;
    a.kind = event.kind === 'release' ? PortalApertureKind.ReleaseWave
      : event.kind === 'collapse' ? PortalApertureKind.Collapse : PortalApertureKind.SwallowFlare;
    a.extent = event.kind === 'collapse' ? Math.max(event.radius, event.reach) * 1.25 + 8 : event.radius * 2.8 + 8;
    // Undirected release waves read as a full ring.
    if (!directed && event.kind === 'release') { a.dx = 0; a.dy = 0; }
    this.layer.addAperture(a);

    const m = this.mote;
    m.x = event.x; m.y = event.y; m.radius = event.radius; m.t0 = event.t0; m.life = event.life;
    m.rim = event.rim; m.hot = event.hot; m.reach = event.reach; m.dx = event.dirX; m.dy = event.dirY;
    m.size = Math.max(1.6, Math.min(3.6, event.radius * 0.11));
    const count = Math.max(2, Math.round(BURST_MOTES[quality] * event.strength * (event.kind === 'collapse' ? 1.6 : 1)));
    m.strength = event.strength;
    m.kind = event.kind === 'swallow' ? PortalMoteKind.Swallow
      : event.kind === 'release' ? PortalMoteKind.Release : PortalMoteKind.Collapse;
    if (!directed && event.kind === 'release') {
      // Without a direction the burst is a full ring rather than a cone.
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        m.dx = Math.cos(angle); m.dy = Math.sin(angle); m.seed = event.seed + i * 3.7;
        this.layer.addMote(m);
      }
    } else {
      for (let i = 0; i < count; i++) { m.seed = event.seed + i * 3.7; this.layer.addMote(m); }
    }
    if (!directed || event.kind === 'collapse') return;
    // The comet carries the direction: it leaves the entry toward the exit and arrives at the
    // exit from the entry's side.
    m.kind = event.kind === 'swallow' ? PortalMoteKind.CometOut : PortalMoteKind.CometIn;
    m.dx = event.kind === 'swallow' ? event.dirX : -event.dirX;
    m.dy = event.kind === 'swallow' ? event.dirY : -event.dirY;
    m.life = event.kind === 'swallow' ? COMET_S : COMET_S * 0.8;
    m.t0 = event.kind === 'swallow' ? event.t0 + SWALLOW_S * 0.35 : event.t0 - COMET_S * 0.8 * 0.15;
    m.size = Math.max(1.4, m.size * 0.8);
    m.strength = event.strength;
    for (let i = 0; i < (quality === 'low' ? 1 : 3); i++) { m.seed = event.seed + 900 + i * 5.1; this.layer.addMote(m); }
  }

  private light(owner: string, end: PortalEndView): void {
    if (!this.lighting) return;
    const style = PORTAL_STYLES[end.style];
    const charging = end.charge !== undefined;
    const presence = (charging ? 0.25 + 0.5 * (end.charge ?? 0) : end.open) * (end.intensity ?? 1);
    if (presence <= 0.02) return;
    const key = `portal:${owner}:${end.key}`;
    this.lightKeys.add(key);
    this.seenLights.add(key);
    this.lighting.setLight(key, 'portal', end.x, end.y, {
      color: style.light, radiusPx: Math.max(60, end.radius * 4.2), intensity: 0.8 * presence * (1 + (end.flash ?? 0) * 0.6),
    });
  }

  private releaseLights(): void {
    for (const key of this.lightKeys) this.lighting?.releaseLight(key);
    this.lightKeys.clear();
    this.seenLights.clear();
  }
}

function seedOf(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 997) + 1;
}
