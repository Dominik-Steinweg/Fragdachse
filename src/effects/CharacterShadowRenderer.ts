import * as Phaser from 'phaser';
import type { PlayerEntity } from '../entities/PlayerEntity';
import { CHARACTER_SHADOW_FILES, CHARACTER_SHADOW_MANIFEST as manifest } from '../assets/CharacterShadowAssetManifest';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { runWithScopedBlend } from '../graphics/PhaserScopedBlend';
import { ownSunShader, sunShaderName } from './sunlight/SunRenderTarget';
import { cloudDirectFactor, setCloudUniforms, type SunCloudState } from './sunlight/cloudShadow';
import { cloudShadowAt } from './sunlight/SunFieldModel';
import { characterShadowOpacity, characterShadowCoreDarkening, characterLightAzimuth, characterShadowSample, createCharacterShadowSelection,
  displayedShadowPose, selectCharacterShadows } from './CharacterShadowModel';
import { CHARACTER_SHADOW_CONFIG as config } from './ShadowConfig';
import { CHARACTER_SHADOW_FRAGMENT } from './characterShadowShader';
import { CharacterShadowReceiver } from './CharacterShadowReceiver';
import { registerGraphicsObject } from './EffectUtils';

const BOUNDS = ['uBounds0', 'uBounds1', 'uBounds2', 'uBounds3'];
const UV = ['uUv0', 'uUv1', 'uUv2', 'uUv3'];
const MASK = ['uMask0', 'uMask1', 'uMask2', 'uMask3'];

