import * as Phaser from 'phaser';
import { DEPTH, DEPTH_FX } from '../config';
import { scaleParticleCount } from '../graphics/GraphicsQuality';
import { emissiveAlpha } from './EmissiveScale';
import { ensureCanvasTexture } from './EffectUtils';

const TEX_EMBLEM_LINE = '__holy_blast_emblem_line';
const TEX_EMBLEM_GLOW = '__holy_blast_emblem_glow';
const TEX_EMBLEM_SHADE = '__holy_blast_emblem_shade';
const TEX_SUNBURST = '__holy_blast_sunburst';
const TEX_JEWEL_RING = '__holy_blast_jewel_ring';
const TEX_SOFT_RING = '__holy_blast_soft_ring';
const TEX_GLOW = '__holy_blast_glow';
const TEX_FEATHER = '__holy_blast_feather';
const TEX_STAR = '__holy_blast_star';

/** Emblem-Leinwand: Reichsapfel mit Kreuz; der Ursprung liegt im Zentrum der Kugel. */
const EMBLEM_W = 512;
const EMBLEM_H = 680;
const EMBLEM_ORB_Y = 424;
const EMBLEM_ORB_R = 150;
const SUNBURST_SIZE = 512;
const JEWEL_RING_SIZE = 512;
const JEWEL_RING_R = 236;
const SOFT_RING_SIZE = 256;
const SOFT_RING_R = 121;
const GLOW_SIZE = 128;

/** Anteil des Schadensradius, den die Kugel des Emblems einnimmt; das Kreuz ragt bis ~0.93 r. */
const EMBLEM_ORB_RADIUS_FACTOR = 0.4;

const GOLD_HOT = 0xffe7a0;
const GOLD_BODY = 0xffc94a;
const GOLD_DEEP = 0x7a4a0c;
const HOLY_WHITE = 0xfffbea;

type EmblemMode = 'line' | 'glow' | 'shade';

/**
 * Signatur-Explosion der Heiligen Handgranate.
 *
 * Die generische GPU-Explosion liefert Funken, Glut und die aufsteigende Krone. Dieser Renderer
 * legt die Form darüber: ein Siegel aus Licht in Gestalt der Granate selbst (Reichsapfel mit
 * Juwelenband und Kreuz), Gottesstrahlen, ein Nimbus-Juwelenring, der Druckring bis zum
 * Schadensradius, funkelnde Lichtsterne, Engelsfedern und ein kurz nachglühender, geweihter
 * Boden. Rein lokale Darstellung; alle Objekte sind kurzlebig und werden in `clear()` geräumt.
 */
export class HolyExplosionRenderer {
  private readonly active = new Set<Phaser.GameObjects.Image>();
  private texturesReady = false;

  constructor(private readonly scene: Phaser.Scene) {}

  play(x: number, y: number, radius: number): void {
    if (radius <= 0) return;
    this.ensureTextures();

    this.spawnPillar(x, y, radius);
    this.spawnAfterglow(x, y, radius);
    this.spawnSunburst(x, y, radius);
    this.spawnShockRings(x, y, radius);
    this.spawnNimbus(x, y, radius);
    this.spawnEmblem(x, y, radius);
    this.spawnConsecratedGround(x, y, radius);
    this.spawnFeathers(x, y, radius);
    this.spawnTwinkles(x, y, radius);
  }

  /** World-Wechsel und Scene-Ende: keine Heiligenscheine in Lobby oder nächster Runde. */
  clear(): void {
    for (const image of this.active) {
      this.scene.tweens.killTweensOf(image);
      image.destroy();
    }
    this.active.clear();
  }

  getActiveObjectCount(): number {
    return this.active.size;
  }

  // ── Phasen ────────────────────────────────────────────────────────────────

  /** Lichtsäule von oben: gleißender Kern, der sich nach dem Einschlag zusammenzieht. */
  private spawnPillar(x: number, y: number, radius: number): void {
    const glowRadius = GLOW_SIZE / 2;
    const flash = this.image(x, y, TEX_GLOW, DEPTH_FX + 0.9, true, 1, 0xffffff);
    flash.setScale(radius * 0.18 / glowRadius);
    this.tween(flash, {
      scale: radius * 1.05 / glowRadius,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
    });

    // Bewusst kleiner als die Kugel des Siegels: sonst überstrahlt die Säule Band und Edelsteine.
    const pillar = this.image(x, y, TEX_GLOW, DEPTH_FX + 0.6, true, 0.85, 0xfff3c8);
    pillar.setScale(radius * 0.24 / glowRadius);
    this.tween(pillar, {
      scale: radius * 0.04 / glowRadius,
      alpha: 0,
      duration: 480,
      ease: 'Sine.easeIn',
    });
  }

