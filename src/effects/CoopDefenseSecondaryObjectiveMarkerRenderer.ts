/**
 * Weltmarkierung der Coop-Defense-Nebenmissionen.
 *
 * Die Marker bleiben Weltobjekte und behalten damit ihre Tiefenbeziehung zum Blätterdach;
 * nur der Randpfeil ist HUD und läuft auf der Klarheitskamera. Die Geometrie des Sichtfelds
 * stammt aus `HostileBaseIndicator` – sie korrigiert den Versatz zwischen Phasers
 * `camera.worldView` und der Arena-Kamera mit `origin = (0, 0)` sowie den Zoomausgleich am
 * Bildschirmrand und darf deshalb nicht nachgebaut werden.
 *
 * Zeichenform ist wie im HUD die Raute: Das Pflichtziel führt eine Leitschiene, der
 * Feindbasis-Indikator ein rotes Dreieck. Die violette Raute ist damit in Welt und HUD
 * eindeutig dem freiwilligen Ziel zugeordnet.
 */
import * as Phaser from 'phaser';
import { CELL_SIZE, COLORS, DEPTH, toCssColor } from '../config';
import { getBaseWorldBounds } from '../arena/BaseRegistry';
import type { BaseManager } from '../entities/BaseManager';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import {
  getArrowPointOnScreenViewEdge,
  getArrowPointOnWorldViewEdge,
  getVisibleWorldView,
  isWorldPointInsideView,
} from '../ui/HostileBaseIndicator';
import { getSecondaryObjectiveTargets } from '../ui/coopDefenseSecondaryObjectiveModel';
import {
  clusterEdgeMarkers,
  formatEdgeMarkerLabel,
  type EdgeMarkerCandidate,
} from './coopDefenseSecondaryObjectiveEdgeMarkers';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';

/** Harte Obergrenze gleichzeitig gezeichneter Zielmarken; die Objekte werden vorab angelegt. */
const MAX_MARKERS = 8;
/** Ebenso begrenzte Zahl an Randpfeilen – ein Pfeil je offener Struktur, bis diese Grenze greift. */
const MAX_EDGE_ARROWS = 6;
/**
 * Erst unterhalb dieses Bildschirmabstands werden zwei Randpfeile zu einem zusammengefasst.
 * Knapp über der Pfeilbreite samt Beschriftung: Darüber stehen sie erkennbar getrennt.
 */
const EDGE_CLUSTER_PX = 74;

const MARKER_COLOR = COLORS.PURPLE_2;
const MARKER_CORE_COLOR = COLORS.PURPLE_1;
const MARKER_GLOW_TEX = '_secondary_objective_marker_glow';
const MARKER_GLOW_SIZE = 96;
const MARKER_RISE_PX = 26;
const MARKER_DIAMOND_R = 9;
const MARKER_BOB_PX = 5;
const MARKER_BOB_MS = 620;
const RING_MIN_RADIUS = 26;
const EDGE_INSET_PX = 26;

interface MarkerVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly glow: Phaser.GameObjects.Image;
  readonly diamond: Phaser.GameObjects.Graphics;
  readonly ring: Phaser.GameObjects.Graphics;
  diamondDrawn: boolean;
  ringRadius: number;
}

interface MarkerTarget {
  readonly x: number;
  readonly y: number;
  readonly topY: number;
  readonly radius: number;
  readonly focused: boolean;
}

interface EdgeArrowVisual {
  readonly arrow: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
}

export class CoopDefenseSecondaryObjectiveMarkerRenderer {
  private readonly markers: MarkerVisual[] = [];
  private readonly edgeArrows: EdgeArrowVisual[] = [];
  private bobOffset = 0;
  private bobTween: Phaser.Tweens.Tween | null = null;
  private built = false;
  private visible = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Vorbaupfad analog zum Encounter-Telegraph: Texturen und Objekte entstehen genau einmal. */
  generateTextures(): void {
    if (this.scene.textures.exists(MARKER_GLOW_TEX)) return;
    const ct = this.scene.textures.createCanvas(MARKER_GLOW_TEX, MARKER_GLOW_SIZE, MARKER_GLOW_SIZE);
    if (!ct) return;
    const ctx = ct.context;
    const half = MARKER_GLOW_SIZE / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, MARKER_GLOW_SIZE, MARKER_GLOW_SIZE);
    ct.refresh();
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    this.generateTextures();