class CharacterShadowQuad {
  readonly shader: Phaser.GameObjects.Shader;
  readonly selection = createCharacterShadowSelection();
  readonly bounds = [0, 0, 1, 1];
  readonly body = [0, 0, config.contactRadiusX as number, config.contactRadiusY as number];
  readonly transform = [1, 0, 1, 1];
  readonly strength = [0, config.contactOpacity as number, 1, 0];
  readonly weaponPose = [0, 0, 0, 0];
  readonly weaponAxis = [1, 0, 0, 1];
  readonly weaponUv = [0, 0, 1, 1];
  readonly channels = [0, 0, 0, 0];
  readonly sampleBounds = Array.from({ length: 4 }, () => [0, 0, 1, 1]);
  readonly sampleUv = Array.from({ length: 4 }, () => [0, 0, 1, 1]);
  seen = false;
  solid = false;
  drawSubmissions = 0;
  pose = 0;
  constructor(scene: Phaser.Scene, private readonly clouds: SunCloudState, receiver: CharacterShadowReceiver) {
    const name = sunShaderName('CharacterShadow');
    this.shader = new Phaser.GameObjects.Shader(scene, { name, shaderName: name,
      fragmentSource: CHARACTER_SHADOW_FRAGMENT, setupUniforms: (set: (name: string, value: unknown) => void) => {
        for (let i = 0; i < 4; i++) { set(MASK[i], i); set(BOUNDS[i], this.sampleBounds[i]); set(UV[i], this.sampleUv[i]); }
        set('uChannels', this.channels); set('uWeights', this.selection.weights);
        set('uBounds', this.bounds); set('uBody', this.body); set('uTransform', this.transform);
        set('uStrength', this.strength); set('uWeapon', 4); set('uReceiver', 5);
        set('uWeaponPose', this.weaponPose); set('uWeaponAxis', this.weaponAxis); set('uWeaponUv', this.weaponUv);
        set('uReceiverWorld', receiver.world); setCloudUniforms(set, this.clouds);
        set('uDebugSolid', Number(this.solid));
      } }, 0, 0, 1, 1, [CHARACTER_SHADOW_FILES[0].key, CHARACTER_SHADOW_FILES[0].key,
      CHARACTER_SHADOW_FILES[0].key, CHARACTER_SHADOW_FILES[0].key, '__DEFAULT', receiver.texture.key]);
    ownSunShader(this.shader, name);
    this.shader.setDepth(config.depth);
    const node = this.shader.renderNode, run = node.run, quad = this;
    node.run = function(context, object, parent): void {
      runWithScopedBlend(this, run, context, quad.solid ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.MULTIPLY, object, parent);
      quad.drawSubmissions++;
    };
    scene.add.existing(this.shader);
    registerGraphicsObject(scene, 'dynamicShadows', this.shader);
  }
  update(player: PlayerEntity): void {
    const sprite = player.displayObject!, path = this.clouds.sunPath;
    const c = Math.cos(sprite.rotation), s = Math.sin(sprite.rotation);
    const sx = sprite.scaleX * sprite.frame.realWidth / manifest.coordinates.bodyCanvasWorldPx;
    const sy = sprite.scaleY * sprite.frame.realHeight / manifest.coordinates.bodyCanvasWorldPx;
    const scaleX = sx * (sprite.flipX ? -1 : 1), scaleY = sy * (sprite.flipY ? -1 : 1);
    const pivotX = (.5 - sprite.originX) * sprite.displayWidth, pivotY = (.5 - sprite.originY) * sprite.displayHeight;
    this.body[0] = sprite.x + c * pivotX - s * pivotY; this.body[1] = sprite.y + s * pivotX + c * pivotY;
    this.transform[0] = c; this.transform[1] = s; this.transform[2] = scaleX; this.transform[3] = scaleY;
    // Reflect the local light too if a presentation ever mirrors the displayed body.
    const dx = path?.direction[0] ?? 1, dy = path?.direction[1] ?? 0;
    const azimuth = characterLightAzimuth((c * dx + s * dy) * Math.sign(scaleX),
      (-s * dx + c * dy) * Math.sign(scaleY), 0);
    selectCharacterShadows(azimuth, path?.elevation ?? 0, this.selection);
    this.strength[0] = characterShadowOpacity(path?.strength ?? 0, path?.elevation ?? 0);
    const pose = displayedShadowPose(sprite.frame.name);
    this.pose = pose;
    let minX = -config.contactRadiusX, minY = -config.contactRadiusY;
    let maxX = config.contactRadiusX as number, maxY = config.contactRadiusY as number;
    for (let i = 0; i < 4; i++) {
      const canvasIndex = this.selection.canvases[i], canvas = manifest.canvases[canvasIndex];
      const sample = characterShadowSample(pose, canvasIndex), page = manifest.pages[sample.page];
      const rect = sample.rect, b = canvas.boundsWorld, out = this.sampleBounds[i], uv = this.sampleUv[i];
      out[0] = b[0]; out[1] = b[1]; out[2] = b[2] - b[0]; out[3] = b[3] - b[1];
      uv[0] = rect[0] / page.width; uv[1] = rect[1] / page.height;
      uv[2] = rect[2] / page.width; uv[3] = rect[3] / page.height;
      this.channels[i] = sample.channel!;
      this.shader.textures[i] = this.shader.scene.textures.get(CHARACTER_SHADOW_FILES[sample.page].key);
      if (this.strength[0] > 0 && this.selection.weights[i] > 0) {
        minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]); maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
      }
    }
    this.strength[2] = sprite.alpha; this.strength[3] = 0;
    const weapon = player.getHeldItemDisplayObject();
    if (weapon?.active && weapon.visible && weapon.alpha > 0 && weapon.scaleX && weapon.scaleY && this.strength[0] > 0) {
      const wc = Math.cos(weapon.rotation), ws = Math.sin(weapon.rotation);
      const w = weapon.frame.realWidth * weapon.scaleX, h = weapon.frame.realHeight * weapon.scaleY;
      const reach = config.weaponGripHeight / Math.tan(path!.elevation);
      const x = weapon.x - dx * reach, y = weapon.y - dy * reach;
      this.weaponPose[0] = x; this.weaponPose[1] = y;
      this.weaponPose[2] = weapon.originX; this.weaponPose[3] = weapon.originY;
      this.weaponAxis[0] = wc / w; this.weaponAxis[1] = ws / w;
      this.weaponAxis[2] = -ws / h; this.weaponAxis[3] = wc / h;
      const frame = weapon.frame;
      this.weaponUv[0] = weapon.flipX ? frame.u1 : frame.u0;
      this.weaponUv[1] = weapon.flipY ? frame.v1 : frame.v0;
      this.weaponUv[2] = (frame.u1 - frame.u0) * (weapon.flipX ? -1 : 1);
      this.weaponUv[3] = (frame.v1 - frame.v0) * (weapon.flipY ? -1 : 1);
      this.shader.textures[4] = weapon.texture; this.strength[3] = Math.min(1, weapon.alpha / sprite.alpha);
      for (let i = 0; i < 4; i++) {
        const wx = ((i % 2) - weapon.originX) * w, wy = (Math.floor(i / 2) - weapon.originY) * h;
        const ox = x + wc * wx - ws * wy - this.body[0], oy = y + ws * wx + wc * wy - this.body[1];
        const lx = (c * ox + s * oy) / scaleX, ly = (-s * ox + c * oy) / scaleY;
        minX = Math.min(minX, lx); minY = Math.min(minY, ly); maxX = Math.max(maxX, lx); maxY = Math.max(maxY, ly);
      }
    }
    this.bounds[0] = minX; this.bounds[1] = minY; this.bounds[2] = maxX - minX; this.bounds[3] = maxY - minY;
    const mx = (minX + maxX) * .5 * scaleX, my = (minY + maxY) * .5 * scaleY;
    this.shader.setPosition(this.body[0] + c * mx - s * my, this.body[1] + s * mx + c * my)
      .setRotation(sprite.rotation).setSize(this.bounds[2], this.bounds[3]).setOrigin(.5)
      .setScale(scaleX, scaleY).setVisible(true);
    // ComputedSize.setSize does not refresh Phaser's cached display origin.
    // Geometry and the fragment's world coordinates must share the same pivot.
  }
  destroy(): void { this.shader.destroy(); }
}

