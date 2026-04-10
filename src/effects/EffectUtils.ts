import * as Phaser from 'phaser';

type CanvasTextureDrawCallback = (
  ctx: CanvasRenderingContext2D,
  canvas: Phaser.Textures.CanvasTexture,
) => void;

type RadialGradientStop = readonly [offset: number, color: string];

/**
 * Shared helpers for effect/particle systems.
 * Avoids duplicate circleZone/edgeZone implementations across FireSystem, SmokeSystem, etc.
 */

/** Random circular emit zone (Partikel spawnen zufällig innerhalb des Kreises). */
export function circleZone(r: number, quantity?: number): Phaser.Types.GameObjects.Particles.EmitZoneData {
  return {
    type:     'random',
    source:   new Phaser.Geom.Circle(0, 0, r),
    ...(quantity !== undefined && { quantity }),
  } as Phaser.Types.GameObjects.Particles.EmitZoneData;
}

/** Edge emit zone: Partikel spawnen gleichmäßig auf dem Kreisrand. */
export function edgeZone(r: number, quantity = 32): Phaser.Types.GameObjects.Particles.EmitZoneData {
  return {
    type:     'edge',
    source:   new Phaser.Geom.Circle(0, 0, r),
    quantity,
  } as Phaser.Types.GameObjects.Particles.EmitZoneData;
}

export function ensureCanvasTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  width: number,
  height: number,
  draw: CanvasTextureDrawCallback,
): void {
  if (textures.exists(key)) return;

  const canvas = textures.createCanvas(key, width, height)!;
  draw(canvas.context, canvas);
  canvas.refresh();
}

export function fillRadialGradientTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  size: number,
  stops: readonly RadialGradientStop[],
): void {
  ensureCanvasTexture(textures, key, size, size, (ctx) => {
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);

    for (const [offset, color] of stops) {
      gradient.addColorStop(offset, color);
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

export function createEmitter(
  scene: Phaser.Scene,
  x: number,
  y: number,
  texture: string,
  config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
  depth: number,
): Phaser.GameObjects.Particles.ParticleEmitter {
  const emitter = scene.add.particles(x, y, texture, config);
  emitter.setDepth(depth);
  return emitter;
}

export function setCircleEmitZone(
  emitter: Phaser.GameObjects.Particles.ParticleEmitter,
  radius: number,
  quantity?: number,
  replace = false,
): void {
  if (replace) {
    emitter.clearEmitZones();
  }

  emitter.addEmitZone(circleZone(radius, quantity));
}

export function configureAdditiveImage(
  image: Phaser.GameObjects.Image,
  depth: number,
  alpha: number,
  tint: number,
): Phaser.GameObjects.Image {
  return image
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(depth)
    .setAlpha(alpha)
    .setTint(tint);
}

export function destroyEmitter(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
  emitter.stop();
  emitter.destroy();
}

export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixColors(colorA: number, colorB: number, amount: number): number {
  const t = Phaser.Math.Clamp(amount, 0, 1);
  const ar = (colorA >> 16) & 0xff;
  const ag = (colorA >> 8) & 0xff;
  const ab = colorA & 0xff;
  const br = (colorB >> 16) & 0xff;
  const bg = (colorB >> 8) & 0xff;
  const bb = colorB & 0xff;

  const rr = Math.round(Phaser.Math.Linear(ar, br, t));
  const rg = Math.round(Phaser.Math.Linear(ag, bg, t));
  const rb = Math.round(Phaser.Math.Linear(ab, bb, t));
  return (rr << 16) | (rg << 8) | rb;
}
