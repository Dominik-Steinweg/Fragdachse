import * as Phaser from 'phaser';
import { COLORS } from '../config';
import type { LoadoutItemPresentation } from '../loadout/LoadoutCatalog';
import { ensureRoundedTexture, lerpColor } from './uiTextures';
import { MOTION, TEXT, textStyle } from './uiTheme';
import { t } from '../i18n';
import { fitLoadoutIcon, getLoadoutIconTextureKey } from './LoadoutIconLayout';

export interface LoadoutSlotControlOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly accentColor: number;
  readonly presentation: LoadoutItemPresentation | null;
  readonly label?: string;
  readonly compact?: boolean;
  /** Kontextvariante fuer kleine Tool-Slots oder ruhige Lobby-Slots. */
  readonly accentMode?: 'default' | 'subtle' | 'lobby';
  readonly enabled?: boolean;
  readonly onClick: (anchorX: number) => void;
  /** Optional gemeinsame Hover-Gruppe fuer mehrere Geschwister-Slots. */
  readonly hoverGroup?: LoadoutHoverGroup;
  /** Eindeutiger Slot-Schluessel innerhalb der gemeinsamen Hover-Gruppe. */
  readonly hoverKey?: string;
  readonly onPointerOver?: (pointer: Phaser.Input.Pointer) => void;
  readonly onPointerMove?: (pointer: Phaser.Input.Pointer) => void;
  readonly onPointerOut?: (pointer: Phaser.Input.Pointer) => void;
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

export interface LoadoutHoverState {
  readonly blockHovered: boolean;
  readonly itemKey: string | null;
}

export interface LoadoutHoverGroup {
  register(
    key: string,
    listener: (state: LoadoutHoverState) => void,
    isPointerInsideItem: (pointer: Phaser.Input.Pointer) => boolean,
  ): void;
  leave(pointer: Phaser.Input.Pointer): void;
  itemEnter(key: string): void;
  itemLeave(key: string, pointer: Phaser.Input.Pointer): void;
  isPointerInsideItem(pointer: Phaser.Input.Pointer): boolean;
}

/**
 * Gemeinsamer Hover-Zustand fuer einen Block aus Geschwister-Slots. Das Verlassen eines
 * einzelnen Slots beendet den Zustand nur dann, wenn der Pointer auch den Gesamtblock verlaesst.
 */