/** World-bound child of the scene ShadowSystem. Shared boot pages are game-owned. */
export class CharacterShadowRenderer {
  private readonly quads = new Map<PlayerEntity, CharacterShadowQuad>();
  private readonly view = createVisibleWorldView();
  private solid = false;
  constructor(private readonly scene: Phaser.Scene, private readonly clouds: SunCloudState,
    readonly receiver: CharacterShadowReceiver) {}
  get count(): number { return this.quads.size; }
  get activeCount(): number { let count = 0; for (const quad of this.quads.values()) if (quad.shader.visible) count++; return count; }
  sync(players: readonly PlayerEntity[], visible: boolean): void {
    const view = getVisibleWorldView(this.scene.cameras.main, this.view, 160);
    for (const [player, quad] of this.quads) if (!players.includes(player)) { quad.destroy(); this.quads.delete(player); }
    for (const quad of this.quads.values()) { quad.seen = false; quad.shader.setVisible(false); }
    for (const player of players) {
      const sprite = player.displayObject, phase = player.getBurrowPhase();
      if (!visible || !sprite?.active || !sprite.visible || sprite.alpha <= 0 || !sprite.scaleX || !sprite.scaleY
        || player.isDecoyStealthedVisual() || phase === 'underground' || phase === 'trapped'
        || sprite.x < view.x || sprite.y < view.y || sprite.x > view.right || sprite.y > view.bottom) continue;
      let quad = this.quads.get(player);
      if (!quad && this.quads.size < config.maxPlayers) {
        quad = new CharacterShadowQuad(this.scene, this.clouds, this.receiver); this.quads.set(player, quad);
      }
      if (quad) { quad.seen = true; quad.solid = this.solid; quad.update(player); }
    }
  }
  setVisible(visible: boolean): void { for (const quad of this.quads.values()) quad.shader.setVisible(visible && quad.seen); }
  setDebugSolid(solid: boolean): void {
    this.solid = solid;
    for (const quad of this.quads.values()) quad.solid = solid;
  }
  /** On demand only; CPU field estimates are labelled, never GPU readbacks per frame. */
  inspect() {
    return { activeInstances: this.activeCount, instances: [...this.quads].map(([player, quad]) => {
      const cloud = cloudDirectFactor(cloudShadowAt(quad.body[0], quad.body[1], this.clouds),
        this.clouds.tuning.cloudDensity, this.clouds.strength);
      const receiver = this.receiver.sample(quad.body[0], quad.body[1]);
      return { playerId: player.id, visible: quad.shader.visible, depth: quad.shader.depth, solid: quad.solid,
        coreDarkeningEstimate: characterShadowCoreDarkening(quad.strength[0], cloud, receiver, quad.strength[2]),
        coreDarkeningAssumptions: 'mask=1, outside foot contact, neutral receiver before grading; CPU cloud at body',
        drawSubmissions: quad.drawSubmissions, pose: quad.pose,
        samples: quad.selection.canvases.map((canvas, i) => ({ canvas, ...characterShadowSample(quad.pose, canvas), weight: quad.selection.weights[i] })),
        position: [quad.shader.x, quad.shader.y], size: [quad.shader.displayWidth, quad.shader.displayHeight],
        displayOrigin: [quad.shader.displayOriginX, quad.shader.displayOriginY], receiverWorld: [...this.receiver.world],
        opacityAtBody: { sun: this.clouds.sunPath?.strength ?? 0, direct: quad.strength[0], cloud, receiver,
          sprite: quad.strength[2], effective: quad.strength[0] * cloud * receiver * quad.strength[2],
          contact: quad.strength[1] * receiver * quad.strength[2],
          estimate: 'CPU cloud at body; per-pixel mask/receiver and cached GPU cloud vary across quad' },
      };
    }) };
  }
  destroy(): void { for (const quad of this.quads.values()) quad.destroy(); this.quads.clear(); this.receiver.destroy(); }
}
