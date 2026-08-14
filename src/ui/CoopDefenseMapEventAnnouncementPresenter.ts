import type { ResolvedCoopDefenseMapEventConfig } from '../config/coopDefenseMaps';
import type {
  CoopDefenseMapEventLifecycleState,
  CoopDefenseMapEventPresentationState,
} from '../types';
import type {
  CoopDefenseAnnouncementMessage,
  CoopDefenseObjectiveAnnouncement,
} from './CoopDefenseObjectiveAnnouncement';

interface EventStateKey {
  readonly occurrence: number;
  readonly state: CoopDefenseMapEventLifecycleState;
}

/**
 * Bridges the small authoritative map-event snapshot into the existing announcement queue.
 *
 * This class is deliberately presentation-only: it never schedules, completes or reconstructs
 * train, airstrike or hazard mechanics. A first snapshot is hydrated as a baseline so a late
 * join, reconnect or scene rebuild cannot replay a lifecycle transition from before the client
 * was present.
 */
export class CoopDefenseMapEventAnnouncementPresenter {
  private mapEventsReference: readonly ResolvedCoopDefenseMapEventConfig[] | null = null;
  private readonly eventsById = new Map<string, ResolvedCoopDefenseMapEventConfig>();
  private readonly previousState = new Map<string, EventStateKey>();
  private readonly currentState = new Map<string, EventStateKey>();
  private hydrated = false;
  private lastSnapshot: CoopDefenseMapEventPresentationState | null | undefined;

  constructor(private readonly announcements: Pick<CoopDefenseObjectiveAnnouncement, 'enqueue' | 'clearTopic'>) {}

  setMapEvents(events: readonly ResolvedCoopDefenseMapEventConfig[]): void {
    if (this.mapEventsReference === events
      || (events.length === 0 && this.mapEventsReference?.length === 0)) return;
    this.clearProducerState();
    this.hydrated = false;
    this.lastSnapshot = undefined;
    this.mapEventsReference = events;
    this.eventsById.clear();
    for (const event of events) this.eventsById.set(event.id, event);
  }

  /** Clears local dedupe state and any queued map-event messages for a new hydration baseline. */
  resetForHydration(): void {
    this.clearProducerState();
    this.hydrated = false;
    this.lastSnapshot = undefined;
  }

  reset(): void {
    this.resetForHydration();
  }

  sync(state: CoopDefenseMapEventPresentationState | null): void {
    if (this.lastSnapshot === state) return;
    this.lastSnapshot = state;
    if (state === null) {
      if (this.hydrated || this.previousState.size > 0) {
        this.resetForHydration();
        this.lastSnapshot = null;
      }
      return;
    }

    const nextState = new Map<string, EventStateKey>();
    for (const entry of state) {
      nextState.set(entry.eventId, { occurrence: entry.occurrence, state: entry.state });
    }

    if (!this.hydrated) {
      this.replaceState(nextState);
      this.hydrated = true;
      return;
    }

    const changedEntries = state.filter((entry) => !sameEventState(
      this.previousState.get(entry.eventId),
      entry,
    ));
    this.replaceState(nextState);

    for (const entry of changedEntries) {
      const event = this.eventsById.get(entry.eventId);
      if (!event || event.type !== entry.eventType || entry.state === 'dormant') continue;
      // Zugfahrten bleiben spielmechanisch aktiv, sind aber bewusst kein HUD-Ereignis:
      // ihre Einblendungen waren im Verhältnis zur taktischen Relevanz zu störend.
      if (event.type === 'train') continue;
      // Einzelne Zielverfolgungs-Luftangriffe telegraphieren ihre Position bereits ueber
      // die sichtbaren Airstrike-Warnkreise. Die wiederholten Map-Event-Pop-ups wuerden
      // diese taktische Information nur doppelt und bei jedem Zyklus anzeigen.
      if (event.type === 'airstrike' && event.pattern === 'player-hunt') continue;
      const message = createAnnouncementMessage(event, entry);
      if (message) this.announcements.enqueue({
        ...message,
        isRelevant: () => this.isCurrent(entry.eventId, entry.occurrence, entry.state),
      });
    }
  }

