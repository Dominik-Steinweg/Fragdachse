import { COOP_DEFENSE_ENEMY_CONFIGS } from '../config/coopDefenseEnemies';
import { PIPELINE_ASSETS, type EyeAnchor, type EyeAnchorFrame } from '../config/pipelineAssets';

export interface EyeSpritePose {
  readonly x: number; readonly y: number; readonly rotation: number;
  readonly scaleX: number; readonly scaleY: number;
  readonly displayOriginX: number; readonly displayOriginY: number;
  readonly flipX: boolean; readonly flipY: boolean;
  readonly visible: boolean; readonly active: boolean; readonly alpha: number;
  readonly texture: { readonly key: string };
  readonly frame: { readonly name: string | number; readonly realWidth: number; readonly realHeight: number };
}
export interface EnemyEyeSource {
  readonly kind: string;
  readonly faction: 'hostile' | 'allied';
  readonly sprite: EyeSpritePose;
  getHp(): number;
}
export interface EnemyEyeLight {
  x: number; y: number; color: number; radiusPx: number; intensity: number;
  /** Optional denser pool at the same centre, drawn on top of the wide light. */
  innerRadiusPx?: number; innerIntensity?: number;
}
export interface EnemyEyePose {
  x: number; y: number; width: number; height: number; rotation: number; alpha: number; color: number;
  /** Bloom diameter around the eye; follows the enemy's size, not the tiny eye ellipse. */
  glowPx: number;
  /** Stable per-enemy phase so neighbouring enemies never pulse in lockstep. */
  phase: number;
}
export interface EnemyEyeLightFrame { readonly lights: readonly EnemyEyeLight[]; readonly lightCount: number }
export interface EyeView { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

// Ground light at full darkness (the sky fades it by day): a wide coloured spill that also
// lifts the enemy's silhouette out of the night, plus a denser pool around the eyes.
const LIGHT_RADIUS_PER_SIZE = 1.45, LIGHT_RADIUS_MIN = 52, LIGHT_RADIUS_MAX = 170;
const LIGHT_INTENSITY = .5, INNER_RADIUS_RATIO = .42, INNER_INTENSITY = .55;
/** Pulls the light from the eyes towards the body pivot so the whole silhouette is lit. */
const LIGHT_BODY_PULL = .35;
const GLOW_PER_SIZE = .5, GLOW_MIN = 14, GLOW_MAX = 46;
const GOLDEN_ANGLE = 2.399963;

const anchorsByTexture = new Map<string, { frames: readonly EyeAnchorFrame[]; static: boolean }>();
for (const asset of PIPELINE_ASSETS) {
  if (!asset.eyeAnchors) continue;
  anchorsByTexture.set(asset.textureKey, { frames: asset.eyeAnchors.frames, static: true });
  anchorsByTexture.set(asset.sheetTextureKey, { frames: asset.eyeAnchors.frames, static: false });
}

/** A pure, reusable frame buffer: owns no entities, animation clocks or gameplay state. */
export class EnemyEyeGlowModel implements EnemyEyeLightFrame {
  readonly eyes: EnemyEyePose[] = [];
  readonly lights: EnemyEyeLight[] = [];
  eyeCount = 0;
  lightCount = 0;
  private readonly phases = new WeakMap<object, number>();
  private nextPhase = 0;

  clear(): void { this.eyeCount = 0; this.lightCount = 0; }

