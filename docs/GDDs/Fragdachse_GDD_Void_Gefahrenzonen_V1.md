# Void-Gefahrenzonen und feste Spawnzonen (V1)

Status: umgesetzt und auf `main` (2026-10-19). Ersetzt N-6 und N-7 aus
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
| E10 | (Nachtrag) Ein Spawnort, der noch nicht aktiv ist, trägt schwächeren Dunst. Gemeint sind eine Zone, die erst ein späterer Encounter, eine spätere Quelle oder der Boss nutzt, und ein schlafender Spawnpunkt. Ein Spawnort, der nie mehr aktiv wird, verliert den Dunst ganz, die Pflanzen bleiben als Narbe. |
| E11 | (Nachtrag) Ein deaktivierter Spawnort verliert den Dunst nicht ganz. Nur kleine, weiterhin dichte Flächen bleiben, über den Void-Pflanzen und an wenigen Stellen des getränkten Bodens. Das Abklingen ist ein Erfolgserlebnis: Eine weiche violette Welle läuft auf der GPU vom Zentrum nach außen, die Sporen flackern auf und werden mitgerissen. Eine Zone gilt bis zum Abwehren ihrer Welle als aktiv. |
| E9 | Die Sporen werden feiner, weniger weiß und dezenter, leuchten aber weiter. Wie der Dunst reagieren sie auf Explosionen und Bewegung. |

## 3. Modell

- **Spawnzonen gehören zur World** (`WorldDefinition.spawnZones`, `src/config/spawnZones.ts`).
  - Sie sind benannte Orte in Arenazellen: authored als Kasten, die Zone ist die organische Ellipse darin (seit 2026-10-28).
  - Optionale Felder: `medium: 'water'` (Wasserhöhle), `cluster` (Rudel-Spawn) und `keepClear: false` (der Generator hält keinen Kern frei).
- **Die Activity referenziert Zonen per ID.** Das gilt für Encounter-Gruppen (`spawnZoneId`), Dauerquellen (`source: {type: 'zone'}`) und den Boss (`spawnZoneId`, nicht beim Kraken).
- **Validierung:**
  - Jede Zone muss benutzt werden.
  - Eine Wasserzone muss Wasser enthalten.
  - `front` und `spawnZoneId` schließen sich aus.
- **Generator:** Er hält einen runden Kern jeder Boden-Zone frei, außer bei `keepClear: false`. Die migrierten Altflächen tragen `keepClear: false` und erzeugen dadurch bytegleiche Layouts.
- **Gefahrenfeld (Präsentation, `src/arena/VoidDangerField.ts`):**
  - Es wird nur aus Gefahrenquellen gebaut. Ohne Quellen entsteht kein Void, keine Textur und kein Quad.
  - Quellen der World: feindliche Basen, alle Spawnzonen, der Kraken-Teich mit seinen Ausgängen und authored `voidDanger.foci`.
  - Quellen der Activity: dauerhafte Void-Bodengefahren ab Start (`isPermanentVoidGroundHazard`). Die Activity liefert außerdem die Präsenz jeder Quelle (`src/activity/CoopMissionVoidDanger.ts`).
  - Jede Quelle hat eine eigene Stärke für Pflanzen und Dunst. Ihr Rand ist durch Rauschen gebrochen, also nie ein Kreis.
  - `voidDanger.intensity` (0,5–1,5) skaliert, wie weit das Void um die Gefahr reicht. Den ambienten Befall-Level (`voidFlora.level`) gibt es nicht mehr.
- **Kanäle der Geflecht-Textur:**
  - R: getränkter Boden (Narbe);
  - G: Landanteil;
  - B: Dunst.
  - Fällt die Präsenz einer Quelle weg, wird nur B im Begrenzungsrahmen dieser Quelle neu berechnet und über 3 s überblendet. Pflanzen und R bleiben.

## 4. Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Spawnzonen in Daten, Host, Generator und Map-Editor; Migration der Inline-Flächen (Maps 00, 01, 06, 07, 13, 16, 20) | fertig |
| 2 | Gefahrenfeld ersetzt das ambiente Void | fertig |
| 3 | GPU-Sporen; der Nebel leiht seine Luft | fertig |
| 4 | Host-Warnungen und Drahtformat (Protokoll 40) | fertig |
| 5 | Gerichtete Randwarnung und HUD-Richtung | fertig, an Zonen angeschlossen |
| 6 | Umbau der Front-Karten (02–06, 08–15, 17–20) auf feste Spawnzonen | fertig; Void-Vorschau im Map-Editor offen |
| 7 | Doku und Release | fertig; Spieltest und Perf-Messpaar offen |

## 5. Entscheidungslog

