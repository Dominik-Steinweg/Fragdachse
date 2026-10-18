# Void-Gefahrenzonen und feste Spawnzonen (V1)

Status: in Umsetzung seit 2026-10-19 im Branch `void-danger`. Ersetzt N-6 und N-7 aus
[Nachtsicht, Mondlicht und Void-Botanik V1](Fragdachse_GDD_Nachtsicht_Void_Botanik_V1.md). Die übrigen
Nachtsicht-Entscheidungen gelten weiter: Mondinseln, Lampe am Fels und blaues Nachtwasser.

## 1. Anlass

Im Spieltest wirkte der Sporendunst wie eine Fläche mit Gameplay-Bedeutung, die gefährlich ist und
nicht betreten werden sollte. Als allgemeines Ambiente passt er deshalb nicht. Er wird stattdessen
gezielt eingesetzt: Violett bedeutet Gefahr.

## 2. Entscheidungen (2026-10-19)

| # | Entscheidung |
|---|---|
| E1 | Alle Front-Karten (02–05, 08–12, 14, 15, 17–19) bekommen feste Spawnzonen. Fronten bleiben nur als technischer Rückfall und für Dawn. |
| E2 | Den Dunst tragen Feindbasen, Spawnzonen, der Kraken-Teich auf Map 20 mit seinen Ausgängen, dauerhafte Bodengefahren (Map 15 Flecken, Map 17 Korridor), feindliche Dawn-Stätten und die Wasserzonen der Mini-Kraken. |
| E3 | Void-Pflanzen (Seerosen, Moos, Adern, Wassertinte) folgen der Gefahr. In PvP, Lobby und auf sicherem Gelände gibt es keinen Befall. |
| E4 | Über jeder Spawnzone liegt immer leichter Dunst, auch über Hinterhalten. Vor einem Spawn verdichtet er sich, und Sporen steigen auf. |
| E5 | Die Randwarnung bleibt, markiert aber nur den Randabschnitt in Richtung der Zone. Das HUD nennt eine von 8 Himmelsrichtungen. |
| E6 | Bezugspunkt für Randwarnung und HUD-Richtung ist die Mitte des sichtbaren Bereichs. |
| E7 | Nach Zerstörung oder Schließung verfliegen Dunst und Sporen. Die Pflanzen bleiben als Narbe. |
| E8 | Vorwarnzeit: Der Dunst setzt 2 s vor dem Spawn ein, die Randwarnung 1 s vorher. |
| E9 | Die Sporen werden feiner, weniger weiß und dezenter, leuchten aber weiter. Wie der Dunst reagieren sie auf Explosionen und Bewegung. |

## 3. Modell

- **Spawnzonen gehören zur World** (`WorldDefinition.spawnZones`, `src/config/spawnZones.ts`).
  - Sie sind benannte Rechtecke in Arenazellen.
  - Optionale Felder: `medium: 'water'` (Wasserhöhle), `cluster` (Rudel-Spawn) und `keepClear: false` (der Generator hält keinen Kern frei).
- **Die Activity referenziert Zonen per ID.** Das gilt für Encounter-Gruppen (`spawnZoneId`), Dauerquellen (`source: {type: 'zone'}`) und den Boss (`spawnZoneId`, nicht beim Kraken).
- **Validierung:**
  - Jede Zone muss benutzt werden.
  - Eine Wasserzone muss Wasser enthalten.
  - `front` und `spawnZoneId` schließen sich aus.
- **Generator:** Er hält einen runden Kern jeder Boden-Zone frei, außer bei `keepClear: false`. Die migrierten Altflächen tragen `keepClear: false` und erzeugen dadurch bytegleiche Layouts.
- **Gefahrenfeld (Präsentation):**
  - Es wird nur aus Gefahrenquellen gebaut.
  - Ohne Quellen entsteht kein Void, keine Textur und kein Quad.

## 4. Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Spawnzonen in Daten, Host, Generator und Map-Editor; Migration der Inline-Flächen (Maps 00, 01, 06, 07, 13, 16, 20) | fertig (Branch) |
| 2 | Gefahrenfeld ersetzt das ambiente Void | in Arbeit |
| 3 | GPU-Sporen; der Nebel leiht seine Luft | offen |
| 4 | Host-Warnungen und Drahtformat (Protokoll +1) | offen |
| 5 | Gerichtete Randwarnung und HUD-Richtung | eigene Sitzung |
| 6 | Umbau der Front-Karten | offen |
| 7 | Doku und Release | offen |

## 5. Entscheidungslog

- 2026-10-19: Die Dawn-Angriffswellen behalten ihr intern erzeugtes Inline-Rechteck. Sie sind eine generierte Activity ohne authored Ort. Der Dunst über Dawn-Stätten kommt aus den feindlichen Stätten-Basen.
