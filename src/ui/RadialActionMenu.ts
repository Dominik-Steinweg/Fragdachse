import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { toDesignSpace } from '../graphics/RenderResolution';
import { formatNumber, getLocale, t } from '../i18n';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import {
  cloneRadialActionRef,
  isSameRadialActionRef,
  type RadialActionCategory,
  type RadialActionDisabledReason,
  type RadialActionRef,
  type RadialActionState,
} from '../systems/RadialActionModel';
import { HudCard, HUD_TEXT_MUTED, HUD_TEXT_PRIMARY, hudTextStyle } from './HudCard';
import { HUD_TONES, hudToneForColor, type HudTone } from './HudFrameAssets';
import { fitLoadoutIcon, getLoadoutIconTextureKey } from './LoadoutIconLayout';
import {
  ensureRadialCooldownTexture,
  ensureRadialHubTexture,
  ensureRadialPointerTexture,
  ensureRadialSegmentTextures,
  ensureRadialSoftTexture,
  ensureRadialVignetteTexture,
  RADIAL_COOLDOWN_RADIUS,
  RADIAL_TEXTURE_SS,
  radialCooldownFrame,
} from './RadialActionMenuTextures';
import { getRadialMenuSegmentIndex } from './RadialMenuGeometry';
import {
  RADIAL_HUB_FRAME,
  RADIAL_HUB_GEOMETRY,
  RADIAL_RING_FRAME,
  RADIAL_RING_GEOMETRY,
  RADIAL_WHEEL_TEXTURE,
  radialManagementIconFrame,
} from './RadialWheelAssets';
import { lerpColor } from './uiColor';
import { ensureUpgradeIcon } from './upgradeForestTextures';

/** Außenkante des gemalten Nabenrings; zugleich die Totzone der Auswahl. */
const HUB_RING_RADIUS = 40;
const INNER_RADIUS = HUB_RING_RADIUS;
const HUB_GLASS_RADIUS = 30;
/** Icon der ausgerüsteten Aktion in der Nabe; passt in die Öffnung des Nabenrings. */
const HUB_ICON_SIZE = 34;
const POINTER_RADIUS = 46;
const RING_INNER_RADIUS = 53;
/** So weit reichen die Glassegmente unter die Innenkante des gemalten Rings. */
const RING_TUCK = 3;
const FOCUS_OFFSET = 3;
const FOCUS_SMOOTHING_MS = 55;
const OPEN_MS = 150;
const CLOSE_MS = 110;
const HALO_PULSE_MS = 1_400;
const CARD_SCALE = 0.5;
const CARD_WIDTH = 300;
/** Transparente Zeilen über der oberen Holzschiene der Kartenform (Quellpixel). */
const CARD_TOP_PADDING = 15;
const SCREEN_MARGIN = 8;
const INV_SS = 1 / RADIAL_TEXTURE_SS;

function getOuterRadius(count: number): number {
  return Math.min(184, 140 + Math.max(0, count - 6) * 8);
}

function easeOutCubic(value: number): number {
  const clamped = Phaser.Math.Clamp(value, 0, 1);
  return 1 - (1 - clamped) ** 3;
}

/**
 * Farbfamilie eines Eintrags nach der HUD-Farbsprache: Orange Utility, Bronze Bauwerke,
 * Gold Belohnungen, Neutral Verwaltung. Temporäre Utilities mit eigener Power-Up-Farbe
 * übernehmen deren nächstliegende Familie.
 */
function getRadialActionTone(entry: RadialActionState): HudTone {
  switch (entry.category) {
    case 'construction': return 'bronze';
    case 'persistentReward': return 'gold';
    case 'managementAction': return 'neutral';
    case 'temporaryUtility':
      return entry.accentColor === COLORS.GOLD_2 ? 'orange' : hudToneForColor(entry.accentColor);
    case 'utility':
    case 'specialPower':
      return 'orange';
  }
}