  /**
   * Warmes Nachleuchten über dem gesamten Wirkungsbereich. Liegt über der Lightmap und hellt
   * den Bereich deshalb auch gegen das Nacht-Grading sichtbar auf; `emissiveAlpha` nimmt es
   * zum Tag hin zurück, wo das Umgebungslicht ohnehin hell ist.
   */
  private spawnAfterglow(x: number, y: number, radius: number): void {
    const glowRadius = GLOW_SIZE / 2;
    const afterglow = this.image(x, y, TEX_GLOW, DEPTH_FX - 0.12, true, 0, 0xffd890);
    afterglow.setScale(radius * 1.25 / glowRadius);
    this.tween(afterglow, { alpha: emissiveAlpha(0.5), duration: 120, ease: 'Quad.easeOut' });
    this.tween(afterglow, { alpha: 0, delay: 950, duration: 650, ease: 'Sine.easeIn' }, true);
  }

  /** Zwei gegenläufig drehende Strahlenkränze hinter dem Emblem. */
  private spawnSunburst(x: number, y: number, radius: number): void {
    const layers = [
      { scale: radius * 2.3 / SUNBURST_SIZE, tint: GOLD_HOT, alpha: 0.82, spin: 0.55, rotation: 0 },
      { scale: radius * 1.55 / SUNBURST_SIZE, tint: HOLY_WHITE, alpha: 0.5, spin: -0.4, rotation: Math.PI / 24 },
    ];
    for (const layer of layers) {
      const rays = this.image(x, y, TEX_SUNBURST, DEPTH_FX - 0.08, true, 0, layer.tint);
      rays.setRotation(layer.rotation).setScale(layer.scale * 0.35);
      this.tween(rays, { scale: layer.scale, duration: 520, ease: 'Cubic.easeOut' });
      this.tween(rays, { rotation: layer.rotation + layer.spin, duration: 1300, ease: 'Sine.easeOut' });
      this.tween(rays, { alpha: emissiveAlpha(layer.alpha), duration: 90, ease: 'Quad.easeOut' });
      this.tween(rays, { alpha: 0, delay: 480, duration: 720, ease: 'Quad.easeIn' }, true);
    }
  }

  /** Druckwelle exakt bis zum Schadensradius, gefolgt von einem goldenen Nachläufer. */
  private spawnShockRings(x: number, y: number, radius: number): void {
    const front = this.image(x, y, TEX_SOFT_RING, DEPTH_FX + 0.05, true, 1, HOLY_WHITE);
    front.setScale(radius * 0.08 / SOFT_RING_R);
    this.tween(front, {
      scale: radius / SOFT_RING_R,
      alpha: 0,
      duration: 560,
      ease: 'Cubic.easeOut',
    }, true);

    const trail = this.image(x, y, TEX_SOFT_RING, DEPTH_FX + 0.04, true, 0.85, GOLD_BODY);
    trail.setScale(radius * 0.05 / SOFT_RING_R).setAlpha(0);
    this.tween(trail, { alpha: emissiveAlpha(0.85), delay: 90, duration: 60 });
    this.tween(trail, {
      scale: radius * 1.04 / SOFT_RING_R,
      delay: 90,
      duration: 780,
      ease: 'Quart.easeOut',
    });
    this.tween(trail, { alpha: 0, delay: 360, duration: 510, ease: 'Quad.easeIn' }, true);
  }

  /** Juwelenring als Nimbus: greift das edelsteinbesetzte Band der Granate auf. */
  private spawnNimbus(x: number, y: number, radius: number): void {
    const target = radius * 0.72 / JEWEL_RING_R;

    const shade = this.image(x, y, TEX_JEWEL_RING, DEPTH_FX + 0.38, false, 0, GOLD_DEEP);
    const ring = this.image(x, y, TEX_JEWEL_RING, DEPTH_FX + 0.4, true, 0, GOLD_HOT);
    for (const [image, alpha] of [[shade, 0.42], [ring, emissiveAlpha(1)]] as const) {
      image.setScale(target * 0.55);
      this.tween(image, { scale: target, duration: 460, delay: 40, ease: 'Back.easeOut' });
      this.tween(image, { rotation: 0.45, duration: 1300, ease: 'Sine.easeOut' });
      this.tween(image, { alpha, delay: 40, duration: 110 });
      this.tween(image, { alpha: 0, delay: 700, duration: 500, ease: 'Quad.easeIn' }, true);
    }
  }