    for (let index = 0; index < MAX_MARKERS; index += 1) {
      const glow = this.scene.add.image(0, 0, MARKER_GLOW_TEX)
        .setOrigin(0.5)
        .setTint(MARKER_COLOR)
        .setAlpha(0.5)
        // Telegraphen mischen bewusst direkt additiv statt über EmissiveScale: Sie müssen zu
        // jeder konfigurierten Uhrzeit gleich lesbar bleiben.
        .setBlendMode(Phaser.BlendModes.ADD);
      const diamond = this.scene.add.graphics();
      const ring = this.scene.add.graphics();
      const container = this.scene.add.container(0, 0, [ring, glow, diamond])
        .setDepth(DEPTH.BASES + 8)
        .setVisible(false);
      this.markers.push({ container, glow, diamond, ring, diamondDrawn: false, ringRadius: -1 });
    }

    for (let index = 0; index < MAX_EDGE_ARROWS; index += 1) {
      const arrow = this.scene.add.graphics()
        .setDepth(DEPTH.OVERLAY)
        .setScrollFactor(0)
        .setVisible(false);
      const label = this.scene.add.text(0, 0, '', {
        fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold',
        color: toCssColor(MARKER_CORE_COLOR),
      })
        .setOrigin(0.5)
        .setDepth(DEPTH.OVERLAY)
        .setScrollFactor(0)
        .setVisible(false);
      promoteToClarityCamera(this.scene, arrow);
      promoteToClarityCamera(this.scene, label);
      this.drawEdgeArrow(arrow);
      this.edgeArrows.push({ arrow, label });
    }