interface EntryStatus {
  readonly cooldownRemaining: number;
  readonly cooldownActive: boolean;
  readonly available: boolean;
  /** Nicht wählbar aus einem anderen Grund als einem laufenden Cooldown. */
  readonly blocked: boolean;
}

function getEntryStatus(entry: RadialActionState, now: number): EntryStatus {
  const cooldownRemaining = Math.max(0, entry.cooldownUntil - now);
  const cooldownActive = cooldownRemaining > 0;
  const available = entry.available || (entry.disabledReason === 'cooldown' && !cooldownActive);
  return { cooldownRemaining, cooldownActive, available, blocked: !available && !cooldownActive };
}

function formatSeconds(ms: number): string {
  return formatNumber(ms / 1000, getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });
}

interface SegmentView {
  readonly entry: RadialActionState;
  readonly tone: HudTone;
  readonly angle: number;
  readonly root: Phaser.GameObjects.Container;
  readonly base: Phaser.GameObjects.Image;
  readonly fill: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  readonly rim: Phaser.GameObjects.Image;
  readonly halo: Phaser.GameObjects.Image;
  readonly equip: Phaser.GameObjects.Image;
  readonly iconGlow: Phaser.GameObjects.Image;
  readonly icon: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
  readonly iconBaseScale: number;
  readonly iconTextureKey: string | null;
  readonly cooldown: Phaser.GameObjects.Image;
  readonly cooldownText: Phaser.GameObjects.Text;
  readonly badge: Phaser.GameObjects.Text;
  focus: number;
  muted: boolean;
}

/**
 * Screen-space renderer for the flat, domain-neutral action ring.
 *
 * Aufbau: dunkle Vignette, ein Glassegment pro Aktion unter dem gemalten Waldboden-Ring, eine
 * Nabe mit Richtungszeiger und darunter eine HUD-Karte mit Kategorie, Name und Status des
 * fokussierten Eintrags. Fokussiert ist der Eintrag unter dem Zeiger, sonst die ausgerüstete
 * Aktion; er erhält eine getönte Glasfüllung, einen hellen Saum und einen Lichtsaum. Die
 * ausgerüstete Aktion zeigt ihr Icon in der Nabe und trägt an der Innenkante ihres Segments
 * eine goldene Leiste.
 *
 * Alle Objekte entstehen beim Öffnen; pro Frame ändern sich nur Transformation, Tönung,
 * Deckkraft und Statustexte.
 */
export class RadialActionMenu {
  private container: Phaser.GameObjects.Container | null = null;
  private segments: SegmentView[] = [];
  private card: HudCard | null = null;
  private pointer: Phaser.GameObjects.Image | null = null;
  private readonly closing = new Set<Phaser.GameObjects.Container>();
  private entries: readonly RadialActionState[] = [];
  private currentIndex = -1;
  private hoveredIndex = -1;
  private cardIndex = -1;
  private origin = { x: 0, y: 0 };
  private openedAt = 0;
  private lastRenderAt = 0;
  private pointerAngle = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  get isOpen(): boolean {
    return this.container !== null;
  }

  open(
    originX: number,
    originY: number,
    entries: readonly RadialActionState[],
    selected: RadialActionRef | null,
  ): void {
    this.close();
    this.entries = entries.map((entry) => ({ ...entry, ref: cloneRadialActionRef(entry.ref) }));
    if (this.entries.length === 0) return;
    this.origin = {
      x: toDesignSpace(this.scene.scale, originX),
      y: toDesignSpace(this.scene.scale, originY),
    };
    this.currentIndex = selected
      ? this.entries.findIndex((entry) => isSameRadialActionRef(entry.ref, selected))
      : 0;
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.hoveredIndex = -1;
    this.cardIndex = -1;
    const now = Date.now();
    this.openedAt = now;
    this.lastRenderAt = now;
    this.build();
    this.render(now);
  }