  /**
   * Die Heilige Handgranate selbst als Lichtsiegel. Die abgedunkelte Unterlage hält Kontur und
   * Wertkontrast auch über hellem Mittagsboden, wo additives Licht allein ausbleicht.
   */
  private spawnEmblem(x: number, y: number, radius: number): void {
    const scale = radius * EMBLEM_ORB_RADIUS_FACTOR / EMBLEM_ORB_R;
    const layers = [
      { texture: TEX_EMBLEM_SHADE, depth: DEPTH_FX + 0.42, additive: false, alpha: 0.58, tint: GOLD_DEEP },
      { texture: TEX_EMBLEM_GLOW, depth: DEPTH_FX + 0.44, additive: true, alpha: 0.95, tint: GOLD_BODY },
      { texture: TEX_EMBLEM_LINE, depth: DEPTH_FX + 0.46, additive: true, alpha: 1, tint: HOLY_WHITE },
    ];
    for (const layer of layers) {
      const image = this.image(x, y, layer.texture, layer.depth, layer.additive, 0, layer.tint);
      image.setOrigin(0.5, EMBLEM_ORB_Y / EMBLEM_H).setScale(scale * 0.3);
      const peak = layer.additive ? emissiveAlpha(layer.alpha) : layer.alpha;
      this.tween(image, { alpha: peak, delay: 50, duration: 120, ease: 'Quad.easeOut' });
      this.tween(image, { scale, delay: 50, duration: 440, ease: 'Back.easeOut' });
      // Die Aura des Siegels atmet einmal auf, bevor alles verblasst.
      if (layer.texture === TEX_EMBLEM_GLOW) {
        this.tween(image, { scale: scale * 1.07, delay: 480, duration: 180, yoyo: true, ease: 'Sine.easeInOut' });
      }
      this.tween(image, {
        alpha: 0,
        scale: scale * 1.1,
        delay: 850,
        duration: 550,
        ease: 'Quad.easeIn',
      }, true);
    }

    // Nachhall: eine Kopie des Siegels löst sich und läuft als Formwelle nach außen.
    const echo = this.image(x, y, TEX_EMBLEM_LINE, DEPTH_FX + 0.47, true, 0, GOLD_HOT);
    echo.setOrigin(0.5, EMBLEM_ORB_Y / EMBLEM_H).setScale(scale);
    this.tween(echo, { alpha: emissiveAlpha(0.75), delay: 300, duration: 40 });
    this.tween(echo, {
      scale: scale * 1.75,
      delay: 300,
      duration: 520,
      ease: 'Cubic.easeOut',
    });
    this.tween(echo, { alpha: 0, delay: 340, duration: 480, ease: 'Quad.easeOut' }, true);
  }

  /** Geweihter Boden: das Siegel brennt sich kurz golden in den Untergrund ein. */
  private spawnConsecratedGround(x: number, y: number, radius: number): void {
    const scale = radius * EMBLEM_ORB_RADIUS_FACTOR / EMBLEM_ORB_R;
    const imprint = this.image(x, y, TEX_EMBLEM_SHADE, DEPTH.DECALS + 0.05, false, 0, 0xd8a53a);
    imprint.setOrigin(0.5, EMBLEM_ORB_Y / EMBLEM_H).setScale(scale);
    this.tween(imprint, { alpha: 0.4, delay: 140, duration: 180, ease: 'Quad.easeOut' });
    this.tween(imprint, { alpha: 0, delay: 600, duration: 600, ease: 'Sine.easeIn' }, true);

    const halo = this.image(x, y, TEX_SOFT_RING, DEPTH.DECALS + 0.04, false, 0, 0xe0b04a);
    halo.setScale(radius * 0.72 / SOFT_RING_R);
    this.tween(halo, { alpha: 0.34, delay: 160, duration: 180 });
    this.tween(halo, { alpha: 0, delay: 500, duration: 600, ease: 'Sine.easeIn' }, true);
  }

