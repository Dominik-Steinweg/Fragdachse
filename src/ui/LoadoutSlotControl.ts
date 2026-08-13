import * as Phaser from 'phaser';
import { COLORS } from '../config';
import type { LoadoutItemPresentation } from '../loadout/LoadoutCatalog';
import { ensureRoundedTexture, lerpColor } from './uiTextures';
import { TEXT, textStyle } from './uiTheme';

export interface LoadoutSlotControlOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly accentColor: number;
  readonly presentation: LoadoutItemPresentation | null;
  readonly label?: string;
  readonly compact?: boolean;
  /** Kontextvariante fuer kleine Tool-Slots: neutraler Grund, nur dezenter Akzentrand. */
  readonly accentMode?: 'default' | 'subtle';
  readonly enabled?: boolean;
  readonly onClick: (anchorX: number) => void;
  readonly onPointerOver?: (pointer: Phaser.Input.Pointer) => void;
  readonly onPointerMove?: (pointer: Phaser.Input.Pointer) => void;
  readonly onPointerOut?: () => void;
}

export interface LoadoutToolRowControlOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly sublabel?: string;
  /** Ein Eintrag pro sichtbarem Slot; `null` steht fuer einen leeren Slot. */
  readonly presentations: readonly (LoadoutItemPresentation | null)[];
  readonly enabled?: boolean;
  readonly onSlotClick: (slotIndex: number, anchorX: number) => void;
}

