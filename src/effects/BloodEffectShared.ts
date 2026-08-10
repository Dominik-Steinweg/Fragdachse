import * as Phaser from 'phaser';
import { BLOOD_HIT_VFX, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createSeededRandom, ensureCanvasTexture } from './EffectUtils';

export const TEX_BLOOD_DROPLET = '__blood_droplet';
export const TEX_BLOOD_STREAK = '__blood_streak';
export const TEX_BLOOD_STAIN = '__blood_stain';

export const TEX_BLOOD_EDGE_TOP    = '__blood_edge_top';
export const TEX_BLOOD_EDGE_BOTTOM = '__blood_edge_bottom';
export const TEX_BLOOD_EDGE_LEFT   = '__blood_edge_left';
export const TEX_BLOOD_EDGE_RIGHT  = '__blood_edge_right';
export const TEX_BLOOD_SPECKLE     = '__blood_speckle';

const activeBloodStains: Phaser.GameObjects.Image[] = [];

function pruneDestroyedBloodStains(): void {
  for (let index = activeBloodStains.length - 1; index >= 0; index -= 1) {
    const stain = activeBloodStains[index];
    if (!stain?.active) {
      activeBloodStains.splice(index, 1);
    }
  }
}

function unregisterBloodStain(stain: Phaser.GameObjects.Image): void {
  const index = activeBloodStains.indexOf(stain);
  if (index >= 0) {
    activeBloodStains.splice(index, 1);
  }
}

function resolveTextures(target: Phaser.Scene | Phaser.Textures.TextureManager): Phaser.Textures.TextureManager {
  return 'textures' in target ? target.textures : target;
}

