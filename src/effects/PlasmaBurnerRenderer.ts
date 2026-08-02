import * as Phaser from 'phaser';
import { DEPTH_TRACE, clipPointToArenaRay, isPointInsideArena } from '../config';
import type { HitscanImpactKind } from '../types';
import { makeAdditive, mixColors } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';

type BeamPoint = { x: number; y: number };

const BEAM_HOLD_MS = 185;
const BEAM_FADE_MS = 180;
const BEAM_LIGHT_SPACING_PX = 150;
const BEAM_MAX_LIGHTS = 5;

interface PlasmaBeamVisual {
  readonly root: Phaser.GameObjects.Container;
  readonly outer: Phaser.GameObjects.Graphics;
  readonly glow: Phaser.GameObjects.Graphics;
  readonly core: Phaser.GameObjects.Graphics;
  readonly hotCore: Phaser.GameObjects.Graphics;
  readonly arcs: Phaser.GameObjects.Graphics;
  readonly muzzle: Phaser.GameObjects.Graphics;
  readonly impact: Phaser.GameObjects.Graphics;
  revision: number;
}

/**
 * Kontinuierlicher Lightning-Gun-Renderer fuer den Plasmabrenner.
 *
 * Ein Schussimpuls aktualisiert nur den Strahl eines Schuetzen. Die Beam-Layer bleiben
 * zwischen zwei Impulsen bestehen, sodass die kurze Spiel-Cooldown-Frequenz nicht als
 * Folge einzelner Tracer sichtbar wird. Neue Geometrie wird aus dem aktuellen Hitscan-
 * Abschnitt aufgebaut; Gameplay und Trefferentscheidungen bleiben ausserhalb dieses Renderers.
 */
