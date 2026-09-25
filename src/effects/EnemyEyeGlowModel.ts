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
}
export interface EnemyEyePose {
  x: number; y: number; width: number; height: number; rotation: number; alpha: number; color: number;
}
export interface EnemyEyeLightFrame { readonly lights: readonly EnemyEyeLight[]; readonly lightCount: number }
export interface EyeView { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

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
      const radius = Math.max(24, Math.min(48, size));
      // Include the head's offset from the pivot and the full light footprint.
      const margin = radius + size;
      if (sprite.x + margin < view.x || sprite.y + margin < view.y
          || sprite.x - margin > view.x + view.width || sprite.y - margin > view.y + view.height) continue;
      const left = this.eye(this.eyeCount++);
      const right = this.eye(this.eyeCount++);
      writeEyePose(left, frame.left, sprite, style.color);
      writeEyePose(right, frame.right, sprite, style.color);
      const light = this.lights[this.lightCount] ?? (this.lights[this.lightCount] = { x: 0, y: 0, color: 0, radiusPx: 0, intensity: 0 });
      this.lightCount++;
      light.x = (left.x + right.x) * .5; light.y = (left.y + right.y) * .5;
      light.color = style.color; light.radiusPx = radius; light.intensity = .18 * sprite.alpha;
    }
  }

  private eye(index: number): EnemyEyePose {
    return this.eyes[index] ?? (this.eyes[index] = { x: 0, y: 0, width: 0, height: 0, rotation: 0, alpha: 0, color: 0 });
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
  out.width = Math.max(1.6, Math.sqrt(Math.max(0, (xx + yy + d) * .5)));
  out.height = Math.max(1, Math.sqrt(Math.max(0, (xx + yy - d) * .5)));
  out.rotation = sprite.rotation + .5 * Math.atan2(2 * xy, xx - yy);
  out.alpha = sprite.alpha; out.color = color;
}
