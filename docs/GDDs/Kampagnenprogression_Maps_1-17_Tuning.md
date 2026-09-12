# Kampagne 1–17: Tuning nach funktionaler Vorbereitung

Stand: 12.09.2026. Ausgangswerte sind spielbar vorbereitet, aber noch nicht manuell solo oder im Koop abgenommen. Alle Zeiten in JSON sind Millisekunden, sofern das Feld nicht `Sec` heißt; Positionen sind Rasterzellen. Keine automatische Balancing-Schleife und kein Fortschrittsreset wurden ausgeführt.

## Zentrale Stellschrauben

| Bereich | Konfigurationsstelle | Ausgangswert / Bedeutung |
|---|---|---|
| Basisbrand | [`BASE_VOID_FIRE`](../../src/config/baseVoidFire.ts) | 200 HP/s, 4.000 ms Nachbrennen; ein Schadensstrom je Basis |
| Baubereich | [`persistentBase.ts`](../../src/config/persistentBase.ts) | Map 10 → Stufe 1 / Radius 5; Map 11 → Stufe 2 / Radius 6 |
| Begegnungen | `encounters[].groups[]` in den Map-JSONs | `count`, `delayMs`, `spawnStaggerMs`, `spawnArea`; `restAfterMs` am Encounter |
| Versorgung | `bases[].powerUpPedestals[]` | `cellOffset`, `respawnMs`, `spawnOnArenaStart`; an die Lebensdauer des Vorpostens gebunden |
| Wege | `rockField.corridors`, `missionProgress` | Checkpoints, Startbereich und Tore zusammen verschieben; Spawnflächen außerhalb der Basis-Schutzabstände halten |

## Änderungen pro Map

| Map / Datei | Ausgangslage für das Tuning | Playtest-Frage |
|---|---|---|
| [1 – Feuertaufe](../../src/config/coopDefenseMaps/01-feuertaufe.json) | Alle Encounter-Gegner sind Zombies; Tutorialroute, Zug, Hold und Vorschau erhalten. | Ist der Einstieg ohne Rabid/Demon verständlich und kurz genug? |
| [3 – Rastlos](../../src/config/coopDefenseMaps/03-rastlos.json) | `rabid-first-contact`: fünf Rabids, 500 ms Staffelung; danach 4,5 s Pause, spätere Pausen 3 s. Mehr Druck von mehreren Fronten. | Ist die erste Rabid-Gruppe erkennbar, bevor der gemischte Druck einsetzt? |
| [4 – Adrenalinrausch](../../src/config/coopDefenseMaps/04-adrenalinrausch.json) | `bfg-station` am mittleren Stützpunkt, erster Spawn nach 15 s; dichte Zombiegruppe ab 16 s mit 250 ms Staffelung. Adrenalin bleibt. | Wird die BFG rechtzeitig entdeckt und lohnt sie sich gegen die folgende Gruppe? |
| [6 – Sporenfront](../../src/config/coopDefenseMaps/06-sporenfront.json) | Drei L-förmige Vorposten mit je 650 HP und vorhandenem Plasma-Sporenturm: West (29,21), Nordwest (36,18), Ost (67,21). Lokale Spawnflächen führen an ihnen vorbei zur Basis. | Tragen alle drei Türme sichtbar zum Kampf bei, ohne ihn allein zu entscheiden? |
| [7 – Medic](../../src/config/coopDefenseMaps/07-medic.json) | Vier Kampfabschnitte nach Westen, dann Extraktion. Sieben Health-Podeste, 8 s Respawn, Vorposten mit 650 HP. Null Spielerrespawns, keine Checkpoint-Wiederbelebung. | Reicht die Versorgung für Fehlerkorrektur, und wie lang sind Zuschauerzeiten im Koop? |
| [8 – Dimensionsbruch](../../src/config/coopDefenseMaps/08-dimensionsbruch.json) | Hold-Vorposten mit Raketentürmen. `base_rocket_turret` ausschließlich unter `persistentBaseRewardsOnComplete`. | Ist der beschädigte Hold rettbar und als optionale permanente Belohnung verständlich? |
| [11 – Bombergeschwader](../../src/config/coopDefenseMaps/11-bombergeschwader.json) | Airstrikes unverändert; zentraler Sieg-Reward erweitert auf Radius 6. | Ist der zusätzliche Bauraum nach Map 10 deutlich genug erkennbar? |
| [14 – Brandschneise](../../src/config/coopDefenseMaps/14-brandschneise.json) | `brandschneise-firefront`: Warnung 15 s, Zündung 20 s, Ausbreitung 90 s, maximal links 36 × 42. `roughnessCells: 2`, `warningLeadMs: 3000`; rechte 24 Spalten sicher. | Bleiben Warnsaum, Rückzug und Basisbrand unter Pyro-Druck lesbar? Reicht die Endfläche für das gesamte Team? |
| [16 – Zeitzünder](../../src/config/coopDefenseMaps/16-zeitzuender.json) | Fünf Hinterhalte, zwei Spielerrespawns. Seitliche Timebomb-Gruppen, ab Abschnitt 3 zusätzliche Gruppen von hinten. Zwei Health-Stationen und zwei seitliche Void-Flächen; keine Dauerproduktion oder Hold-Mission. | Werden Hinterhalte ausgelöst, bevor man die nächste Sperre erreicht? Sind rückwärtige Gruppen überraschend, aber vermeidbar? |

