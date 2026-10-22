import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, DEPTH_LIGHTING } from '../../config';
import { LOBBY_BUILDINGS, lobbyBuildingWorldRects, type LobbyMenu } from '../../config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT } from '../../config/authoring/lobbyMerchant';
import { lobbyStaffAsset, lobbyStaffWorkMarkers, registerLobbyStaffClips } from '../../animations/LobbyStaffAssets';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';
import { createLobbyStaffState, stepLobbyStaff, type LobbyStaffClip, type LobbyStaffState } from './LobbyStaffModel';
import { LobbyStructureFx, type LobbyStructureBurst, type LobbyStructureEmitter } from './LobbyStructureFx';
import type { WorldMetrics } from '../../world/WorldMetrics';
import { t } from '../../i18n';
import { WorldPlaque } from '../../ui/WorldPlaque';
import type { LightingSystem } from '../../effects/LightingSystem';
import { LIGHT_PRESETS, type LightPresetKey } from '../../effects/LightingConfig';
import type { LongCasterFrame, ShadowSystem } from '../../effects/ShadowSystem';
import { STRUCTURE_SHADOW } from '../../effects/ShadowConfig';
import { emissiveAlpha } from '../../effects/EmissiveScale';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { setCloudUniforms, type SunCloudState } from '../../effects/sunlight/cloudShadow';
import { createSurfaceLightFrame, setSurfaceLightUniforms } from '../../effects/SurfaceLocalLights';
import type { RockLightingState, SurfaceLightSource } from '../rocks/RockLightingState';
import type { FogSurfaceStamp } from '../../effects/groundFog/FogSurfaceMask';
import { nearestStructurePoint, structureBounds, type StructureRect } from '../StructureOutline';
import { lobbyStructureAsset, lobbyStructureTextureKey, type LobbyStructureAsset, type LobbyStructureLayer } from './LobbyStructureAssets';
import { LOBBY_STRUCTURE_RELIEF_FRAGMENT, LOBBY_STRUCTURE_SHADOW_FRAGMENT } from './lobbyStructureShaders';

type LobbyLighting = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor'> & Partial<Pick<LightingSystem, 'pulse'>>;
type LobbyShadows = Pick<ShadowSystem, 'getLongCasterFrame'>;

/** Sun, clouds, moon relief and relief lamps lent by the World's sole sunlight owner. */
export interface LobbyStructureSunlight {
  readonly state: RockLightingState;
  readonly clouds: SunCloudState;
  /** Moon direction xyz and relief strength. */
  readonly moon: Float32Array;
  readonly surfaceLights: SurfaceLightSource;
}

/** Gap between an outline edge and its name plaque. */
const NAMEPLATE_GAP_PX = 12;
/** Half the plaque height: a plaque above the outline is placed by its centre, below by its top. */
const NAMEPLATE_HALF_HEIGHT_PX = 8;
/** Structure bodies stand in the watchtower band: decals, blood and ground shadows stay below. */
export const LOBBY_STRUCTURE_DEPTH = DEPTH.ROCKS + 0.15;
const RELIEF_DEPTH = LOBBY_STRUCTURE_DEPTH + 0.01;
const EMISSION_DEPTH = DEPTH_LIGHTING + 0.1;
/** Emission and light per layer: day floor, night level and flicker of the glow. */
const LAYER_LOOK: Record<LobbyStructureLayer, { day: number; night: number; flicker: number; hz: number }> = {
  forge: { day: .55, night: 1, flicker: .22, hz: 6.5 },
  lamp: { day: 0, night: 1, flicker: .05, hz: 1.3 },
  cyan: { day: .45, night: 1, flicker: .03, hz: .6 },
};
/** Ambient particle sources by socket name prefix. */
const SOCKET_EMITTERS: readonly { prefix: string; kind: LobbyStructureEmitter['kind']; intervalMs: number }[] = [
  { prefix: 'forge', kind: 'ember', intervalMs: 170 },
  { prefix: 'chimney', kind: 'smoke', intervalMs: 420 },
  { prefix: 'exhaust', kind: 'smoke', intervalMs: 900 },
];
/** Work markers that throw sparks or a glint: which marker, which burst and where. */
const STAFF_BURSTS: Partial<Record<LobbyMenu, { marker: string; burst: LobbyStructureBurst; socket?: string }>> = {
  upgrades: { marker: 'strike', burst: 'anvil', socket: 'spark_anvil' },
  merchant: { marker: 'tap', burst: 'grind' },
  items: { marker: 'stamp', burst: 'stamp' },
};
/** Tool reach in front of a staff member, for bursts without a socket. */
const STAFF_REACH_PX = 14;
/** Staff sheets share the player's 32 px reference size. */
const STAFF_BASE_SIZE = 32;

