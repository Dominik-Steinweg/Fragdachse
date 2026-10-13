import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { getDawnSchedule } from '../config/dawn/dawnContent';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { WorldDescriptor } from '../world/WorldDescriptor';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';
import { resolveWorldDefinition } from '../world/WorldDefinitionResolution';
import { resolveCoopDefenseWorldMetrics, type WorldMetrics } from '../world/WorldMetrics';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { t } from '../i18n';
import { HudCard } from './HudCard';
import type { CoopDefenseObjectiveAnnouncement } from './CoopDefenseObjectiveAnnouncement';
import { getArrowPointOnScreenViewEdge, getVisibleWorldView, isWorldPointInsideView } from './HostileBaseIndicator';
import { buildDawnHudModel, buildDawnSiteMarkers, type DawnSiteMarker } from './DawnHudModel';

const CARD = { x: 270, y: 66, width: 480, scale: 0.62 };

/** Scene-owned projection of replicated Dawn plans, time and objective state. */
export class DawnHUD {
  private readonly card: HudCard;
  private announcements: CoopDefenseObjectiveAnnouncement | null = null;
  private key = '';
  private phase = '';
  private signature = '';
  private world: WorldDefinition | null = null;
  private metrics: WorldMetrics | null = null;
  private sites: readonly DawnSiteMarker[] = [];
  private readonly markers = new Map<string, { world: Phaser.GameObjects.Graphics; edge: Phaser.GameObjects.Graphics }>();

  constructor(private readonly scene: Phaser.Scene) {
    this.card = new HudCard(scene, { ...CARD, tone: 'neutral', titleSize: 14, valueSize: 14, kickerSize: 10 });
    this.card.root.setPosition(CARD.x, CARD.y).setDepth(DEPTH.OVERLAY).setScrollFactor(0).setVisible(false);
    promoteToClarityCamera(scene, this.card.root);
  }

  setObjectiveAnnouncements(announcements: CoopDefenseObjectiveAnnouncement): void { this.announcements = announcements; }

