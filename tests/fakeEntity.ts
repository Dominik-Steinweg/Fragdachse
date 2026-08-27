/**
 * Fake einer Figur fuer System- und Contract-Tests.
 *
 * Seit der Runtime-/Presentation-Trennung beantworten Spieler Position, Ausrichtung, Aktivitaet,
 * Bounds und Trefferradius selbst - ihr Sprite ist Darstellung und fuer die Simulation nicht mehr
 * erreichbar. Gegner und Koeder fuehren ihr Sprite weiterhin.
 *
 * Der Fake traegt beide Sichten auf **demselben Objekt** (`fake.sprite === fake`). Damit gibt es
 * genau einen Satz Werte: ein Test, der `fake.x` setzt, veraendert dieselbe Stelle wie einer, der
 * `fake.sprite.x` setzt - ein Fake kann nicht auseinanderlaufen.
 */
export interface FakeEntityState {
  x?: number;
  y?: number;
  active?: boolean;
  rotation?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  displayWidth?: number;
  displayHeight?: number;
  tint?: number;
  texture?: { key?: string };
  frame?: { name?: string | number };
  [key: string]: unknown;
}

export function fakeEntity(state: FakeEntityState = {}): Record<string, unknown> {
  const fake: Record<string, unknown> = { x: 0, y: 0, ...state };

  const width = (): number => (fake.displayWidth as number | undefined)
    ?? (fake.width as number | undefined) ?? 32;
  const height = (): number => (fake.displayHeight as number | undefined)
    ?? (fake.height as number | undefined) ?? 32;

  // Selbst gesetzte Funktionen eines Tests haben Vorrang - der Helfer ergaenzt nur.
  if (fake.getBounds === undefined) fake.getBounds = () => ({
    x: (fake.x as number) - width() / 2,
    y: (fake.y as number) - height() / 2,
    width: width(),
    height: height(),
  });
  // Trefferradius kommt aus der Runtime statt aus dem Anzeigemass.
  if (fake.getHitRadius === undefined) fake.getHitRadius = () => Math.max(width(), height()) * 0.5;
  if (fake.getCollisionRadius === undefined) fake.getCollisionRadius = () => Math.max(width(), height()) * 0.5;
  if (fake.getDeathVisual === undefined) fake.getDeathVisual = () => ({
    textureKey: (fake.texture as { key?: string } | undefined)?.key,
    frame: (fake.frame as { name?: string | number } | undefined)?.name,
    rotation: (fake.rotation as number | undefined) ?? 0,
    displayWidth: width(),
    displayHeight: height(),
    tint: (fake.tint as number | undefined) ?? 0xffffff,
  });

  // Eine Quelle, zwei Sichten.
  fake.sprite = fake;
  fake.physicsProxy = fake;
  fake.displayObject = fake;
  return fake;
}
