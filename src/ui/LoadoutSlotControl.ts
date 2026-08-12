import * as Phaser from 'phaser';
import { COLORS, toCssColor } from '../config';
import type { LoadoutItemPresentation } from '../loadout/LoadoutCatalog';
import { ensureRoundedTexture, lerpColor } from './uiTextures';
import { FONT_MONO } from './uiTheme';

export interface LoadoutSlotControlOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly accentColor: number;
  readonly presentation: LoadoutItemPresentation | null;
  readonly label?: string;
  readonly compact?: boolean;
  readonly enabled?: boolean;
  readonly onClick: (anchorX: number) => void;
  readonly onPointerOver?: (pointer: Phaser.Input.Pointer) => void;
  readonly onPointerMove?: (pointer: Phaser.Input.Pointer) => void;
  readonly onPointerOut?: () => void;
}

/** Gemeinsame visuelle und interaktive Slotkarte fuer Lobby und Coop-Upgrade-Menue. */
export function createLoadoutSlotControl(
  scene: Phaser.Scene,
  options: LoadoutSlotControlOptions,
): Phaser.GameObjects.Container {
  const enabled = options.enabled ?? true;
  const filled = options.presentation !== null;
  const key = ensureSlotTexture(scene, options.width, options.height, options.accentColor, filled, enabled);
  const root = scene.add.container(options.x, options.y).setScrollFactor(0).setAlpha(enabled ? 1 : 0.45);
  const frame = scene.add.image(0, 0, key).setScrollFactor(0);
  root.add(frame);

  const iconSize = Math.min(options.height - 12, options.compact ? options.width - 12 : 30);
  const iconX = options.compact ? 0 : -options.width / 2 + 12 + iconSize / 2;
  const presentation = options.presentation;
  if (presentation?.textureKey && scene.textures.exists(presentation.textureKey)) {
    root.add(scene.add.image(iconX, 0, presentation.textureKey)
      .setDisplaySize(iconSize, iconSize)
      .setScrollFactor(0));
  } else if (options.compact) {
    root.add(scene.add.text(0, 0, presentation?.displayName ?? '+', {
      fontSize: presentation ? '9px' : '22px',
      fontFamily: FONT_MONO,
      fontStyle: 'bold',
      color: toCssColor(presentation ? COLORS.GREY_1 : COLORS.GREY_4),
      align: 'center',
      wordWrap: { width: options.width - 8, useAdvancedWrap: true },
    }).setOrigin(0.5).setScrollFactor(0));
  } else {
    root.add(scene.add.text(iconX, 0, presentation?.displayName.slice(0, 2).toUpperCase() ?? '+', {
      fontSize: '11px', fontFamily: FONT_MONO, fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
    }).setOrigin(0.5).setScrollFactor(0));
  }

  if (!options.compact) {
    const textX = -options.width / 2 + 12 + iconSize + 10;
    root.add(scene.add.text(textX, -8, presentation?.displayName ?? 'Leer', {
      fontSize: '13px', fontFamily: FONT_MONO, fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0, 0.5).setScrollFactor(0));
    root.add(scene.add.text(textX, 10, options.label ?? '', {
      fontSize: '10px', fontFamily: FONT_MONO, color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0, 0.5).setScrollFactor(0));
    root.add(scene.add.text(options.width / 2 - 14, 0, '›', {
      fontSize: '22px', fontFamily: FONT_MONO, color: toCssColor(COLORS.GREY_3),
    }).setOrigin(0.5).setScrollFactor(0));
  }

  const hitArea = scene.add.rectangle(0, 0, options.width, options.height, 0x000000, 0.001)
    .setScrollFactor(0);
  if (enabled) {
    hitArea.setInteractive({ useHandCursor: true })
      .on('pointerover', (pointer: Phaser.Input.Pointer) => {
        scene.tweens.add({ targets: root, scaleX: 1.04, scaleY: 1.04, duration: 90, ease: 'Sine.easeOut' });
        options.onPointerOver?.(pointer);
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => options.onPointerMove?.(pointer))
      .on('pointerout', () => {
        scene.tweens.add({ targets: root, scaleX: 1, scaleY: 1, duration: 120, ease: 'Sine.easeOut' });
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

function ensureSlotTexture(
  scene: Phaser.Scene,
  width: number,
  height: number,
  accentColor: number,
  filled: boolean,
  enabled: boolean,
): string {
  const w = Math.round(width);
  const h = Math.round(height);
  return ensureRoundedTexture(scene, {
    key: `_loadout_slot_${w}x${h}_${accentColor.toString(16)}_${filled ? 'on' : 'off'}_${enabled ? 'enabled' : 'disabled'}`,
    w,
    h,
    radius: Math.min(12, h / 3),
    topColor: lerpColor(COLORS.GREY_8, accentColor, filled ? 0.34 : 0.08),
    bottomColor: lerpColor(COLORS.GREY_10, accentColor, filled ? 0.2 : 0.04),
    fillAlpha: enabled ? (filled ? 0.97 : 0.8) : 0.65,
    strokeColor: accentColor,
    strokeAlpha: enabled ? (filled ? 0.9 : 0.35) : 0.2,
    strokeWidth: filled ? 2 : 1,
    highlightAlpha: filled ? 0.12 : 0.03,
  });
}
