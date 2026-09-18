import authored from '../config/shootingRange.json';

export type ShootingRangeControl = 'power' | 'minus' | 'plus' | 'supply';
export type ShootingRangeAction = 'enable' | 'disable' | 'add' | 'remove' | 'supply-on' | 'supply-off';

/** Session identity rejects a delayed request from a previous activation in the same World. */
export interface ShootingRangeRequest {
  readonly control: ShootingRangeControl;
  readonly action: ShootingRangeAction;
  readonly session: number;
}

export function parseShootingRangeRequest(value: unknown): ShootingRangeRequest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.control !== 'string' || !['power', 'minus', 'plus', 'supply'].includes(input.control)
    || typeof input.action !== 'string' || !['enable', 'disable', 'add', 'remove', 'supply-on', 'supply-off'].includes(input.action)
    || typeof input.session !== 'number' || !Number.isSafeInteger(input.session) || input.session < 0) return null;
  return { control: input.control as ShootingRangeControl, action: input.action as ShootingRangeAction, session: input.session };
}

export interface ShootingRangeTarget {
  readonly id: string;
  readonly generation: number;
}

export interface ShootingRangeSample {
  readonly at: number;
  readonly dps: number;
}

/** Complete, bounded projection. Null at the network boundary means no range in this World. */
export interface ShootingRangeState {
  readonly session: number;
  readonly enabled: boolean;
  readonly count: number;
  readonly supply: boolean;
  readonly targets: readonly (ShootingRangeTarget | null)[];
  readonly dps: number;
  readonly scale: number;
  readonly samples: readonly ShootingRangeSample[];
}

export function shootingRangeAction(state: ShootingRangeState, control: ShootingRangeControl): ShootingRangeAction | null {
  if (control === 'power') return state.enabled ? 'disable' : 'enable';
  if (!state.enabled) return null;
  if (control === 'supply') return state.supply ? 'supply-off' : 'supply-on';
  if (control === 'minus') return state.count > 1 ? 'remove' : null;
  return control === 'plus' && state.count < authored.targets.length ? 'add' : null;
}
