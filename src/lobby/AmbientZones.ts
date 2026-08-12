/** Rechteckige Zone im Lobby-Gitter, in Zellen. */
export interface AmbientZone {
  id: string;
  minGridX: number;
  maxGridX: number;
  minGridY: number;
  maxGridY: number;
}

/**
 * Spielflächen der Ambient-Inszenierung.
 *
 * Die Felslandschaft unter dem Mittelpanel gehört ausdrücklich **nicht** dazu: Sie ist die
 * ruhige Fläche hinter dem Text. Zerstörung darf dort trotzdem Wege öffnen, die innerhalb
 * derselben Sequenz benutzt werden – der Compiler wählt sie nur nicht als Startzone.
 *
 * Die Zonen sind bewusst großzügig geschnitten; welche Zellen davon tatsächlich frei sind,
 * entscheidet der Compiler beim Auflösen gegen den echten Felsbestand.
 */
export const AMBIENT_ZONES: readonly AmbientZone[] = [
  { id: 'top_left',    minGridX:  0, maxGridX: 13, minGridY: 0,  maxGridY: 7 },
  { id: 'top_right',   minGridX: 46, maxGridX: 59, minGridY: 0,  maxGridY: 7 },
  { id: 'left_gap',    minGridX:  0, maxGridX: 16, minGridY: 9,  maxGridY: 27 },
  { id: 'right_gap',   minGridX: 43, maxGridX: 59, minGridY: 9,  maxGridY: 27 },
  { id: 'bottom_band', minGridX:  0, maxGridX: 59, minGridY: 29, maxGridY: 32 },
];

export function getAmbientZone(id: string): AmbientZone | undefined {
  return AMBIENT_ZONES.find((zone) => zone.id === id);
}