  update(pointerX: number, pointerY: number, now = Date.now()): void {
    if (!this.container || this.entries.length === 0) return;
    const designX = toDesignSpace(this.scene.scale, pointerX);
    const designY = toDesignSpace(this.scene.scale, pointerY);
    this.hoveredIndex = getRadialMenuSegmentIndex(
      designX - this.origin.x,
      designY - this.origin.y,
      this.entries.length,
      INNER_RADIUS,
    ) ?? -1;
    this.render(now);
  }

  close(pointerX?: number, pointerY?: number): RadialActionRef | null {
    return this.closeMenu(true, pointerX, pointerY);
  }

  destroy(): void {
    this.closeMenu(false);
    for (const container of this.closing) {
      this.scene.tweens?.killTweensOf(container);
      container.destroy();
    }
    this.closing.clear();
  }

  private get focusIndex(): number {
    return this.hoveredIndex >= 0 ? this.hoveredIndex : this.currentIndex;
  }

  private closeMenu(animate: boolean, pointerX?: number, pointerY?: number): RadialActionRef | null {
    if (pointerX !== undefined && pointerY !== undefined) this.update(pointerX, pointerY);
    const entry = this.hoveredIndex >= 0 ? this.entries[this.hoveredIndex] : undefined;
    const selection = entry ? cloneRadialActionRef(entry.ref) : null;
    const container = this.container;
    if (container) {
      const chosen = this.hoveredIndex >= 0 ? this.segments[this.hoveredIndex] : undefined;
      if (animate && this.scene.tweens) {
        // Kurzes Nachleuchten der gewählten Aktion, dann blendet das Rad aus.
        chosen?.glow.setAlpha(0.9);
        chosen?.halo.setAlpha(1);
        chosen?.iconGlow.setAlpha(0.8);
        this.closing.add(container);
        this.scene.tweens.add({
          targets: container,
          alpha: 0,
          scale: container.scale * 1.035,
          duration: CLOSE_MS,
          ease: 'Quad.easeOut',
          onComplete: () => {
            this.closing.delete(container);
            container.destroy();
          },
        });
      } else {
        container.destroy();
      }
    }
    this.container = null;
    this.segments = [];
    this.card = null;
    this.pointer = null;
    this.entries = [];
    this.currentIndex = -1;
    this.hoveredIndex = -1;
    this.cardIndex = -1;
    return selection;
  }