export function createLoadoutHoverGroup(
  isPointerInside: (pointer: Phaser.Input.Pointer) => boolean,
): LoadoutHoverGroup {
  const listeners = new Map<string, (state: LoadoutHoverState) => void>();
  const itemHitTests = new Map<string, (pointer: Phaser.Input.Pointer) => boolean>();
  let state: LoadoutHoverState = { blockHovered: false, itemKey: null };

  const notify = (): void => listeners.forEach((listener) => listener(state));

  return {
    register(key, listener, isPointerInsideItem) {
      listeners.set(key, listener);
      itemHitTests.set(key, isPointerInsideItem);
      listener(state);
    },
    leave(pointer) {
      if (isPointerInside(pointer) || !state.blockHovered) return;
      state = { blockHovered: false, itemKey: null };
      notify();
    },
    itemEnter(key) {
      if (state.itemKey === key && state.blockHovered) return;
      state = { blockHovered: true, itemKey: key };
      notify();
    },
    itemLeave(key, pointer) {
      if (state.itemKey !== key) return;
      const pointerOverSibling = [...itemHitTests.entries()].some(([otherKey, isInsideItem]) => (
        otherKey !== key && isInsideItem(pointer)
      ));
      if (pointerOverSibling) return;
      state = { blockHovered: state.blockHovered, itemKey: null };
      notify();
    },
    isPointerInsideItem(pointer) {
      return [...itemHitTests.values()].some((isInsideItem) => isInsideItem(pointer));
    },
  };
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
  const hoverOutline = !options.compact || accentMode === 'subtle' || accentMode === 'lobby'
    ? scene.add.image(0, 0, ensureRoundedTexture(scene, {
      key: `_loadout_slot_hover_${accentMode}_${Math.round(options.width)}x${Math.round(options.height)}_${options.accentColor.toString(16)}_${filled ? 'on' : 'off'}_${enabled ? 'enabled' : 'disabled'}`,
      w: options.width,
      h: options.height,
      radius: Math.min(12, options.height / 3),
      topColor: COLORS.GREY_8,
      bottomColor: COLORS.GREY_8,
      fillAlpha: 0,
      strokeColor: options.accentColor,
      strokeAlpha: options.accentMode === 'lobby' ? 0.8 : 1,
      strokeWidth: options.accentMode === 'lobby' ? 1 : 2,
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
  const hoverKey = options.hoverKey ?? `${options.x}:${options.y}`;
  let applyHoverState: ((state: LoadoutHoverState) => void) | null = null;
  if (presentation?.textureKey && scene.textures.exists(presentation.textureKey)) {
    const textureKey = getLoadoutIconTextureKey(scene, presentation.textureKey);
    if (options.hoverGroup) {
      const mutedIcon = createMutedIcon(scene, iconX, iconSize, textureKey);
      const blockIcon = createBlockHoverIcon(scene, iconX, iconSize, textureKey);
      const colorIcon = fitLoadoutIcon(
        scene.add.image(iconX, 0, textureKey),
        iconSize,
        iconSize,
      )
        .setAlpha(0)
        .setScrollFactor(0);
      root.add([mutedIcon, blockIcon, colorIcon]);
      applyHoverState = (state) => {
        const itemHovered = state.itemKey === hoverKey;
        scene.tweens.killTweensOf(mutedIcon);
        scene.tweens.killTweensOf(blockIcon);
        scene.tweens.killTweensOf(colorIcon);
        scene.tweens.add({
          targets: mutedIcon,
          alpha: state.blockHovered ? 0 : 0.78,
          duration: MOTION.base,
          ease: MOTION.ease.hover,
        });
        scene.tweens.add({
          targets: blockIcon,
          alpha: state.blockHovered && !itemHovered ? 0.92 : 0,
          duration: MOTION.base,
          ease: MOTION.ease.hover,
        });
        scene.tweens.add({
          targets: colorIcon,
          alpha: itemHovered ? 1 : 0,
          duration: MOTION.base,
          ease: MOTION.ease.hover,
        });
      };
    } else {
      root.add(fitLoadoutIcon(
        scene.add.image(iconX, 0, textureKey),
        iconSize,
        iconSize,
      )
        .setScrollFactor(0));
    }
  } else if (options.compact) {
    const fallbackText = presentation?.displayName ?? '+';
    const role = presentation ? 'micro' : 'title';
    if (options.hoverGroup && presentation) {
      const mutedText = scene.add.text(0, 0, fallbackText, textStyle(role, {
        color: TEXT.muted,
        align: 'center',
        wordWrapWidth: options.width - 8,
      })).setOrigin(0.5).setScrollFactor(0);
      const blockText = scene.add.text(0, 0, fallbackText, textStyle(role, {
        color: TEXT.secondary,
        align: 'center',
        wordWrapWidth: options.width - 8,
      })).setOrigin(0.5).setAlpha(0).setScrollFactor(0);
      const colorText = scene.add.text(0, 0, fallbackText, textStyle(role, {
        color: TEXT.primary,
        align: 'center',
        wordWrapWidth: options.width - 8,
      })).setOrigin(0.5).setAlpha(0).setScrollFactor(0);
      root.add([mutedText, blockText, colorText]);
      applyHoverState = (state) => {
        const itemHovered = state.itemKey === hoverKey;
        scene.tweens.killTweensOf(mutedText);
        scene.tweens.killTweensOf(blockText);
        scene.tweens.killTweensOf(colorText);
        scene.tweens.add({
          targets: mutedText,
          alpha: state.blockHovered ? 0 : 0.78,
          duration: MOTION.base,
          ease: MOTION.ease.hover,
        });
        scene.tweens.add({
          targets: blockText,
          alpha: state.blockHovered && !itemHovered ? 0.92 : 0,
          duration: MOTION.base,
          ease: MOTION.ease.hover,
        });
        scene.tweens.add({
          targets: colorText,
          alpha: itemHovered ? 1 : 0,
          duration: MOTION.base,
          ease: MOTION.ease.hover,
        });
      };
    } else {
      root.add(scene.add.text(0, 0, fallbackText, textStyle(
        role,
        { color: presentation ? TEXT.primary : TEXT.muted, align: 'center', wordWrapWidth: options.width - 8 },
      )).setOrigin(0.5).setScrollFactor(0));
    }
  } else {
    root.add(scene.add.text(iconX, 0, presentation?.displayName.slice(0, 2).toUpperCase() ?? '+', textStyle('labelSm', {
      color: TEXT.secondary,
    })).setOrigin(0.5).setScrollFactor(0));
  }

  if (!options.compact) {
    const textX = -options.width / 2 + 12 + iconSize + 10;
    root.add(scene.add.text(textX, -8, presentation?.displayName ?? t('ui.common.empty'), textStyle('labelSm', {
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
  options.hoverGroup?.register(hoverKey, (state) => {
    applyHoverState?.(state);
    if (hoverOutline) {
      scene.tweens.killTweensOf(hoverOutline);
      scene.tweens.add({
        targets: hoverOutline,
        alpha: state.itemKey === hoverKey ? 0.86 : state.blockHovered ? 0.48 : 0,
        duration: MOTION.base,
        ease: MOTION.ease.hover,
      });
    }
  }, (pointer) => Phaser.Geom.Rectangle.Contains(root.getBounds(), pointer.worldX, pointer.worldY));
  if (enabled) {
    hitArea.setInteractive({ useHandCursor: true })
      .on('pointerover', (pointer: Phaser.Input.Pointer) => {
        if (!options.hoverGroup) {
          scene.tweens.add({ targets: root, scaleX: 1.04, scaleY: 1.04, duration: 90, ease: 'Sine.easeOut' });
          if (hoverOutline) scene.tweens.add({ targets: hoverOutline, alpha: 0.72, duration: 90, ease: 'Sine.easeOut' });
        } else {
          options.hoverGroup.itemEnter(hoverKey);
        }
        options.onPointerOver?.(pointer);
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => options.onPointerMove?.(pointer))
      .on('pointerout', (pointer: Phaser.Input.Pointer) => {
        if (!options.hoverGroup) {
          scene.tweens.add({ targets: root, scaleX: 1, scaleY: 1, duration: 120, ease: 'Sine.easeOut' });
          if (hoverOutline) scene.tweens.add({ targets: hoverOutline, alpha: 0, duration: 120, ease: 'Sine.easeOut' });
        } else {
          options.hoverGroup.itemLeave(hoverKey, pointer);
          options.hoverGroup.leave(pointer);
        }
        options.onPointerOut?.(pointer);
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
  accentMode: 'default' | 'subtle' | 'lobby',
): string {
  const w = Math.round(width);
  const h = Math.round(height);
  const compact = w <= h * 1.5;
  const subtle = accentMode === 'subtle';
  const lobby = accentMode === 'lobby';
  return ensureRoundedTexture(scene, {
    key: `_loadout_slot_${accentMode}_${compact ? 'compact' : 'row'}_${w}x${h}_${accentColor.toString(16)}_${filled ? 'on' : 'off'}_${enabled ? 'enabled' : 'disabled'}`,
    w,
    h,
    radius: Math.min(12, h / 3),
    topColor: compact
      ? lobby
        ? COLORS.GREY_8
        : lerpColor(COLORS.GREY_8, accentColor, filled ? (subtle ? 0.08 : 0.34) : (subtle ? 0.03 : 0.08))
      : lerpColor(COLORS.GREY_7, 0xffffff, 0.03),
    bottomColor: compact
      ? lobby
        ? COLORS.GREY_10
        : lerpColor(COLORS.GREY_10, accentColor, filled ? (subtle ? 0.05 : 0.2) : (subtle ? 0.02 : 0.04))
      : COLORS.GREY_9,
    fillAlpha: enabled
      ? (filled ? (compact ? (lobby ? 0.78 : subtle ? 0.92 : 0.97) : 0.93) : 0.8)
      : 0.65,
    strokeColor: compact ? accentColor : COLORS.GREY_5,
    strokeAlpha: enabled
      ? (filled
        ? (compact ? (lobby ? 0.28 : subtle ? 0.58 : 0.9) : 0.58)
        : (subtle ? 0.38 : 0.3))
      : 0.2,
    strokeWidth: compact && filled ? (subtle || lobby ? 1 : 2) : 1,
    highlightAlpha: filled ? (compact ? (lobby ? 0.01 : subtle ? 0.04 : 0.12) : 0.05) : 0.03,
    leftAccentColor: compact ? undefined : accentColor,
    leftAccentAlpha: compact ? 0 : enabled ? (filled ? 0.88 : 0.24) : 0.16,
    leftAccentWidth: 5,
  });
}

function createMutedIcon(
  scene: Phaser.Scene,
  x: number,
  size: number,
  textureKey: string,
): Phaser.GameObjects.Image {
  const icon = fitLoadoutIcon(scene.add.image(x, 0, textureKey), size, size)
    .setScrollFactor(0);

  icon.enableFilters();
  const colorMatrix = icon.filters?.internal?.addColorMatrix();
  if (colorMatrix) {
    colorMatrix.colorMatrix.desaturate();
    colorMatrix.colorMatrix.brightness(0.68);
  } else {
    icon.setTint(COLORS.GREY_3).setTintMode(Phaser.TintModes.FILL);
  }
  return icon;
}

function createBlockHoverIcon(
  scene: Phaser.Scene,
  x: number,
  size: number,
  textureKey: string,
): Phaser.GameObjects.Image {
  const icon = fitLoadoutIcon(scene.add.image(x, 0, textureKey), size, size)
    .setAlpha(0)
    .setScrollFactor(0);

  icon.enableFilters();
  const colorMatrix = icon.filters?.internal?.addColorMatrix();
  if (colorMatrix) {
    colorMatrix.colorMatrix.saturate(-0.42);
    colorMatrix.colorMatrix.brightness(0.9);
  } else {
    icon.setTint(0xc0c3c2);
  }
  return icon;
}