  /** Engelsfedern treiben aus dem Zentrum und kommen trudelnd zur Ruhe. */
  private spawnFeathers(x: number, y: number, radius: number): void {
    const count = scaleParticleCount(this.scene, 26, 'decorative');
    const sizeScale = Phaser.Math.Clamp(radius / 400, 0.6, 1.2);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
      const distance = radius * Phaser.Math.FloatBetween(0.35, 0.95);
      const duration = Phaser.Math.Between(1100, 1600);
      const startRotation = angle + Math.PI / 2 + Phaser.Math.FloatBetween(-0.6, 0.6);
      const feather = this.image(
        x + Math.cos(angle) * radius * 0.05,
        y + Math.sin(angle) * radius * 0.05,
        TEX_FEATHER,
        DEPTH_FX + 0.2,
        false,
        0.95,
        index % 3 === 0 ? 0xfff1cf : 0xffffff,
      );
      feather
        .setRotation(startRotation)
        .setScale(Phaser.Math.FloatBetween(0.55, 0.9) * sizeScale);
      this.tween(feather, {
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        duration,
        ease: 'Quart.easeOut',
      });
      this.tween(feather, {
        rotation: startRotation + Phaser.Math.FloatBetween(1.2, 2.6) * (index % 2 === 0 ? 1 : -1),
        duration,
        ease: 'Cubic.easeOut',
      });
      // Taumeln: die Feder kippt beim Gleiten um ihre Längsachse.
      this.tween(feather, {
        scaleX: feather.scaleX * 0.35,
        duration: Phaser.Math.Between(200, 320),
        yoyo: true,
        repeat: 1,
        delay: Phaser.Math.Between(80, 300),
        ease: 'Sine.easeInOut',
      });
      this.tween(feather, { alpha: 0, delay: duration * 0.5, duration: duration * 0.5, ease: 'Quad.easeIn' }, true);
    }
  }

  /** Funkelnde Lichtsterne im gesamten Wirkungsbereich. */
  private spawnTwinkles(x: number, y: number, radius: number): void {
    const count = scaleParticleCount(this.scene, 18, 'decorative');
    for (let index = 0; index < count; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = radius * Math.sqrt(Phaser.Math.FloatBetween(0.04, 0.8));
      const star = this.image(
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance,
        TEX_STAR,
        DEPTH_FX + 0.5,
        true,
        emissiveAlpha(1),
        index % 2 === 0 ? HOLY_WHITE : GOLD_HOT,
      );
      const peak = Phaser.Math.FloatBetween(0.45, 0.95);
      star.setScale(0).setRotation(Phaser.Math.FloatBetween(-0.3, 0.3));
      this.tween(star, {
        scale: peak,
        rotation: star.rotation + 0.7,
        delay: Phaser.Math.Between(100, 750),
        duration: Phaser.Math.Between(180, 260),
        yoyo: true,
        hold: 60,
        ease: 'Sine.easeOut',
      }, true);
    }
  }

  // ── Objekt- und Tween-Verwaltung ─────────────────────────────────────────

  private image(
    x: number,
    y: number,
    texture: string,
    depth: number,
    additive: boolean,
    alpha: number,
    tint: number,
  ): Phaser.GameObjects.Image {
    const image = this.scene.add.image(x, y, texture)
      .setDepth(depth)
      .setTint(tint)
      .setAlpha(additive ? emissiveAlpha(alpha) : alpha);
    if (additive) image.setBlendMode(Phaser.BlendModes.ADD);
    this.active.add(image);
    image.once(Phaser.GameObjects.Events.DESTROY, () => {
      // Parallele Tweens (Drehung, Taumeln) dürfen das zerstörte Objekt nicht weiter treiben.
      this.scene.tweens.killTweensOf(image);
      this.active.delete(image);
    });
    return image;
  }

  /** `finishing` markiert den letzten Tween eines Objekts; er zerstört es am Ende. */
  private tween(
    target: Phaser.GameObjects.Image,
    config: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>,
    finishing = false,
  ): void {
    this.scene.tweens.add({
      ...config,
      targets: target,
      ...(finishing ? { onComplete: () => target.destroy() } : {}),
    });
  }

  // ── Texturen ─────────────────────────────────────────────────────────────

  private ensureTextures(): void {
    if (this.texturesReady) return;
    const textures = this.scene.textures;

    ensureCanvasTexture(textures, TEX_EMBLEM_LINE, EMBLEM_W, EMBLEM_H, (ctx) => drawEmblem(ctx, 'line'));
    ensureCanvasTexture(textures, TEX_EMBLEM_GLOW, EMBLEM_W, EMBLEM_H, (ctx) => drawEmblem(ctx, 'glow'));
    ensureCanvasTexture(textures, TEX_EMBLEM_SHADE, EMBLEM_W, EMBLEM_H, (ctx) => drawEmblem(ctx, 'shade'));
    ensureCanvasTexture(textures, TEX_SUNBURST, SUNBURST_SIZE, SUNBURST_SIZE, drawSunburst);
    ensureCanvasTexture(textures, TEX_JEWEL_RING, JEWEL_RING_SIZE, JEWEL_RING_SIZE, drawJewelRing);
    ensureCanvasTexture(textures, TEX_SOFT_RING, SOFT_RING_SIZE, SOFT_RING_SIZE, drawSoftRing);
    ensureCanvasTexture(textures, TEX_GLOW, GLOW_SIZE, GLOW_SIZE, drawGlow);
    ensureCanvasTexture(textures, TEX_FEATHER, 24, 64, drawFeather);
    ensureCanvasTexture(textures, TEX_STAR, 64, 64, drawStar);
    this.texturesReady = true;
  }
}

