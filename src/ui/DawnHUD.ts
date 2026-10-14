import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { DAWN_SITE_DISPLAY_SIZE } from '../assets/DawnAssets';
import { DAWN_UI_TEXTURES } from '../assets/DawnUiAssets';
import { getDawnSchedule } from '../config/dawn/dawnContent';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { WorldDescriptor } from '../world/WorldDescriptor';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';
import { resolveWorldDefinition } from '../world/WorldDefinitionResolution';
import { resolveCoopDefenseWorldMetrics, type WorldMetrics } from '../world/WorldMetrics';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { t } from '../i18n';
import { NightModifierAtmosphere } from '../effects/dawn/NightModifierAtmosphere';
import { HudCard } from './HudCard';
import type { CoopDefenseObjectiveAnnouncement } from './CoopDefenseObjectiveAnnouncement';
import { buildDawnHudModel, buildDawnSiteMarkers, resolveDawnHudWidth, type DawnSiteMarker } from './DawnHudModel';
import { dawnMarkers } from '../effects/markers/sources/DawnMarkerSource';
import type { MarkerDescriptor } from '../effects/markers/MarkerTypes';

const CARD = { x: 270, y: 66, width: 480, scale: 0.62 };

/** Scene-owned projection of replicated Dawn plans, time and objective state. */
export class DawnHUD {
  private readonly card: HudCard;
  private readonly atmosphere: NightModifierAtmosphere;
  private modifierIcon: Phaser.GameObjects.Image | null = null;
  private announcements: CoopDefenseObjectiveAnnouncement | null = null;
  private key = '';
  private phase = '';
  private signature = '';
  private world: WorldDefinition | null = null;
  private metrics: WorldMetrics | null = null;
  private sites: readonly DawnSiteMarker[] = [];
  private markers: readonly MarkerDescriptor[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.atmosphere = new NightModifierAtmosphere(scene);
    this.card = new HudCard(scene, { ...CARD, tone: 'neutral', titleSize: 14, valueSize: 14, kickerSize: 10,
      valueIcon: { key: DAWN_UI_TEXTURES.scrap, size: 18 },
      kickerIcon: { key: DAWN_UI_TEXTURES.threat, size: 18 },
    });
    this.card.root.setPosition(CARD.x, CARD.y).setDepth(DEPTH.OVERLAY).setScrollFactor(0).setVisible(false);
    promoteToClarityCamera(scene, this.card.root);
  }

  setObjectiveAnnouncements(announcements: CoopDefenseObjectiveAnnouncement): void { this.announcements = announcements; }

