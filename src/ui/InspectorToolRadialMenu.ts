import * as Phaser from 'phaser';
import { COLORS, DEPTH, toCssColor } from '../config';
import { getCoopDefenseConstructionDefinition, getToolCapacityCost } from '../config/coopDefenseConstructions';
import { toDesignSpace } from '../graphics/RenderResolution';
import { UTILITY_CONFIGS } from '../loadout/LoadoutConfig';
import { describeLoadoutTool } from '../loadout/LoadoutCatalog';
import type { LoadoutToolRef } from '../types';
import { getInspectorToolRadialSegmentIndex } from './InspectorToolRadialGeometry';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

const INNER_RADIUS = 34;
const OUTER_RADIUS = 112;
const LABEL_RADIUS = 76;

/**
 * Auswahl aus dem Rad. Der Rueckbau ist ein fester Zusatzeintrag ohne Ausruestungsplatz
 * und darf deshalb nie als `LoadoutToolRef` in ein Profil wandern.
 */
export type InspectorRadialSelection =
  | { kind: 'tool'; tool: LoadoutToolRef }
  | { kind: 'dismantle' };

interface RadialEntry {
  readonly selection: InspectorRadialSelection;
  readonly displayName: string;
  readonly textureKey: string | null;
  readonly accentColor: number;
  /** Kapazitaetskosten des Konstrukts; 0 bei reinen Utilities und beim Rueckbau. */
  readonly capacityCost: number;
  readonly cooldownMs: number;
  /** false = passt aktuell nicht mehr in die freie Baukapazitaet. */
  readonly affordable: boolean;
}

export function isSameInspectorRadialSelection(
  left: InspectorRadialSelection | null,
  right: InspectorRadialSelection | null,
): boolean {
  if (!left || !right) return left === right;
  if (left.kind === 'dismantle' || right.kind === 'dismantle') return left.kind === right.kind;
  return left.tool.kind === right.tool.kind && left.tool.id === right.tool.id;
}

/** Screen-space radial selection for the Inspector's shared tool loadout. */
export class InspectorToolRadialMenu {
  private container: Phaser.GameObjects.Container | null = null;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private entries: readonly RadialEntry[] = [];
  private currentIndex = -1;
  private hoveredIndex = -1;
  private origin = { x: 0, y: 0 };

  constructor(private readonly scene: Phaser.Scene) {}

  get isOpen(): boolean {
    return this.container !== null;
  }

  open(
    originX: number,
    originY: number,
    tools: readonly LoadoutToolRef[],
    selected: InspectorRadialSelection | null,
    usedCapacity: number,
    // Bewusst ohne Default: ein stiller Rueckfall auf die Grundkapazitaet wuerde Item-Boni
    // verschlucken und Bauplaetze als nicht bezahlbar anzeigen, die der Host akzeptiert.
    capacityMax: number,
  ): void {
    this.close();
    this.entries = buildEntries(tools, usedCapacity, capacityMax);
    if (this.entries.length === 0) return;
    this.origin = {
      x: toDesignSpace(this.scene.scale, originX),
      y: toDesignSpace(this.scene.scale, originY),
    };
    this.currentIndex = selected
      ? this.entries.findIndex((entry) => isSameInspectorRadialSelection(entry.selection, selected))
      : 0;
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.hoveredIndex = -1;
    // Wird bei jedem Öffnen neu aufgebaut – die Beförderung gehört deshalb hierher und nicht
    // in eine einmalige Registrierung beim Start.
    this.container = this.scene.add.container(this.origin.x, this.origin.y)
      .setScrollFactor(0)
      .setDepth(DEPTH.LOCAL_UI + 20);
    promoteToClarityCamera(this.scene, this.container);
    this.graphics = this.scene.add.graphics();
    this.container.add(this.graphics);
    this.render();
  }

  update(pointerX: number, pointerY: number): void {
    if (!this.container || this.entries.length === 0) return;
    const designX = toDesignSpace(this.scene.scale, pointerX);
    const designY = toDesignSpace(this.scene.scale, pointerY);
    this.hoveredIndex = getInspectorToolRadialSegmentIndex(
      designX - this.origin.x,
      designY - this.origin.y,
      this.entries.length,
      INNER_RADIUS,
    ) ?? -1;
    this.render();
  }

  close(pointerX?: number, pointerY?: number): InspectorRadialSelection | null {
    if (pointerX !== undefined && pointerY !== undefined) this.update(pointerX, pointerY);
    const entry = this.hoveredIndex >= 0 ? this.entries[this.hoveredIndex] : undefined;
    const selection = entry ? cloneSelection(entry.selection) : null;
    this.container?.destroy(true);
    this.container = null;
    this.graphics = null;
    this.entries = [];
    this.currentIndex = -1;
    this.hoveredIndex = -1;
    return selection;
  }

  destroy(): void {
    this.close();
  }

