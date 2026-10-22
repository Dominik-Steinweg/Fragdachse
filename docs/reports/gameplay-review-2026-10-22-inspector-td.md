# Gameplay-Analyse 22.10.2026: Inspector Gadachs als Action-TD-Klasse

Stand: `main` am 2026-10-22. Dieser Bericht hält eine Gameplay-Analyse und Vorschläge fest. Er ist kein GDD;
die ausgewählten Vorschläge brauchen jeweils ein eigenes GDD in [`docs/GDDs/`](../GDDs/README.md).

## 1. Richtungsentscheidungen

Mit dem Projektinhaber abgestimmt:

| Frage | Entscheidung |
|---|---|
| TD-Vorbild | **Action-TD** (Orcs Must Die, Dungeon Defenders): Der Inspector kämpft mit und baut Fallen und Türme an Engstellen. |
| Fokus dieser Runde | **TD-Spieler und Coop-Action.** PvP nur am Rand (Abschnitt 6). |
| Rundenstruktur | Runden bleiben **kurz**, die Progression liegt **zwischen** den Runden. In Ruhe gebaut wird zwischen den Runden, auch in der Lobby. In der Runde überwiegt die Action. Es gibt keine In-Run-Währung und keine Bauphase in der Mission. |
| Investitionsmodell | **Baukapazität** begrenzt, *wie viel* gebaut wird. **Upgrade-Punkte** begrenzen, *was* und *wie stark* gebaut wird. Es kommt keine neue Währung hinzu. |
| Planungsraum | Noch offen. Leitidee: In der Lobby die **nächste Map um die persistente Basis** zeigen und die **Angriffsrichtungen** andeuten, damit die Basis sinnvoll geplant werden kann. |
| TD-Tiefe | **Bodenfallen**, **Upgradebäume und Synergien**, **Mazing/Wegführung**. |
| Freischaltung | Bleibt nach Map 10, dazu kommt ein **Bau-Tutorial**. |
| Coop-Action | **Klassen-Kits** für Dachs Nukem und Dachs of Steel. |

## 2. Ist-Stand in Kürze

**Inspector** ([`coopDefenseClasses.ts`](../../src/config/coopDefenseClasses.ts)):
- Er hat keine Kampfstatboni. Seine einzige Klassenfähigkeit ist `player.turretControlEnabled`, also Türme bemannen.
- Seine Stärke ist die Baukapazität: 100 statt 30 bei den anderen Klassen ([`coopDefenseConstructions.ts`](../../src/config/coopDefenseConstructions.ts)).
- Exklusiv hat er die Werkzeugslots 3–6, die Feuerleit-Utilities (Turmkopien, Portale), die Ultimates Holo-Offensive und Bombergeschwader sowie drei Support-Waffen (Plasmabrenner, Verstärkungsmatrix, Energieinjektor).

**Bauen:**
- Bauen kostet keine Ressource. Ein Bau dauert 100 ms und kann jederzeit verschoben oder abgebaut werden.
- Die Grenzen sind die Kapazität und die Werkzeugslots.
- Es gibt keine Bauzonen und keine Wegeprüfung beim Platzieren ([`PlacementSystem.ts`](../../src/systems/PlacementSystem.ts)).

**Bauwerke:**

| Bauwerk | Kapazität | Eigener Upgradebaum |
|---|---|---|
| Rakete | 30 | nein |
| MG | 10 | ja, 7 Knoten |
| Flamme | 20 | nein |
| Tesla | 25 | nein |
| Gravitation | 25 | nein |
| Zeitblase | 20 | nein |
| Spore | 15 | ja, 5 Knoten |
| Felsbarriere | 1 | ja, 3 Knoten |
| Drohnenstation | 30 | ja, 7 Knoten |
| Medic-Podest | 30 | nein |
| Rüstungs-Podest | 25 | nein |

Rakete, Flamme, Tesla, Gravitation und Zeitblase haben in [`coopDefenseUpgrades.json`](../../src/config/coopDefenseUpgrades.json) nur ihren Freischaltknoten.

