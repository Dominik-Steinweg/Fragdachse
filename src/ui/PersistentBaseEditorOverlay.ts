import * as Phaser from 'phaser';
import type { LoadoutToolRef } from '../types';
import type {
  PersistentBaseCompositeSnapshot,
} from '../persistentBase/PersistentBaseEditorState';
import type { PersistentCompositeActiveEntry } from '../persistentBase/PersistentBaseComposite';
import type { PersistentBaseRewardId } from '../config/persistentBaseRewards';
import type { PersistentToolRef } from '../persistentBase/PersistentBaseTypes';
import { GAME_HEIGHT, GAME_WIDTH, COLORS, DEPTH } from '../config';
import { UiButton } from './UiButton';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { BORDER, SPACE, TEXT, textStyle } from './uiTheme';

export type PersistentBaseEditorSelection =
  | { readonly kind: 'tool'; readonly tool: LoadoutToolRef }
  | { readonly kind: 'reward'; readonly rewardId: PersistentBaseRewardId }
  | { readonly kind: 'remove' }
  | { readonly kind: 'move' };

export interface PersistentBaseEditorOverlayCallbacks {
  readonly getLocalOwnerId: () => string;
  readonly getTools: () => readonly LoadoutToolRef[];
  readonly onClose: () => void;
  readonly onPlace: (tool: LoadoutToolRef, relativeGridX: number, relativeGridY: number) => void;
  readonly onPlaceReward: (rewardId: PersistentBaseRewardId, relativeGridX: number, relativeGridY: number) => void;
  readonly onRemove: (persistentId: string) => void;
  readonly onReposition: (persistentId: string, relativeGridX: number, relativeGridY: number) => void;
  readonly onUnplaceReward: (rewardId: PersistentBaseRewardId) => void;
}

const GRID_CELLS = 17;
const CELL_SIZE = 28;
const GRID_X = GAME_WIDTH / 2 - (GRID_CELLS * CELL_SIZE) / 2;
const GRID_Y = 244;
const GRID_W = GRID_CELLS * CELL_SIZE;
const PANEL_X = 36;
const PANEL_Y = 44;
const PANEL_W = GAME_WIDTH - 72;
const PANEL_H = GAME_HEIGHT - 88;
const GRID_CENTER = Math.floor(GRID_CELLS / 2);

/**
 * Shared, intentionally quiet editor surface. The host owns all mutations; this class only
 * renders the reliable composite and translates clicks into relative-grid requests.
 */
