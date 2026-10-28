# Bauhof-Vorbereitung, 28.10.2026

Messung der Öffnungszeit des Bauhofs vor und nach dem Umbau zur vorbereiteten Bühne
([GDD V2](../GDDs/Fragdachse_GDD_Lagekarte_Bauhof_V2.md), Entscheidung vom 28.10.).
Dev-Server (Vite), Desktop mit RTX 3080, Host allein, Map 18 (16:30) und Map 13. Gemessen über den
Lade-Lauf `editor` (`window.__FD_BOOT__.timeline()`) und Frame-Lücken per `requestAnimationFrame`.
Werte im Dev-Modus; Modul-Ladezeiten von Workern sind dort höher als im Build.

## Ausgangswert (Branch `lagekarte` 276c5518)

| Fall | Klick bis bereit | längster Frame |
|---|---|---|
| Erstes Öffnen, kalt | 3,6 s | 1,46 s |
| Zweites Öffnen, warm | 2,1 s | 470 ms (synchroner Aufbau 375 ms) |

Größte synchrone Blöcke (warm): Gelände 87–167 ms, erstes Sonnen-Update 106 ms, GPU-VFX + Power-ups 55 ms,
Sonne 55 ms, Übersicht 34–65 ms. Danach etwa 1,6 s Bakes, begrenzt durch den Material-Worker.

Texturspeicher (`allocatedPixels·4`): Bauhof-World ≈ 311 MB (Boden 102, Fels-Overlay 102, statische Schatten 34,
Formation 73), Lobby-World ≈ 258 MB. Der Spitzenwert (Lobby + offener Bauhof) bleibt mit der Vorbereitung gleich,
er hält nur länger an.

## Nach dem Umbau

| Fall | Ergebnis |
|---|---|
| Vorbereitet, Klick | Sitzung in 3 ms, kein Frame über 25 ms, danach 150 ms Einblendung |
| Vorbereitung, Spieler bewegt sich | kein Aufbauschritt über 5 ms; schwere Schritte warten |
| Vorbereitung, Spieler steht | schwere Schritte einzeln 47–86 ms, bereit nach ≈ 3,2 s |
| Klick 0,4 s nach Mapwechsel | Ladefenster sofort, offen nach 2,1 s (Aufbau 374 ms am Stück, Rest Bakes) |

Ohne Warm-up kostete der erste sichtbare Frame einer vorbereiteten Bühne 239 ms (Shader-Linken,
Filter-Puffer, Sonnen-Komposit). Zwei unsichtbare Frames während der Vorbereitung beseitigen das.

Schwere Schritte (warm, Map 18): Felsformation ≈ 45 ms, GPU-VFX ≈ 55 ms, Sonnenlicht-Aufbau ≈ 53 ms,
Sonnen-Komposit (`WorldSunComposite.create`) ≈ 88–100 ms. Ein Teilen der Sonnen-Shaderprogramme über
`sharedShaderName` könnte die beiden letzten verkürzen; nicht umgesetzt.

Nicht gemessen: Gastrolle, schwache Grafikkarten, Produktions-Build.
