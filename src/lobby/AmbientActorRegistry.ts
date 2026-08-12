import type { OwnerVisualSource, OwnerVisualState } from '../entities/OwnerVisualSource';
import type { LobbyAmbientActor } from './LobbyAmbientActor';

/**
 * Bestand der aktuell inszenierten Ambient-Actors.
 *
 * Erfüllt {@link OwnerVisualSource} und ist damit für die geteilte Renderkette das genaue
 * Gegenstück zum `PlayerManager` des Gameplays: Projektilmanager, Mündungsfeuer,
 * Strahl-Renderer und Effektsystem fragen Besitzerpositionen über dieselbe Grenze ab.
 */
export class AmbientActorRegistry implements OwnerVisualSource {
  private readonly actors = new Map<string, LobbyAmbientActor>();

  add(actor: LobbyAmbientActor): void {
    this.actors.set(actor.id, actor);
  }

  get(id: string): LobbyAmbientActor | undefined {
    return this.actors.get(id);
  }

  all(): LobbyAmbientActor[] {
    return [...this.actors.values()];
  }

  get size(): number {
    return this.actors.size;
  }

  /** Alle lebenden Actors der Gegenseite – Zielauswahl von Sequenzen. */
  opponentsOf(actor: LobbyAmbientActor): LobbyAmbientActor[] {
    return this.all().filter((other) => other.team !== actor.team && other.isAlive());
  }

  getOwnerVisualState(ownerId: string): OwnerVisualState | null {
    const actor = this.actors.get(ownerId);
    if (!actor) return null;
    return { x: actor.x, y: actor.y, color: actor.color, visible: actor.visible };
  }

  update(deltaMs: number): void {
    for (const actor of this.actors.values()) actor.update(deltaMs);
  }

  remove(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.destroy();
    this.actors.delete(id);
  }

  /** Räumt den gesamten Bestand ab. Nach dem Aufruf ist er garantiert leer. */
  clear(): void {
    for (const actor of this.actors.values()) actor.destroy();
    this.actors.clear();
  }
}
