/**
 * Sichtbarer Zustand des Besitzers eines Projektils oder Effekts.
 *
 * Renderer und der {@link ProjectileManager} brauchen von einem Besitzer nur Position, Farbe
 * und Sichtbarkeit. Woher dieser Zustand stammt, ist ihnen gleich – im Gameplay aus dem
 * `PlayerManager`, in der Lobby aus der Ambient-Actor-Registry.
 */
export interface OwnerVisualState {
  x:       number;
  y:       number;
  /** Glow-/Strahlfarbe des Besitzers. */
  color:   number;
  visible: boolean;
}

/**
 * Nachschlagegrenze für Besitzerzustände.
 *
 * Diese Schnittstelle ist der einzige Weg, über den Darstellungscode an eine Besitzerposition
 * kommt. Sie hält die Renderer frei von Matchzustand, Netzwerk und Spielerverwaltung und
 * erlaubt derselben Renderkette, lokale Ambient-Actors zu bedienen.
 */
export interface OwnerVisualSource {
  /** Aktueller Zustand oder `null`, wenn der Besitzer nicht (mehr) existiert. */
  getOwnerVisualState(ownerId: string): OwnerVisualState | null;
}
