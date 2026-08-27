import type { ActivityKind } from '../config/authoring/ActivityDefinition';
import type { PlayerProfile } from '../types';

/**
 * Gemeinsamer Lebenszyklus der Player-Runtime innerhalb einer World.
 *
 * Es gibt genau einen Weg hinein und einen hinaus – kein getrennter Mission-, Editor- oder
 * PvP-Pfad. Welche Module dabei laufen, entscheidet nicht mehr "welches System ist gerade nicht
 * null", sondern ein expliziter Kontext: Rolle und laufende Activity.
 *
 * Der Attach ist atomar. Bricht ein Modul ab, werden die bereits angehaengten in umgekehrter
 * Reihenfolge zurueckgenommen; ein Spieler bleibt nie halb initialisiert zurueck.
 */

/** Runtime-Bausteine, die ein Spieler in einer World haben kann. */
export type PlayerRuntimeFeature =
  /** Spielfigur, Physikkoerper und ihre Darstellung. */
  | 'entity'
  /** Wegfindung fuer verbuendete Einheiten. */
  | 'navigation'
  /** Kampfzustand: Leben, Treffer, Tod, Respawn. */
  | 'combat'
  /** Verbrauchsressourcen des Kampfes. */
  | 'combatResources'
  /** Loadout, Werkzeuge und ihre Laufzeitzustaende. */
  | 'loadoutTools'
  /** Zielmarkierung und Fokus – world-scoped Zustand ueber den Spieler als Ziel. */
  | 'worldTargeting'
  /** Missionsgebundener Spielerzustand: Respawn-Budget, Items, Missionsziele. */
  | 'missionStatus';

export type PlayerRuntimeFeatures = Readonly<Record<PlayerRuntimeFeature, boolean>>;

export interface PlayerRuntimeContextInput {
  /** Activity dieser World; `null` fuer eine World ohne Mission. */
  readonly activityKind: ActivityKind | null;
  /** Nur der Host fuehrt die autoritative Simulation eines Spielers. */
  readonly isHost: boolean;
}

/**
 * Leitet die Player-Features aus dem World-/Activity-Kontext ab.
 *
 * Der gemeinsame Lifecycle initialisiert damit ausdruecklich **nicht** automatisch den
 * vollstaendigen Mission-Player-Stack: eine World ohne Coop-Mission fuehrt keinen
 * missionsgebundenen Spielerzustand, und ein Client fuehrt keine autoritative Simulation.
 */
export function resolvePlayerRuntimeFeatures(input: PlayerRuntimeContextInput): PlayerRuntimeFeatures {
  const simulation = input.isHost;
  return {
    entity: true,
    worldTargeting: true,
    navigation: simulation,
    combat: simulation,
    combatResources: simulation,
    loadoutTools: simulation,
    missionStatus: simulation && input.activityKind === 'coop-mission',
  };
}

export interface PlayerAttachContext {
  readonly profile: PlayerProfile;
  /** True, wenn der Spieler nach einem Tod erneut in dieselbe Runde kommt. */
  readonly reconnectAfterDeath: boolean;
}

export interface PlayerAttachStep {
  readonly id: string;
  readonly feature: PlayerRuntimeFeature;
  /** `false` bricht den Attach ab und loest den Rollback aus. */
  readonly run: (context: PlayerAttachContext) => boolean | void;
  /** Nimmt genau diesen Schritt zurueck, wenn ein spaeterer scheitert. */
  readonly rollback?: (context: PlayerAttachContext) => void;
}

export interface PlayerDetachStep {
  readonly id: string;
  readonly feature: PlayerRuntimeFeature;
  readonly run: (playerId: string) => void;
}

export interface PlayerWorldRuntimeSteps {
  readonly attach: readonly PlayerAttachStep[];
  readonly detach: readonly PlayerDetachStep[];
}

export class PlayerWorldRuntime {
  private readonly attachedPlayers = new Set<string>();

  constructor(private readonly steps: PlayerWorldRuntimeSteps) {}

  isAttached(playerId: string): boolean {
    return this.attachedPlayers.has(playerId);
  }

  /**
   * Haengt einen Spieler an die World. Liefert `false`, wenn ein Modul den Attach ablehnt – der
   * Spieler ist dann so unberuehrt wie vorher.
   */
  attach(context: PlayerAttachContext, features: PlayerRuntimeFeatures): boolean {
    const playerId = context.profile.id;
    if (this.attachedPlayers.has(playerId)) return true;

    const completed: PlayerAttachStep[] = [];
    for (const step of this.steps.attach) {
      if (!features[step.feature]) continue;
      let accepted: boolean | void;
      try {
        accepted = step.run(context);
      } catch (error) {
        this.rollback(completed, context);
        throw error;
      }
      if (accepted === false) {
        this.rollback(completed, context);
        return false;
      }
      completed.push(step);
    }
    this.attachedPlayers.add(playerId);
    return true;
  }

  /**
   * Loest einen Spieler von der World. Laeuft ueber dieselbe Feature-Entscheidung wie der
   * Attach und ist damit auch fuer Spieler gueltig, die diese Runtime nie selbst angehaengt hat –
   * ein Client entfernt so genau seinen Anteil.
   */
  detach(playerId: string, features: PlayerRuntimeFeatures): void {
    this.attachedPlayers.delete(playerId);
    for (const step of this.steps.detach) {
      if (!features[step.feature]) continue;
      step.run(playerId);
    }
  }

  private rollback(completed: readonly PlayerAttachStep[], context: PlayerAttachContext): void {
    for (const step of [...completed].reverse()) {
      // Ein fehlgeschlagener Rollback darf den restlichen Rollback nicht verhindern.
      try {
        step.rollback?.(context);
      } catch {
        /* bewusst verschluckt */
      }
    }
  }
}