**Persistente Basis** ([`persistentBase.ts`](../../src/config/persistentBase.ts)):
- Sie ist das einzige Bauwerk, das zwischen den Runden erhalten bleibt. Ein Sieg übernimmt die Änderungen der Mission, eine Niederlage verwirft sie.
- Bearbeitet wird sie in der Lobby ([`PersistentBaseEditorScene.ts`](../../src/scenes/PersistentBaseEditorScene.ts)) auf der **Lobby-World**, nicht auf der nächsten Map.
- Der Bauradius beträgt **5 Zellen** (Stufe 1, ab Map 10) bzw. **6 Zellen** (ab Map 11), in Dawn bis 10 Zellen. Bei 32 px pro Zelle sind das rund 160–190 px.

**Missionen:**
- Missionen dauern meist 2–4 Minuten. Zwischen den Wellen liegen meist 3–5 s.
- Spieleranzahl skaliert **nur die Gegner-HP**, um +80 % pro weiteren Spieler (bei allen 18 Gegnertypen mit Skalierung).
- Alle 11 Maps ab Map 10 haben eine persistente Basis. Damit ist der Inspector-Teil der Kampagne grundsätzlich TD-tauglich.

## 3. Befunde aus Sicht der TD-Spieler

### B1. Der Planungsraum ist zu klein für Fallen und Wegführung
Turmreichweiten liegen bei 500–600 px, der persistente Bauradius bei rund 160–190 px. Was in der Mission
außerhalb der Basis entsteht, verfällt nach der Runde. Die Planung „in Ruhe zwischen den Runden“ findet damit
nur auf einem kleinen Kreis um den Kern statt. Für Fallenkorridore und Wegführung fehlt die Fläche.

### B2. Im Editor plant man blind
Der Editor zeigt die Lobby-Welt, nicht die nächste Mission. Die Angriffsrichtungen unterscheiden sich aber stark
von Map zu Map. Die Tabelle zählt authored Encounter-Gegner nach Himmelsrichtung ihrer Spawnzone, gesehen von der
Basis (ohne Dauerdruck, ohne HP-Gewichtung):

| Map | Ausrichtung | Hauptrichtungen (Gegneranzahl) |
|---|---|---|
| 10 Flammenkoloss | open-left | W 47, O 38, N 20, S 14 |
| 11 Bombergeschwader | open-left | NW 99, NO 91, W 88, S 13 |
| 14 Brandschneise | open-left | W 32 |
| 15 Leerenjäger | open-left | W 17, O 17, N 6, S 6 |
| 16 Spinnensteig | open-right | NO 55, O 54, NW 35, N 31, W 10 |
| 17 Bierrettung | open-left | W 41, NO 16 |
| 18 Mörserstellung | open-left | **W 58**, O 39 |
| 19 Brandherd | open-left | **O 58**, W 39 |

Nur Map 16 dreht den Grundriss. Map 18 und Map 19 sind spiegelverkehrt. Eine Basis, die auf Map 18 stark ist,
steht deshalb auf Map 19 falsch herum.

### B3. Turmidentität und Synergien sind dünn
Fünf der sechs Inspector-Türme haben keinen eigenen Baum. Kombinationen wie Gravitation mit Flamme oder Zeitblase
mit Rakete funktionieren nur zufällig; keine davon ist bewusst gestaltet oder wird belohnt. Für Punkte gibt es
deshalb außer dem MG wenig, in das ein TD-Spieler „seinen Stil“ investieren kann.

### B4. Fallen, die Kernmechanik von Action-TD, fehlen
Es gibt nur blockierende Bauwerke und Türme. Bodenfallen, über die Gegner laufen, gibt es nicht, ebenso wenig
eine Kategorie „billig, viele, kombinierbar“. Die Felsbarriere ist das einzige günstige Element.

### B5. Wegführung wirkt, ist aber unsichtbar
Barrieren sind Navigationshindernisse. Gegner laufen um sie herum und brechen erst durch, wenn kein Weg mehr frei
ist (siehe [`gameplay.md`](../ai/gameplay.md) zu Durchbruchsaufträgen). Damit funktioniert Mazing technisch schon.
Es fehlt aber eine Vorschau der Wege, eine sichtbare Durchbruchsregel und ein Gegner, der eine Festung gezielt
angreift. Der Zielmodus `players-and-armed-constructs` existiert, wird aber von keinem Gegner genutzt.

### B6. Es gibt kein Lernfeedback
Bei bereits gebauten Türmen werden keine Reichweitenringe angezeigt. Schaden und Kills pro Turm stehen nicht im
Ergebnisbildschirm, und es gibt keine Möglichkeit, eine Wegführung vor dem Ernstfall zu testen. Ein TD-Spieler kann
deshalb nicht nachvollziehen, welche Aufstellung funktioniert hat.