  sync(input: {
    active: boolean; world: WorldDescriptor | null; activity: ActivityDescriptor | null;
    startTime: number; now: number; sharedScrap: number;
    objectives: CoopDefenseSecondaryObjectivePresentationState | null;
    /** Dargestellte Tageszeit des Lichtsystems. */
    clockMinutes: number;
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
      sharedScrap: input.sharedScrap, threat: plan.threat, dayNumber: plan.dayNumber, sites: this.sites, objectives: input.objectives,
      clockMinutes: input.clockMinutes, nightModifierId: plan.nightModifierId });
    this.atmosphere.sync(model.nightModifier?.id, model.phase, input.now - input.startTime);
    const modifierLabel = model.nightModifier ? t(model.nightModifier.nameKey) : '';
    const label = t(`ui.dawn.phase.${model.phase}`);
    const kicker = t('ui.dawn.dayThreat', { day: model.dayNumber, threat: model.threat });
    const tone = model.phase === 'night' ? 'purple' : model.phase === 'dawn' ? 'green' : model.phase === 'dusk' ? 'orange' : 'neutral';
    if (this.phase !== model.phase) {
      this.phase = model.phase;
      this.announcements?.enqueue({ id: `dawn:${key}:${model.phase}`, topic: 'dawn-phase', priority: 50,
        kicker, title: model.phase === 'night' && modifierLabel ? modifierLabel.toLocaleUpperCase() : label,
        tone: model.phase === 'night' ? 'wave' : model.phase === 'dawn' ? 'positive' : 'main',
        ...(model.returnToBase ? { detail: t('ui.dawn.returnToBase') } : {}),
      });
    }
    const remaining = `${Math.floor(model.remainingSeconds / 60)}:${(model.remainingSeconds % 60).toString().padStart(2, '0')}`;
    const signature = [label, kicker, model.clock, remaining, model.scrap, model.returnToBase, modifierLabel].join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      const phaseKicker = [kicker, model.returnToBase ? t('ui.dawn.returnToBase') : '', modifierLabel].filter(Boolean).join(' · ');
      this.card.setTone(tone).setKicker(phaseKicker)
        .setValue(t('ui.dawn.scrapCount', { scrap: model.scrap }));
      const title = t('ui.dawn.phaseTime', { phase: label, clock: model.clock, time: remaining });
      this.card.title.setText(title);
      this.card.setWidth(resolveDawnHudWidth({ minimum: CARD.width,
        inset: this.card.width / 2 - this.card.contentRight,
        title: this.card.title.width, value: this.card.value.width, kicker: this.card.kicker.width,
        valueIcon: this.card.valueIconWidth, kickerIcon: this.card.kickerIconWidth
          + (model.nightModifier && this.scene.textures.exists(model.nightModifier.iconKey) ? 24 : 0),
      })).setTitle(title);
      // Keep the original left edge when long phase names or counters need more room.
      this.card.root.setPosition(CARD.x - CARD.width / 2 + this.card.width / 2, CARD.y);
    }
    this.card.setProgress(model.remainingFraction).root.setVisible(true);
    this.syncModifierIcon(model.nightModifier?.iconKey);
    const anchor = this.world.persistentBaseSite?.anchor;
    // Sites and the dusk return are projected onto the shared marker system (one key per site).
    this.markers = dawnMarkers({ phase: model.phase, returnToBase: model.returnToBase, objectives: input.objectives,
      sites: this.sites.map(site => ({ ...site, targetHalfHeight: DAWN_SITE_DISPLAY_SIZE / 2 })), origin: this.metrics,
      base: anchor ?? null,
      clock: { nowMs: this.scene.time.now, elapsedMs: input.now - input.startTime } });
  }

  /** Marker candidates of the last sync; empty outside an active Dawn round. */
  getMarkerDescriptors(): readonly MarkerDescriptor[] { return this.markers; }

  getReservedHudRects() {
    return this.card.root.visible ? [{ left: this.card.root.x - this.card.width / 2, right: this.card.root.x + this.card.width / 2,
      top: CARD.y - this.card.height / 2, bottom: CARD.y + this.card.height / 2 }] : [];
  }

  private syncModifierIcon(key?: string): void {
    if (!key || !this.scene.textures.exists(key)) { this.modifierIcon?.setVisible(false); return; }
    if (!this.modifierIcon) {
      this.modifierIcon = this.scene.add.image(0, 0, key).setDisplaySize(18, 18);
      this.card.root.add(this.modifierIcon);
      promoteToClarityCamera(this.scene, this.modifierIcon);
    }
    this.modifierIcon.setTexture(key).setDisplaySize(18, 18).setVisible(true)
      .setPosition(this.card.contentRight - 9, this.card.kicker.y);
  }

  private clear(): void {
    this.markers = [];
    this.card.root.setVisible(false);
    this.atmosphere.clear();
    this.modifierIcon?.setVisible(false);
    if (!this.key) return;
    this.announcements?.clearTopic('dawn-phase');
    this.key = ''; this.phase = ''; this.signature = ''; this.world = null; this.metrics = null; this.sites = [];
    this.markers = [];
  }

  destroy(): void { this.clear(); this.atmosphere.destroy(); this.card.destroy(); }
}