export function ensureBloodHitTextures(target: Phaser.Scene | Phaser.Textures.TextureManager): void {
  const textures = resolveTextures(target);

  ensureCanvasTexture(textures, TEX_BLOOD_DROPLET, 14, 14, (ctx) => {
    const gradient = ctx.createRadialGradient(7, 7, 1, 7, 7, 7);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.65, 'rgba(255,255,255,0.78)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(7, 7, 6.2, 0, Math.PI * 2);
    ctx.fill();
  });

  ensureCanvasTexture(textures, TEX_BLOOD_STREAK, 36, 16, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(20, 8, 12, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.beginPath();
    ctx.ellipse(11, 8, 8, 2.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.46)';
    ctx.beginPath();
    ctx.ellipse(5, 8, 4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ensureCanvasTexture(textures, TEX_BLOOD_STAIN, 42, 42, (ctx) => {
    const circles: Array<{ x: number; y: number; r: number; alpha: number }> = [
      { x: 18, y: 16, r: 8, alpha: 0.9 },
      { x: 24, y: 20, r: 10, alpha: 0.75 },
      { x: 14, y: 24, r: 7, alpha: 0.58 },
      { x: 28, y: 27, r: 6, alpha: 0.52 },
    ];

    for (const circle of circles) {
      ctx.fillStyle = `rgba(255,255,255,${circle.alpha})`;
      ctx.beginPath();
      ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * Bildschirmrand-Blut: dieselbe Formsprache wie die Trefferspritzer oben, nur in
 * Bildschirmmaßstab. Der gerade Verlauf allein liest sich als Rahmen; erst die unregelmäßige
 * Innenkante aus überlappenden weichen Blobs und die nach innen zeigenden Läufer machen daraus
 * Blut, das am Rand klebt.
 *
 * Alle Texturen sind rein weiß – die Farbe kommt beim Verwender aus `setTint()`, damit derselbe
 * Satz sowohl den Dauerzustand bei wenig Leben als auch die kurze Schadensvignette trägt.
 */

type BloodEdgeSide = 'top' | 'bottom' | 'left' | 'right';

/** Feste Seeds: die Textur muss über Sitzungen und Clients identisch aussehen. */
const BLOOD_EDGE_SEEDS: Readonly<Record<BloodEdgeSide, number>> = {
  top: 0x51a3d7,
  bottom: 0x2f8c14,
  left: 0x7ac1e9,
  right: 0x13d46b,
};

const BLOOD_EDGE_TEXTURE_KEYS: Readonly<Record<BloodEdgeSide, string>> = {
  top: TEX_BLOOD_EDGE_TOP,
  bottom: TEX_BLOOD_EDGE_BOTTOM,
  left: TEX_BLOOD_EDGE_LEFT,
  right: TEX_BLOOD_EDGE_RIGHT,
};

interface BloodEdgeFrame {
  /** Länge der Kante in Kantenkoordinaten. */
  readonly length: number;
  /** Eindringtiefe nach innen. */
  readonly depth: number;
  /** `setTransform`-Matrix, die Kantenkoordinaten (entlang, nach innen) auf die Leinwand legt. */
  readonly transform: readonly [number, number, number, number, number, number];
}

/**
 * Alle vier Kanten werden in derselben Kantenkoordinate gezeichnet: x läuft entlang der Kante,
 * y nach innen. Die Matrix dreht bzw. spiegelt das anschließend an seinen Platz – sonst gäbe es
 * vier fast gleiche Zeichenroutinen, die auseinanderlaufen.
 */
function resolveBloodEdgeFrame(side: BloodEdgeSide): BloodEdgeFrame {
  const verticalDepth = GAME_HEIGHT * 0.34;
  const horizontalDepth = GAME_WIDTH * 0.20;

  switch (side) {
    case 'top':
      return { length: GAME_WIDTH, depth: verticalDepth, transform: [1, 0, 0, 1, 0, 0] };
    case 'bottom':
      return { length: GAME_WIDTH, depth: verticalDepth, transform: [1, 0, 0, -1, 0, GAME_HEIGHT] };
    case 'left':
      return { length: GAME_HEIGHT, depth: horizontalDepth, transform: [0, 1, 1, 0, 0, 0] };
    case 'right':
      return { length: GAME_HEIGHT, depth: horizontalDepth, transform: [0, 1, -1, 0, GAME_WIDTH, 0] };
  }
}

/**
 * Weicher elliptischer Fleck. Der Radialverlauf wird im Einheitskreis aufgebaut und über die
 * Transformation gestreckt – so trägt dieselbe Routine sowohl runde Blobs als auch langgezogene
 * Läufer, ohne dass eine harte Ellipsenkante entsteht.
 */
function fillSoftBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(Math.max(0.001, radiusX), Math.max(0.001, radiusY));

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBloodEdge(ctx: CanvasRenderingContext2D, side: BloodEdgeSide): void {
  const frame = resolveBloodEdgeFrame(side);
  const rng = createSeededRandom(BLOOD_EDGE_SEEDS[side]);
  const { length, depth } = frame;

  ctx.save();
  ctx.setTransform(...frame.transform);

  // Grundfläche: der großflächige, eingesickerte Anteil. Bewusst unter voller Deckkraft, damit
  // die Blobs darüber die Kontur bestimmen und nicht nur einen geraden Verlauf überzeichnen.
  const field = ctx.createLinearGradient(0, 0, 0, depth);
  field.addColorStop(0, 'rgba(255,255,255,0.78)');
  field.addColorStop(0.5, 'rgba(255,255,255,0.36)');
  field.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, length, depth);

  // Unregelmäßige Innenkante.
  for (let i = 0; i < 30; i += 1) {
    const radius = depth * (0.32 + rng() * 0.78);
    fillSoftBlob(
      ctx,
      rng() * length,
      depth * 0.06 * rng(),
      radius * (0.75 + rng() * 0.6),
      radius,
      (rng() - 0.5) * 0.5,
      0.24 + rng() * 0.18,
    );
  }

  // Läufer nach innen – die Kometenform der Trefferstreifen, nur lang und schwach.
  for (let i = 0; i < 9; i += 1) {
    fillSoftBlob(
      ctx,
      rng() * length,
      depth * (0.10 + rng() * 0.35),
      20 + rng() * 32,
      depth * (0.50 + rng() * 0.90),
      (rng() - 0.5) * 0.4,
      0.16 + rng() * 0.16,
    );
  }

  ctx.restore();
}

function drawBloodSpeckle(ctx: CanvasRenderingContext2D): void {
  const rng = createSeededRandom(0x4d1f07);

  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const frame = resolveBloodEdgeFrame(side);
    ctx.save();
    ctx.setTransform(...frame.transform);

    for (let i = 0; i < 40; i += 1) {
      // Quadratische Verteilung nach innen: die Tropfen sitzen dicht am Rand und werden zur
      // Bildmitte hin schnell seltener, ohne dass eine sichtbare Grenze entsteht.
      const inward = frame.depth * 1.3 * rng() * rng();
      // Größenmischung: wenige fette Tropfen zwischen vielen kleinen. Gleich große Punkte
      // lesen sich als Raster, nicht als Spritzer.
      const radius = (rng() < 0.22 ? 9 + rng() * 11 : 3 + rng() * 7);
      fillSoftBlob(
        ctx,
        rng() * frame.length,
        inward,
        radius,
        radius * (1 + rng() * 1.7),
        (rng() - 0.5) * 1.2,
        0.62 + rng() * 0.38,
      );
    }

    ctx.restore();
  }
}

/**
 * Fünf bildschirmgroße Texturen. Sie werden einmal je Szene gebaut und von der
 * Blutdarstellung bei wenig Leben sowie von der Schadensvignette geteilt.
 */
export function ensureBloodEdgeTextures(target: Phaser.Scene | Phaser.Textures.TextureManager): void {
  const textures = resolveTextures(target);

  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    ensureCanvasTexture(textures, BLOOD_EDGE_TEXTURE_KEYS[side], GAME_WIDTH, GAME_HEIGHT, (ctx) => {
      drawBloodEdge(ctx, side);
    });
  }

  ensureCanvasTexture(textures, TEX_BLOOD_SPECKLE, GAME_WIDTH, GAME_HEIGHT, (ctx) => {
    drawBloodSpeckle(ctx);
  });
}

export interface BloodStainSpawnConfig {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  fadeMs: number;
  tint: number;
  rotation: number;
  depth: number;
  stainDelayMs: number;
}

export function spawnBloodStain(scene: Phaser.Scene, config: BloodStainSpawnConfig): Phaser.GameObjects.Image {
  pruneDestroyedBloodStains();
  while (activeBloodStains.length >= BLOOD_HIT_VFX.maxActiveStains) {
    const oldest = activeBloodStains.shift();
    oldest?.destroy();
  }

  const stain = scene.add.image(config.x, config.y, TEX_BLOOD_STAIN)
    .setDepth(config.depth)
    .setTint(config.tint)
    .setAlpha(0)
    .setScale(config.scale * 0.82)
    .setRotation(config.rotation);

  activeBloodStains.push(stain);
  stain.once(Phaser.GameObjects.Events.DESTROY, () => unregisterBloodStain(stain));

  scene.tweens.add({
    targets: stain,
    alpha: config.alpha,
    scaleX: config.scale,
    scaleY: config.scale,
    duration: 80,
    ease: 'Quad.easeOut',
  });

  scene.tweens.add({
    targets: stain,
    alpha: 0,
    delay: config.stainDelayMs,
    duration: config.fadeMs,
    ease: 'Sine.easeIn',
    onComplete: () => stain.destroy(),
  });

  return stain;
}