### B7. Der Rollenübergang ist abrupt
Der Inspector wird nach dem Bossmap 10 frei. Danach erklärt kein Tutorial Bauen, Kapazität, Slots, Bemannen
oder Feuerleitung.

### B8. Coop-Action: Die Klassen sind nur Multiplikatoren
Nukem (×1,5 Schaden, Krit, Tempo) und Steel (×2 HP und Rüstung, Regeneration) haben kein eigenes Kit. Im Code
gibt es außer Profilen und Farben keine klassenspezifische Logik für sie. Dadurch fehlen Zusammenspiel-Momente
mit dem Inspector.

## 4. Vorschläge für TD-Spieler (priorisiert)

### V1 Lagekarte im Basis-Editor (Priorität hoch, Grundlage für alle weiteren Vorschläge)
Die Idee des Projektinhabers, ausformuliert:
- **Gelände:** Der Editor zeigt um den Bauradius das **Gelände der als Nächstes gewählten Map**: Felsen, Bäume,
  Wasser, Gleise, Brücken. Grundlage ist dieselbe World-Definition, die die Mission lädt. Die Darstellung ist
  zunächst statisch und ohne Simulation.
- **Bedrohungsrose:** Pfeile am Rand des Bauradius zeigen, aus welchen Richtungen Gegner kommen. Die Stärke jedes
  Pfeils wird aus den authored Encounter-Gruppen und Dauerquellen berechnet (Anzahl × HP oder ein Bedrohungswert).
  Dazu kommen Symbole besonderer Gegner (Mörser, Kabummtula, Flieger, Boss).
- **Laufwege, Ausbaustufe:** Die Navigation berechnet einmal für die aktuelle Aufstellung, wo die Wege der
  Spawnzonen in den Bauradius eintreten. Die Linien aktualisieren sich, wenn eine Barriere verschoben wird.
  Das ist die Grundlage für V4.
- **Ausrichtung pro Map:** Der Grundriss lässt sich **pro Map drehen oder spiegeln**. Das bestehende
  `orientation`-Konzept rotiert Bauwerke bereits mit. So muss nicht jede Map neu gebaut werden; Map 18 und 19
  zeigen, dass das sofort hilft.
- **Optionale Grundrissvarianten:** 2–3 gespeicherte Basis-Varianten pro Spieler, z. B. „zwei Fronten“ und
  „Belagerung West“, die man vor dem Start auswählt.

Abgrenzung: Die Vorschau ist reine Lobby-Darstellung aus authored Daten. Der Host materialisiert die Basis wie
bisher. Wire- und Ready-Snapshots tragen höchstens eine Ausrichtungs- oder Varianten-ID, keine rekonstruierten
Layouts.

### V2 Bodenfallen als neue Bauwerkskategorie (Priorität hoch)
Fallen blockieren nicht, sind günstig (Kapazität 3–8), haben eine Ladezeit oder einen Cooldown und lassen sich
miteinander kombinieren. Freischaltung und Stärke laufen über Punkte, die Anzahl über die Kapazität. Damit passen
sie zum beschlossenen Investitionsmodell.

| Falle | Wirkung | Wiederverwendbare Basis |
|---|---|---|
| Stachelfeld | Schaden bei Betreten und leichtes Verlangsamen | Bodenschaden wie bei Brandflächen |
| Teergrube | starkes Verlangsamen; brennt, wenn Feuer sie berührt | `EnemyMovementStatusSystem`, Feuer- oder Molotov-Flächen |
| Sprungplatte | stößt Gegner in eine eingestellte Richtung, z. B. in Wasser, Void-Zonen oder zurück | Laubbläser-Impuls |
| Zündmine | Explosion mit Zeitverzögerung, wird wieder scharf | `DetonationSystem` |
| Elektrozaun | Linie zwischen zwei Pfosten, betäubt kurz | `CombatStunStatusSystem`, Tesla |
| Rückführportal | versetzt Gegner an den Anfang eines Korridors (Inspector-Signatur) | `WorldPortalTransport` als weitere Quelle |

**Fallenring:** Ein Upgrade nur für den Inspector erlaubt Fallen, aber keine Türme, in einem Ring um den
Bauradius (etwa +3 bis +4 Zellen). Das löst B1, ohne die Basis auf Türme in voller Reichweite aufzublähen.
Der Ring ist eine eigene Ausbaustufe und passt zu „Punkte bestimmen, was gebaut wird“.