// ── Texturzeichnung (weiß; Farbe kommt über den Tint) ──────────────────────

/** Latein-Kreuz mit leicht ausgestellten Enden, relativ zum Kugelzentrum. */
const CROSS_POLYGON: readonly (readonly [number, number])[] = [
  [-18, -330], [-26, -396], [26, -396], [18, -330],
  [106, -338], [106, -286], [18, -294],
  [22, -170], [-22, -170], [-18, -294],
  [-106, -286], [-106, -338],
];

function traceCross(ctx: CanvasRenderingContext2D, grow = 0): void {
  ctx.beginPath();
  CROSS_POLYGON.forEach(([px, py], index) => {
    const gx = px + Math.sign(px) * grow;
    const gy = py + (py < -312 ? -grow : grow);
    if (index === 0) ctx.moveTo(gx, gy);
    else ctx.lineTo(gx, gy);
  });
  ctx.closePath();
}

function traceCollar(ctx: CanvasRenderingContext2D, grow = 0): void {
  ctx.beginPath();
  ctx.roundRect(-36 - grow, -182 - grow, 72 + grow * 2, 38 + grow * 2, 7);
}

/** Mittellinie des Juwelenbands: quadratische Kurve, leicht nach Süden gewölbt. */
function equatorPoint(t: number): { x: number; y: number } {
  return { x: -EMBLEM_ORB_R + t * EMBLEM_ORB_R * 2, y: 60 * t * (1 - t) };
}

function traceDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.72, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size * 0.72, cy);
  ctx.closePath();
}

function drawEmblem(ctx: CanvasRenderingContext2D, mode: EmblemMode): void {
  const R = EMBLEM_ORB_R;
  ctx.save();
  ctx.translate(EMBLEM_W / 2, EMBLEM_ORB_Y);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (mode === 'glow') {
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = 34;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    traceCross(ctx, 8);
    ctx.fill();
    traceCollar(ctx, 6);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (mode === 'shade') {
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    traceCross(ctx, 6);
    ctx.fill();
    traceCollar(ctx, 5);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.lineWidth = 42;
    ctx.beginPath();
    ctx.moveTo(-R, 0);
    ctx.quadraticCurveTo(0, 30, R, 0);
    ctx.stroke();
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.lineTo(0, R);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    return;
  }

  // Linienzeichnung: Kugelkörper mit weichem Innenlicht.
  const body = ctx.createRadialGradient(-R * 0.25, -R * 0.3, 8, 0, 0, R);
  body.addColorStop(0, 'rgba(255,255,255,0.32)');
  body.addColorStop(0.55, 'rgba(255,255,255,0.1)');
  body.addColorStop(1, 'rgba(255,255,255,0.04)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';

  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, R - 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Meridian- und Äquatorband, auf die Kugel beschnitten.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R - 5, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.3;
  ctx.fillRect(-12, -R, 24, R * 2);
  ctx.beginPath();
  ctx.moveTo(-R, -16);
  ctx.quadraticCurveTo(0, 14, R, -16);
  ctx.lineTo(R, 16);
  ctx.quadraticCurveTo(0, 46, -R, 16);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 4;
  for (const dx of [-12, 12]) {
    ctx.beginPath();
    ctx.moveTo(dx, -R);
    ctx.lineTo(dx, R);
    ctx.stroke();
  }
  for (const dy of [-16, 16]) {
    ctx.beginPath();
    ctx.moveTo(-R, dy);
    ctx.quadraticCurveTo(0, dy + 30, R, dy);
    ctx.stroke();
  }
  ctx.restore();

  // Edelsteine auf dem Band; der große Stein sitzt an der Kreuzung beider Bänder.
  ctx.globalAlpha = 1;
  for (const t of [0.18, 0.34, 0.66, 0.82]) {
    const point = equatorPoint(t);
    traceDiamond(ctx, point.x, point.y, 10);
    ctx.fill();
  }
  const center = equatorPoint(0.5);
  traceDiamond(ctx, center.x, center.y, 18);
  ctx.fill();

  // Kragen und Kreuz.
  traceCollar(ctx);
  ctx.fill();
  traceCross(ctx);
  ctx.fill();

  // Eingelassene Mittelrillen geben Kreuz und Kragen innere Wertabstufung.
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -384);
  ctx.lineTo(0, -178);
  ctx.moveTo(-94, -312);
  ctx.lineTo(94, -312);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-28, -163);
  ctx.lineTo(28, -163);
  ctx.stroke();
  ctx.restore();
}