  private build(): void {
    const scene = this.scene;
    const count = this.entries.length;
    const outer = getOuterRadius(count);
    const container = scene.add.container(this.origin.x, this.origin.y)
      .setScrollFactor(0)
      .setDepth(DEPTH.LOCAL_UI + 20);
    this.container = container;
    promoteToClarityCamera(scene, container);

    const hasArtwork = scene.textures.exists(RADIAL_WHEEL_TEXTURE);
    const ring = RADIAL_RING_GEOMETRY;
    const ringScale = (outer - RING_TUCK) / ring.innerRadius;
    const ringExtent = (ring.size / 2) * ringScale;

    const vignetteSize = (ringExtent + 64) * 2;
    container.add(scene.add.image(0, 0, ensureRadialVignetteTexture(scene)).setDisplaySize(vignetteSize, vignetteSize));

    const textures = ensureRadialSegmentTextures(scene, count, RING_INNER_RADIUS, outer);
    const cooldownTexture = ensureRadialCooldownTexture(scene);
    const softTexture = ensureRadialSoftTexture(scene);
    const step = (Math.PI * 2) / count;
    const iconRadius = (RING_INNER_RADIUS + outer) / 2 - 5;
    const chord = count > 1 ? 2 * iconRadius * Math.sin(step / 2) : 80;
    const iconSize = Math.round(Math.min(42, chord * 0.6, (outer - RING_INNER_RADIUS) * 0.5));
    // Unter dem Icon statt radial außen: bleibt bei jeder Segmentlage frei von Icon und dem
    // Efeu, das stellenweise über die Ringinnenkante ragt.
    const badgeOffset = iconSize / 2 + 10;
    // Lichtsäume liegen über allen Segmenten, damit sie auch über die Nachbarkanten strahlen.
    const halos = scene.add.container(0, 0);

    this.segments = this.entries.map((entry, index) => {
      const angle = -Math.PI / 2 + (index + 0.5) * step;
      const tone = getRadialActionTone(entry);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const layer = (key: string): Phaser.GameObjects.Image => scene.add.image(0, 0, key)
        .setOrigin(textures.originX, textures.originY)
        .setRotation(angle)
        .setScale(INV_SS);
      const base = layer(textures.base);
      const fill = layer(textures.fill).setAlpha(0);
      const glow = layer(textures.glow).setBlendMode(Phaser.BlendModes.ADD);
      const rim = layer(textures.rim);
      const halo = layer(textures.halo).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      const equip = layer(textures.equip).setTint(HUD_TONES.gold.accent).setVisible(index === this.currentIndex);
      halos.add(halo);
      const iconX = iconRadius * cos;
      const iconY = iconRadius * sin;
      const iconGlow = scene.add.image(iconX, iconY, softTexture)
        .setDisplaySize(iconSize * 2.2, iconSize * 2.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);

      const { icon, textureKey: iconTextureKey } = this.createIcon(entry, iconX, iconY, iconSize);

      const cooldown = scene.add.image(iconX, iconY, cooldownTexture, radialCooldownFrame(1))
        .setScale((iconSize * 0.62) / RADIAL_COOLDOWN_RADIUS * INV_SS)
        .setVisible(false);
      const cooldownText = scene.add.text(iconX, iconY, '', hudTextStyle(13, HUD_TEXT_PRIMARY, true))
        .setOrigin(0.5)
        .setVisible(false);
      const badge = scene.add.text(iconX, iconY + badgeOffset, '', hudTextStyle(11, COLORS.GOLD_2, true))
        .setOrigin(0.5)
        .setVisible(false);

      const root = scene.add.container(0, 0, [base, fill, glow, rim, equip, iconGlow, icon, cooldown, cooldownText, badge]);
      container.add(root);
      return {
        entry, tone, angle, root, base, fill, glow, rim, halo, equip, iconGlow, icon,
        iconBaseScale: icon.scaleX,
        iconTextureKey,
        cooldown, cooldownText, badge,
        focus: 0,
        muted: false,
      };
    });
    container.add(halos);

    if (hasArtwork) {
      container.add(scene.add.image(0, 0, RADIAL_WHEEL_TEXTURE, RADIAL_RING_FRAME)
        .setOrigin(ring.centerX / ring.size, ring.centerY / ring.size)
        .setScale(ringScale));
    }
    container.add(scene.add.image(0, 0, ensureRadialHubTexture(scene, HUB_GLASS_RADIUS)).setScale(INV_SS));
    if (hasArtwork) {
      const hub = RADIAL_HUB_GEOMETRY;
      container.add(scene.add.image(0, 0, RADIAL_WHEEL_TEXTURE, RADIAL_HUB_FRAME)
        .setOrigin(hub.centerX / hub.size, hub.centerY / hub.size)
        .setScale(HUB_RING_RADIUS / hub.outerRadius));
    }
    this.pointer = scene.add.image(0, 0, ensureRadialPointerTexture(scene)).setScale(INV_SS);
    this.pointerAngle = this.segments[this.focusIndex]?.angle ?? 0;
    container.add(this.pointer);
    const equipped = this.entries[this.currentIndex];
    if (equipped) container.add(this.createIcon(equipped, 0, 0, HUB_ICON_SIZE).icon);

    // Fester neutraler Rahmen: nur Kicker und Füllung wechseln die Farbfamilie, die Karte
    // selbst bleibt beim Durchblättern pixelgleich.
    const card = new HudCard(scene, {
      scale: CARD_SCALE, width: CARD_WIDTH, tone: 'orange', frameTone: 'neutral', titleSize: 15, valueSize: 13,
    });
    const reach = ringExtent + card.height / 2 - CARD_TOP_PADDING * CARD_SCALE + 2;
    const fitsBelow = this.origin.y + reach + card.height / 2 <= GAME_HEIGHT - SCREEN_MARGIN;
    const halfWidth = CARD_WIDTH / 2;
    const cardX = Phaser.Math.Clamp(
      0,
      SCREEN_MARGIN + halfWidth - this.origin.x,
      GAME_WIDTH - SCREEN_MARGIN - halfWidth - this.origin.x,
    );
    card.root.setPosition(cardX, fitsBelow ? reach : -reach);
    container.add(card.root);
    this.card = card;
  }