Maps 2, 5, 9, 10, 12, 13, 15 und 17 behalten ihre Rollen und authored Rewards. Die globale Void-Basisbrandregel gilt auch dort.

## Hinweise für Änderungen

- Die finale Extraktion liegt hinter dem letzten Encounter-Tor. Tore, zugehörige Checkpoints und Spawnflächen als Abschnitt bearbeiten; Gruppen nicht hinter ein noch geschlossenes Tor setzen.
- Das Feuerrechteck beschreibt die maximale Fläche. Noch nicht erreichte Zellen sind nicht aktiv. `spread.durationMs` ist die Ausbreitungszeit; kein `durationMs` am Event setzen, denn die verbrannte Fläche bleibt bis zum Activity-Ende aktiv.
- `area.baseClearanceCells > 0` schützt Basisabstände absichtlich. Bei `0` darf Void-Fire die tatsächliche Basisfläche entzünden. Der Radius-6-Baubereich von Map 14 liegt vollständig rechts außerhalb des Feuerrechtecks.
- Der Map-8-Unlock wird schon beim Hold-Erfolg gespeichert und bleibt bei späterer Niederlage erhalten. Wiederholungen gewähren keine Duplikate. Radius-Upgrades sind monoton; Altfortschritt wird nicht rückwirkend ergänzt.
- Manuelle Abnahme: Solo und Koop, Sieg/Niederlage/Retry, Late Join während Feuerfront und Nachbrennen, beschädigte bzw. geschützte Basen sowie Replay der Maps 8, 10 und 11 prüfen. Browser und Dev-Server wurden für die Vorbereitung nicht gestartet.

## Automatische Prüfung

- `npm run check`: 3.472 Core-Tests, 33 Architekturtests und Produktionsbuild erfolgreich.
- `npm run test:integration`: 431 Tests erfolgreich, einschließlich neuer Brand-/Warnsaum-Replikation und Activity-Cleanup.
- `CoopDefenseArenaGeneration`, `CoopDefenseArenaWidth`, `CoopDefenseArenaHeight`: elf Stresstests erfolgreich. Alle 17 Maps generieren; Maps 7/16 werden über mehrere Seeds auf Checkpoint-, Spawn- und Extraktionserreichbarkeit geprüft.
- Zusätzlich ausgeführte Projektil-Stresssuite: 16 Tests erfolgreich, ein Fehler in `tests/stress/ProjectilePerformance.test.ts:330` beim erwarteten Flammenschaden gegen einen Turm. Dieser Test und der Projektilcode wurden für die Kampagnenänderung nicht verändert. Der Befund bleibt offen.
