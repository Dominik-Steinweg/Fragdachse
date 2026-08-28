import { ArenaGenerator, ARENA_GENERATOR_VERSION } from '../arena/ArenaGenerator';
import type { ArenaGenerationInput, ArenaGenerationMapConfig } from '../arena/ArenaGenerator';
import { buildLobbyWorldLayout } from '../arena/LobbyWorldLayout';
import { LOBBY_WORLD_DEFINITION_ID } from '../config/authoring/lobbyWorld';
import type { ArenaLayout } from '../types';
import type { WorldDescriptor, WorldParameters } from './WorldDescriptor';

/**
 * Die eine Stelle, an der die Geometrie einer World entsteht.
 *
 * Die meisten Worlds werden prozedural erzeugt: Seed, Metrik und authored Generatorparameter
 * gehen in {@link ArenaGenerator}. Eine World darf ihre Geometrie stattdessen vollstaendig
 * authoren – dann steht sie in dieser Registry.
 *
 * Beides bleibt derselbe Vertrag: das Ergebnis ist ein {@link ArenaLayout}, es haengt nur von
 * World-Identitaet und Seed ab, und der World-Fingerprint prueft auf jedem Peer, dass wirklich
 * dieselbe Geometrie entstanden ist. Es gibt deshalb keinen zweiten Bau-, Render- oder
 * Replikationspfad fuer authored Worlds.
 */

/** Baut die authored Geometrie genau einer World. Sie darf nur von der World selbst abhaengen. */
type AuthoredWorldLayoutBuilder = () => ArenaLayout;

const AUTHORED_WORLD_LAYOUTS: ReadonlyMap<string, AuthoredWorldLayoutBuilder> = new Map([
  [LOBBY_WORLD_DEFINITION_ID, buildLobbyWorldLayout],
]);

export interface WorldLayoutInput {
  readonly definitionId: string;
  readonly seed: number;
  /** Unveraenderliche Generatoreingaben dieser World; nur fuer prozedurale Worlds relevant. */
  readonly generation: ArenaGenerationInput;
  /** Authored Generatorparameter, falls die World welche besitzt. */
  readonly mapConfig?: ArenaGenerationMapConfig;
}

export function generateWorldLayout(input: WorldLayoutInput): ArenaLayout {
  const authored = AUTHORED_WORLD_LAYOUTS.get(input.definitionId);
  if (authored) return authored();
  return ArenaGenerator.generate(input.seed, input.generation, input.mapConfig);
}

/**
 * Identitaet einer neuen Instanz einer authored World.
 *
 * Seed und Fingerprint stehen bereits im Authoring; es gibt nichts zu wuerfeln. Zwei Instanzen
 * derselben authored World unterscheiden sich ausschliesslich in ihrer Revision – genau deshalb
 * ist ihre Neuerzeugung zugleich ihr Reset.
 */
export function createAuthoredWorldDescriptor(
  definitionId: string,
  worldRevision: number,
  parameters?: WorldParameters,
): WorldDescriptor {
  const authored = AUTHORED_WORLD_LAYOUTS.get(definitionId);
  if (!authored) {
    throw new Error(`[WorldLayout] World ${definitionId} has no authored layout`);
  }
  const layout = authored();
  const descriptor: WorldDescriptor = {
    worldRevision,
    definitionId,
    seed: layout.seed,
    generatorVersion: ARENA_GENERATOR_VERSION,
    layoutFingerprint: ArenaGenerator.fingerprint(layout),
  };
  return parameters ? { ...descriptor, parameters } : descriptor;
}
