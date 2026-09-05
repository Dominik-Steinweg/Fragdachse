/**
 * Sichtbarer Zustand des Besitzers eines Projektils oder Effekts.
 *
 * Renderer und die Projectile-Presentation brauchen von einem Besitzer nur Position, Farbe
 * und Sichtbarkeit. Woher dieser Zustand stammt, bleibt dieser Grenze ueberlassen; die Quelle
 * kann aus der jeweils zustaendigen Player-/World-Runtime kommen.
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
 * erlaubt derselben Renderkette, lokale wie replizierte Besitzerzustaende zu bedienen.
 */
export interface OwnerVisualSource {
  /** Aktueller Zustand oder `null`, wenn der Besitzer nicht (mehr) existiert. */
  getOwnerVisualState(ownerId: string): OwnerVisualState | null;
}
