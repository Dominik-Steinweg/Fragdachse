import type {
  FireControlCopiesDeploymentSnapshot, FireControlDeploymentSnapshot, FireControlPortalDeploymentSnapshot, FireControlSnapshot,
} from './FireControlSnapshot';

export interface FireControlDeploymentStatus<T extends FireControlDeploymentSnapshot = FireControlDeploymentSnapshot> {
  readonly deployment: T;
  readonly remainingMs: number;
}
export type FireControlCopiesStatus = FireControlDeploymentStatus<FireControlCopiesDeploymentSnapshot>;
export type FireControlPortalStatus = FireControlDeploymentStatus<FireControlPortalDeploymentSnapshot>;

/** Read the replicated deployment using synchronized host time, including between snapshots. */
function getStatus<K extends FireControlDeploymentSnapshot['kind']>(
  snapshot: FireControlSnapshot, ownerId: string, now: number, kind: K,
): FireControlDeploymentStatus<Extract<FireControlDeploymentSnapshot, { kind: K }>> | null {
  const deployment = snapshot.deployments.find(
    (entry): entry is Extract<FireControlDeploymentSnapshot, { kind: K }> =>
      entry.kind === kind && entry.ownerId === ownerId && entry.expiresAt > now,
  );
  return deployment ? { deployment, remainingMs: deployment.expiresAt - now } : null;
}

export function getFireControlCopiesStatus(snapshot: FireControlSnapshot, ownerId: string, now: number): FireControlCopiesStatus | null {
  return getStatus(snapshot, ownerId, now, 'copies');
}

export function getFireControlPortalStatus(snapshot: FireControlSnapshot, ownerId: string, now: number): FireControlPortalStatus | null {
  return getStatus(snapshot, ownerId, now, 'portal');
}
