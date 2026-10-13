import type { FireControlCopiesDeploymentSnapshot, FireControlSnapshot } from './FireControlSnapshot';

export interface FireControlCopiesStatus {
  readonly deployment: FireControlCopiesDeploymentSnapshot;
  readonly remainingMs: number;
}

/** Read the replicated deployment using synchronized host time, including between snapshots. */
export function getFireControlCopiesStatus(
  snapshot: FireControlSnapshot,
  ownerId: string,
  now: number,
): FireControlCopiesStatus | null {
  const deployment = snapshot.deployments.find(
    (entry): entry is FireControlCopiesDeploymentSnapshot =>
      entry.kind === 'copies' && entry.ownerId === ownerId && entry.expiresAt > now,
  );
  return deployment ? { deployment, remainingMs: deployment.expiresAt - now } : null;
}
