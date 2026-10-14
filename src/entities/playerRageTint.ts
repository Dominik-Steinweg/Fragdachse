/**
 * Rote Spieler-Einfärbung: ausschließlich während der Honigdachs-Wut, nie bei anderen aktiven
 * Ultimates. Host und Client projizieren denselben replizierten Zustand mit dieser einen Regel.
 */
export function usesRageTint(active: boolean, activeUltimateId: string | null | undefined): boolean {
  return active && activeUltimateId === 'HONEY_BADGER_RAGE';
}
