import type { PlayerProfile } from '../types';
import { PlayerWorldRuntime, type PlayerAttachContext } from './PlayerWorldRuntime';

/**
 * Konkrete, scene-seitige Operationen des world-scoped Player-Aufbaus.
 *
 * Die Composition kennt die feste Modulreihenfolge, aber keinen ArenaContext und keinen
 * langlebigen Runtime-State. Der entstandene {@link PlayerWorldRuntime} bleibt dessen Owner.
 */
export interface PlayerWorldRuntimeCompositionPorts {
  readonly attachEntity: (context: PlayerAttachContext) => void;
  readonly detachEntity: (playerId: string) => void;
  readonly attachCombat: (profile: PlayerProfile, reconnectAfterDeath: boolean) => boolean;
  readonly detachCombat: (playerId: string) => void;
  readonly attachCombatResources: (playerId: string) => void;
  readonly detachCombatResources: (playerId: string) => void;
  readonly attachPlayerBuild: (playerId: string, nowMs: number) => void;
  readonly detachPlayerBuild: (playerId: string) => void;
  readonly attachBurrow: (playerId: string) => void;
  readonly detachBurrow: (playerId: string) => void;
  readonly attachLoadout: (playerId: string) => void;
  readonly detachLoadout: (playerId: string) => void;
  readonly detachWorldTargeting: (playerId: string) => void;
}

/** Baut das feste world-scoped Player-Rezept; die Activity kommt darin nicht vor. */
export function composePlayerWorldRuntime(
  ports: PlayerWorldRuntimeCompositionPorts,
): PlayerWorldRuntime {
  return new PlayerWorldRuntime({
    attach: [
      {
        id: 'player-entity',
        feature: 'entity',
        run: (context) => { ports.attachEntity(context); },
        rollback: ({ profile }) => { ports.detachEntity(profile.id); },
      },
      {
        id: 'combat-state',
        feature: 'combat',
        run: ({ profile, reconnectAfterDeath }) => ports.attachCombat(profile, reconnectAfterDeath),
      },
      {
        id: 'combat-resources',
        feature: 'combatResources',
        run: ({ profile }) => { ports.attachCombatResources(profile.id); },
      },
      {
        id: 'player-build',
        feature: 'playerBuild',
        run: ({ profile, nowMs }) => { ports.attachPlayerBuild(profile.id, nowMs); },
      },
      {
        id: 'burrow-state',
        feature: 'combatResources',
        run: ({ profile }) => { ports.attachBurrow(profile.id); },
      },
      {
        id: 'loadout',
        feature: 'loadoutTools',
        run: ({ profile }) => { ports.attachLoadout(profile.id); },
      },
    ],
    detach: [
      {
        id: 'world-targeting',
        feature: 'worldTargeting',
        run: (playerId) => { ports.detachWorldTargeting(playerId); },
      },
      {
        id: 'combat-state',
        feature: 'combat',
        run: (playerId) => { ports.detachCombat(playerId); },
      },
      {
        id: 'combat-resources',
        feature: 'combatResources',
        run: (playerId) => { ports.detachCombatResources(playerId); },
      },
      {
        id: 'player-build',
        feature: 'playerBuild',
        run: (playerId) => { ports.detachPlayerBuild(playerId); },
      },
      {
        id: 'burrow-state',
        feature: 'combatResources',
        run: (playerId) => { ports.detachBurrow(playerId); },
      },
      {
        id: 'loadout',
        feature: 'loadoutTools',
        run: (playerId) => { ports.detachLoadout(playerId); },
      },
      {
        id: 'player-entity',
        feature: 'entity',
        run: (playerId) => { ports.detachEntity(playerId); },
      },
    ],
  });
}
