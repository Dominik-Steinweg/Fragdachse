import Phaser from 'phaser';
import {
  ARENA_MAX_X,
  ARENA_MAX_Y,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  COLORS,
  DEPTH_FX,
  GAME_HEIGHT,
  GAME_WIDTH,
  TEAM_BLUE_COLOR,
  TEAM_RED_COLOR,
  getBeamPaletteForPlayerColor,
} from '../config';
import type { CaptureTheBeerFxEvent, SyncedCaptureTheBeerBeer, TeamId } from '../types';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
  setCircleEmitZone,
} from './EffectUtils';

const TEX_BEER_OUTER_GLOW = '__ctb_beer_outer_glow';
const TEX_BEER_INNER_GLOW = '__ctb_beer_inner_glow';
const TEX_BEER_AURA = '__ctb_beer_aura';
const TEX_BEER_BUBBLE = '__ctb_beer_bubble';
const TEX_BEER_FOAM = '__ctb_beer_foam';
const TEX_BEER_FLASH = '__ctb_beer_flash';

const BEER_DEPTH = DEPTH_FX - 0.8;
const BEER_RADIUS = 8;

interface TeamPalette {
  base: number;
  glow: number;
  core: number;
  rim: number;
  foam: number;
}

interface BeerVisual {
  teamId: TeamId;
  palette: TeamPalette;
  container: Phaser.GameObjects.Container;
  outerGlow: Phaser.GameObjects.Image;
  innerGlow: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
  bottle: Phaser.GameObjects.Graphics;
  idleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  bubbleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  state: SyncedCaptureTheBeerBeer;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  prevX: number;
  prevY: number;
  phaseOffset: number;
  trailCooldownMs: number;
}

export class CaptureTheBeerRenderer {
  private readonly visuals = new Map<TeamId, BeerVisual>();
  private arenaMask: Phaser.Display.Masks.GeometryMask | null;