  private render(now: number): void {
    const container = this.container;
    if (!container) return;
    const dt = Phaser.Math.Clamp(now - this.lastRenderAt, 0, 80);
    this.lastRenderAt = now;
    const smoothing = 1 - Math.exp(-dt / FOCUS_SMOOTHING_MS);
    const elapsed = now - this.openedAt;
    const opening = easeOutCubic(elapsed / OPEN_MS);
    container.setAlpha(opening).setScale(0.92 + 0.08 * opening);

    const count = this.segments.length;
    const focusIndex = this.focusIndex;
    const stagger = Math.min(16, 110 / Math.max(1, count));
    const pulse = 0.82 + 0.18 * Math.sin((elapsed / HALO_PULSE_MS) * Math.PI * 2);
    for (let index = 0; index < count; index += 1) {
      const view = this.segments[index];
      const target = index === focusIndex ? 1 : 0;
      // Beim Öffnen steht der Fokus sofort auf der ausgerüsteten Aktion.
      view.focus = elapsed <= 0 ? target : view.focus + (target - view.focus) * smoothing;
      if (Math.abs(target - view.focus) < 0.002) view.focus = target;
      const reveal = easeOutCubic((elapsed - index * stagger) / OPEN_MS);
      this.renderSegment(view, index === this.currentIndex, reveal, pulse, now);
    }

    this.renderPointer(smoothing);
    this.renderCard(now);
  }

  private renderSegment(view: SegmentView, equipped: boolean, reveal: number, pulse: number, now: number): void {
    const style = HUD_TONES[view.tone];
    const status = getEntryStatus(view.entry, now);
    const focus = view.focus;
    const offset = FOCUS_OFFSET * focus - (1 - reveal) * 12;
    const dx = Math.cos(view.angle) * offset;
    const dy = Math.sin(view.angle) * offset;
    view.root.setPosition(dx, dy).setAlpha(reveal);
    view.halo.setPosition(dx, dy);

    const accent = status.blocked ? COLORS.RED_2 : style.accent;
    const fillColor = status.blocked ? COLORS.RED_4 : lerpColor(style.fill.dark, style.fill.mid, 0.35);
    const resting = status.blocked ? COLORS.RED_3 : style.muted;
    view.fill.setTint(fillColor).setAlpha((status.blocked ? 0.4 : 0.78) * focus);
    view.glow.setTint(accent).setAlpha(0.03 + (equipped ? 0.07 : 0) + 0.2 * focus);
    view.rim.setTint(lerpColor(resting, accent, Math.max(focus, equipped ? 0.5 : 0)))
      .setAlpha(0.4 + (equipped ? 0.2 : 0) + 0.6 * focus);
    view.halo.setTint(accent).setAlpha(reveal * focus * pulse * (status.blocked ? 0.45 : 0.9));
    view.iconGlow.setTint(accent).setAlpha((status.cooldownActive || status.blocked ? 0.1 : 0.32) * focus);

    this.setIconMuted(view, status.blocked);
    view.icon.setScale(view.iconBaseScale * (1 + 0.16 * focus));
    const iconAlpha = status.blocked ? 0.75 : status.cooldownActive ? 0.5 : 0.8;
    view.icon.setAlpha(iconAlpha + (1 - iconAlpha) * focus * (status.cooldownActive ? 0.3 : 1));

    const showCooldown = status.cooldownActive && view.entry.cooldownDurationMs > 0;
    view.cooldown.setVisible(showCooldown);
    view.cooldownText.setVisible(status.cooldownActive);
    if (status.cooldownActive) {
      if (showCooldown) {
        view.cooldown.setFrame(radialCooldownFrame(status.cooldownRemaining / view.entry.cooldownDurationMs));
      }
      const seconds = formatSeconds(status.cooldownRemaining);
      if (view.cooldownText.text !== seconds) view.cooldownText.setText(seconds);
    }

    const badge = this.getBadge(view.entry);
    view.badge.setVisible(badge !== null);
    if (badge) {
      if (view.badge.text !== badge.text) view.badge.setText(badge.text);
      view.badge.setColor(toCssColor(badge.color))
        .setAlpha(status.blocked && badge.color !== COLORS.RED_2 ? 0.6 : 0.8 + 0.2 * focus);
    }
  }