    this.bobTween = this.scene.tweens.add({
      targets: this,
      bobOffset: MARKER_BOB_PX,
      duration: MARKER_BOB_MS,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      paused: true,
    });
  }

  sync(
    snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    baseManager: BaseManager | null,
    active: boolean,
  ): void {
    if (!this.built) return;
    const targets = active && snapshot && baseManager
      ? this.collectTargets(snapshot, configs, baseManager)
      : [];
    if (targets.length === 0) {
      this.clear();
      return;
    }

    this.visible = true;
    this.bobTween?.resume();
    const decorative = getGraphicsQualityProfile(this.scene).level !== 'low';
    for (let index = 0; index < this.markers.length; index += 1) {
      const marker = this.markers[index];
      const target = targets[index];
      if (!target) {
        marker.container.setVisible(false);
        continue;
      }
      this.applyMarker(marker, target, decorative);
    }

    this.syncEdgeArrows(targets);
  }

  /**
   * Zielpositionen entstehen lokal aus der Map-Konfiguration und dem Basiszustand. Der
   * Snapshot liefert bewusst nur IDs – Geometrie ist auf jedem Client bereits bekannt.
   */
  private collectTargets(
    snapshot: CoopDefenseSecondaryObjectivePresentationState,
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    baseManager: BaseManager,
  ): MarkerTarget[] {
    const targets: MarkerTarget[] = [];
    for (const entry of snapshot) {
      // Nur laufende Missionen markieren: Ein Abschluss oder Fehlschlag hat keine offenen Ziele
      // mehr, und eine dormante Mission existiert für den Spieler noch gar nicht.
      if (entry.state !== 'active') continue;
      for (const targetId of getSecondaryObjectiveTargets(configs, entry.objectiveId)) {
        if (targets.length >= MAX_MARKERS) return targets;
        const base = baseManager.getBase(targetId);
        if (!base || base.isDormant() || base.isDestroyed()) continue;
        const bounds = getBaseWorldBounds(base.spec.region);
        targets.push({
          x: bounds.x + bounds.width * 0.5,
          y: bounds.y + bounds.height * 0.5,
          topY: bounds.y,
          radius: Math.max(RING_MIN_RADIUS, Math.max(bounds.width, bounds.height) * 0.62),
          focused: entry.focused,
        });
      }
    }
    return targets;
  }

  private applyMarker(marker: MarkerVisual, target: MarkerTarget, decorative: boolean): void {
    marker.container
      .setVisible(true)
      .setPosition(target.x, target.topY - MARKER_RISE_PX - this.bobOffset);
    marker.container.setAlpha(target.focused ? 1 : 0.62);

    if (!marker.diamondDrawn) {
      // Die Rautenform ist konstant; nur Position und Deckkraft ändern sich pro Frame.
      marker.diamondDrawn = true;
      marker.diamond.fillStyle(MARKER_CORE_COLOR, 0.95);
      fillDiamond(marker.diamond, MARKER_DIAMOND_R - 3.5);
      marker.diamond.lineStyle(2, MARKER_COLOR, 0.95);
      strokeDiamond(marker.diamond, MARKER_DIAMOND_R);
    }
    marker.glow.setVisible(decorative);

    // Der Fußring liegt um die Struktur und wandert mit dem Marker nach oben mit; er wird
    // deshalb gegen den Container-Ursprung zurückversetzt.
    const ringOffsetY = target.y - (target.topY - MARKER_RISE_PX - this.bobOffset);
    marker.ring.setPosition(0, ringOffsetY).setVisible(decorative);
    if (decorative && marker.ringRadius !== target.radius) {
      marker.ringRadius = target.radius;
      marker.ring.clear();
      marker.ring.lineStyle(2, MARKER_COLOR, 0.34);
      marker.ring.strokeCircle(0, 0, target.radius);
      marker.ring.lineStyle(3, MARKER_CORE_COLOR, 0.16);
      marker.ring.strokeCircle(0, 0, target.radius - 4);
    }
  }

  /**
   * Ein Randpfeil je offener Struktur außerhalb des Bildes. Nur Pfeile, die am Rand ineinander
   * liefen, werden zu einem Pfeil mit Anzahl zusammengefasst.
   */
  private syncEdgeArrows(targets: readonly MarkerTarget[]): void {
    const camera = this.scene.cameras.main;
    const view = getVisibleWorldView(camera);
    const zoom = Math.max(0.001, camera.zoom);

    const candidates: EdgeMarkerCandidate[] = [];
    for (const target of targets) {
      if (isWorldPointInsideView(target.x, target.y, view)) continue;
      const edge = getArrowPointOnWorldViewEdge(target.x, target.y, view, EDGE_INSET_PX / zoom);
      const screenEdge = getArrowPointOnScreenViewEdge(target.x, target.y, view, camera, EDGE_INSET_PX);
      candidates.push({
        screenX: screenEdge.x,
        screenY: screenEdge.y,
        angle: Math.atan2(target.y - edge.y, target.x - edge.x),
        distancePx: Math.hypot(target.x - view.centerX, target.y - view.centerY),
        focused: target.focused,
      });
    }

    const clusters = clusterEdgeMarkers(candidates, EDGE_CLUSTER_PX, MAX_EDGE_ARROWS);
    for (let index = 0; index < this.edgeArrows.length; index += 1) {
      const visual = this.edgeArrows[index];
      const cluster = clusters[index];
      if (!cluster) {
        visual.arrow.setVisible(false);
        visual.label.setVisible(false);
        continue;
      }
      const alpha = cluster.focused ? 1 : 0.62;
      visual.arrow
        .setPosition(cluster.screenX, cluster.screenY)
        .setRotation(cluster.angle - Math.PI / 2)
        .setAlpha(alpha)
        .setVisible(true);
      // Beschriftung gegen die Zielrichtung nach innen versetzt, damit sie nicht aus dem Bild läuft.
      visual.label
        .setText(formatEdgeMarkerLabel(cluster, CELL_SIZE))
        .setPosition(
          cluster.screenX - Math.cos(cluster.angle) * 30,
          cluster.screenY - Math.sin(cluster.angle) * 30,
        )
        .setAlpha(alpha)
        .setVisible(true);
    }
  }

  private drawEdgeArrow(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();
    graphics.fillStyle(MARKER_COLOR, 0.95);
    fillDiamond(graphics, 11);
    graphics.lineStyle(2, MARKER_CORE_COLOR, 0.95);
    strokeDiamond(graphics, 11);
    // Kurze Spitze in Zielrichtung: Sie unterscheidet den Randpfeil von der ruhenden
    // Weltmarke und macht die Richtung auch bei kleiner Darstellung eindeutig.
    graphics.fillStyle(MARKER_CORE_COLOR, 0.95);
    graphics.fillTriangle(0, 20, -6, 10, 6, 10);
  }

  /** Rundengebundener Zustand; die Objekte selbst bleiben für die Szene bestehen. */
  clear(): void {
    // Wie im HUD: Vor dem ersten Trigger ist das der Normalfall jedes Frames.
    if (!this.built || !this.visible) return;
    this.visible = false;
    for (const marker of this.markers) marker.container.setVisible(false);
    for (const visual of this.edgeArrows) {
      visual.arrow.setVisible(false);
      visual.label.setVisible(false);
    }
    this.bobTween?.pause();
  }

  destroy(): void {
    this.bobTween?.destroy();
    this.bobTween = null;
    for (const marker of this.markers) marker.container.destroy(true);
    this.markers.length = 0;
    for (const visual of this.edgeArrows) {
      visual.arrow.destroy();
      visual.label.destroy();
    }
    this.edgeArrows.length = 0;
    this.built = false;
    this.visible = false;
  }
}

function diamondPoints(radius: number): Phaser.Math.Vector2[] {
  return [
    new Phaser.Math.Vector2(0, -radius),
    new Phaser.Math.Vector2(radius, 0),
    new Phaser.Math.Vector2(0, radius),
    new Phaser.Math.Vector2(-radius, 0),
  ];
}

function fillDiamond(graphics: Phaser.GameObjects.Graphics, radius: number): void {
  graphics.fillPoints(diamondPoints(radius), true);
}

function strokeDiamond(graphics: Phaser.GameObjects.Graphics, radius: number): void {
  graphics.strokePoints(diamondPoints(radius), true, true);
}
