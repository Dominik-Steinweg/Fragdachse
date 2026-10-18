import * as Phaser from 'phaser';
import { DEPTH, VOID_PALETTE } from '../../config';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import type { FormationCoverageBinding } from '../../arena/rocks/RockFormationLighting';
import type { VoidCreepField } from '../../arena/VoidCreepField';
import type { LightMapAmbientLayer } from '../LightingSystem';
import { SunRenderTarget } from './SunRenderTarget';
import {
  VOID_CREEP_GLOW_FRAGMENT, VOID_CREEP_GLOW_SHADER_NAME, VOID_CREEP_GROUND_FRAGMENT, VOID_CREEP_GROUND_SHADER_NAME,
  VOID_CREEP_ROCK_FRAGMENT, VOID_CREEP_ROCK_SHADER_NAME,
} from './VoidCreepShaders';

/** Light the creep adds at full night, per channel of the void's primary violet. */
const GLOW_STRENGTH = 0.30;
/** World margin around the camera so drifting rims never pop at the screen edge. */
const VIEW_MARGIN_PX = 24;

let nextCreepId = 0;
type Set = (name: string, value: unknown) => void;

/** The creep's night light in light-map space, drawn additively like the moon islands. */
class VoidCreepGlow implements LightMapAmbientLayer {
  private readonly target: SunRenderTarget;
  private readonly image: Phaser.GameObjects.Image;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly world = new Float32Array(4);
  readonly glow = new Float32Array(3);
  private width = 0;
  private height = 0;

  constructor(scene: Phaser.Scene, texture: string, private readonly creep: { frame: Float32Array; time: number }) {
    this.renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    this.target = new SunRenderTarget(scene, 'VoidCreepGlow', VOID_CREEP_GLOW_FRAGMENT, set => {
      set('uCreep', 0); set('uCreepFrame', this.creep.frame); set('uCreepTime', this.creep.time);
      set('uWorld', this.world); set('uGlow', this.glow);
    }, [texture], VOID_CREEP_GLOW_SHADER_NAME);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, this.target.shader.texture!.key)
      .setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
  }

  update(worldX: number, worldY: number, worldWidth: number, worldHeight: number, width: number, height: number):
    Phaser.GameObjects.GameObject | null {
    this.world[0] = worldX; this.world[1] = worldY; this.world[2] = worldWidth; this.world[3] = worldHeight;
    this.renderer.renderNodes.finishBatch();
    this.target.draw(width, height);
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height;
      this.image.setTexture(this.target.shader.texture!.key).setDisplaySize(width, height);
    }
    return this.image;
  }

  destroy(): void { this.image.destroy(); this.target.destroy(); }
}

/**
 * Void creep of one World (GDD Nachtsicht N-6): ink soaking ground and rock tops where the void
 * has taken the flora, and its night glow through the light map. Material layers draw by day and
 * night; the glow only from dusk. Owned by the World's sunlight presentation, which also hands the
 * creep field to the water stain and the spores.
 */
export class VoidCreepPresentation {
  private readonly id = nextCreepId++;
  private key: string | null = null;
  private readonly creep = { frame: new Float32Array(4), time: 0 };
  private readonly view = new Float32Array(4);
  private readonly visible = createVisibleWorldView();
  private readonly rockFrame = new Float32Array(4);
  private ground: Phaser.GameObjects.Shader | null = null;
  private rock: Phaser.GameObjects.Shader | null = null;
  private rockBinding: FormationCoverageBinding | null = null;
  private glow: VoidCreepGlow | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  /** The World's creep field; null releases texture, quads and glow. */
  setCreep(creep: VoidCreepField | null): void {
    this.release();
    if (!creep) return;
    const key = this.key = `__void_creep_${this.id}`;
    const texture = this.scene.textures.createCanvas(key, creep.width, creep.height);
    if (!texture) throw new Error('[VoidCreepPresentation] Cannot allocate the creep field');
    const pixels = texture.context.createImageData(creep.width, creep.height);
    for (let i = 0; i < creep.data.length; i++) {
      pixels.data[i * 4] = creep.data[i]; pixels.data[i * 4 + 1] = creep.land[i]; pixels.data[i * 4 + 3] = 255;
    }
    texture.context.putImageData(pixels, 0, 0); texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.creep.frame.set([creep.offsetX, creep.offsetY, creep.width * creep.texelPx, creep.height * creep.texelPx]);
    this.ground = this.makeQuad(VOID_CREEP_GROUND_SHADER_NAME, VOID_CREEP_GROUND_FRAGMENT, DEPTH.VOID_CREEP, [key], () => {});
  }