const SOCKET_LIGHTS: readonly { prefix: string; preset: LightPresetKey; layer: LobbyStructureLayer }[] = [
  { prefix: 'forge', preset: 'lobbyForgeGlow', layer: 'forge' },
  { prefix: 'lamp', preset: 'lobbyLampGlow', layer: 'lamp' },
  { prefix: 'window', preset: 'lobbyLampGlow', layer: 'lamp' },
  { prefix: 'tile_glow', preset: 'lobbyTileGlow', layer: 'cyan' },
];

/** Smooth spatial fade in cell units, with flat endpoints (no threshold pop). */
export function resolveLobbyStructureNameplateAlpha(distanceCells: number): number {
  if (!Number.isFinite(distanceCells)) return 0;
  const { fullVisibilityCells, hiddenAtCells } = LOBBY_MERCHANT.nameplate;
  const fraction = Math.max(0, Math.min(1,
    (distanceCells - fullVisibilityCells) / (hiddenAtCells - fullVisibilityCells)));
  return 1 - fraction * fraction * (3 - 2 * fraction);
}

/** Deterministic glow flicker per light, two incommensurate sines. */
function flicker(seconds: number, hz: number, amount: number, phase: number): number {
  if (amount <= 0) return 1;
  const wave = .6 * Math.sin((seconds * hz + phase) * Math.PI * 2) + .4 * Math.sin((seconds * hz * 2.37 + phase * 3.1) * Math.PI * 2);
  return 1 + amount * wave;
}

interface StructureView {
  readonly menu: LobbyMenu;
  readonly asset: LobbyStructureAsset;
  readonly rects: readonly StructureRect[];
  readonly originX: number;
  readonly originY: number;
  readonly body: Phaser.GameObjects.Image;
  readonly relief: Phaser.GameObjects.Shader | null;
  readonly shadow: Phaser.GameObjects.Shader | null;
  readonly emission: { layer: LobbyStructureLayer; image: Phaser.GameObjects.Image; phase: number }[];
  readonly lights: { key: string; preset: LightPresetKey; layer: LobbyStructureLayer; x: number; y: number; phase: number }[];
  readonly label: WorldPlaque;
  readonly stamp: FogSurfaceStamp;
  readonly staff: StaffView | null;
}

interface StaffView {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly clips: Partial<Record<LobbyStaffClip, string>>;
  readonly x: number;
  readonly y: number;
  readonly workHeading: number;
  readonly greetDurationMs: number;
  readonly state: LobbyStaffState;
  /** 1-based animation frame index of the work marker, -1 without a burst. */
  readonly markerFrame: number;
  readonly burst: { kind: LobbyStructureBurst; x: number; y: number } | null;
  lastFrame: number;
}

/**
 * World material of the four lobby structures on the main camera: lit albedo with a height-field
 * relief and self-shadow, a ground shadow on the shared bearing, emissive layers above the light
 * map, socket lights, name plaques and the fog roof stamp. No interaction, physics, progress or
 * Activity dependency; collision, fog obstacle and focus follow the authored outline.
 */
export class LobbyStructureRenderer {
  private readonly views: StructureView[] = [];
  private readonly stamps: FogSurfaceStamp[] = [];
  private lighting: LobbyLighting | null = null;
  private readonly fx: LobbyStructureFx | null = null;
  private lastUpdate = -1;
  private sunlight: LobbyStructureSunlight | null = null;
  private readonly castFrame: LongCasterFrame = { x: 0, y: 1, lengthMult: 1, softnessMult: 1, opacityMult: 1, visible: true };
  private readonly surfaceLights = createSurfaceLightFrame();
  private readonly canvasUniform = new Float32Array(4);
  private readonly quadUniform = new Float32Array(4);
  private readonly castUniform = new Float32Array(4);
  private readonly heightUniform = new Float32Array(2);
  private readonly optionsUniform = new Float32Array([0, 0, 1, 1]);
  private readonly shadeUniform = new Float32Array(2);

