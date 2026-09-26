/**
 * HudResourceRow – Ressourcen- und Zustandskarten am unteren Bildrand.
 *
 * Statt eines Turms, der aus der Bildmitte Richtung Spielfigur wächst, liegen die Karten in
 * einer flachen Zeile direkt über der Unterkante. Ausrüstung steht links von Ultimate,
 * Baukapazität und Power-Ups. Jede belegte Zeile wird als Ganzes zentriert, auch bei einem
 * einzelnen Eintrag oder ungleich großen Gruppen.
 */
import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { LivingBarEffect } from './LivingBarEffect';
import { HudCard, HUD_TEXT_PRIMARY } from './HudCard';
import { HUD_CARD_SOURCE, HUD_TONES, type HudTone } from './HudFrameAssets';

const SCALE = 0.5;
const ENTRY_W = 236;
const GAP_X = 8;
const GAP_Y = 4;
const BOTTOM_MARGIN = 8;
const PER_ROW = 6;
const MOVE_MS = 240;
const ENTER_MS = 220;
const EXIT_MS = 150;

export type HudResourceSide = 'left' | 'right';

export interface HudResourceEntry {
  readonly id: string;
  readonly side: HudResourceSide;
  readonly tone: HudTone;
  readonly title: string;
  readonly value?: string;
  readonly valueColor?: number;
  /** Füllgrad 0..1; `null` zeigt eine leere Rinne (z. B. Killstreak ohne Laufzeit). */
  readonly frac: number | null;
  /** Energiestufe des lebendigen Balkens, 0 = ruhig. */
  readonly energy?: number;
  /** Gedämpft darstellen (blockierte Utility). */
  readonly dim?: boolean;
  /** Ruhiges Atmen der Karte (Ultimate bereit, temporäre Utility gewählt). */
  readonly attention?: boolean;
}

interface EntryVisual {
  readonly card: HudCard;
  effect: LivingBarEffect | null;
  side: HudResourceSide;
  targetX: number;
  targetY: number;
  moveTween: Phaser.Tweens.Tween | null;
  enterTween: Phaser.Tweens.Tween | null;
  pulseTween: Phaser.Tweens.Tween | null;
  removing: boolean;
  /** Erst nach dem ersten Layout: davor steht die Karte noch nicht an ihrem Platz. */
  placed: boolean;
  dim: boolean;
  lastTitle: string;
  lastValue: string;
  lastFillWidth: number;
  energy: number;
}