  private replaceState(nextState: Map<string, EventStateKey>): void {
    this.previousState.clear();
    for (const [eventId, value] of nextState) this.previousState.set(eventId, value);
    this.currentState.clear();
    for (const [eventId, value] of nextState) this.currentState.set(eventId, value);
  }

  private isCurrent(eventId: string, occurrence: number, state: CoopDefenseMapEventLifecycleState): boolean {
    const current = this.currentState.get(eventId);
    return current?.occurrence === occurrence && current.state === state;
  }

  private clearProducerState(): void {
    for (const eventId of this.eventsById.keys()) {
      this.announcements.clearTopic(getAnnouncementTopic(eventId));
    }
    this.previousState.clear();
    this.currentState.clear();
  }
}

function sameEventState(
  previous: EventStateKey | undefined,
  current: { occurrence: number; state: CoopDefenseMapEventLifecycleState },
): boolean {
  return previous?.occurrence === current.occurrence && previous.state === current.state;
}

function createAnnouncementMessage(
  event: ResolvedCoopDefenseMapEventConfig,
  entry: CoopDefenseMapEventPresentationState[number],
): Omit<CoopDefenseAnnouncementMessage, 'isRelevant'> | null {
  const topic = getAnnouncementTopic(event.id);
  const id = `${topic}:${entry.occurrence}:${entry.state}`;
  const active = entry.state === 'active';
  const repeating = entry.state === 'waiting-repeat';

  if (event.type === 'train') {
    return {
      id,
      topic,
      priority: active || repeating ? 90 : 80,
      kicker: repeating ? 'RB 54' : entry.state === 'completed' ? 'RB 54' : 'MAP-EVENT · RB 54',
      title: active ? 'RB 54 FÄHRT EIN' : entry.state === 'completed' ? 'RB 54 ABGEFAHREN' : 'RB 54 ANGEKÜNDIGT',
      detail: repeating ? 'NÄCHSTE DURCHFAHRT' : entry.state === 'completed' ? 'GLEISE WIEDER FREI' : 'GLEISE · AUSWEICHEN',
      tone: entry.state === 'completed' ? 'positive' : 'wave',
    };
  }

  if (event.type === 'airstrike') {
    const label = event.pattern === 'player-hunt'
      ? 'ZIELVERFOLGUNG'
      : event.pattern === 'tutorial-sweep'
        ? 'BOMBARDEMENT'
        : 'ZONEN-BARRAGE';
    return {
      id,
      topic,
      priority: active ? 95 : repeating ? 85 : 90,
      kicker: active ? 'LUFTANGRIFF' : entry.state === 'completed' ? 'LUFTANGRIFF' : 'WARNUNG · BOMBERANFLUG',
      title: active ? `${label} AKTIV` : entry.state === 'completed' ? `${label} BEENDET` : `${label} ANGEKÜNDIGT`,
      detail: entry.state === 'completed'
        ? 'EINSCHLÄGE ABGESCHLOSSEN'
        : event.pattern === 'player-hunt' ? 'IN BEWEGUNG BLEIBEN' : 'EINSCHLAGSBEREICH MEIDEN',
      tone: entry.state === 'completed' ? 'positive' : 'negative',
    };
  }

  const isVoid = event.effect.visualStyle === 'void';
  const label = isVoid ? 'LEERENBRAND' : 'BODENBRAND';
  return {
    id,
    topic,
    priority: active ? 95 : 90,
    kicker: active ? 'GEFAHRENFLÄCHE' : 'WARNUNG · BODENGEFAHR',
    title: active ? `${label} AKTIVIERT` : entry.state === 'completed' ? `${label} BEENDET` : `${label} ANGEKÜNDIGT`,
    detail: entry.state === 'completed' ? 'BEREICH WIEDER SICHER' : 'BEREICH VERMEIDEN',
    tone: active ? 'negative' : entry.state === 'completed' ? 'positive' : 'negative',
  };
}

function getAnnouncementTopic(eventId: string): string {
  return `map-event:${eventId}`;
}