  /** Loadout-Icon, gemaltes Verwaltungs-Icon oder als Rückfall der Anfangsbuchstabe. */
  private createIcon(
    entry: RadialActionState,
    x: number,
    y: number,
    size: number,
  ): { icon: Phaser.GameObjects.Image | Phaser.GameObjects.Text; textureKey: string | null } {
    const scene = this.scene;
    if (entry.iconKey && scene.textures.exists(entry.iconKey)) {
      const textureKey = getLoadoutIconTextureKey(scene, entry.iconKey);
      return { icon: fitLoadoutIcon(scene.add.image(x, y, textureKey), size, size), textureKey };
    }
    if (entry.ref.kind === 'management' && scene.textures.exists(RADIAL_WHEEL_TEXTURE)) {
      const frame = radialManagementIconFrame(entry.ref.action);
      return { icon: fitLoadoutIcon(scene.add.image(x, y, RADIAL_WHEEL_TEXTURE, frame), size * 1.08, size * 1.08), textureKey: null };
    }
    const letter = entry.label.trim().charAt(0).toLocaleUpperCase();
    return {
      icon: scene.add.text(x, y, letter, hudTextStyle(Math.round(size * 0.62), HUD_TEXT_PRIMARY)).setOrigin(0.5),
      textureKey: null,
    };
  }

  private setIconMuted(view: SegmentView, muted: boolean): void {
    if (view.muted === muted) return;
    view.muted = muted;
    if (!(view.icon instanceof Phaser.GameObjects.Image)) {
      view.icon.setColor(toCssColor(muted ? HUD_TEXT_MUTED : HUD_TEXT_PRIMARY));
      return;
    }
    if (view.iconTextureKey) {
      view.icon.setTexture(muted ? ensureUpgradeIcon(this.scene, view.iconTextureKey, false, true) : view.iconTextureKey);
    } else {
      view.icon.setTint(muted ? 0x8a8a8a : 0xffffff);
    }
  }

  private getBadge(entry: RadialActionState): { text: string; color: number } | null {
    if (entry.charges !== undefined) {
      return {
        text: entry.maxCharges === undefined ? `×${entry.charges}` : `${entry.charges}/${entry.maxCharges}`,
        color: entry.disabledReason === 'no-charges' || entry.charges <= 0 ? COLORS.RED_2 : COLORS.GOLD_1,
      };
    }
    if ((entry.capacityCost ?? 0) > 0) {
      return {
        text: t('ui.radial.capacity', { cost: entry.capacityCost ?? 0 }),
        color: entry.disabledReason === 'capacity' ? COLORS.RED_2 : HUD_TONES.bronze.accent,
      };
    }
    return null;
  }