export class HudResourceRow {
  private readonly entries = new Map<string, EntryVisual>();
  private presentationActive = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly parent: Phaser.GameObjects.Container,
  ) {}

  sync(next: readonly HudResourceEntry[]): void {
    const nextIds = new Set(next.map((entry) => entry.id));
    for (const [id, visual] of this.entries) {
      if (!nextIds.has(id) && !visual.removing) this.remove(id, visual);
    }

    let layoutDirty = false;
    for (const entry of next) {
      let visual = this.entries.get(entry.id);
      if (!visual || visual.removing) {
        if (visual) this.destroyVisual(entry.id, visual);
        visual = this.create(entry);
        layoutDirty = true;
      }
      if (visual.side !== entry.side) { visual.side = entry.side; layoutDirty = true; }
      this.apply(visual, entry);
    }

    const order = next.map((entry) => entry.id);
    if (layoutDirty || this.orderSignature !== order.join('|')) {
      this.orderSignature = order.join('|');
      this.layout(order);
    }
  }

  /** Versteckt die Zeile sofort (Lobby, Rundenende). */
  clear(): void {
    for (const [id, visual] of [...this.entries]) this.destroyVisual(id, visual);
    this.orderSignature = '';
  }

  setPresentationActive(active: boolean): void {
    this.presentationActive = active;
    for (const visual of this.entries.values()) this.syncEffect(visual);
  }

  destroy(): void {
    this.clear();
  }

  private orderSignature = '';

  private cardHeight(): number {
    return HUD_CARD_SOURCE.height * SCALE;
  }

  private create(entry: HudResourceEntry): EntryVisual {
    let effect: LivingBarEffect | null = null;
    const card = new HudCard(this.scene, {
      scale: SCALE,
      width: ENTRY_W,
      tone: entry.tone,
      titleSize: 13,
      valueSize: 13,
      backingAlpha: 0.58,
      onFillCreated: (created) => {
        const rect = created.fillRect;
        effect = new LivingBarEffect(this.scene, created.root, rect.x, rect.y, rect.width, rect.height,
          HUD_TONES[entry.tone].fill, { glowTarget: created.fill, scrollFactor: 0, startActive: false,
            variantKey: `hud-resource-${entry.id}` });
      },
    });
    card.root.setVisible(true).setAlpha(0);
    this.parent.add(card.root);
    const visual: EntryVisual = {
      card, effect, side: entry.side, targetX: 0, targetY: 0,
      moveTween: null, enterTween: null, pulseTween: null, removing: false, placed: false, dim: false,
      lastTitle: '', lastValue: '', lastFillWidth: -1, energy: -1,
    };
    this.entries.set(entry.id, visual);
    return visual;
  }

  private apply(visual: EntryVisual, entry: HudResourceEntry): void {
    const card = visual.card;
    card.setTone(entry.tone);
    const value = entry.value ?? '';
    if (value !== visual.lastValue) {
      card.setValue(value, entry.valueColor ?? HUD_TEXT_PRIMARY);
      visual.lastValue = value;
      visual.lastTitle = '';
    }
    if (entry.title !== visual.lastTitle) {
      card.setTitle(entry.title);
      visual.lastTitle = entry.title;
    }
    card.setProgress(entry.frac, false);
    const fillWidth = entry.frac === null ? 0 : Math.round(card.fillRect.width * Phaser.Math.Clamp(entry.frac, 0, 1));
    if (fillWidth !== visual.lastFillWidth) {
      visual.effect?.setFilledWidth(fillWidth);
      visual.lastFillWidth = fillWidth;
    }
    const energy = Phaser.Math.Clamp(entry.energy ?? 0, 0, 1);
    if (Math.abs(energy - visual.energy) > 0.01) {
      visual.effect?.setEnergyIntensity(energy);
      visual.energy = energy;
    }
    this.syncEffect(visual);
    visual.dim = entry.dim ?? false;
    if (visual.placed && !visual.enterTween) card.root.setAlpha(visual.dim ? 0.5 : 1);
    this.setAttention(visual, entry.attention ?? false);
  }

  private syncEffect(visual: EntryVisual): void {
    if (!visual.effect) return;
    if (this.presentationActive && !visual.removing && visual.lastFillWidth > 4) visual.effect.start();
    else visual.effect.stop();
  }

  private setAttention(visual: EntryVisual, enabled: boolean): void {
    if (enabled === (visual.pulseTween !== null)) return;
    visual.pulseTween?.destroy();
    visual.pulseTween = null;
    visual.card.root.setScale(1);
    if (!enabled) return;
    visual.pulseTween = this.scene.tweens.add({
      targets: visual.card.root,
      scaleX: 1.035,
      scaleY: 1.035,
      duration: 720,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private layout(order: readonly string[]): void {
    const h = this.cardHeight();
    const baseY = GAME_HEIGHT - BOTTOM_MARGIN - h / 2;
    const centerX = GAME_WIDTH / 2;
    const visible = order.map((id) => this.entries.get(id))
      .filter((visual): visual is EntryVisual => !!visual && !visual.removing);
    // Linke Gruppe wie bisher von außen zur Mitte, rechte von der Mitte nach außen.
    const ordered = [
      ...visible.filter((visual) => visual.side === 'left').reverse(),
      ...visible.filter((visual) => visual.side === 'right'),
    ];
    for (let start = 0; start < ordered.length; start += PER_ROW) {
      const row = ordered.slice(start, start + PER_ROW);
      const width = row.length * ENTRY_W + (row.length - 1) * GAP_X;
      const y = baseY - (start / PER_ROW) * (h + GAP_Y);
      row.forEach((visual, column) => {
        const x = centerX - width / 2 + ENTRY_W / 2 + column * (ENTRY_W + GAP_X);
        this.moveTo(visual, x, y);
      });
    }
  }

  private moveTo(visual: EntryVisual, x: number, y: number): void {
    const root = visual.card.root;
    const fresh = !visual.placed;
    visual.placed = true;
    visual.targetX = x;
    visual.targetY = y;
    if (fresh) {
      // Auftritt: von der Unterkante hochgleiten und aufblenden.
      root.setPosition(x, y + 14).setAlpha(0);
      visual.enterTween = this.scene.tweens.add({
        targets: root,
        y,
        alpha: visual.dim ? 0.5 : 1,
        duration: ENTER_MS,
        ease: 'Cubic.easeOut',
        onComplete: () => { visual.enterTween = null; },
      });
      return;
    }
    if (root.x === x && root.y === y) return;
    visual.moveTween?.destroy();
    visual.moveTween = this.scene.tweens.add({
      targets: root,
      x,
      y,
      duration: MOVE_MS,
      ease: 'Cubic.easeInOut',
      onComplete: () => { visual.moveTween = null; },
    });
  }

  private remove(id: string, visual: EntryVisual): void {
    visual.removing = true;
    visual.moveTween?.destroy();
    visual.enterTween?.destroy();
    visual.enterTween = null;
    this.setAttention(visual, false);
    this.syncEffect(visual);
    this.scene.tweens.add({
      targets: visual.card.root,
      alpha: 0,
      y: visual.card.root.y + 10,
      duration: EXIT_MS,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (this.entries.get(id) === visual) this.destroyVisual(id, visual);
      },
    });
    this.orderSignature = '';
  }

  private destroyVisual(id: string, visual: EntryVisual): void {
    visual.moveTween?.destroy();
    visual.enterTween?.destroy();
    visual.pulseTween?.destroy();
    this.scene.tweens.killTweensOf(visual.card.root);
    visual.effect?.destroy();
    visual.card.destroy();
    if (this.entries.get(id) === visual) this.entries.delete(id);
  }
}