  sync(input: {
    active: boolean; world: WorldDescriptor | null; activity: ActivityDescriptor | null;
    startTime: number; now: number; sharedScrap: number;
    objectives: CoopDefenseSecondaryObjectivePresentationState | null;
  }): void {
    const plan = input.activity?.parameters?.dawn;
    if (!input.active || !plan || !input.world?.parameters?.dawn || input.startTime <= 0) {
      this.clear();
      return;
    }
    const key = `${input.world.worldRevision}:${input.startTime}`;
    if (key !== this.key) {
      this.clear();
      this.key = key;
      this.world = resolveWorldDefinition(input.world, input.activity);
      if (!this.world) return;
      this.metrics = resolveCoopDefenseWorldMetrics(this.world.metrics.widthCells, this.world.metrics.heightCells);
      this.sites = buildDawnSiteMarkers(input.world.parameters.dawn, this.world);
    }
    if (!this.world || !this.metrics) return;
    const model = buildDawnHudModel({ schedule: getDawnSchedule(plan.scheduleId), elapsedMs: input.now - input.startTime,
      sharedScrap: input.sharedScrap, threat: plan.threat, dayNumber: plan.dayNumber, sites: this.sites, objectives: input.objectives });
    const label = t(`ui.dawn.phase.${model.phase}`);
    const kicker = t('ui.dawn.dayThreat', { day: model.dayNumber, threat: model.threat });
    const tone = model.phase === 'night' ? 'purple' : model.phase === 'dawn' ? 'green' : model.phase === 'dusk' ? 'orange' : 'neutral';
    if (this.phase !== model.phase) {
      this.phase = model.phase;
      this.announcements?.enqueue({ id: `dawn:${key}:${model.phase}`, topic: 'dawn-phase', priority: 50,
        kicker, title: label, tone: model.phase === 'night' ? 'wave' : model.phase === 'dawn' ? 'positive' : 'main',
        ...(model.returnToBase ? { detail: t('ui.dawn.returnToBase') } : {}),
      });
    }
    const remaining = `${Math.floor(model.remainingSeconds / 60)}:${(model.remainingSeconds % 60).toString().padStart(2, '0')}`;
    const signature = [label, kicker, model.clock, remaining, model.scrap, model.returnToBase].join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.card.setTone(tone).setKicker(model.returnToBase ? `${kicker} · ${t('ui.dawn.returnToBase')}` : kicker)
        .setValue(t('ui.dawn.scrapCount', { scrap: model.scrap }))
        .setTitle(t('ui.dawn.phaseTime', { phase: label, clock: model.clock, time: remaining }));
    }
    this.card.setProgress(model.remainingFraction).root.setVisible(true);
    const targets = model.sites.map(site => ({ id: site.objectiveId, ...site }));
    const anchor = this.world.persistentBaseSite?.anchor;
    if (model.returnToBase && anchor) targets.push({ id: 'return-base', objectiveId: 'return-base', visualKey: 'return-base', ...anchor });
    const visible = new Set(targets.map(target => target.id));
    for (const [id, marker] of this.markers) {
      if (!visible.has(id)) { marker.world.setVisible(false); marker.edge.setVisible(false); }
    }
    const camera = this.scene.cameras.main, view = getVisibleWorldView(camera);
    for (const target of targets) {
      let marker = this.markers.get(target.id);
      if (!marker) {
        marker = { world: this.createMarker(target.visualKey), edge: this.createMarker(target.visualKey) };
        marker.edge.setScrollFactor(0).setDepth(DEPTH.OVERLAY);
        this.markers.set(target.id, marker);
      }
      const x = this.metrics.offsetX + (target.gridX + 0.5) * CELL_SIZE;
      const y = this.metrics.offsetY + (target.gridY + 0.5) * CELL_SIZE;
      const inside = isWorldPointInsideView(x, y, view);
      // Clarity has no scroll; project world targets into the shared design space explicitly.
      marker.world.setPosition(camera.x / camera.zoom + x - view.x, camera.y / camera.zoom + y - view.y).setVisible(inside);
      marker.edge.setVisible(!inside);
      if (!inside) {
        const edge = getArrowPointOnScreenViewEdge(x, y, view, camera, 30);
        marker.edge.setPosition(edge.x, edge.y);
      }
    }
  }

  /** Replace these keyed drawings with final visualKey assets after the gameplay gate. */
  private createMarker(visualKey: string): Phaser.GameObjects.Graphics {
    const marker = this.scene.add.graphics().setDepth(DEPTH.BASES + 8).setScrollFactor(0);
    registerGraphicsObject(this.scene, 'baseMarkers', marker);
    // Both the world badge and its edge counterpart are navigation UI, independent of world lighting.
    promoteToClarityCamera(this.scene, marker);
    const home = visualKey === 'return-base';
    marker.fillStyle(0x101916, 0.82).lineStyle(2, home ? 0xe8b46a : 0x79b8dc, 1);
    marker.beginPath().moveTo(0, -19).lineTo(19, 0).lineTo(0, 19).lineTo(-19, 0)
      .closePath().fillPath().strokePath();
    if (home) {
      marker.strokeRect(-7, -7, 14, 14).lineBetween(-10, 0, 10, 0).lineBetween(0, -10, 0, 10);
    } else if (visualKey.includes('extractor')) {
      marker.strokeRect(-7, -9, 14, 18).lineBetween(0, -12, 0, 12).lineBetween(-10, 0, 10, 0);
    } else {
      marker.strokeTriangle(-9, 7, -4, -8, 10, 4).lineBetween(-6, 2, 7, -2);
    }
    const tier = Number(visualKey.match(/-t([1-3])$/)?.[1] ?? 0);
    for (let index = 0; index < tier; index++) marker.fillStyle(0x79b8dc).fillRect((index - (tier - 1) / 2) * 6 - 2, 22, 4, 4);
    return marker;
  }

  getReservedHudRects() {
    return this.card.root.visible ? [{ left: CARD.x - CARD.width / 2, right: CARD.x + CARD.width / 2,
      top: CARD.y - this.card.height / 2, bottom: CARD.y + this.card.height / 2 }] : [];
  }

  private clear(): void {
    this.card.root.setVisible(false);
    if (!this.key) return;
    this.announcements?.clearTopic('dawn-phase');
    this.key = ''; this.phase = ''; this.signature = ''; this.world = null; this.metrics = null; this.sites = [];
    for (const marker of this.markers.values()) { marker.world.destroy(); marker.edge.destroy(); }
    this.markers.clear();
  }

  destroy(): void { this.clear(); this.card.destroy(); }
}