### V3 Upgradebäume und gestaltete Synergien (Priorität mittel bis hoch)
- **Bäume:** Rakete, Flamme, Tesla, Gravitation und Zeitblase bekommen je einen Baum mit 4–6 Knoten nach dem
  MG-Vorbild (MG Turm v3). Jeder Baum hat **zwei gegensätzliche Zweige**, z. B. Rakete „Flächenbeschuss“ gegen
  „Panzerknacker“. Der Spieler entscheidet sich, statt alles zu maximieren.
- **Synergien:** Die Kontrollwirkungen der Türme werden zu Signalen für andere Türme. Jede Synergie ist ein
  Upgradeknoten und sichtbar markiert.

| Kombination | Effekt |
|---|---|
| Gravitation + Flamme | Gegner im Sog nehmen mehr Brandschaden |
| Zeitblase + Tesla | verlangsamte Ziele leiten Ketten weiter |
| MG-Zermürbung + Rakete | Raketen bevorzugen zermürbte Ziele |
| Teergrube + Flamme | „Brandteppich“ |
| Sprungplatte + Gravitation | Gegner werden in den Sog geschleudert |

- **Kapazität als Schalter:** Ein Knoten kann wahlweise die Kapazitätskosten eines Turms senken, etwa „Kompaktbau“.
  So beeinflussen Punkte auch indirekt, wie viel gebaut werden kann, und es entsteht eine eigene Bauweise.

### V4 Wegführung als bewusste Mechanik (Priorität mittel)
- **Vorschau:** Die Laufwege aus V1 werden im Editor und, falls nötig, in der Mission beim Verschieben
  eingeblendet.
- **Tor:** Eine neue Barriere, die Gegner als Weg behandeln, durch die aber nur einer gleichzeitig passt.
  Damit lassen sich Kill-Zonen bauen, ohne die Basis völlig abzuriegeln.
- **Sichtbare Durchbruchsregel:** Bei völliger Abriegelung zeigt der Editor eine Warnung: „Gegner brechen hier
  durch.“ Der Durchbruch bleibt Teil des Systems, wird aber lesbar.
- **Gegendruck gegen TD-Spieler:**
  - Der Zielmodus `players-and-armed-constructs` wird für einen neuen Saboteur genutzt, der gezielt Türme angreift.
  - Ein Flieger ignoriert Barrieren, und Gravitation sowie Zeitblase kontern ihn.
  - Kabummtula-Netze funktionieren bereits so; sie bekommen im Editor ein Symbol in der Bedrohungsrose.

### V5 Lernfeedback (Priorität mittel, geringer Aufwand)
- Reichweitenringe für gebaute Türme: mit gehaltener Taste in der Mission, dauerhaft im Editor.
- Ergebnisbildschirm: Schaden, Kills und Kontrollzeit pro Bauwerk, dazu eine Übersicht „Bester Turm“ und
  „Durchbrochen bei …“.
- **Manöver in der Lobby (Ausbaustufe):** Eine Probewelle gegen die eigene Basis auf der Lobby-World. Sie läuft
  ohne Belohnung und ohne Commit, ähnlich dem Schießstand.

### V6 Bau-Tutorial nach Map 10 (Priorität mittel)
- Nach dem Sieg auf Map 10 erklärt ein kurzer Lobby-Rundgang Kapazität, Slots, Editor und Lagekarte.
- Map 11 bekommt beim ersten Durchlauf als Inspector Tutorial-Schritte nach dem Vorbild von
  [`coopDefenseTutorial.ts`](../../src/config/coopDefenseTutorial.ts): bauen, bemannen, Turmkopien, Energieinjektor.
- Die TD-Inhalte in den Maps 12–20 lassen sich staffeln: neue Fallen und Synergien als Belohnung für
  Nebenziele, so wie der Raketenturm auf Map 8.

## 5. Vorschläge für Coop-Action: Klassen-Kits

Jede Klasse bekommt **eine aktive Klassenfähigkeit** mit Cooldown, unabhängig von Adrenalin und Wut. Sie passt
zur Klassenfantasie und **wirkt mit den Inspector-Killzonen zusammen**. Damit entsteht Rollenspiel im Team, ohne
dass eine Klasse den Inspector braucht.

