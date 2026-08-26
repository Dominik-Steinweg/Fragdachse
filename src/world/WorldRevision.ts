/**
 * Gemeinsame monotone Revisionsquelle und die zentrale Verwerfungsregel fuer worldbezogene
 * Nachrichten.
 *
 * World- und Activity-Revision duerfen aus derselben monotonen Quelle stammen, sind aber
 * unterschiedliche Identitaeten. Deshalb steht die Erzeugung hier genau einmal – und nicht
 * verstreut in den Lifecycle-Pfaden, die eine neue Instanz eroeffnen.
 */

/**
 * Naechste Revision einer neuen Instanz.
 *
 * Der Zeitstempel macht Revisionen ueber Neustarts hinweg vergleichbar; `previousRevision + 1`
 * haelt sie auch dann streng monoton, wenn zwei Instanzen in dieselbe Millisekunde fallen
 * (Abbruch und sofortiger Neustart). Eine verspaetete Nachricht der Vorinstanz kann eine neue
 * dadurch niemals zufaellig treffen.
 */
export function nextMonotonicRevision(previousRevision: number, nowMs: number): number {
  return Math.max(nowMs, previousRevision + 1);
}

/**
 * Umschlag fuer jede worldbezogene Nachricht.
 *
 * Er existiert, damit die Zuordnung nicht an jeder einzelnen Aufrufstelle von Hand geprueft
 * werden muss: Placement, Construction Mutation, Occupancy, World Snapshot, Initial Baseline,
 * Load Ready, Player Runtime Join und worldbezogene RPCs laufen alle durch dieselbe Regel.
 */
export interface WorldScoped<T> {
  readonly worldRevision: number;
  readonly payload: T;
}

export function worldScoped<T>(worldRevision: number, payload: T): WorldScoped<T> {
  return { worldRevision, payload };
}

/**
 * Zentrale Verwerfungsregel: eine Nachricht der World-Revision N darf niemals auf eine andere
 * World-Revision angewendet werden.
 *
 * Liefert die Nutzlast nur, wenn der Umschlag gueltig ist und exakt zur aktuellen World gehoert;
 * sonst `null`. Fehlende, unplausible und fremde Revisionen sind derselbe Fall – die
 * Netzwerkgrenze soll hier nicht raten.
 */
export function acceptWorldScoped<T>(currentWorldRevision: number, message: unknown): T | null {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as Partial<WorldScoped<T>>;
  if (typeof candidate.worldRevision !== 'number' || !Number.isSafeInteger(candidate.worldRevision)) return null;
  if (candidate.worldRevision !== currentWorldRevision) return null;
  if (!('payload' in candidate)) return null;
  return candidate.payload as T;
}

/** Direkte Fassung derselben Regel fuer Nachrichten, die ihre Revision selbst als Feld tragen. */
export function isCurrentWorldRevision(currentWorldRevision: number, candidateRevision: unknown): boolean {
  return typeof candidateRevision === 'number'
    && Number.isSafeInteger(candidateRevision)
    && candidateRevision === currentWorldRevision;
}