  /**
   * Follows the camera and returns the light-map layer for this frame (null by day, on low
   * quality or without creep). `night` 0..1 follows the lamps' dusk curve.
   */
  update(camera: Phaser.Cameras.Scene2D.Camera, timeSec: number, night: number,
    options: { rocks: boolean; glow: boolean }, coverage: FormationCoverageBinding | null): LightMapAmbientLayer | null {
    if (!this.key || !this.ground) return null;
    this.creep.time = timeSec;
    // The arena camera uses origin (0, 0); Phaser's cached worldView assumes 0.5.
    const view = getVisibleWorldView(camera, this.visible, VIEW_MARGIN_PX);
    this.view[0] = view.x; this.view[1] = view.y; this.view[2] = view.width; this.view[3] = view.height;
    this.place(this.ground);
    this.syncRock(options.rocks ? coverage : null);
    if (!options.glow || night <= .01) return null;
    this.glow ??= new VoidCreepGlow(this.scene, this.key, this.creep);
    const [r, g, b] = [(VOID_PALETTE.primary >> 16) & 255, (VOID_PALETTE.primary >> 8) & 255, VOID_PALETTE.primary & 255];
    const strength = GLOW_STRENGTH * Math.min(1, night) / 255;
    this.glow.glow[0] = r * strength; this.glow.glow[1] = g * strength; this.glow.glow[2] = b * strength;
    return this.glow;
  }

  destroy(): void { this.release(); }

  private syncRock(coverage: FormationCoverageBinding | null): void {
    if (!coverage) { this.rock?.setVisible(false); return; }
    if (!this.rock) {
      this.rock = this.makeQuad(VOID_CREEP_ROCK_SHADER_NAME, VOID_CREEP_ROCK_FRAGMENT, DEPTH.ROCK_VOID_CREEP,
        [this.key!, coverage.field.key, coverage.lookup.key], set => {
          set('uRockField', 1); set('uRockLookup', 2); set('uRockFrame', this.rockFrame);
        });
      this.rockBinding = coverage;
    } else if (this.rockBinding !== coverage) {
      this.rock.setTextures([this.key!, coverage.field.key, coverage.lookup.key]);
      this.rockBinding = coverage;
    }
    for (let i = 0; i < 4; i++) this.rockFrame[i] = coverage.frame[i];
    this.place(this.rock.setVisible(true));
  }

  private place(quad: Phaser.GameObjects.Shader): void {
    quad.setPosition(this.view[0], this.view[1]).setDisplaySize(this.view[2], this.view[3]);
  }

  private makeQuad(name: string, fragmentSource: string, depth: number, textures: string[], extra: (set: Set) => void):
    Phaser.GameObjects.Shader {
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name, shaderName: name, fragmentSource,
      setupUniforms: (set: Set) => {
        set('uCreep', 0); set('uCreepFrame', this.creep.frame); set('uCreepTime', this.creep.time); set('uView', this.view);
        extra(set);
      },
    }, 0, 0, 1, 1, textures);
    const node = quad.renderNode;
    if (node) quad.once('destroy', () => disposeShaderWarmupNode(node));
    quad.setOrigin(0).setDepth(depth).setBlendMode(Phaser.BlendModes.NORMAL);
    this.scene.add.existing(quad);
    return quad;
  }

  private release(): void {
    this.ground?.destroy(); this.ground = null;
    this.rock?.destroy(); this.rock = null; this.rockBinding = null;
    this.glow?.destroy(); this.glow = null;
    if (this.key) { this.scene.textures.remove(this.key); this.key = null; }
  }
}
