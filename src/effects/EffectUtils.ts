import Phaser from 'phaser';

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