**Dachs of Steel – Bollwerk:**
- Ein Spott: Gegner in einem Radius wechseln für einige Sekunden ihr Ziel auf Steel und erleiden weniger
  Rückstoß; Steel selbst nimmt reduzierten Schaden.
- Taktischer Zweck: Steel hält eine Engstelle oder zieht eine Gruppe in eine Fallenreihe.
- Upgradezweige: „Standhaft“ (länger halten) gegen „Vorstoß“ (Ansturm mit Stoß in eine Richtung, z. B. auf eine
  Sprungplatte).
- Technischer Hinweis: Der Zielwechsel läuft über die gemeinsame Zielbindung im
  [`EnemyIntentSystem`](../../src/systems/navigation/EnemyIntentSystem.ts), nicht über Sonderfälle in einzelnen
  Gegnern. Der Köder (`CoopDefenseDecoyTargetSystem`) ist dafür das Vorbild.

**Dachs Nukem – Zündkette:**
- Markiert Gegner kurzzeitig. Markierte Gegner explodieren beim Tod und lösen Fallen, Fässer und Feuerkugeln aus.
- Taktischer Zweck: Nukem räumt eine Fallenkreuzung oder eine Sog-Gruppe mit einem Burst ab.
- Upgradezweige: „Kettenreaktion“ (springt über) gegen „Hinrichtung“ (Bonus gegen Ziele unter X % HP oder unter
  Kontrolle).

**Inspector – Feuerleitpunkt:**
- Optional als Gegenstück: ein Zielmarker, auf den alle Türme in Reichweite feuern. Er überschneidet sich mit dem
  Fokusziel des Energieinjektors und sollte erst nach den Playtests der Feuerleit-Utilities entschieden werden.

Begleitende Kleinigkeit ohne großen Aufwand: Die Klassenfähigkeiten bekommen im Ergebnisbildschirm je eine Zeile,
etwa „Gegner gehalten“ oder „Kettenkills“, damit die Rollenleistung sichtbar wird.

## 6. Randnotiz: PvP

PvP stand in dieser Runde nicht im Fokus. Folgende Punkte wurden geprüft und für eine spätere Runde notiert:
- Es gibt keinen Spawnschutz bei 2 s Respawn.
- Runden enden nur über den Timer: 120 s in DM und TDM, ohne Punktlimit, Overtime oder Tiebreak.
- PvP läuft nur auf prozedural erzeugten, asymmetrischen Arenen und hat keinen Map-Pool.
- Der Host hat einen Vorteil, weil Projektile keine Lag-Kompensation haben.
- Die Balance ist auf Coop ausgelegt; Telefrag, Tarnung und Taser sind im PvP nicht getestet.
- Es gibt keine PvP-Progression.

Spawnschutz und ein Punktlimit mit Overtime wären die günstigsten Verbesserungen.

## 7. Empfohlene Reihenfolge

1. **V1 Lagekarte** mit Bedrohungsrose und Ausrichtung pro Map. Danach **V5** mit Reichweitenringen und
   Turmstatistik. Beides bringt viel und ändert keine Balance.
2. **V2 Bodenfallen** (3–4 Fallen) zusammen mit dem **Fallenring**, in einem GDD.
3. **V3 Bäume und Synergien**, beginnend mit Gravitation und Zeitblase, weil sie heute am wenigsten eigene
   Identität haben.
4. **V4 Wegführung** mit Tor, Laufwegvorschau und Saboteur.
5. **Klassen-Kits** Steel und Nukem in einem gemeinsamen GDD.
6. **V6 Bau-Tutorial**, sobald V1 und V2 stehen, damit das Tutorial sie gleich erklärt.

## 8. Offene Fragen

- Wird die Lagekarte nur für die vom Host gewählte nächste Map angezeigt, oder kann man im Editor beliebige
  freigeschaltete Maps ansehen?
- Wie verteilen sich Bauradius, Fallenring und Kapazität zwischen den Klassen, wenn mehrere Spieler gemeinsam an
  der persistenten Basis bauen?
- Sollen die Kontrolltürme (Gravitation, Zeitblase) mit Bodenfallen konkurrieren oder sie ergänzen? Davon hängt
  ab, wie stark die Synergien ausfallen.
- Dürfen in der Mission platzierte Fallen außerhalb der Basis bestehen bleiben, oder bleibt alles Persistente auf
  Basis und Fallenring beschränkt?
