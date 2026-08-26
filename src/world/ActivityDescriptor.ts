import type { ActivityKind } from '../config/authoring/ActivityDefinition';
import type { WorldDescriptor } from './WorldDescriptor';

/**
 * Kanonische replizierte Activity-Identitaet.
 *
 * Eine Activity setzt zwingend eine aktive World voraus und nennt sie ueber
 * {@link ActivityDescriptor.worldRevision}. Sie dupliziert die World-Identitaet nicht: Seed,
 * Generator-Version und Layout-Fingerprint stehen ausschliesslich im
 * {@link WorldDescriptor}.
 *
 * Umgekehrt gilt das nicht – eine World kann ohne Activity bestehen. Der Kanal dieses
 * Descriptors traegt dann schlicht `null`.
 */
export interface ActivityDescriptor {
  /** Identitaet genau eines Activity-Durchlaufs, getrennt von der World-Identitaet. */
  readonly activityRevision: number;
  /** Die World-Instanz, in der diese Activity laeuft. */
  readonly worldRevision: number;
  readonly kind: ActivityKind;
  /** Verweist auf die authored ActivityDefinition, z. B. `activity:coop-mission:7`. */
  readonly definitionId: string;
}

const ACTIVITY_KINDS: ReadonlySet<string> = new Set<ActivityKind>([
  'coop-mission',
  'deathmatch',
  'team-deathmatch',
  'capture-the-beer',
]);

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && ACTIVITY_KINDS.has(value);
}

/** Netzwerkgrenze fuer eingehende Activity-Identitaeten. */
export function parseActivityDescriptor(raw: unknown): ActivityDescriptor | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ActivityDescriptor>;
  if (!isSafePositiveInteger(candidate.activityRevision)) return null;
  if (!isSafePositiveInteger(candidate.worldRevision)) return null;
  if (!isActivityKind(candidate.kind)) return null;
  if (typeof candidate.definitionId !== 'string' || candidate.definitionId.length === 0) return null;
  return {
    activityRevision: candidate.activityRevision,
    worldRevision: candidate.worldRevision,
    kind: candidate.kind,
    definitionId: candidate.definitionId,
  };
}

/** True, solange die Activity zur angegebenen World-Instanz gehoert. */
export function isActivityOfWorld(activity: ActivityDescriptor, world: WorldDescriptor): boolean {
  return activity.worldRevision === world.worldRevision;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
