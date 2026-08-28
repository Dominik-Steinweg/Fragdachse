import type { PersistentConstruction, PersistentToolKind } from './PersistentBaseTypes';

/**
 * Was ein Werkzeug fuer genau einen Besitzer bedeutet.
 *
 * Freischaltung, Klasse und Loadout gehoeren dem Besitzer der Konstruktion, nicht dem Host des
 * Raums. Deshalb wird diese Definition immer fuer eine bestimmte Spieler-ID aufgeloest - ein Gast
 * darf ein Werkzeug einsetzen, das der Host selbst nicht besitzt.
 */
export interface PersistentRestoreToolDefinition {
  readonly kind: PersistentToolKind;
  readonly id: string;
  readonly footprint: readonly { readonly dx: number; readonly dy: number }[];
  readonly capacityCost: number;
  readonly maxHp: number;
  readonly unlocked: boolean;
  /** An unlocked tool may remain dormant while it is not in the current loadout. */
  readonly active?: boolean;
  readonly unavailableReason?: PersistentToolUnavailableReason;
}

/** Warum ein Besitzer sein Werkzeug gerade nicht einsetzen darf. */
export type PersistentToolUnavailableReason = 'class-not-allowed' | 'mode-not-allowed';

/** Ein vom Composite freigegebener Eintrag, bereit zur Materialisierung in der Welt. */
export interface PersistentRestoreCandidate {
  readonly blueprint: PersistentConstruction;
  readonly tool: PersistentRestoreToolDefinition;
  readonly gridX: number;
  readonly gridY: number;
}