  update(enemies: readonly EnemyEyeSource[], view: EyeView): void {
    this.clear();
    for (const enemy of enemies) {
      const sprite = enemy.sprite;
      if (enemy.faction !== 'hostile' || !sprite.active || !sprite.visible || sprite.alpha <= 0 || enemy.getHp() <= 0) continue;
      const style = COOP_DEFENSE_ENEMY_CONFIGS[enemy.kind]?.eyeGlow;
      const asset = anchorsByTexture.get(sprite.texture.key);
      const frame = asset?.frames[asset.static ? 0 : Number(sprite.frame.name)];
      if (!style || !frame) continue;
      const size = Math.max(Math.abs(sprite.frame.realWidth * sprite.scaleX), Math.abs(sprite.frame.realHeight * sprite.scaleY));
      const radius = Math.max(LIGHT_RADIUS_MIN, Math.min(LIGHT_RADIUS_MAX, size * LIGHT_RADIUS_PER_SIZE));
      // Include the head's offset from the pivot and the full light footprint.
      const margin = radius + size;
      if (sprite.x + margin < view.x || sprite.y + margin < view.y
          || sprite.x - margin > view.x + view.width || sprite.y - margin > view.y + view.height) continue;
      const glow = Math.max(GLOW_MIN, Math.min(GLOW_MAX, size * GLOW_PER_SIZE));
      const phase = this.phaseOf(sprite);
      const left = this.eye(this.eyeCount++);
      const right = this.eye(this.eyeCount++);
      writeEyePose(left, frame.left, sprite, style.color);
      writeEyePose(right, frame.right, sprite, style.color);
      left.glowPx = right.glowPx = glow; left.phase = right.phase = phase;
      const light = this.lights[this.lightCount] ?? (this.lights[this.lightCount] = { x: 0, y: 0, color: 0, radiusPx: 0, intensity: 0 });
      this.lightCount++;
      const eyeX = (left.x + right.x) * .5, eyeY = (left.y + right.y) * .5;
      light.x = eyeX + (sprite.x - eyeX) * LIGHT_BODY_PULL; light.y = eyeY + (sprite.y - eyeY) * LIGHT_BODY_PULL;
      light.color = style.color; light.radiusPx = radius; light.intensity = LIGHT_INTENSITY * sprite.alpha;
      light.innerRadiusPx = radius * INNER_RADIUS_RATIO; light.innerIntensity = INNER_INTENSITY * sprite.alpha;
    }
  }

  private eye(index: number): EnemyEyePose {
    return this.eyes[index] ?? (this.eyes[index] = { x: 0, y: 0, width: 0, height: 0, rotation: 0, alpha: 0, color: 0, glowPx: 0, phase: 0 });
  }

  /** Keyed by the displayed sprite, which lives exactly as long as the enemy's visual. */
  private phaseOf(sprite: object): number {
    let phase = this.phases.get(sprite);
    if (phase === undefined) {
      phase = this.nextPhase;
      this.nextPhase = (this.nextPhase + GOLDEN_ANGLE) % (Math.PI * 2);
      this.phases.set(sprite, phase);
    }
    return phase;
  }
}

export function writeEyePose(out: EnemyEyePose, eye: EyeAnchor, sprite: EyeSpritePose, color: number): void {
  const co = Math.cos(sprite.rotation), si = Math.sin(sprite.rotation);
  const sx = sprite.scaleX, sy = sprite.scaleY;
  const fx = sprite.flipX ? -1 : 1, fy = sprite.flipY ? -1 : 1;
  const dx = ((sprite.flipX ? 1 - eye.x : eye.x) * sprite.frame.realWidth - sprite.displayOriginX) * sx;
  const dy = ((sprite.flipY ? 1 - eye.y : eye.y) * sprite.frame.realHeight - sprite.displayOriginY) * sy;
  out.x = sprite.x + co * dx - si * dy;
  out.y = sprite.y + si * dx + co * dy;
  // Transform the ellipse covariance, including reflection and non-uniform scaling.
  const ec = Math.cos(eye.rotation), es = Math.sin(eye.rotation);
  const ax = ec * eye.width * sprite.frame.realWidth * sx * fx;
  const ay = es * eye.width * sprite.frame.realHeight * sy * fy;
  const bx = -es * eye.height * sprite.frame.realWidth * sx * fx;
  const by = ec * eye.height * sprite.frame.realHeight * sy * fy;
  const xx = ax * ax + bx * bx, yy = ay * ay + by * by, xy = ax * ay + bx * by;
  const d = Math.hypot(xx - yy, 2 * xy);
  // Preserve a narrow, readable core at native game size, including subpixel positions.
  out.width = Math.max(2, Math.sqrt(Math.max(0, (xx + yy + d) * .5)));
  out.height = Math.max(1.3, Math.sqrt(Math.max(0, (xx + yy - d) * .5)));
  out.rotation = sprite.rotation + .5 * Math.atan2(2 * xy, xx - yy);
  out.alpha = sprite.alpha; out.color = color;
}