/** Gemeinsame visuelle und interaktive Slotkarte fuer Lobby und Coop-Upgrade-Menue. */
export function createLoadoutSlotControl(
  scene: Phaser.Scene,
  options: LoadoutSlotControlOptions,
): Phaser.GameObjects.Container {
  const enabled = options.enabled ?? true;
  const filled = options.presentation !== null;
  const accentMode = options.accentMode ?? 'default';
  const key = ensureSlotTexture(
    scene,
    options.width,
    options.height,
    options.accentColor,
    filled,
    enabled,
    accentMode,
  );
  const root = scene.add.container(options.x, options.y).setScrollFactor(0).setAlpha(enabled ? 1 : 0.45);
  const frame = scene.add.image(0, 0, key).setScrollFactor(0);
  root.add(frame);

  // Breite Lobby-Zeilen bleiben neutral. Farbkante und Hover-Kontur sind beide in dieselbe
  // Rounded-Texture geclippt und folgen dadurch auch an den Ecken exakt der Rahmengeometrie.
  const hoverOutline = !options.compact || accentMode === 'subtle'
    ? scene.add.image(0, 0, ensureRoundedTexture(scene, {
      key: `_loadout_slot_hover_${accentMode}_${Math.round(options.width)}x${Math.round(options.height)}_${options.accentColor.toString(16)}_${filled ? 'on' : 'off'}_${enabled ? 'enabled' : 'disabled'}`,
      w: options.width,
      h: options.height,
      radius: Math.min(12, options.height / 3),
      topColor: COLORS.GREY_8,
      bottomColor: COLORS.GREY_8,
      fillAlpha: 0,
      strokeColor: options.accentColor,
      strokeAlpha: 1,
      strokeWidth: 2,
      highlightAlpha: 0,
      leftAccentColor: options.compact ? undefined : options.accentColor,
      leftAccentAlpha: options.compact ? 0 : filled ? 0.28 : 0.1,
      leftAccentWidth: options.compact ? 0 : 5,
    }))
      .setAlpha(0)
      .setScrollFactor(0)
    : null;
  if (hoverOutline) root.add(hoverOutline);

  const iconSize = Math.min(options.height - 12, options.compact ? options.width - 12 : 30);
  const iconX = options.compact ? 0 : -options.width / 2 + 12 + iconSize / 2;
  const presentation = options.presentation;
  if (presentation?.textureKey && scene.textures.exists(presentation.textureKey)) {
    root.add(scene.add.image(iconX, 0, presentation.textureKey)
      .setDisplaySize(iconSize, iconSize)
      .setScrollFactor(0));
  } else if (options.compact) {
    root.add(scene.add.text(0, 0, presentation?.displayName ?? '+', textStyle(
      presentation ? 'micro' : 'title',
      { color: presentation ? TEXT.primary : TEXT.muted, align: 'center', wordWrapWidth: options.width - 8 },
    )).setOrigin(0.5).setScrollFactor(0));
  } else {
    root.add(scene.add.text(iconX, 0, presentation?.displayName.slice(0, 2).toUpperCase() ?? '+', textStyle('labelSm', {
      color: TEXT.secondary,
    })).setOrigin(0.5).setScrollFactor(0));
  }

  if (!options.compact) {
    const textX = -options.width / 2 + 12 + iconSize + 10;
    root.add(scene.add.text(textX, -8, presentation?.displayName ?? 'Leer', textStyle('labelSm', {
      color: TEXT.primary,
    })).setOrigin(0, 0.5).setScrollFactor(0));
    root.add(scene.add.text(textX, 10, options.label ?? '', textStyle('micro'))
      .setOrigin(0, 0.5).setScrollFactor(0));
    root.add(scene.add.text(options.width / 2 - 14, 0, '›', textStyle('title', {
      color: TEXT.muted,
    })).setOrigin(0.5).setScrollFactor(0));
  }

  const hitArea = scene.add.rectangle(0, 0, options.width, options.height, 0x000000, 0.001)
    .setScrollFactor(0);
  if (enabled) {
    hitArea.setInteractive({ useHandCursor: true })
      .on('pointerover', (pointer: Phaser.Input.Pointer) => {
        scene.tweens.add({ targets: root, scaleX: 1.04, scaleY: 1.04, duration: 90, ease: 'Sine.easeOut' });
        if (hoverOutline) scene.tweens.add({ targets: hoverOutline, alpha: 0.72, duration: 90, ease: 'Sine.easeOut' });
        options.onPointerOver?.(pointer);
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => options.onPointerMove?.(pointer))
      .on('pointerout', () => {
        scene.tweens.add({ targets: root, scaleX: 1, scaleY: 1, duration: 120, ease: 'Sine.easeOut' });
        if (hoverOutline) scene.tweens.add({ targets: hoverOutline, alpha: 0, duration: 120, ease: 'Sine.easeOut' });
        options.onPointerOut?.();
      })
      .on('pointerdown', (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        options.onClick(options.x);
      });
  }
  root.add(hitArea);
  return root;
}

/**
 * Gemeinsame Lobby-Zeile fuer das Inspector-Utility-Rad. Die Zeile besitzt dieselbe
 * Oberflaeche wie die normalen Loadout-Zeilen; nur die darin liegenden Tool-Slots sind
 * eigene interaktive Controls.
 */
export function createLoadoutToolRowControl(
  scene: Phaser.Scene,
  options: LoadoutToolRowControlOptions,
): Phaser.GameObjects.Container {
  const enabled = options.enabled ?? true;
  const root = scene.add.container(options.x, options.y).setScrollFactor(0);
  const frameKey = ensureSlotTexture(
    scene,
    options.width,
    options.height,
    COLORS.GREY_5,
    false,
    enabled,
    'default',
  );
  root.add(scene.add.image(0, 0, frameKey).setScrollFactor(0));

  const labelX = -options.width / 2 + 12;
  const labelAlpha = enabled ? 1 : 0.45;
  root.add(scene.add.text(labelX, -7, options.label, textStyle('labelSm', {
    color: TEXT.primary,
    tracking: 0.6,
  })).setOrigin(0, 0.5).setAlpha(labelAlpha).setScrollFactor(0));
  if (options.sublabel) {
    root.add(scene.add.text(labelX, 8, options.sublabel, textStyle('micro', {
      color: TEXT.muted,
      tracking: 0.5,
    })).setOrigin(0, 0.5).setAlpha(labelAlpha).setScrollFactor(0));
  }

  const capacity = Math.max(1, options.presentations.length);
  const gap = 4;
  const slotHeight = Math.min(options.height - 10, 28);
  // Die Beschriftung bleibt auch bei voller Kapazitaet vom ersten Tool-Slot getrennt.
  const slotAreaLeft = -options.width / 2 + 94;
  const slotAreaRight = options.width / 2 - 12;
  const slotAreaWidth = Math.max(1, slotAreaRight - slotAreaLeft);
  const slotWidth = Math.min(28, (slotAreaWidth - gap * (capacity - 1)) / capacity);
  const totalWidth = capacity * slotWidth + gap * (capacity - 1);
  const startX = slotAreaRight - totalWidth + slotWidth / 2;

  for (let index = 0; index < capacity; index += 1) {
    const slotX = startX + index * (slotWidth + gap);
    const presentation = options.presentations[index] ?? null;
    root.add(createLoadoutSlotControl(scene, {
      x: slotX,
      y: 0,
      width: slotWidth,
      height: slotHeight,
      accentColor: presentation?.accentColor ?? COLORS.GREY_5,
      presentation,
      compact: true,
      accentMode: 'subtle',
      enabled,
      onClick: () => options.onSlotClick(index, options.x + slotX),
    }));
  }

  return root;
}

function ensureSlotTexture(
  scene: Phaser.Scene,
  width: number,
  height: number,
  accentColor: number,
  filled: boolean,
  enabled: boolean,
  accentMode: 'default' | 'subtle',
): string {
  const w = Math.round(width);
  const h = Math.round(height);
  const compact = w <= h * 1.5;
  const subtle = accentMode === 'subtle';
  return ensureRoundedTexture(scene, {
    key: `_loadout_slot_${accentMode}_${compact ? 'compact' : 'row'}_${w}x${h}_${accentColor.toString(16)}_${filled ? 'on' : 'off'}_${enabled ? 'enabled' : 'disabled'}`,
    w,
    h,
    radius: Math.min(12, h / 3),
    topColor: compact
      ? lerpColor(COLORS.GREY_8, accentColor, filled ? (subtle ? 0.08 : 0.34) : (subtle ? 0.03 : 0.08))
      : lerpColor(COLORS.GREY_7, 0xffffff, 0.03),
    bottomColor: compact
      ? lerpColor(COLORS.GREY_10, accentColor, filled ? (subtle ? 0.05 : 0.2) : (subtle ? 0.02 : 0.04))
      : COLORS.GREY_9,
    fillAlpha: enabled ? (filled ? (compact ? (subtle ? 0.92 : 0.97) : 0.93) : 0.8) : 0.65,
    strokeColor: compact ? accentColor : COLORS.GREY_5,
    strokeAlpha: enabled
      ? (filled ? (compact ? (subtle ? 0.58 : 0.9) : 0.58) : (subtle ? 0.38 : 0.3))
      : 0.2,
    strokeWidth: compact && filled ? (subtle ? 1 : 2) : 1,
    highlightAlpha: filled ? (compact ? (subtle ? 0.04 : 0.12) : 0.05) : 0.03,
    leftAccentColor: compact ? undefined : accentColor,
    leftAccentAlpha: compact ? 0 : enabled ? (filled ? 0.88 : 0.24) : 0.16,
    leftAccentWidth: 5,
  });
}
