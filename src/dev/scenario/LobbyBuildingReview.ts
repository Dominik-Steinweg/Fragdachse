import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { DevScenarioController } from './controller';
import { bridge } from '../../network/bridge';
import { DEPTH, PLAYER_SIZE } from '../../config';
import { LOBBY_BUILDINGS, LOBBY_BUILDING_INTERACTION_RANGE_PX, lobbyBuildingWorldRects } from '../../config/authoring/lobbyBuildings';
import { isLobbyWorldDefinitionId } from '../../config/authoring/lobbyWorld';
import { nearestStructurePoint, structureBounds } from '../../arena/StructureOutline';
import { isCoopDefenseMode } from '../../gameModes';
import { getVisibleWorldView } from '../../graphics/CameraWorldView';

type Side = 'N' | 'E' | 'S' | 'W';
const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];

/** Gap between the player's body and the outline bounds at an approach point. */
const APPROACH_GAP_PX = 12;

interface Fixture {
  readonly runtime: ArenaRuntime;
  readonly scene: Phaser.Scene;
  overlay: Phaser.GameObjects.Graphics | null;
}

const fixtures = new WeakMap<DevScenarioController, Fixture>();

/** Lobby review: the real lobby World, real input and real fog; the overlay is dev-only. */
export function bindLobbyBuildingReview(controller: DevScenarioController, runtime: ArenaRuntime, scene: Phaser.Scene): void {
  fixtures.set(controller, { runtime, scene, overlay: null });
}

export function releaseLobbyBuildingReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.overlay?.destroy();
  fixtures.delete(controller);
}

function requireLobby(runtime: ArenaRuntime): NonNullable<ReturnType<ArenaRuntime['getWorldMetrics']>> {
  const metrics = runtime.getWorldMetrics();
  if (bridge.getGamePhase() !== 'LOBBY' || !metrics || !isLobbyWorldDefinitionId(runtime.getWorldDescriptor()?.definitionId ?? '')) {
    throw new Error('lobbyBuildingReview braucht die bereite LobbyWorld.');
  }
  return metrics;
}

function building(menu: string) {
  const entry = LOBBY_BUILDINGS.find(candidate => candidate.menu === menu);
  if (!entry) throw new Error(`Unbekanntes Lobby-Menü: ${menu}`);
  return entry;
}

/** Normalized canvas position (0..1) of a world point in the main camera, for a pointer driver. */
function screenPoint(scene: Phaser.Scene, x: number, y: number): { u: number; v: number } {
  const view = getVisibleWorldView(scene.cameras.main);
  return { u: (x - view.x) / view.width, v: (y - view.y) / view.height };
}

/** Outline rects (cyan), Shift reach (amber) and the fog's fine barrier (magenta). */
function drawOverlay(fixture: Fixture): void {
  const metrics = requireLobby(fixture.runtime);
  const graphics = fixture.overlay ??= fixture.scene.add.graphics().setDepth(DEPTH.OVERLAY - 2);
  graphics.clear();
  const fog = fixture.runtime.getScenarioLightingTargets().fog;
  for (const entry of LOBBY_BUILDINGS) {
    const rects = lobbyBuildingWorldRects(metrics, entry), bounds = structureBounds(rects);
    if (fog) {
      graphics.fillStyle(0xff3cc8, 0.28);
      const frame = fog.terrain.frame;
      for (let y = bounds.top - 16; y < bounds.bottom + 16; y += 8) for (let x = bounds.left - 16; x < bounds.right + 16; x += 8) {
        if (fog.terrain.isBlockedAt(x + 4 - frame.offsetX, y + 4 - frame.offsetY)) graphics.fillRect(x, y, 8, 8);
      }
    }
    graphics.lineStyle(1, 0x3cf0ff, 0.95);
    for (const rect of rects) graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
    graphics.lineStyle(1, 0xffc040, 0.7);
    const reach = LOBBY_BUILDING_INTERACTION_RANGE_PX;
    graphics.strokeRoundedRect(bounds.left - reach, bounds.top - reach,
      bounds.right - bounds.left + reach * 2, bounds.bottom - bounds.top + reach * 2, reach);
  }
}

