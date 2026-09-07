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
  /** Animated held-item muzzle. Absent for owners without held weapons. */
  readOwnerHeldWeaponPose?(ownerId: string, out: OwnerHeldWeaponPose): boolean;
  /** Render pose, written into caller-owned storage without allocating. */
  readOwnerRenderPose?(ownerId: string, out: OwnerRenderPose): boolean;
  /** Aktueller Zustand oder `null`, wenn der Besitzer nicht (mehr) existiert. */
  getOwnerVisualState(ownerId: string): OwnerVisualState | null;
}

export interface OwnerRenderPose { x: number; y: number; rotation: number; }
export interface OwnerHeldWeaponPose extends OwnerRenderPose { itemId: string; }
