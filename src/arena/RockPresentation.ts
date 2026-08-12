import type * as Phaser from 'phaser';
import { ROCK_HP_MAX, CELL_SIZE } from '../config';
import type { ArenaLayout } from '../types';
import type { RockDestructionRenderer } from '../effects/RockDestructionRenderer';
import { ArenaBuilder, getArenaRockWorldFrame, type ArenaBuilderResult, type RockWorldFrame } from './ArenaBuilder';

/**
 * Woher der Felsbestand kommt, dessen Darstellung geführt wird.
 *
 * Bewusst Getter statt Referenzen: In der Arena sind Layout und Bauergebnis rundengebunden
 * und außerhalb einer Runde `null`; in der Lobby stehen sie über die gesamte Scene.
 */
export interface RockPresentationSources {
  readonly scene: Phaser.Scene;
  getResult(): ArenaBuilderResult | null;
  getLayout(): ArenaLayout | null;
  /** Weltausschnitt des Bestands. Arena: laufende Metriken, Lobby: Vorschaurahmen. */
  getWorldFrame(): RockWorldFrame;
}

/**
 * Gemeinsame Darstellung von Felsbau und Felszerstörung.
 *
 * Schaden, Zerstörung mit Trümmer-VFX, Neubau und der anschließende Overlay-/AutoTile-Neubau
 * laufen für Arena und Lobby über genau diese Abfolge. Autoritative Entscheidungen – wer
 * wieviel Schaden verursacht, ob ein Fels überhaupt zerstörbar ist – gehören **nicht**
 * hierher; die trifft der jeweilige Aufrufer.
 */
export class RockPresentation {
  constructor(
    private readonly sources: RockPresentationSources,
    private readonly destructionRenderer: RockDestructionRenderer,
  ) {}

  /** Weltmittelpunkt einer Gitterzelle im Rahmen dieses Bestands. */
  gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    const frame = this.sources.getWorldFrame();
    return {
      x: frame.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: frame.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  /** Schadenstint eines noch lebenden Felsens nachziehen. */
  applyDamageVisual(
    id: number,
    hp: number,
    maxHp = ROCK_HP_MAX,
    ownerColor?: number,
    ownerTintStrength = 0,
  ): void {
    const result = this.sources.getResult();
    const layout = this.sources.getLayout();
    if (!result || !layout) return;
    ArenaBuilder.updateRockVisual(result, layout.rocks, id, hp, maxHp, ownerColor, ownerTintStrength);
  }

  /**
   * Zerstört einen Fels sichtbar: Trümmer-VFX aus dem vorhandenen Renderer, danach Entfernen
   * und Retiling der Nachbarn. Gibt `false` zurück, wenn dort gar kein aktiver Fels stand.
   */
  destroyRock(id: number): boolean {
    const result = this.sources.getResult();
    const layout = this.sources.getLayout();
    if (!result || !layout) return false;
    const image = result.rockObjects[id];
    if (!image?.active) return false;

    this.destructionRenderer.playDestruction({ source: image });
    ArenaBuilder.destroyRockAndRetile(result, layout.rocks, id);
    return true;
  }

  /**
   * Baut einen Fels an seiner Originalzelle neu auf und retiled die Nachbarn.
   *
   * Ohne `ownerColor` entsteht ein neutraler Landschaftsfels: kein Besitzer-Tint, keine
   * Konstrukt-HP, keine Laufzeitbegrenzung.
   */
  buildRock(
    id: number,
    hp = ROCK_HP_MAX,
    maxHp = ROCK_HP_MAX,
    ownerColor?: number,
    ownerTintStrength = 0,
  ): Phaser.GameObjects.Image | null {
    const result = this.sources.getResult();
    const layout = this.sources.getLayout();
    if (!result || !layout || !layout.rocks[id]) return null;
    if (result.rockObjects[id]?.active) return result.rockObjects[id];

    return ArenaBuilder.spawnRockAndRetile(
      this.sources.scene,
      result,
      layout.rocks,
      id,
      ownerColor,
      ownerTintStrength,
      hp,
      maxHp,
      this.sources.getWorldFrame(),
    );
  }

  /**
   * Erneuert die felsabhängigen Overlays: gebackene Materialstörung, Fels-Decals und die
   * Flächen-/Kantentints der Nachbarn.
   *
   * Gehört gebündelt ans Ende einer Änderungswelle. Eine Explosion zerstört typischerweise
   * mehrere Felsen; pro Fels neu zu backen wäre ein sichtbarer Ruckler.
   */
  refreshOverlays(): void {
    const result = this.sources.getResult();
    const layout = this.sources.getLayout();
    if (!result || !layout) return;
    const frame = this.sources.getWorldFrame();
    ArenaBuilder.rebuildRockOverlays(this.sources.scene, result, layout, frame);
    // Das Kantenlicht eines Felsens haengt an der Belegung seiner Nachbarzellen; ein
    // zerstoerter oder gesetzter Fels aendert es also auch bei den Nachbarn.
    ArenaBuilder.refreshRockSurfaceTints(result, layout);
  }
}

/** Rahmen-Getter für einen Bestand, der in der laufenden Arena liegt. */
export const arenaWorldFrameSource = (): RockWorldFrame => getArenaRockWorldFrame();