function drawSunburst(ctx: CanvasRenderingContext2D): void {
  const c = SUNBURST_SIZE / 2;
  const rays = 24;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.62)');
  gradient.addColorStop(0.65, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.shadowColor = 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 10;
  for (let index = 0; index < rays; index += 1) {
    const angle = (index / rays) * Math.PI * 2;
    const long = index % 2 === 0;
    const halfWidth = long ? 0.06 : 0.036;
    const length = long ? c - 6 : c * 0.66;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(angle - halfWidth) * length, c + Math.sin(angle - halfWidth) * length);
    ctx.lineTo(c + Math.cos(angle + halfWidth) * length, c + Math.sin(angle + halfWidth) * length);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,0.7)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, SUNBURST_SIZE, SUNBURST_SIZE);
}

function drawJewelRing(ctx: CanvasRenderingContext2D): void {
  const c = JEWEL_RING_SIZE / 2;
  ctx.translate(c, c);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, JEWEL_RING_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, JEWEL_RING_R - 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const ornaments = 16;
  for (let index = 0; index < ornaments; index += 1) {
    const angle = (index / ornaments) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);
    ctx.translate(0, -JEWEL_RING_R);
    if (index % 2 === 0) {
      ctx.fillRect(-2.5, -15, 5, 30);
      ctx.fillRect(-10, -8, 20, 5);
    } else {
      traceDiamond(ctx, 0, 0, 8);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawSoftRing(ctx: CanvasRenderingContext2D): void {
  const c = SOFT_RING_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.88, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.95, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SOFT_RING_SIZE, SOFT_RING_SIZE);
}

function drawGlow(ctx: CanvasRenderingContext2D): void {
  const c = GLOW_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
}

/** Feder in Draufsicht: Fahne mit Kiel, leicht asymmetrisch, mit feinen Einkerbungen. */
function drawFeather(ctx: CanvasRenderingContext2D): void {
  const vane = ctx.createLinearGradient(0, 0, 24, 0);
  vane.addColorStop(0, 'rgba(236,232,222,1)');
  vane.addColorStop(0.5, 'rgba(255,255,255,1)');
  vane.addColorStop(1, 'rgba(228,222,208,1)');
  ctx.fillStyle = vane;
  ctx.beginPath();
  ctx.moveTo(12, 3);
  ctx.bezierCurveTo(21, 12, 23, 34, 13, 56);
  ctx.lineTo(11, 56);
  ctx.bezierCurveTo(1, 38, 2, 14, 12, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,138,112,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = 1.2;
  for (const [x0, y0, x1, y1] of [[21, 20, 15, 25], [20, 34, 14, 38], [3, 26, 9, 31], [4, 40, 10, 44]]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = 'rgba(196,176,132,0.95)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(12, 6);
  ctx.quadraticCurveTo(12.8, 34, 12, 62);
  ctx.stroke();
}

function drawStar(ctx: CanvasRenderingContext2D): void {
  const c = 32;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(c, 0);
  ctx.lineTo(c + 3.5, c);
  ctx.lineTo(c, 64);
  ctx.lineTo(c - 3.5, c);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 22, c);
  ctx.lineTo(c, c - 3);
  ctx.lineTo(c + 22, c);
  ctx.lineTo(c, c + 3);
  ctx.closePath();
  ctx.fill();
}
