import { describe, expect, it } from 'vitest';

import {
  LOBBY_AMBIENT_ROCK_IDS,
  LOBBY_FRAME_BOUNDS,
  LOBBY_PANEL_WIDTH,
  LOBBY_ROCK_ROLES,
  MENU_ARENA_PREVIEW_CONFIG,
} from '../src/arena/MenuArenaPreviewConfig';
import { isLobbyUiReservedCell } from '../src/arena/MenuArenaPreviewConfig';
import { AMBIENT_ZONES } from '../src/lobby/AmbientZones';
import { ARENA_OFFSET_Y, CELL_SIZE, GAME_WIDTH } from '../src/config';

const rocks = MENU_ARENA_PREVIEW_CONFIG.layout.rocks;
const rockKeys = new Set(rocks.map(({ gridX, gridY }) => `${gridX}:${gridY}`));

/** Panelgrundriss in Gitterzellen – die Kernfläche der Felslandschaft. */
const panelCore = {
  minGridX: Math.ceil((GAME_WIDTH / 2 - LOBBY_PANEL_WIDTH / 2) / CELL_SIZE),
  maxGridX: Math.floor((GAME_WIDTH / 2 + LOBBY_PANEL_WIDTH / 2) / CELL_SIZE) - 1,
  minGridY: (LOBBY_FRAME_BOUNDS.outerTop - ARENA_OFFSET_Y) / CELL_SIZE,
  maxGridY: (LOBBY_FRAME_BOUNDS.outerBottom - ARENA_OFFSET_Y) / CELL_SIZE - 1,
};

describe('lobby ambient zones', () => {
  it('never places a combat zone under a side menu or the centre panel', () => {
    for (const zone of AMBIENT_ZONES) {
      for (let gridY = zone.minGridY; gridY <= zone.maxGridY; gridY += 1) {
        for (let gridX = zone.minGridX; gridX <= zone.maxGridX; gridX += 1) {
          expect(
            isLobbyUiReservedCell(gridX, gridY),
            `Zone ${zone.id} greift auf die Oberflächenfläche bei ${gridX},${gridY}`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps at least one zone on each side of the frame', () => {
    const ids = AMBIENT_ZONES.map((zone) => zone.id);
    expect(ids).toContain('left_gap');
    expect(ids).toContain('right_gap');
    expect(ids).toContain('bottom_band');
  });
});

describe('lobby rock landscape', () => {
  it('fills the area under the centre panel completely instead of leaving it bare', () => {
    let covered = 0;
    let total = 0;
    for (let gridY = panelCore.minGridY; gridY <= panelCore.maxGridY; gridY += 1) {
      for (let gridX = panelCore.minGridX; gridX <= panelCore.maxGridX; gridX += 1) {
        total += 1;
        if (rockKeys.has(`${gridX}:${gridY}`)) covered += 1;
      }
    }

    expect(total).toBeGreaterThan(300);
    expect(covered).toBe(total);
  });

  it('lets the edge run out organically instead of ending on a straight line', () => {
    // Unmittelbar links und rechts der Kernfläche steht ein ausgefranster Saum: einige Zellen
    // belegt, aber nicht alle – sonst gäbe es keine Öffnungen für die Ambient-Actors.
    const seam: boolean[] = [];
    for (let gridY = panelCore.minGridY; gridY <= panelCore.maxGridY; gridY += 1) {
      seam.push(rockKeys.has(`${panelCore.minGridX - 2}:${gridY}`));
      seam.push(rockKeys.has(`${panelCore.maxGridX + 2}:${gridY}`));
    }

    expect(seam.some(Boolean)).toBe(true);
    expect(seam.every(Boolean)).toBe(false);
  });

  it('keeps the rock lettering band above the panel free of landscape rocks', () => {
    for (const { gridX, gridY } of rocks) {
      if (gridY >= panelCore.minGridY) continue;
      if (gridX <= panelCore.minGridX - 4 || gridX >= panelCore.maxGridX + 4) continue;
      // Über dem Panel darf nur der Schriftzug selbst stehen – und der ist strukturell.
      const index = rocks.findIndex((rock) => rock.gridX === gridX && rock.gridY === gridY);
      expect(LOBBY_ROCK_ROLES[index]).toBe('structural');
    }
  });

  it('marks lettering and frame as structural and everything else as ambient', () => {
    expect(LOBBY_ROCK_ROLES).toHaveLength(rocks.length);

    const structuralCount = LOBBY_ROCK_ROLES.filter((role) => role === 'structural').length;
    expect(structuralCount).toBeGreaterThan(0);
    expect(LOBBY_AMBIENT_ROCK_IDS.length).toBe(rocks.length - structuralCount);

    // Die Felsen unter dem Panel sind Landschaft und damit für die Inszenierung freigegeben.
    const ambientIds = new Set(LOBBY_AMBIENT_ROCK_IDS);
    const midX = Math.round((panelCore.minGridX + panelCore.maxGridX) / 2);
    const midY = Math.round((panelCore.minGridY + panelCore.maxGridY) / 2);
    const midIndex = rocks.findIndex((rock) => rock.gridX === midX && rock.gridY === midY);
    expect(midIndex).toBeGreaterThanOrEqual(0);
    expect(ambientIds.has(midIndex)).toBe(true);
  });
});