export class PlasmaBurnerRenderer {
  private readonly beams = new Map<string, PlasmaBeamVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  playTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
    beamId = 'anonymous',
  ): void {
    const clippedEnd = clipPointToArenaRay(startX, startY, endX, endY);
    const renderEndX = clippedEnd.x;
    const renderEndY = clippedEnd.y;
    const clippedDx = renderEndX - endX;
    const clippedDy = renderEndY - endY;
    const clippedByArena = (clippedDx * clippedDx) + (clippedDy * clippedDy) > 0.25;
    const resolvedImpactKind: HitscanImpactKind = impactKind === 'none' && clippedByArena
      ? 'environment'
      : impactKind;

    const visual = this.beams.get(beamId) ?? this.createBeam(beamId);
    visual.revision += 1;
    this.scene.tweens.killTweensOf(visual.root);
    visual.root.setAlpha(1);
    this.drawBeam(
      visual,
      startX,
      startY,
      renderEndX,
      renderEndY,
      color,
      Math.max(1, thickness),
      resolvedImpactKind,
      visual.revision,
    );
    this.emitBeamLight(startX, startY, renderEndX, renderEndY, color);

    const revision = visual.revision;
    this.scene.tweens.add({
      targets: visual.root,
      alpha: 0,
      delay: BEAM_HOLD_MS,
      duration: BEAM_FADE_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (visual.revision === revision) this.destroyBeam(beamId, visual);
      },
    });
  }

  clear(): void {
    for (const [beamId, visual] of this.beams) this.destroyBeam(beamId, visual);
    this.beams.clear();
  }

  shutdown(): void {
    this.clear();
  }

  private createBeam(beamId: string): PlasmaBeamVisual {
    const root = this.scene.add.container(0, 0).setDepth(DEPTH_TRACE + 0.16);
    const outer = makeAdditive(this.scene.add.graphics().setAlpha(0.2));
    const glow = makeAdditive(this.scene.add.graphics().setAlpha(0.36));
    const core = makeAdditive(this.scene.add.graphics().setAlpha(0.9));
    const hotCore = makeAdditive(this.scene.add.graphics().setAlpha(0.9));
    const arcs = makeAdditive(this.scene.add.graphics().setAlpha(0.52));
    const muzzle = makeAdditive(this.scene.add.graphics().setAlpha(0.72));
    const impact = makeAdditive(this.scene.add.graphics().setAlpha(0.72));
    root.add([outer, glow, core, hotCore, arcs, muzzle, impact]);

    const visual: PlasmaBeamVisual = {
      root,
      outer,
      glow,
      core,
      hotCore,
      arcs,
      muzzle,
      impact,
      revision: 0,
    };
    this.beams.set(beamId, visual);
    return visual;
  }

  private destroyBeam(beamId: string, visual: PlasmaBeamVisual): void {
    this.scene.tweens.killTweensOf(visual.root);
    visual.root.removeAll(true);
    visual.root.destroy();
    this.beams.delete(beamId);
  }

  private drawBeam(
    visual: PlasmaBeamVisual,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: number,
    thickness: number,
    impactKind: HitscanImpactKind,
    revision: number,
  ): void {
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    const normalX = length > 0 ? -dy / length : 0;
    const normalY = length > 0 ? dx / length : 1;
    const pointCount = Phaser.Math.Clamp(Math.round(length / 72), 5, 10);
    const phase = revision * 1.17;
    const amplitude = Math.min(10, Math.max(1.5, thickness * 0.38));
    const points = this.createBeamPoints(
      startX,
      startY,
      endX,
      endY,
      normalX,
      normalY,
      pointCount,
      phase,
      amplitude,
    );

    const glowColor = color;
    const accentColor = mixColors(color, 0xffffff, 0.34);
    const coreColor = mixColors(color, 0xffffff, 0.68);

    visual.outer.clear();
    this.strokePolyline(visual.outer, points, Math.max(thickness * 4.2, 18), glowColor, 0.26);

    visual.glow.clear();
    this.strokePolyline(visual.glow, points, Math.max(thickness * 2.35, 10), glowColor, 0.48);

    visual.core.clear();
    this.strokePolyline(visual.core, points, Math.max(thickness * 1.05, 4.5), accentColor, 0.94);

    visual.hotCore.clear();
    this.strokePolyline(visual.hotCore, points, Math.max(thickness * 0.38, 2), coreColor, 0.95);

    visual.arcs.clear();
    for (let arcIndex = 0; arcIndex < 3; arcIndex += 1) {
      const side = arcIndex - 1;
      const arcPoints = points.map((point, pointIndex) => {
        const t = pointIndex / Math.max(1, points.length - 1);
        const envelope = Math.sin(Math.PI * t);
        const zigzag = Math.sin(phase * 1.7 + pointIndex * 2.4 + arcIndex) * amplitude * 0.72 * envelope;
        const offset = side * thickness * 0.72 + zigzag;
        return {
          x: point.x + normalX * offset,
          y: point.y + normalY * offset,
        };
      });
      this.strokePolyline(
        visual.arcs,
        arcPoints,
        Math.max(thickness * 0.09, 1.1),
        arcIndex === 1 ? coreColor : accentColor,
        arcIndex === 1 ? 0.62 : 0.42,
      );
    }

    visual.muzzle.clear();
    const muzzleRadius = Math.max(thickness * 1.45, 7);
    visual.muzzle.fillStyle(accentColor, 0.38);
    visual.muzzle.fillCircle(startX, startY, muzzleRadius * 1.75);
    visual.muzzle.fillStyle(coreColor, 0.78);
    visual.muzzle.fillCircle(startX, startY, muzzleRadius);
    visual.muzzle.lineStyle(Math.max(thickness * 0.16, 1.4), 0xffffff, 0.8);
    visual.muzzle.strokeCircle(startX, startY, muzzleRadius * 0.62);

    visual.impact.clear();
    if (impactKind !== 'none' && isPointInsideArena(endX, endY)) {
      const impactRadius = Math.max(thickness * (impactKind === 'player' ? 1.35 : 1.7), 6);
      visual.impact.fillStyle(coreColor, impactKind === 'player' ? 0.58 : 0.68);
      visual.impact.fillCircle(endX, endY, impactRadius);
      visual.impact.lineStyle(Math.max(thickness * 0.14, 1.2), 0xffffff, 0.82);
      visual.impact.strokeCircle(endX, endY, impactRadius * 1.45);
      visual.impact.lineStyle(Math.max(thickness * 0.08, 0.8), accentColor, 0.52);
      visual.impact.strokeCircle(endX, endY, impactRadius * 2.05);
    }
  }

  private createBeamPoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    normalX: number,
    normalY: number,
    pointCount: number,
    phase: number,
    amplitude: number,
  ): BeamPoint[] {
    const points: BeamPoint[] = [];
    for (let index = 0; index < pointCount; index += 1) {
      const t = index / Math.max(1, pointCount - 1);
      const envelope = Math.sin(Math.PI * t);
      const wave = Math.sin(phase + index * 1.83) * amplitude * 0.26 * envelope;
      points.push({
        x: Phaser.Math.Linear(startX, endX, t) + normalX * wave,
        y: Phaser.Math.Linear(startY, endY, t) + normalY * wave,
      });
    }
    return points;
  }

  private strokePolyline(
    graphics: Phaser.GameObjects.Graphics,
    points: readonly BeamPoint[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    const first = points[0];
    if (!first) return;
    graphics.lineStyle(width, color, alpha);
    graphics.beginPath();
    graphics.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(points[index].x, points[index].y);
    }
    graphics.strokePath();
  }

  private emitBeamLight(startX: number, startY: number, endX: number, endY: number, color: number): void {
    if (!this.lighting) return;
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;

    const steps = Phaser.Math.Clamp(Math.round(length / BEAM_LIGHT_SPACING_PX), 1, BEAM_MAX_LIGHTS);
    const lightColor = mixColors(color, 0xffffff, 0.22);
    this.lighting.pulse('muzzleFlash', startX, startY, {
      color: lightColor,
      radiusPx: 150,
      intensity: 0.68,
      durationMs: 110,
    });
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      this.lighting.pulse('electricArc', startX + dx * t, startY + dy * t, {
        color: lightColor,
        intensity: 0.72,
        durationMs: 135,
      });
    }
  }
}