  constructor(private readonly scene: Phaser.Scene, arenaMask: Phaser.Display.Masks.GeometryMask | null = null) {
    this.arenaMask = arenaMask;
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clear();
    });
  }

  setArenaMask(mask: Phaser.Display.Masks.GeometryMask | null): void {
    this.arenaMask = mask;
    for (const visual of this.visuals.values()) {
      this.applyArenaMask(visual.container);
      this.applyArenaMask(visual.idleEmitter);
      this.applyArenaMask(visual.bubbleEmitter);
    }
  }

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_BEER_OUTER_GLOW, 192, [
      [0, 'rgba(255,255,255,0.98)'],
      [0.18, 'rgba(255,255,255,0.52)'],
      [0.42, 'rgba(255,255,255,0.18)'],
      [0.7, 'rgba(255,255,255,0.04)'],
      [1, 'rgba(255,255,255,0.00)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_BEER_INNER_GLOW, 96, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.26, 'rgba(255,255,255,0.65)'],
      [0.55, 'rgba(255,255,255,0.18)'],
      [1, 'rgba(255,255,255,0.00)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_BEER_AURA, 128, [
      [0, 'rgba(255,255,255,0.70)'],
      [0.22, 'rgba(255,255,255,0.34)'],
      [0.58, 'rgba(255,255,255,0.10)'],
      [1, 'rgba(255,255,255,0.00)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_BEER_FLASH, 80, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.24, 'rgba(255,255,255,0.74)'],
      [0.6, 'rgba(255,255,255,0.12)'],
      [1, 'rgba(255,255,255,0.00)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_BEER_BUBBLE, 24, 24, (ctx) => {
      ctx.clearRect(0, 0, 24, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(12, 12, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(12, 12, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(8, 8, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ensureCanvasTexture(this.scene.textures, TEX_BEER_FOAM, 48, 48, (ctx) => {
      ctx.clearRect(0, 0, 48, 48);
      const circles = [
        [16, 18, 11],
        [26, 15, 9],
        [31, 23, 10],
        [20, 29, 11],
        [11, 26, 8],
      ] as const;
      ctx.fillStyle = 'rgba(255,255,255,0.98)';
      for (const [x, y, radius] of circles) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      for (const [x, y, radius] of circles) {
        ctx.beginPath();
        ctx.arc(x - 1.2, y - 1.2, Math.max(2, radius - 2.2), 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  sync(beers: SyncedCaptureTheBeerBeer[]): void {
    const active = new Set<TeamId>();

    for (const beer of beers) {
      active.add(beer.teamId);
      const clamped = this.clampBeerPoint(beer.x, beer.y);
      const existing = this.visuals.get(beer.teamId);
      if (existing) {
        existing.state = beer;
        existing.targetX = clamped.x;
        existing.targetY = clamped.y;
        continue;
      }

      const visual = this.createVisual({
        ...beer,
        x: clamped.x,
        y: clamped.y,
      });
      this.visuals.set(beer.teamId, visual);
    }

    for (const [teamId, visual] of this.visuals) {
      if (active.has(teamId)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(teamId);
    }
  }

  update(now: number, delta: number): void {
    if (this.visuals.size === 0) return;
    const lerp = 1 - Math.exp(-delta / 52);
    const dtSec = Math.max(delta, 1) / 1000;

    for (const visual of this.visuals.values()) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, lerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, lerp);

      const dx = visual.currentX - visual.prevX;
      const dy = visual.currentY - visual.prevY;
      const speed = Math.hypot(dx, dy) / dtSec;
      const wave = now * 0.0032 + visual.phaseOffset;
      const wobble = 0.5 + 0.5 * Math.sin(wave * 2.1);
      const shimmer = 0.5 + 0.5 * Math.sin(wave * 5.4 + visual.phaseOffset * 2.7);
      const isCarried = visual.state.state === 'carried';
      const isDropped = visual.state.state === 'dropped';

      const hover = Math.sin(wave * 1.35) * (isCarried ? 0.9 : 1.5) + Math.cos(wave * 2.9) * 0.45;
      const rotation = Math.sin(wave * 0.95) * 0.15 + Math.cos(wave * 1.7) * 0.06;
      const glowBoost = isCarried ? 1.35 : (isDropped ? 1.08 : 0.92);
      const auraBoost = isCarried ? 1.45 : (isDropped ? 1.12 : 0.95);

      visual.container
        .setDepth(isCarried ? BEER_DEPTH + 0.35 : BEER_DEPTH + 0.12)
        .setPosition(visual.currentX, visual.currentY + hover)
        .setRotation(rotation);

      visual.outerGlow
        .setAlpha((0.42 + wobble * 0.22 + shimmer * 0.14) * glowBoost)
        .setScale(0.72 + wobble * 0.22 + shimmer * 0.08 + (isCarried ? 0.18 : 0));
      visual.innerGlow
        .setAlpha((0.32 + wobble * 0.18) * glowBoost)
        .setScale(0.42 + wobble * 0.1 + (isCarried ? 0.12 : 0));
      visual.aura
        .setAlpha((0.18 + shimmer * 0.12) * auraBoost)
        .setScale(0.34 + wobble * 0.08 + shimmer * 0.05 + (isCarried ? 0.08 : 0));

      visual.idleEmitter.setPosition(visual.currentX, visual.currentY);
      visual.bubbleEmitter.setPosition(visual.currentX, visual.currentY);
      visual.idleEmitter.frequency = isCarried ? 55 : (isDropped ? 80 : 115);
      visual.bubbleEmitter.frequency = isCarried ? 90 : (isDropped ? 120 : 170);
      visual.idleEmitter.setParticleScale(isCarried ? 0.34 : 0.22, 0.02);
      visual.bubbleEmitter.setParticleScale(isCarried ? 0.54 : 0.34, 0.05);

      visual.trailCooldownMs -= delta;
      if (isCarried) {
        const spawnInterval = speed > 22 ? 28 : 46;
        while (visual.trailCooldownMs <= 0) {
          this.spawnTrailPuff(visual, dx, dy, speed);
          visual.trailCooldownMs += spawnInterval;
        }
      } else {
        visual.trailCooldownMs = 0;
      }

      visual.prevX = visual.currentX;
      visual.prevY = visual.currentY;
    }
  }

  playFx(event: CaptureTheBeerFxEvent): void {
    switch (event.kind) {
      case 'drop':
        this.playDropBurst(event.x, event.y, this.getPalette(event.beerTeamId));
        break;
      case 'score':
        this.playScoreBurst(event.x, event.y, this.getPalette(event.scoreTeamId));
        break;
      case 'reset':
        this.playResetTeleport(event.sourceX, event.sourceY, this.getPalette(event.beerTeamId), false);
        this.playResetTeleport(event.targetX, event.targetY, this.getPalette(event.beerTeamId), true);
        break;
    }
  }

  clear(): void {
    for (const visual of this.visuals.values()) {
      this.destroyVisual(visual);
    }
    this.visuals.clear();
  }

  private createVisual(state: SyncedCaptureTheBeerBeer): BeerVisual {
    const palette = this.getPalette(state.teamId);
    const container = this.scene.add.container(state.x, state.y).setDepth(BEER_DEPTH);
    const outerGlow = configureAdditiveImage(
      this.scene.add.image(0, 0, TEX_BEER_OUTER_GLOW),
      BEER_DEPTH - 0.2,
      0.6,
      palette.glow,
    ).setScale(0.82);
    this.applyArenaMask(outerGlow);
    const innerGlow = configureAdditiveImage(
      this.scene.add.image(0, 0, TEX_BEER_INNER_GLOW),
      BEER_DEPTH - 0.1,
      0.55,
      palette.core,
    ).setScale(0.48);
    this.applyArenaMask(innerGlow);
    const aura = configureAdditiveImage(
      this.scene.add.image(0, 0, TEX_BEER_AURA),
      BEER_DEPTH - 0.05,
      0.28,
      palette.foam,
    ).setScale(0.38);
    this.applyArenaMask(aura);
    const bottle = this.scene.add.graphics();
    this.applyArenaMask(bottle);
    container.add([outerGlow, innerGlow, aura, bottle]);
    this.applyArenaMask(container);

    const idleEmitter = createEmitter(this.scene, state.x, state.y, TEX_BEER_BUBBLE, {
      lifespan: { min: 380, max: 880 },
      frequency: 105,
      quantity: 1,
      speed: { min: 4, max: 18 },
      scale: { start: 0.26, end: 0.02 },
      alpha: { start: 0.3, end: 0 },
      tint: [palette.foam, palette.core, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, BEER_DEPTH + 0.26);
    this.applyArenaMask(idleEmitter);
    setCircleEmitZone(idleEmitter, 9, 1, true);

    const bubbleEmitter = createEmitter(this.scene, state.x, state.y, TEX_BEER_FOAM, {
      lifespan: { min: 520, max: 920 },
      frequency: 160,
      quantity: 1,
      speedX: { min: -12, max: 12 },
      speedY: { min: -12, max: 12 },
      scale: { start: 0.16, end: 0.02 },
      alpha: { start: 0.2, end: 0 },
      tint: [palette.foam, palette.glow, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, BEER_DEPTH + 0.22);
    this.applyArenaMask(bubbleEmitter);
    setCircleEmitZone(bubbleEmitter, 6, 1, true);

    const visual: BeerVisual = {
      teamId: state.teamId,
      palette,
      container,
      outerGlow,
      innerGlow,
      aura,
      bottle,
      idleEmitter,
      bubbleEmitter,
      state,
      currentX: state.x,
      currentY: state.y,
      targetX: state.x,
      targetY: state.y,
      prevX: state.x,
      prevY: state.y,
      phaseOffset: state.teamId === 'blue' ? 0.3 : 1.1,
      trailCooldownMs: 0,
    };
    this.drawBottle(visual);
    return visual;
  }

  private drawBottle(visual: BeerVisual): void {
    const g = visual.bottle;
    const rimColor = mixColors(visual.palette.rim, 0xffffff, 0.35);
    const glassFill = mixColors(COLORS.GREY_2, visual.palette.base, 0.24);
    const capColor = mixColors(visual.palette.core, COLORS.GREY_1, 0.22);

    g.clear();
    g.fillStyle(0x06070d, 0.22);
    g.fillCircle(0.8, 2.8, BEER_RADIUS + 0.8);

    g.fillStyle(glassFill, 0.68);
    g.fillCircle(0, 0, 7.2);
    g.lineStyle(2.1, rimColor, 0.95);
    g.strokeCircle(0, 0, 7.2);

    g.fillStyle(visual.palette.base, 0.86);
    g.fillCircle(0, 0, 5.55);
    g.lineStyle(1.2, visual.palette.glow, 0.72);
    g.strokeCircle(0, 0, 5.05);

    g.fillStyle(0xffffff, 0.34);
    g.fillEllipse(-2.1, -1.9, 4.2, 3.2);
    g.lineStyle(1, 0xffffff, 0.4);
    g.strokeEllipse(-1.35, -1.45, 3.5, 2.3);

    g.fillStyle(capColor, 0.96);
    g.fillCircle(0, -5.5, 1.9);
    g.lineStyle(1, mixColors(capColor, 0xffffff, 0.25), 0.7);
    g.strokeCircle(0, -5.5, 1.9);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(-0.45, -6.0, 0.55);
  }

  private clampBeerPoint(x: number, y: number): { x: number; y: number } {
    const padding = BEER_RADIUS + 2;
    return {
      x: Phaser.Math.Clamp(x, ARENA_OFFSET_X + padding, ARENA_MAX_X - padding),
      y: Phaser.Math.Clamp(y, ARENA_OFFSET_Y + padding, ARENA_MAX_Y - padding),
    };
  }

  private spawnTrailPuff(visual: BeerVisual, dx: number, dy: number, speed: number): void {
    const wave = this.scene.time.now * 0.003 + visual.phaseOffset;
    const len = Math.hypot(dx, dy);
    const dirX = len > 0.001 ? dx / len : Math.cos(wave);
    const dirY = len > 0.001 ? dy / len : Math.sin(wave);
    const jitterX = Phaser.Math.FloatBetween(-4, 4);
    const jitterY = Phaser.Math.FloatBetween(-4, 4);
    const x = visual.currentX - dirX * Phaser.Math.FloatBetween(8, 16) + jitterX;
    const y = visual.currentY - dirY * Phaser.Math.FloatBetween(8, 16) + jitterY;
    const drift = Phaser.Math.Clamp(speed * 0.02, 10, 26);

    const foam = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BEER_FOAM),
      BEER_DEPTH + 0.04,
      0.58,
      visual.palette.foam,
    ).setScale(0.12 + Phaser.Math.FloatBetween(0.02, 0.06));
    this.applyArenaMask(foam);

    const bubble = configureAdditiveImage(
      this.scene.add.image(x + Phaser.Math.FloatBetween(-3, 3), y + Phaser.Math.FloatBetween(-3, 3), TEX_BEER_BUBBLE),
      BEER_DEPTH + 0.08,
      0.7,
      mixColors(visual.palette.core, 0xffffff, 0.35),
    ).setScale(0.18 + Phaser.Math.FloatBetween(0.03, 0.07));
    this.applyArenaMask(bubble);

    this.scene.tweens.add({
      targets: foam,
      x: x - dirX * drift,
      y: y - dirY * drift,
      scale: foam.scale * Phaser.Math.FloatBetween(3.2, 4.8),
      alpha: 0,
      duration: Phaser.Math.Between(540, 880),
      ease: 'Quad.easeOut',
      onComplete: () => foam.destroy(),
    });
    this.scene.tweens.add({
      targets: bubble,
      x: bubble.x - dirX * drift * 0.5 + Phaser.Math.FloatBetween(-6, 6),
      y: bubble.y - dirY * drift * 0.5 + Phaser.Math.FloatBetween(-6, 6),
      scale: bubble.scale * Phaser.Math.FloatBetween(1.8, 2.7),
      alpha: 0,
      duration: Phaser.Math.Between(460, 760),
      ease: 'Sine.easeOut',
      onComplete: () => bubble.destroy(),
    });
  }

  private playDropBurst(x: number, y: number, palette: TeamPalette): void {
    this.playPulseHalo(x, y, palette.foam, 0.44, 0.22, 0.92, 340);
    this.playRing(x, y, palette.glow, 14, 42, 320, 3.5);
    this.playFoamBurst(x, y, palette, 28, 18, 62, 0.2, 0.9);
    this.spawnAfterglow(x, y, palette, 0.24, 460);
  }

  private playScoreBurst(x: number, y: number, palette: TeamPalette): void {
    this.playScoreScreenFlash(palette);
    this.scene.cameras.main.flash(150, 255, 255, 255, false);
    this.scene.cameras.main.shake(460, 0.014);

    this.playPulseHalo(x, y, palette.foam, 0.88, 0.3, 2.65, 980);
    this.playPulseHalo(x, y, 0xffffff, 0.56, 0.2, 2.15, 720);
    this.playPulseHalo(x, y, palette.glow, 0.42, 0.26, 3.6, 1320);

    this.playRing(x, y, mixColors(palette.foam, 0xffffff, 0.35), 16, 132, 980, 6);
    this.playRing(x, y, palette.glow, 24, 188, 1180, 8);
    this.playRing(x, y, palette.core, 10, 108, 780, 4);

    this.playScoreLightBurst(x, y, palette);
    this.playScoreFoamShell(x, y, palette);
    this.playFoamBurst(x, y, palette, 160, 78, 196, 0.28, 1.7);
    this.playFoamBurst(x, y, palette, 110, 56, 156, 0.18, 1.34);
    this.playFoamBurst(x, y, palette, 72, 40, 112, 0.12, 1.02);
    this.spawnAfterglow(x, y, palette, 0.58, 1800);
    this.spawnAfterglow(x, y, palette, 0.3, 2450);
  }

  private playResetTeleport(x: number, y: number, palette: TeamPalette, isTarget: boolean): void {
    const halo = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BEER_FLASH),
      DEPTH_FX + 0.9,
      isTarget ? 0.92 : 0.72,
      palette.foam,
    ).setScale(isTarget ? 0.18 : 0.36);
    this.applyArenaMask(halo);
    this.scene.tweens.add({
      targets: halo,
      scale: isTarget ? 2.4 : 0.16,
      alpha: 0,
      duration: isTarget ? 420 : 280,
      ease: isTarget ? 'Cubic.easeOut' : 'Quad.easeIn',
      onComplete: () => halo.destroy(),
    });

    this.playRing(x, y, palette.glow, isTarget ? 12 : 24, isTarget ? 64 : 10, isTarget ? 420 : 260, 3.5);
    this.spawnTeleportSwirl(x, y, palette, isTarget);
    this.playFoamBurst(x, y, palette, isTarget ? 24 : 18, isTarget ? 14 : 10, isTarget ? 44 : 30, 0.18, isTarget ? 0.72 : 0.48);
  }

  private spawnTeleportSwirl(x: number, y: number, palette: TeamPalette, outward: boolean): void {
    for (let index = 0; index < 12; index += 1) {
      const angle = (Math.PI * 2 * index) / 12;
      const radius = outward ? Phaser.Math.FloatBetween(2, 8) : Phaser.Math.FloatBetween(14, 24);
      const startX = x + Math.cos(angle) * radius;
      const startY = y + Math.sin(angle) * radius;
      const bubble = configureAdditiveImage(
        this.scene.add.image(startX, startY, TEX_BEER_BUBBLE),
        DEPTH_FX + 0.82,
        0.8,
        index % 3 === 0 ? 0xffffff : palette.foam,
      ).setScale(Phaser.Math.FloatBetween(0.12, 0.26));
      this.applyArenaMask(bubble);

      this.scene.tweens.add({
        targets: bubble,
        x: outward ? x + Math.cos(angle) * Phaser.Math.FloatBetween(26, 42) : x,
        y: outward ? y + Math.sin(angle) * Phaser.Math.FloatBetween(26, 42) : y,
        alpha: 0,
        scale: outward ? bubble.scale * Phaser.Math.FloatBetween(1.6, 2.4) : bubble.scale * 0.4,
        duration: outward ? Phaser.Math.Between(300, 460) : Phaser.Math.Between(220, 320),
        ease: outward ? 'Cubic.easeOut' : 'Cubic.easeIn',
        onComplete: () => bubble.destroy(),
      });
    }
  }

  private playFoamBurst(
    x: number,
    y: number,
    palette: TeamPalette,
    foamCount: number,
    bubbleCount: number,
    maxSpeed: number,
    startScale: number,
    endScale: number,
  ): void {
    const foamEmitter = createEmitter(this.scene, x, y, TEX_BEER_FOAM, {
      lifespan: { min: 420, max: 920 },
      frequency: -1,
      quantity: foamCount,
      speed: { min: 14, max: maxSpeed },
      scale: { start: startScale, end: endScale },
      alpha: { start: 0.95, end: 0 },
      tint: [palette.foam, palette.glow, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_FX + 0.66);
    this.applyArenaMask(foamEmitter);
    foamEmitter.explode(foamCount, 0, 0);

    const bubbleEmitter = createEmitter(this.scene, x, y, TEX_BEER_BUBBLE, {
      lifespan: { min: 340, max: 760 },
      frequency: -1,
      quantity: bubbleCount,
      speed: { min: 10, max: maxSpeed * 0.85 },
      scale: { start: startScale * 0.75, end: 0.05 },
      alpha: { start: 0.88, end: 0 },
      tint: [0xffffff, palette.foam, palette.core],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_FX + 0.7);
    this.applyArenaMask(bubbleEmitter);
    bubbleEmitter.explode(bubbleCount, 0, 0);

    this.scene.time.delayedCall(1100, () => {
      destroyEmitter(foamEmitter);
      destroyEmitter(bubbleEmitter);
    });
  }

  private playPulseHalo(
    x: number,
    y: number,
    tint: number,
    alpha: number,
    startScale: number,
    endScale: number,
    duration: number,
  ): void {
    const halo = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BEER_OUTER_GLOW),
      DEPTH_FX + 0.52,
      alpha,
      tint,
    ).setScale(startScale);
    this.applyArenaMask(halo);
    this.scene.tweens.add({
      targets: halo,
      scale: endScale,
      alpha: 0,
      duration,
      ease: 'Sine.easeOut',
      onComplete: () => halo.destroy(),
    });
  }

  private playScoreScreenFlash(palette: TeamPalette): void {
    const colorWash = this.scene.add.rectangle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, GAME_WIDTH, GAME_HEIGHT, palette.glow, 0.24);
    colorWash.setScrollFactor(0);
    colorWash.setDepth(DEPTH_FX + 1.75);
    colorWash.setBlendMode(Phaser.BlendModes.ADD);

    const whiteWash = this.scene.add.rectangle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.18);
    whiteWash.setScrollFactor(0);
    whiteWash.setDepth(DEPTH_FX + 1.8);
    whiteWash.setBlendMode(Phaser.BlendModes.ADD);

    const centerHalo = configureAdditiveImage(
      this.scene.add.image(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, TEX_BEER_OUTER_GLOW),
      DEPTH_FX + 1.82,
      0.46,
      palette.foam,
    ).setScrollFactor(0).setScale(1.05);

    const centerCore = configureAdditiveImage(
      this.scene.add.image(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.5, TEX_BEER_FLASH),
      DEPTH_FX + 1.84,
      0.44,
      0xffffff,
    ).setScrollFactor(0).setScale(0.64);

    this.scene.tweens.add({
      targets: colorWash,
      alpha: 0,
      duration: 420,
      ease: 'Quad.easeOut',
      onComplete: () => colorWash.destroy(),
    });
    this.scene.tweens.add({
      targets: whiteWash,
      alpha: 0,
      duration: 240,
      ease: 'Quad.easeOut',
      onComplete: () => whiteWash.destroy(),
    });
    this.scene.tweens.add({
      targets: centerHalo,
      scale: 2.5,
      alpha: 0,
      duration: 760,
      ease: 'Expo.easeOut',
      onComplete: () => centerHalo.destroy(),
    });
    this.scene.tweens.add({
      targets: centerCore,
      scale: 1.85,
      alpha: 0,
      duration: 440,
      ease: 'Expo.easeOut',
      onComplete: () => centerCore.destroy(),
    });
  }

  private playScoreLightBurst(x: number, y: number, palette: TeamPalette): void {
    const beamColor = mixColors(palette.foam, 0xffffff, 0.35);
    const beamSpecs = [
      { angle: 0, width: 420, height: 86, alpha: 0.2 },
      { angle: 90, width: 420, height: 86, alpha: 0.22 },
      { angle: 45, width: 360, height: 54, alpha: 0.16 },
      { angle: -45, width: 360, height: 54, alpha: 0.16 },
    ] as const;

    for (const spec of beamSpecs) {
      const beam = this.scene.add.rectangle(x, y, spec.width, spec.height, beamColor, spec.alpha);
      beam.setDepth(DEPTH_FX + 0.95);
      beam.setBlendMode(Phaser.BlendModes.ADD);
      beam.setAngle(spec.angle);
      this.applyArenaMask(beam);
      this.scene.tweens.add({
        targets: beam,
        scaleX: spec.angle === 90 ? 1.2 : 1.9,
        scaleY: spec.angle === 90 ? 1.9 : 1.25,
        alpha: 0,
        duration: 520,
        ease: 'Expo.easeOut',
        onComplete: () => beam.destroy(),
      });
    }

    const core = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BEER_FLASH),
      DEPTH_FX + 1.02,
      0.95,
      0xffffff,
    ).setScale(0.32);
    this.applyArenaMask(core);

    const corona = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BEER_INNER_GLOW),
      DEPTH_FX + 1.01,
      0.8,
      palette.foam,
    ).setScale(0.56);
    this.applyArenaMask(corona);

    this.scene.tweens.add({
      targets: core,
      scale: 2.1,
      alpha: 0,
      duration: 420,
      ease: 'Expo.easeOut',
      onComplete: () => core.destroy(),
    });
    this.scene.tweens.add({
      targets: corona,
      scale: 3.1,
      alpha: 0,
      duration: 660,
      ease: 'Expo.easeOut',
      onComplete: () => corona.destroy(),
    });
  }

  private playScoreFoamShell(x: number, y: number, palette: TeamPalette): void {
    const shell = createEmitter(this.scene, x, y, TEX_BEER_FOAM, {
      lifespan: { min: 820, max: 1380 },
      frequency: -1,
      quantity: 96,
      speedX: { min: -164, max: 164 },
      speedY: { min: -198, max: 46 },
      scale: { start: 0.2, end: 1.9 },
      alpha: { start: 0.92, end: 0 },
      tint: [0xffffff, palette.foam, palette.glow],
      blendMode: Phaser.BlendModes.ADD,
      gravityY: 120,
      emitting: false,
    }, DEPTH_FX + 0.86);
    this.applyArenaMask(shell);
    shell.addEmitZone({
      type: 'edge',
      source: new Phaser.Geom.Circle(0, 0, 16),
      quantity: 96,
    } as Phaser.Types.GameObjects.Particles.EmitZoneData);
    shell.explode(96, 0, 0);

    const plume = createEmitter(this.scene, x, y + 8, TEX_BEER_BUBBLE, {
      lifespan: { min: 980, max: 1760 },
      frequency: -1,
      quantity: 132,
      speedX: { min: -104, max: 104 },
      speedY: { min: -248, max: -54 },
      scale: { start: 0.12, end: 0.88 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffffff, palette.foam, palette.core],
      blendMode: Phaser.BlendModes.ADD,
      gravityY: 140,
      emitting: false,
    }, DEPTH_FX + 0.88);
    this.applyArenaMask(plume);
    plume.explode(132, 0, 0);

    this.scene.time.delayedCall(1900, () => {
      destroyEmitter(shell);
      destroyEmitter(plume);
    });
  }

  private playRing(
    x: number,
    y: number,
    color: number,
    startRadius: number,
    endRadius: number,
    duration: number,
    lineWidth: number,
  ): void {
    const ring = this.scene.add.circle(x, y, startRadius);
    ring.setStrokeStyle(lineWidth, color, 0.9);
    ring.setFillStyle(0, 0);
    ring.setDepth(DEPTH_FX + 0.6);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    this.applyArenaMask(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: endRadius / Math.max(startRadius, 1),
      alpha: 0,
      duration,
      ease: 'Linear',
      onComplete: () => ring.destroy(),
    });
  }

  private spawnAfterglow(x: number, y: number, palette: TeamPalette, alpha: number, duration: number): void {
    const afterglow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BEER_AURA),
      DEPTH_FX + 0.3,
      alpha,
      palette.foam,
    ).setScale(0.34);
    this.applyArenaMask(afterglow);
    this.scene.tweens.add({
      targets: afterglow,
      scale: 1.08,
      alpha: 0,
      duration,
      ease: 'Sine.easeOut',
      onComplete: () => afterglow.destroy(),
    });
  }

  private destroyVisual(visual: BeerVisual): void {
    destroyEmitter(visual.idleEmitter);
    destroyEmitter(visual.bubbleEmitter);
    visual.container.destroy(true);
  }

  private applyArenaMask<T extends Phaser.GameObjects.GameObject>(gameObject: T): T {
    if (this.arenaMask) {
      (gameObject as T & Phaser.GameObjects.Components.Mask).setMask(this.arenaMask);
    }
    return gameObject;
  }

  private getPalette(teamId: TeamId): TeamPalette {
    const base = teamId === 'blue' ? TEAM_BLUE_COLOR : TEAM_RED_COLOR;
    const beam = getBeamPaletteForPlayerColor(base);
    return {
      base,
      glow: mixColors(base, beam.glow, 0.38),
      core: mixColors(base, beam.core, 0.34),
      rim: mixColors(COLORS.GREY_2, base, 0.2),
      foam: mixColors(base, 0xffffff, 0.54),
    };
  }
}