  private render(): void {
    if (!this.graphics || !this.container) return;
    for (const child of this.container.list.slice()) {
      if (child !== this.graphics) child.destroy();
    }
    this.container.removeAll(false);
    this.container.add(this.graphics);
    this.graphics.clear();
    const count = this.entries.length;
    const step = Math.PI * 2 / count;
    const start = -Math.PI / 2;
    for (let index = 0; index < count; index += 1) {
      const from = start + index * step + 0.025;
      const to = start + (index + 1) * step - 0.025;
      const entry = this.entries[index];
      const active = index === (this.hoveredIndex >= 0 ? this.hoveredIndex : this.currentIndex);
      const color = entry.affordable ? entry.accentColor : COLORS.RED_2;
      const contentAlpha = entry.affordable ? (active ? 1 : 0.8) : 0.45;
      this.graphics.fillStyle(active ? color : COLORS.GREY_8, active ? 0.92 : 0.9);
      this.graphics.lineStyle(active ? 3 : 1.5, color, active ? 1 : 0.75);
      this.graphics.beginPath();
      this.graphics.moveTo(INNER_RADIUS * Math.cos(from), INNER_RADIUS * Math.sin(from));
      this.graphics.arc(0, 0, OUTER_RADIUS, from, to, false);
      this.graphics.lineTo(INNER_RADIUS * Math.cos(to), INNER_RADIUS * Math.sin(to));
      this.graphics.arc(0, 0, INNER_RADIUS, to, from, true);
      this.graphics.closePath();
      this.graphics.fillPath();
      this.graphics.strokePath();

      const center = start + (index + 0.5) * step;
      const labelX = LABEL_RADIUS * Math.cos(center);
      const labelY = LABEL_RADIUS * Math.sin(center);
      if (entry.textureKey && this.scene.textures.exists(entry.textureKey)) {
        const icon = this.scene.add.image(labelX, labelY - 8, entry.textureKey)
          .setDisplaySize(28, 28)
          .setAlpha(contentAlpha);
        this.container.add(icon);
      }
      this.container.add(this.scene.add.text(labelX, labelY + 18, entry.displayName.slice(0, 14), {
        fontSize: '10px', fontFamily: 'monospace', fontStyle: active ? 'bold' : 'normal',
        color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0.5).setAlpha(contentAlpha));
      if (entry.capacityCost > 0) {
        this.container.add(this.scene.add.text(labelX, labelY + 30, `${entry.capacityCost} BK`, {
          fontSize: '8px', fontFamily: 'monospace',
          color: toCssColor(entry.affordable ? COLORS.GOLD_2 : COLORS.RED_2),
        }).setOrigin(0.5).setAlpha(entry.affordable ? (active ? 1 : 0.75) : 0.9));
      }
      if (entry.cooldownMs > 0) {
        this.container.add(this.scene.add.text(labelX, labelY + 40, `CD ${(entry.cooldownMs / 1000).toFixed(1)}s`, {
          fontSize: '7px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
        }).setOrigin(0.5).setAlpha(active ? 1 : 0.65));
      }
    }
    this.graphics.fillStyle(COLORS.GREY_9, 0.95);
    this.graphics.fillCircle(0, 0, INNER_RADIUS - 2);
    this.graphics.lineStyle(2, COLORS.GREY_3, 0.9);
    this.graphics.strokeCircle(0, 0, INNER_RADIUS - 2);
    this.container.add(this.scene.add.text(0, 0, 'E', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5));
  }
}

/**
 * `capacityMax` wird uebergeben statt aus der Konstante gelesen: das persoenliche Maximum haengt
 * an den Item-Boni des Spielers, und dieses Modul kennt weder Spieler-ID noch Modifikatoren.
 */
function buildEntries(
  tools: readonly LoadoutToolRef[],
  usedCapacity: number,
  capacityMax: number,
): RadialEntry[] {
  const free = Math.max(0, capacityMax - usedCapacity);
  const entries: RadialEntry[] = tools.map((tool) => {
    const presentation = describeLoadoutTool(tool);
    const capacityCost = getToolCapacityCost(tool);
    return {
      selection: { kind: 'tool', tool },
      displayName: presentation.displayName,
      textureKey: presentation.textureKey,
      accentColor: presentation.accentColor,
      capacityCost,
      cooldownMs: tool.kind === 'construction'
        ? getCoopDefenseConstructionDefinition(tool.id).buildCooldownMs
        : UTILITY_CONFIGS[tool.id as keyof typeof UTILITY_CONFIGS]?.cooldown ?? 0,
      affordable: capacityCost <= free,
    };
  });
  if (entries.length === 0) return entries;
  entries.push({
    selection: { kind: 'dismantle' },
    displayName: 'Rückbau',
    textureKey: null,
    accentColor: COLORS.GREY_3,
    capacityCost: 0,
    cooldownMs: 0,
    affordable: true,
  });
  return entries;
}

function cloneSelection(selection: InspectorRadialSelection): InspectorRadialSelection {
  return selection.kind === 'dismantle'
    ? { kind: 'dismantle' }
    : { kind: 'tool', tool: { ...selection.tool } };
}