- 2026-10-19: Präsenz-Überblendung per Teil-Upload des B-Kanals statt zweitem Kanal und Uniform. Ein Datenkanal im Alpha einer Canvas-Textur würde vormultipliziert und dabei zerstört. Ein zweiter Sampler passt nicht ins Budget des Nebel-Passes.
- 2026-10-19: Eine Dawn-Stätte gilt als geschlossen, wenn ihr Ziel `completed` oder `failed` ist (Ende zur Dämmerung). Das ist replizierter Zustand, der Client braucht nichts Eigenes.
- 2026-10-19: Die Sporen-Partikel sind ein GPU-Pass über dem Dunst (`VoidSporeMotes`) und ersetzen die Sprite-Sporen über Pflanzen. Sie gehören zum Dunst: Über einer Narbe ohne Präsenz gibt es keine.
- 2026-10-19: Der Nebel verleiht seine Luft erst nach seinem Schritt im Frame (`GroundFogSystem.getAirBinding`). Er tauscht seine Texturen pro Schritt und kann sie freigeben.
- 2026-10-19: Warnungen kommen aus drei Quellen: Director-Gruppen (Vorlauf 2 s vor dem ersten geplanten Spawn, offen bis zum letzten), Dauerquellen auf Zonen (jeder Takt 2 s vorher) und Boss-Zone (ab Intro). Sie werden pro Zone zusammengeführt (`csz`) und nur bei Änderung veröffentlicht. Der Client glättet die Stärke, damit ein ersetzter Takt abklingt statt abzureißen. Im Shader verdichten bis zu 8 Zonen den Dunst-Kanal.
- 2026-10-19: Die Front-Karten wurden per Codemod (`scripts/map-tools/migrate-front-zones.py`) umgestellt. Die Zonen liegen im alten Randband. Gruppen einer Front wechseln Encounter für Encounter durch deren Zonen. Gruppen über 15 Gegner werden mit gleicher Gesamtzahl auf die Zonen ihrer Front verteilt. Map 08: `dimension-north/south` kommen aus Nord- und Süd-Zonen. Map 06: Die Süd-Zone liegt östlich, weil die Mitte des Südrands in der Reservierung der persistenten Basis liegt. Neue Zonen halten ihren Kern frei, deshalb ändern sich die Fingerprints (E1).
- 2026-10-19 (E10): Der Host veröffentlicht, welche Zonen gerade genutzt werden oder noch kommen und welche schlafenden Ziele verfallen sind (`csp`, Protokoll 41). Eine Zone ist aktiv, solange ein laufender Encounter dort noch eine fällige Gruppe hat, eine Dauerquelle läuft oder das Boss-Intro läuft. Sie ist kommend, solange ein nicht gestarteter Encounter, eine spätere Quelle oder der wartende Boss sie nutzt. Sonst ist sie verbraucht. Präsenz: aktiv 1, kommend oder schlafend 0,45, verbraucht oder verfallen 0.
- 2026-10-19 (E11): Ohne Präsenz behält eine Quelle nur den Rest (`VoidHazeResidue`) mit mindestens `RESIDUE_HAZE` Dichte: Flecken um Seerosen- und Felskolonien und eine kleine Rauschauswahl auf stark befallenem Boden. Die Deaktivierung wischt den B-Kanal radial vom Zentrum der Quelle aus (3,2 s, Teil-Uploads). Die Wellenfront trägt `uVoidLift[4]` in den Sporen-Pass: weicher Schimmer, Sporen werden nach außen geschoben und flackern auf. Der Host meldet eine Zone als aktiv, bis der laufende Encounter dort abgewehrt ist.
- 2026-10-19 (Map 20, Spieltest "man sieht den großen Kraken nicht mehr gut"): Der Nebel-Composite liegt über den Figuren, der Dunst darin verdeckte den Kraken im Teich. Zwei allgemeine Regeln statt eines Map-Sonderfalls:
  - Der Dunst haftet an Land und Ufern. Über offenem Wasser bleibt ein Film von 20 %, Warnungen zu 60 %. Der Teich zeigt Tinte, Ufer und Ausgänge bleiben dicht.
  - Körper ab Bossgröße (56 px) halten Nebel und Dunst um sich offen, auch in Ruhe. Davon profitiert auch der normale Nebel, der über Wasser dichter ist.
- 2026-10-28 (Spieltest Lagekarte): Spawnzonen sind rund statt rechteckig: die Ellipse im authored Kasten, ihr Rand schwingt organisch nach innen. Spawns, Routenquellen, Prüfungen, Dunst, Warnungen, Lagekarte und Map-Editor lesen dieselbe Form. Bodenzonen über Wasser wurden verlegt (Maps 02, 05, 08, 11, 13, 14; Map 02 bekommt dafür ein trockenes Westufer), sehr flache Randzonen wurden runder (Maps 05, 06, 08, 09, 10, 14, 15, 17). Generator 17, Protokoll 53.
- 2026-10-19: Die Dawn-Angriffswellen behalten ihr intern erzeugtes Inline-Rechteck. Sie sind eine generierte Activity ohne authored Ort. Der Dunst über Dawn-Stätten kommt aus den feindlichen Stätten-Basen.
