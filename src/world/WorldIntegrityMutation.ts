export type WorldObjectKind = 'rock' | 'construction' | 'base' | 'train';

export type WorldRemovalCause = 'damage' | 'decay' | 'removal' | 'teardown';

export interface WorldIntegrityState {
  readonly integrity: number;
  readonly maxIntegrity: number;
  readonly destroyed: boolean;
}

export interface WorldIntegrityFacts {
  readonly kind: WorldObjectKind;
  readonly id: string | number;
  readonly position: { readonly x: number; readonly y: number };
  readonly category?: string;
  readonly ownerId?: string;
}

export type WorldIntegrityMutationResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'inert'; readonly state: WorldIntegrityState }
  | { readonly kind: 'immune'; readonly state: WorldIntegrityState }
  | {
    readonly kind: 'applied';
    readonly actualAmount: number;
    readonly state: WorldIntegrityState;
    readonly transition: 'none' | 'destroyed';
    readonly facts?: WorldIntegrityFacts;
  };

export function integrityState(
  integrity: number,
  maxIntegrity: number,
): WorldIntegrityState {
  return Object.freeze({
    integrity,
    maxIntegrity,
    destroyed: integrity <= 0,
  });
}