function status(controller: DevScenarioController, fixture: Fixture) {
  const metrics = requireLobby(fixture.runtime);
  const player = fixture.runtime.navigationLabPort.getPlayerPosition();
  const focus = controller.readInteraction()?.focus ?? null;
  return {
    player,
    focus: focus ? { key: focus.key, subject: focus.subject, label: focus.label, blocked: focus.blocked } : null,
    buildings: LOBBY_BUILDINGS.map(entry => {
      const rects = lobbyBuildingWorldRects(metrics, entry), bounds = structureBounds(rects);
      return {
        menu: entry.menu, bounds,
        center: screenPoint(fixture.scene, (bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2),
        wallDistance: player ? nearestStructurePoint(rects, player.x, player.y).distance : null,
      };
    }),
  };
}

async function waitForPlayer(runtime: ArenaRuntime, timeoutMs: number): Promise<void> {
  const until = performance.now() + timeoutMs;
  while (!runtime.navigationLabPort.getPlayerPosition()?.alive) {
    if (performance.now() > until) throw new Error('Lokaler Spieler ist der LobbyWorld nicht beigetreten.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * window.devScenario.run({action:'lobbyBuildingReview', step}) with step 'start',
 * 'approach:<menu>:<N|E|S|W>', 'time:<hh:mm>', 'fog:<strength>', 'quality:<level>', 'overlay:<on|off>'
 * or 'status'. Shift itself is pressed by the driver, exactly like a player.
 */
export async function runLobbyBuildingReview(controller: DevScenarioController, command: Record<string, unknown>): Promise<void> {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Lobby building review is not bound');
  const { runtime } = fixture;
  const [step, ...args] = String(command.step ?? 'start').split(':');
  const metrics = requireLobby(runtime);
  switch (step) {
    case 'start':
      // Menus open only in co-op; elsewhere Shift reports the co-op denial.
      if (bridge.isHost() && !isCoopDefenseMode(bridge.getGameMode())) bridge.setGameMode('coop_defense');
      runtime.requestLocalWorldParticipation(true);
      await waitForPlayer(runtime, 20000);
      drawOverlay(fixture);
      break;
    case 'approach': {
      const entry = building(args[0]);
      const side = args[1] as Side;
      if (!SIDES.includes(side)) throw new Error('Seite N, E, S oder W erwartet.');
      const bounds = structureBounds(lobbyBuildingWorldRects(metrics, entry));
      const gap = PLAYER_SIZE / 2 + APPROACH_GAP_PX;
      const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2;
      const point = side === 'N' ? { x: centerX, y: bounds.top - gap } : side === 'S' ? { x: centerX, y: bounds.bottom + gap }
        : side === 'W' ? { x: bounds.left - gap, y: centerY } : { x: bounds.right + gap, y: centerY };
      runtime.navigationLabPort.placePlayer(point.x, point.y);
      break;
    }
    case 'time': {
      const [hours, minutes] = args.map(Number);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        throw new Error('Uhrzeit hh:mm erwartet.');
      }
      bridge.setLobbyTimeOfDayMinutes(hours * 60 + minutes);
      runtime.syncLobbyTimeOfDay();
      break;
    }
    case 'fog': {
      const fog = runtime.getScenarioLightingTargets().fog;
      const strength = Number(args[0]);
      if (!fog || !Number.isFinite(strength) || strength < 0 || strength > 3) throw new Error('Nebelstärke 0…3 erwartet.');
      fog.strength = strength;
      break;
    }
    case 'quality': controller.setQuality(args[0] as Parameters<DevScenarioController['setQuality']>[0]); break;
    case 'overlay':
      if (args[0] === 'off') { fixture.overlay?.destroy(); fixture.overlay = null; } else drawOverlay(fixture);
      break;
    case 'status': break;
    default: throw new Error('Unknown lobbyBuildingReview step');
  }
  controller.lastAction = { lobbyBuildingReview: status(controller, fixture) };
  controller.syncPanel();
}