  /** Zeiger zwischen Nabe und Segmenten dreht auf kürzestem Weg zum fokussierten Segment. */
  private renderPointer(smoothing: number): void {
    const pointer = this.pointer;
    const focused = this.segments[this.focusIndex];
    if (!pointer || !focused) return;
    const delta = Phaser.Math.Angle.Wrap(focused.angle - this.pointerAngle);
    this.pointerAngle += delta * Math.min(1, smoothing * 1.6);
    const blocked = getEntryStatus(focused.entry, this.lastRenderAt).blocked;
    pointer
      .setTint(blocked ? COLORS.RED_2 : HUD_TONES[focused.tone].accent)
      .setPosition(Math.cos(this.pointerAngle) * POINTER_RADIUS, Math.sin(this.pointerAngle) * POINTER_RADIUS)
      .setRotation(this.pointerAngle + Math.PI / 2);
  }

  private renderCard(now: number): void {
    const card = this.card;
    if (!card) return;
    const index = this.focusIndex;
    const view = this.segments[index];
    if (!view) {
      card.root.setVisible(false);
      return;
    }
    card.root.setVisible(true);
    const entry = view.entry;
    const status = getEntryStatus(entry, now);
    const value = this.getCardValue(entry, status);
    if (index !== this.cardIndex) {
      this.cardIndex = index;
      card.setTone(status.blocked ? 'red' : view.tone);
      const category = getCategoryLabel(entry.category);
      card.setKicker(index === this.currentIndex ? `${category} · ${t('ui.radial.equipped')}` : category);
      // Wert zuerst setzen: der Titel kürzt sich auf die verbleibende Breite.
      card.setValue(value.text, value.color);
      card.setTitle(entry.label, status.blocked ? HUD_TEXT_MUTED : HUD_TEXT_PRIMARY);
    }
    card.setValue(value.text, value.color);
    card.setProgress(value.progress, value.progress !== null && value.progress < 1);
  }

  private getCardValue(
    entry: RadialActionState,
    status: EntryStatus,
  ): { text: string; color: number; progress: number | null } {
    const charges = entry.charges !== undefined && entry.maxCharges !== undefined
      ? entry.charges / Math.max(1, entry.maxCharges)
      : null;
    if (status.cooldownActive) {
      return {
        text: t('ui.radial.cooldown', { seconds: formatSeconds(status.cooldownRemaining) }),
        color: HUD_TEXT_MUTED,
        progress: entry.cooldownDurationMs > 0
          ? 1 - Math.min(1, status.cooldownRemaining / entry.cooldownDurationMs)
          : charges,
      };
    }
    if (status.blocked && entry.disabledReason) {
      return { text: getDisabledReasonLabel(entry.disabledReason), color: COLORS.RED_2, progress: charges };
    }
    const badge = this.getBadge(entry);
    return {
      text: badge?.text ?? '',
      color: badge?.color ?? HUD_TEXT_PRIMARY,
      progress: charges,
    };
  }
}

function getCategoryLabel(category: RadialActionCategory): string {
  switch (category) {
    case 'utility': return t('ui.radial.category.utility');
    case 'temporaryUtility': return t('ui.radial.category.temporaryUtility');
    case 'construction': return t('ui.radial.category.construction');
    case 'persistentReward': return t('ui.radial.category.persistentReward');
    case 'managementAction': return t('ui.radial.category.managementAction');
    case 'specialPower': return t('ui.radial.category.specialPower');
  }
}

function getDisabledReasonLabel(reason: RadialActionDisabledReason): string {
  switch (reason) {
    case 'capacity': return t('ui.radial.disabled.capacity');
    case 'no-charges': return t('ui.radial.disabled.noCharges');
    case 'cooldown': return t('ui.radial.disabled.cooldown');
    case 'player-blocked':
    case 'unavailable':
      return t('ui.radial.disabled.unavailable');
  }
}
