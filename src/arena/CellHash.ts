/**
 * Deterministischer Hash einer Gitterzelle.
 *
 * Die Platzierung haengt ausschliesslich von den Gitterkoordinaten ab, nie von einer Position in
 * einer Liste und nie von der Anzahl lebender Zellen. Das ist die Voraussetzung dafuer, einen
 * Layer bei jeder Hindernisaenderung neu backen zu koennen: eine listenabhaengige Zufallsfolge
 * wuerde die gesamte Flaeche umfaerben, sobald eine einzige Zelle verschwindet – im Spiel sichtbar
 * als Flackern aller Felsen, sobald einer zerbricht.
 */
export function hashCell01(gridX: number, gridY: number, salt: number): number {
  let h = Math.imul(gridX + 0x9e3779b1, 0x85ebca6b)
    ^ Math.imul(gridY + 0x7f4a7c15, 0xc2b2ae35)
    ^ Math.imul(salt + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x2545f491);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Seed-abhaengige Variante fuer Felder, die pro Runde anders aussehen sollen.
 *
 * Der Seed laeuft durch eine eigene Avalanche-Runde, bevor er in den Salt eingeht. Eine blosse
 * Addition wuerde `seed + k` nicht von `(seed + 1) + (k - 1)` unterscheiden; benachbarte
 * Layout-Seeds ergaeben dann nur verschobene, aber gleich aussehende Felder.
 */
export function hashSeededCell01(seed: number, gridX: number, gridY: number, salt: number): number {
  let s = seed >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x7feb352d);
  s = Math.imul(s ^ (s >>> 15), 0x846ca68b);
  s ^= s >>> 16;
  return hashCell01(gridX, gridY, (s + Math.imul(salt, 0x9e3779b1)) | 0);
}