export class PersistentBaseEditorOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private gridRoot: Phaser.GameObjects.Container | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private selectionText: Phaser.GameObjects.Text | null = null;
  private snapshot: PersistentBaseCompositeSnapshot | null = null;
  private visible = false;
  private selection: PersistentBaseEditorSelection = { kind: 'tool', tool: { kind: 'construction', id: 'machine_gun_turret' } };
  private selectedPersistentId: string | null = null;
  private readonly buttons: UiButton[] = [];
  private readonly rewardButtons = new Map<PersistentBaseRewardId, UiButton>();
  private renderSignature = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly callbacks: PersistentBaseEditorOverlayCallbacks,
  ) {}

  build(): void {
    this.destroy();
    const background = this.scene.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      COLORS.GREY_9,
      0.96,
    ).setScrollFactor(0);
    const panel = this.scene.add.rectangle(
      PANEL_X + PANEL_W / 2,
      PANEL_Y + PANEL_H / 2,
      PANEL_W,
      PANEL_H,
      COLORS.GREY_8,
      0.98,
    ).setStrokeStyle(2, BORDER.default, 0.85).setScrollFactor(0);
    const title = this.scene.add.text(
      PANEL_X + 30,
      PANEL_Y + 22,
      'PERSISTENT BASE',
      textStyle('title', { color: COLORS.GOLD_1 }),
    ).setOrigin(0, 0).setScrollFactor(0);
    const subtitle = this.scene.add.text(
      PANEL_X + 31,
      PANEL_Y + 62,
      'Shared editor · every player contributes · host confirms the composite',
      textStyle('body', { color: COLORS.GREY_3 }),
    ).setOrigin(0, 0).setScrollFactor(0);

    this.statusText = this.scene.add.text(
      PANEL_X + 30,
      PANEL_Y + PANEL_H - 42,
      '',
      textStyle('body', { color: COLORS.GREY_2 }),
    ).setOrigin(0, 0.5).setScrollFactor(0);
    this.selectionText = this.scene.add.text(
      GRID_X,
      GRID_Y - 24,
      '',
      textStyle('section', { color: COLORS.GREY_2 }),
    ).setOrigin(0, 0.5).setScrollFactor(0);

    this.gridRoot = this.scene.add.container(0, 0).setScrollFactor(0);
    this.buildGrid();
    this.buildPalette();
    const close = new UiButton(this.scene, {
      x: PANEL_X + PANEL_W - 92,
      y: PANEL_Y + 34,
      w: 132,
      h: 40,
      label: 'BACK TO LOBBY',
      intent: 'neutral',
      onClick: () => this.callbacks.onClose(),
    });
    this.buttons.push(close);

    this.container = this.scene.add.container(0, 0, [
      background,
      panel,
      title,
      subtitle,
      this.gridRoot,
      this.statusText,
      this.selectionText,
      ...this.buttons.map((button) => button.getRoot()),
    ]).setDepth(DEPTH.OVERLAY + 20).setVisible(this.visible);
    promoteToClarityCamera(this.scene, this.container);
    this.render(true);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container?.setVisible(visible);
    if (visible) this.render(true);
  }

  isVisible(): boolean { return this.visible; }

  setSnapshot(snapshot: PersistentBaseCompositeSnapshot | null): void {
    this.snapshot = snapshot;
    if (this.visible) this.render(false);
  }

  destroy(): void {
    for (const button of this.buttons) button.destroy();
    this.buttons.length = 0;
    this.rewardButtons.clear();
    this.container?.destroy(true);
    this.container = null;
    this.gridRoot = null;
    this.statusText = null;
    this.selectionText = null;
    this.renderSignature = '';
    this.selectedPersistentId = null;
  }

  private buildGrid(): void {
    if (!this.gridRoot) return;
    for (let row = 0; row < GRID_CELLS; row += 1) {
      for (let column = 0; column < GRID_CELLS; column += 1) {
        const cell = this.scene.add.rectangle(
          GRID_X + column * CELL_SIZE + CELL_SIZE / 2,
          GRID_Y + row * CELL_SIZE + CELL_SIZE / 2,
          CELL_SIZE - 2,
          CELL_SIZE - 2,
          COLORS.GREY_7,
          0.6,
        ).setStrokeStyle(1, COLORS.GREY_5, 0.35).setScrollFactor(0);
        cell.setInteractive({ useHandCursor: true });
        cell.on('pointerdown', () => this.handleCellClick(column - GRID_CENTER, row - GRID_CENTER));
        this.gridRoot.add(cell);
      }
    }
  }

  private buildPalette(): void {
    const tools = this.callbacks.getTools();
    const x = PANEL_X + 30;
    let y = PANEL_Y + 126;
    for (const tool of tools.slice(0, 7)) {
      const button = new UiButton(this.scene, {
        x: x + 72,
        y,
        w: 144,
        h: 34,
          label: tool.id.replace(/_/g, ' ').toUpperCase(),
        intent: 'neutral',
        onClick: () => this.select({ kind: 'tool', tool }),
      });
      this.buttons.push(button);
      y += 40;
    }
    for (const reward of [
      ['watchtower', 'WATCHTOWER'],
      ['holy_hand_pedestal', 'HOLY HAND'],
      ['burrow', 'BURROW'],
    ] as const) {
      const button = new UiButton(this.scene, {
        x: x + 72,
        y,
        w: 144,
        h: 34,
        label: reward[1],
        intent: 'neutral',
        onClick: () => this.select({ kind: 'reward', rewardId: reward[0] }),
      });
      this.buttons.push(button);
      this.rewardButtons.set(reward[0], button);
      y += 40;
    }
    for (const mode of ['remove', 'move'] as const) {
      const button = new UiButton(this.scene, {
        x: x + 72,
        y,
        w: 144,
        h: 34,
        label: mode.toUpperCase(),
        intent: 'neutral',
        onClick: () => this.select({ kind: mode }),
      });
      this.buttons.push(button);
      y += 40;
    }
  }

  private select(selection: PersistentBaseEditorSelection): void {
    this.selection = selection;
    this.selectedPersistentId = null;
    this.render(true);
  }

  private handleCellClick(relativeGridX: number, relativeGridY: number): void {
    if (!this.snapshot) return;
    const active = this.findEntry(relativeGridX, relativeGridY);
    if (this.selection.kind === 'remove') {
      if (active && active.ownerId === this.callbacks.getLocalOwnerId()) {
        if (active.blueprint.rewardId) this.callbacks.onUnplaceReward(active.blueprint.rewardId as PersistentBaseRewardId);
        else this.callbacks.onRemove(active.blueprint.persistentId);
      }
      return;
    }
    if (this.selection.kind === 'move') {
      if (!this.selectedPersistentId) {
        if (active?.ownerId === this.callbacks.getLocalOwnerId()) {
          this.selectedPersistentId = active.blueprint.persistentId;
          this.render(true);
        }
        return;
      }
      this.callbacks.onReposition(this.selectedPersistentId, relativeGridX, relativeGridY);
      this.selectedPersistentId = null;
      return;
    }
    if (active) return;
    const selectedRewardId = this.selection.kind === 'reward' ? this.selection.rewardId : null;
    if (selectedRewardId
      && this.snapshot.rewards.find((reward) => reward.rewardId === selectedRewardId)?.availability !== 'available') {
      return;
    }
    if (this.selection.kind === 'tool') this.callbacks.onPlace(this.selection.tool, relativeGridX, relativeGridY);
    else if (this.selection.kind === 'reward') {
      this.callbacks.onPlaceReward(this.selection.rewardId, relativeGridX, relativeGridY);
    }
  }

  private findEntry(relativeGridX: number, relativeGridY: number): PersistentCompositeActiveEntry | null {
    return this.snapshot?.active.find((entry) => {
      const originX = entry.gridX - this.snapshot!.anchor.gridX;
      const originY = entry.gridY - this.snapshot!.anchor.gridY;
      return (entry.footprint.length > 0 ? entry.footprint : [{ dx: 0, dy: 0 }])
        .some((cell) => originX + cell.dx === relativeGridX && originY + cell.dy === relativeGridY);
    }) ?? null;
  }

  private render(force: boolean): void {
    if (!this.snapshot || !this.gridRoot) return;
    const signature = [
      this.snapshot.revision,
      this.snapshot.active.map((entry) => `${entry.blueprint.persistentId}:${entry.gridX}:${entry.gridY}`).join('|'),
      this.snapshot.conflicts.length,
      this.selectedPersistentId ?? '',
    ].join('::');
    if (!force && signature === this.renderSignature) return;
    this.renderSignature = signature;
    for (const [rewardId, button] of this.rewardButtons) {
      button.setEnabled(
        this.snapshot.rewards.find((reward) => reward.rewardId === rewardId)?.availability === 'available',
      );
    }
    for (const child of this.gridRoot.list) {
      const rectangle = child as Phaser.GameObjects.Rectangle;
      const column = Math.round((rectangle.x - GRID_X - CELL_SIZE / 2) / CELL_SIZE);
      const row = Math.round((rectangle.y - GRID_Y - CELL_SIZE / 2) / CELL_SIZE);
      const entry = this.findEntry(column - GRID_CENTER, row - GRID_CENTER);
      rectangle.setFillStyle(entry ? entry.ownerId === this.callbacks.getLocalOwnerId() ? COLORS.GOLD_3 : COLORS.BLUE_4 : COLORS.GREY_7, entry ? 0.95 : 0.6);
      rectangle.setStrokeStyle(1, entry?.blueprint.persistentId === this.selectedPersistentId ? COLORS.GOLD_1 : COLORS.GREY_5, entry?.blueprint.persistentId === this.selectedPersistentId ? 1 : 0.35);
    }
    const localConflicts = this.snapshot.conflicts.filter((conflict) => (
      conflict.ownerId === this.callbacks.getLocalOwnerId()
    ));
    const conflictSummary = new Map<string, number>();
    for (const conflict of localConflicts) {
      conflictSummary.set(conflict.toolId, (conflictSummary.get(conflict.toolId) ?? 0) + 1);
    }
    const conflictText = [...conflictSummary.entries()]
      .map(([toolId, count]) => `${count}×${toolId.replace(/_/g, ' ')}`)
      .join(', ');
    this.statusText?.setText(
      `Revision ${this.snapshot.revision} · ${this.snapshot.active.length} active · ${localConflicts.length} local conflicts${conflictText ? ` (${conflictText})` : ''}`,
    );
    const mode = this.selection.kind === 'tool'
      ? `PLACE ${this.selection.tool.id.toUpperCase()}`
      : this.selection.kind === 'reward'
        ? `PLACE ${this.selection.rewardId.toUpperCase()}`
        : this.selection.kind.toUpperCase();
    this.selectionText?.setText(`${mode} · click a grid cell`);
  }
}
