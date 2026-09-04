import type { PlayerProfile } from '../types';
import type { WorldParticipation } from './WorldParticipation';

/**
 * Gemeinsamer Lebenszyklus der Player-Runtime innerhalb einer World.
 *
 * Es gibt genau einen Weg hinein und einen hinaus – kein getrennter Mission-, Editor- oder
 * PvP-Pfad. Welche Module dabei laufen, entscheidet nicht mehr "welches System ist gerade nicht
 * null", sondern ein expliziter Kontext aus Rolle und Teilnahme. Missionsgebundene Module
 * gehoeren nicht hierher: Sie wuerden einen Activity-Wechsel in derselben World nicht ueberleben.
 *
 * Der Attach ist atomar. Bricht ein Modul ab, werden die bereits angehaengten in umgekehrter
 * Reihenfolge zurueckgenommen; ein Spieler bleibt nie halb initialisiert zurueck.
 */

/**
 * Runtime-Bausteine, die ein Spieler in einer World haben kann.
 *
 * Ausschliesslich world-scoped: Was ein Activity-Wechsel in derselben World nicht ueberleben
 * soll, gehoert nicht hierher, sondern in die Player-Runtime der jeweiligen Activity.
 */
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
  /** Coop-Build-Modifikatoren und Item-Laufzeitzustaende; auch ohne Activity erlaubt. */
  | 'playerBuild'
  /** Zielmarkierung und Fokus – world-scoped Zustand ueber den Spieler als Ziel. */
  | 'worldTargeting';

export type PlayerRuntimeFeatures = Readonly<Record<PlayerRuntimeFeature, boolean>>;

export interface PlayerRuntimeContextInput {
  /** Nur der Host fuehrt die autoritative Simulation eines Spielers. */
  readonly isHost: boolean;
  /**
   * Teilnahme dieses Spielers an der World. Sie beantwortet mit, welche Runtime-Module er
   * ueberhaupt braucht: wer nur zusieht, fuehrt keine Kampfsimulation.
   */
  readonly participation: WorldParticipation;
}

/**
 * Leitet die world-scoped Player-Features aus Rolle und Teilnahme ab.
 *
 * Die laufende Activity kommt hier nicht mehr vor: Ein Modul, dessen Antwort von ihr abhinge,
 * waere activity-scoped und gehoerte damit in die Player-Runtime der Activity.
 */
export function resolvePlayerRuntimeFeatures(input: PlayerRuntimeContextInput): PlayerRuntimeFeatures {
  // Ein Beobachter steht in der World, handelt darin aber nicht – er braucht deshalb keine
  // Kampf- und Ressourcenmodule.
  const simulation = input.isHost && input.participation !== 'observer';
  return {
    entity: true,
    worldTargeting: true,
    navigation: simulation,
    combat: simulation,
    combatResources: simulation,
    loadoutTools: simulation,
    playerBuild: simulation,
  };
}

export interface PlayerAttachContext {
  readonly profile: PlayerProfile;
  /** True, wenn der Spieler nach einem Tod erneut in dieselbe Runde kommt. */
  readonly reconnectAfterDeath: boolean;
  /** Zeitpunkt des Attach-Aufrufs; wird für zeitabhängige World-Player-Initialisierung weitergereicht. */
  readonly nowMs: number;
  /**
   * Autoritative Startposition dieses Eintritts in Weltkoordinaten.
   *
   * Der Host waehlt sie selbst und laesst das Feld leer. Ein Client traegt sie hier ein, sobald
   * der replizierte World-Snapshot sie kennt – er darf keine eigene wuerfeln.
   */
  readonly spawn?: { readonly x: number; readonly y: number };
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
  /**
   * Materialisierungs-Ledger: Zu jedem angehaengten Spieler die Module, die er beim Attach
   * tatsaechlich bekommen hat.
   *
   * Der Detach liest ausschliesslich hier. Er rekonstruiert nicht aus einer inzwischen
   * moeglicherweise anderen Policy, was einmal erzeugt worden sein koennte – ein Beobachter, der
   * zwischenzeitlich Teilnehmer geworden waere, wuerde sonst Module abbauen, die er nie hatte,
   * und ein Teilnehmer wuerde seine behalten.
   */
  private readonly materializedFeatures = new Map<string, PlayerRuntimeFeatures>();

  constructor(private readonly steps: PlayerWorldRuntimeSteps) {}

  isAttached(playerId: string): boolean {
    return this.materializedFeatures.has(playerId);
  }

  /** Alle Spieler, die diese World-Runtime aktuell traegt. */
  attachedPlayerIds(): readonly string[] {
    return [...this.materializedFeatures.keys()];
  }

  /**
   * Haengt einen Spieler an die World. Liefert `false`, wenn ein Modul den Attach ablehnt – der
   * Spieler ist dann so unberuehrt wie vorher.
   */
  attach(context: PlayerAttachContext, features: PlayerRuntimeFeatures): boolean {
    const playerId = context.profile.id;
    if (this.materializedFeatures.has(playerId)) return true;

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
    this.materializedFeatures.set(playerId, { ...features });
    return true;
  }

  /**
   * Loest einen Spieler genau einmal von der World. Wiederholtes Leave ist ein No-op; ein
   * spaeterer Rejoin muss zuerst einen neuen erfolgreichen Attach durchlaufen.
   */
  detach(playerId: string): void {
    const features = this.materializedFeatures.get(playerId);
    if (!features) return;
    this.materializedFeatures.delete(playerId);
    for (const step of this.steps.detach) {
      if (!features[step.feature]) continue;
      step.run(playerId);
    }
  }

  /** Loest jeden getragenen Spieler. Mit dem Ende der World steht niemand mehr in ihr. */
  detachAll(): void {
    for (const playerId of this.attachedPlayerIds()) this.detach(playerId);
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