  constructor(private readonly scene: Phaser.Scene, metrics: WorldMetrics, gpuVfx: GpuVfxSystem | null = null) {
    const lit = getGraphicsQualityProfile(scene).level !== 'low';
    const emitters: LobbyStructureEmitter[] = [];
    LOBBY_BUILDINGS.forEach((building, index) => {
      const asset = lobbyStructureAsset(building.id);
      if (!asset || !scene.textures.exists(lobbyStructureTextureKey(asset, 'beauty'))) return;
      const rects = lobbyBuildingWorldRects(metrics, building);
      const originX = metrics.offsetX + building.gridX * CELL_SIZE, originY = metrics.offsetY + building.gridY * CELL_SIZE;
      const left = originX + asset.canvasOffset.x, top = originY + asset.canvasOffset.y, size = asset.displaySize;
      const body = scene.add.image(left, top, lobbyStructureTextureKey(asset, lit ? 'albedo' : 'beauty'))
        .setOrigin(0).setDisplaySize(size, size).setDepth(LOBBY_STRUCTURE_DEPTH);
      const relief = lit ? this.makeRelief(asset, left, top) : null;
      const shadow = lit ? this.makeShadow(asset, left, top) : null;
      const emission = asset.layers.map((layer, layerIndex) => ({ layer, phase: index * .37 + layerIndex * .21,
        image: scene.add.image(left, top, lobbyStructureTextureKey(asset, `emission-${layer}`)).setOrigin(0).setDisplaySize(size, size)
          .setDepth(EMISSION_DEPTH).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0) }));
      const lights: StructureView['lights'] = [];
      for (const [name, socket] of Object.entries(asset.sockets)) {
        const rule = SOCKET_LIGHTS.find(candidate => name.startsWith(candidate.prefix));
        if (!rule || !asset.layers.includes(rule.layer)) continue;
        lights.push({ key: `lobby-structure:${building.id}:${name}`, preset: rule.preset, layer: rule.layer,
          x: originX + socket.x, y: originY + socket.y, phase: lights.length * .43 + index * .19 });
      }
      const bounds = structureBounds(rects);
      // The plaque hangs outside the outline on the working front, never over the building.
      const plaque = asset.sockets.plaque;
      const above = !!plaque && originY + plaque.y < (bounds.top + bounds.bottom) / 2;
      const label = new WorldPlaque(scene).setText(t(building.nameKey)).setPosition(
        plaque ? originX + plaque.x : (bounds.left + bounds.right) / 2,
        above ? bounds.top - NAMEPLATE_GAP_PX - NAMEPLATE_HALF_HEIGHT_PX : bounds.bottom + NAMEPLATE_GAP_PX);
      const stamp: FogSurfaceStamp = { active: true, visible: true, alpha: 1, x: left, y: top,
        displayWidth: size, displayHeight: size, scaleX: size / asset.sourceSize, scaleY: size / asset.sourceSize,
        originX: 0, originY: 0, rotation: 0, texture: { key: lobbyStructureTextureKey(asset, 'solid') }, frame: { name: '__BASE' } };
      for (const [name, socket] of Object.entries(asset.sockets)) {
        const rule = SOCKET_EMITTERS.find(candidate => name.startsWith(candidate.prefix));
        if (rule) emitters.push({ kind: rule.kind, x: originX + socket.x, y: originY + socket.y, intervalMs: rule.intervalMs });
      }
      const staff = this.makeStaff(building.menu, asset, originX, originY);
      this.views.push({ menu: building.menu, asset, rects, originX, originY, body, relief, shadow, emission, lights, label, stamp, staff });
      this.stamps.push(stamp);
    });
    if (gpuVfx && this.views.length > 0) this.fx = new LobbyStructureFx(gpuVfx, emitters);
  }

  /** Staff stand at their structure's `staff` socket facing the station; presentation only. */
  private makeStaff(menu: LobbyMenu, asset: LobbyStructureAsset, originX: number, originY: number): StaffView | null {
    const sheet = lobbyStaffAsset(menu), socket = asset.sockets.staff, facing = asset.sockets.staff_facing;
    if (!sheet || !socket || !this.scene.textures.exists(sheet.sheetTextureKey)) return null;
    const clips = registerLobbyStaffClips(this.scene.anims, sheet);
    const x = originX + socket.x, y = originY + socket.y;
    const workHeading = facing ? Math.atan2(facing.y - socket.y, facing.x - socket.x) : Math.PI / 2;
    const size = STAFF_BASE_SIZE * (sheet.displayScale ?? 1);
    const sprite = this.scene.add.sprite(x, y, sheet.sheetTextureKey).setOrigin(0.5).setDisplaySize(size, size)
      .setRotation(workHeading + Math.PI / 2).setDepth(DEPTH.PLAYERS);
    const greet = sheet.clips.find(clip => clip.name === 'greet');
    const rule = STAFF_BURSTS[menu], marker = rule ? lobbyStaffWorkMarkers(sheet)[rule.marker] : undefined;
    const at = rule?.socket ? asset.sockets[rule.socket] : undefined;
    const burst = rule && marker !== undefined ? { kind: rule.burst,
      x: at ? originX + at.x : x + Math.cos(workHeading) * STAFF_REACH_PX,
      y: at ? originY + at.y : y + Math.sin(workHeading) * STAFF_REACH_PX } : null;
    const view: StaffView = { sprite, clips, x, y, workHeading, state: createLobbyStaffState(workHeading),
      greetDurationMs: greet ? greet.frames.length / greet.frameRate * 1000 : 0,
      markerFrame: marker !== undefined ? marker + 1 : -1, burst, lastFrame: -1 };
    if (clips.work) sprite.play(clips.work);
    return view;
  }

  /** Behaviour step, clip switch and work-marker bursts of one staff member. */
  private updateStaff(view: StructureView, staff: StaffView, player: { x: number; y: number } | null,
    focusedMenu: LobbyMenu | null, now: number, deltaMs: number): void {
    const previous = staff.state.clip;
    stepLobbyStaff(staff.state, { now, deltaMs, x: staff.x, y: staff.y, workHeading: staff.workHeading, player,
      focused: focusedMenu === view.menu, greetDurationMs: staff.greetDurationMs });
    staff.sprite.setRotation(staff.state.heading + Math.PI / 2);
    const clip = staff.state.clip;
    if (clip !== previous) {
      const key = staff.clips[clip] ?? staff.clips.idle;
      if (key) staff.sprite.play(key);
      staff.lastFrame = -1;
    }
    if (clip !== 'work' || !staff.burst || !this.fx) return;
    const frame = staff.sprite.anims.currentFrame?.index ?? -1;
    if (frame === staff.markerFrame && staff.lastFrame !== frame) {
      this.fx.burst(staff.burst.kind, staff.burst.x, staff.burst.y);
      if (staff.burst.kind === 'anvil') this.lighting?.pulse?.('lobbyForgeGlow', staff.burst.x, staff.burst.y, { durationMs: 180, intensity: .7, radiusPx: 90 });
    }
    staff.lastFrame = frame;
  }

  private makeRelief(asset: LobbyStructureAsset, left: number, top: number): Phaser.GameObjects.Shader {
    const size = asset.displaySize;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: 'LobbyStructureRelief', shaderName: 'LobbyStructureRelief', fragmentSource: LOBBY_STRUCTURE_RELIEF_FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        const sunlight = this.sunlight;
        setCloudUniforms(set, sunlight?.clouds);
        set('uElevation', 0); set('uMineralResponse', 0); set('uFineMineral', 0);
        this.canvasUniform[0] = left; this.canvasUniform[1] = top; this.canvasUniform[2] = size; this.canvasUniform[3] = 0;
        set('uCanvas', this.canvasUniform);
        this.heightUniform[0] = asset.heightPx.min; this.heightUniform[1] = asset.heightPx.max;
        set('uHeight', this.heightUniform);
        set('uSun', sunlight?.state.sun ?? [0, 0, 1]);
        this.optionsUniform[0] = sunlight?.state.enabled ? sunlight.clouds.strength : 0;
        set('uOptions', this.optionsUniform);
        const lights = sunlight ? sunlight.surfaceLights(left, top, size, size, this.surfaceLights) : null;
        setSurfaceLightUniforms(set, lights, sunlight?.moon ?? null, sunlight?.clouds.quality?.surfaceLights);
      },
    }, left, top, size, size, [this.scene.textures.get(lobbyStructureTextureKey(asset, 'elevation'))]);
    return this.scene.add.existing(quad).setOrigin(0).setDepth(RELIEF_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  private makeShadow(asset: LobbyStructureAsset, left: number, top: number): Phaser.GameObjects.Shader {
    const size = asset.displaySize, reach = STRUCTURE_SHADOW.maxReachPx;
    const quadLeft = left - reach, quadTop = top - reach, quadSize = size + reach * 2;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: 'LobbyStructureShadow', shaderName: 'LobbyStructureShadow', fragmentSource: LOBBY_STRUCTURE_SHADOW_FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        const frame = this.castFrame;
        set('uCaster', 0);
        set('uStep', STRUCTURE_SHADOW.marchStepPx);
        this.canvasUniform[0] = left; this.canvasUniform[1] = top; this.canvasUniform[2] = size; this.canvasUniform[3] = 0;
        set('uCanvas', this.canvasUniform);
        this.heightUniform[0] = asset.heightPx.min; this.heightUniform[1] = asset.heightPx.max;
        set('uHeight', this.heightUniform);
        this.quadUniform[0] = quadLeft; this.quadUniform[1] = quadTop; this.quadUniform[2] = quadSize; this.quadUniform[3] = quadSize;
        set('uQuad', this.quadUniform);
        this.castUniform[0] = frame.x; this.castUniform[1] = frame.y; this.castUniform[2] = frame.lengthMult;
        this.castUniform[3] = Math.min(reach, asset.heightPx.max * frame.lengthMult);
        set('uCast', this.castUniform);
        this.shadeUniform[0] = STRUCTURE_SHADOW.opacity * frame.opacityMult; this.shadeUniform[1] = STRUCTURE_SHADOW.softnessPx * frame.softnessMult;
        set('uShade', this.shadeUniform);
      },
    }, quadLeft, quadTop, quadSize, quadSize, [this.scene.textures.get(lobbyStructureTextureKey(asset, 'caster-height'))]);
    return this.scene.add.existing(quad).setOrigin(0).setDepth(STRUCTURE_SHADOW.layerDepth).setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  /** Lent by the World sunlight owner while it presents this World; null when it leaves. */
  setSunlight(sunlight: LobbyStructureSunlight | null): void { this.sunlight = sunlight; }

  /** Solid geometry of every structure: the fog is cut on it, never on the ground around it. */
  getFogSurfaceStamps(): readonly FogSurfaceStamp[] { return this.stamps; }

  update(localPlayer: { x: number; y: number } | null, activeMenu: LobbyMenu | null = null,
    lighting: LobbyLighting | null = null, shadows: LobbyShadows | null = null): void {
    const now = this.scene.time.now, seconds = now / 1000;
    const deltaMs = this.lastUpdate < 0 ? 0 : Math.min(100, now - this.lastUpdate);
    this.lastUpdate = now;
    this.fx?.setActive(lighting !== null);
    for (const view of this.views) if (view.staff) this.updateStaff(view, view.staff, localPlayer, activeMenu, now, deltaMs);
    // Names fade with the distance to the nearest wall, the same measure Shift uses.
    for (const { menu, rects, label } of this.views) label.setAlpha(localPlayer && activeMenu !== menu
      ? resolveLobbyStructureNameplateAlpha(nearestStructurePoint(rects, localPlayer.x, localPlayer.y).distance / CELL_SIZE) : 0);
    if (shadows) shadows.getLongCasterFrame(this.castFrame);
    for (const view of this.views) view.shadow?.setVisible(this.castFrame.visible);
    if (this.lighting !== lighting) this.releaseLights();
    this.lighting = lighting;
    const night = lighting?.getArtificialLightFactor() ?? 0;
    for (const view of this.views) {
      for (const glow of view.emission) {
        const look = LAYER_LOOK[glow.layer];
        const level = look.day + (look.night - look.day) * night;
        glow.image.setAlpha(lighting ? emissiveAlpha(Math.min(1, level * flicker(seconds, look.hz, look.flicker, glow.phase))) : 0);
      }
      for (const light of view.lights) {
        const look = LAYER_LOOK[light.layer];
        const level = look.day + (look.night - look.day) * night;
        if (lighting && level > 0) lighting.setLight(light.key, light.preset, light.x, light.y, { intensity: LIGHT_PRESETS[light.preset].intensity * level });
        else lighting?.releaseLight(light.key, { immediate: true });
      }
    }
  }

  private releaseLights(): void {
    for (const view of this.views) for (const { key } of view.lights) this.lighting?.releaseLight(key, { immediate: true });
    this.lighting = null;
  }

  private destroyQuad(quad: Phaser.GameObjects.Shader | null): void {
    if (!quad) return;
    // Phaser 4.2.1 Shader.preDestroy omits its private VAOs and vertex buffer.
    const node = quad.renderNode;
    if (node?.programManager) {
      for (const suite of Object.values(node.programManager.programs)) {
        Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      node.programManager.programs = {}; node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);
    }
    quad.destroy();
  }

  destroy(): void {
    this.releaseLights();
    this.sunlight = null;
    for (const view of this.views) {
      view.body.destroy(); view.label.destroy();
      this.destroyQuad(view.relief); this.destroyQuad(view.shadow);
      for (const { image } of view.emission) image.destroy();
      view.staff?.sprite.destroy();
    }
    this.views.length = 0; this.stamps.length = 0;
    this.fx?.destroy();
  }
}
