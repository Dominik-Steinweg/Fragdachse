# GDD – Decoy-Utility-Überarbeitung

Stand: 8. September 2026. Diese Fassung übernimmt die Entscheidungen des freigegebenen Implementierungsplans und ersetzt abweichende Vorgaben der ursprünglichen v2.

## Ziel und Umfang

Das Decoy ist ein defensives Täuschungswerkzeug für Flucht, Repositionierung und Entlastung. Erfolgreiche Ablenkung ermöglicht eine hohe Verfügbarkeit. Koop ist das primäre Designziel; gemeinsame Basismechaniken gelten auch im PvP. Sprengattrappe und zwei kombinierbare Feueräste ergänzen die Offensive.

Umfang: Gameplay, entkoppelte Runtime und KI-Ziele, Upgradebaum, deutsche und englische Texte sowie automatisierte Prüfung. Bestehende Decoy-, Tarnungs-, Explosions- und Feuerdarstellung und vorhandene Icon-Aliase bleiben die visuelle Grundlage. Keine zusätzlichen Lock-Markierungen, Verbindungslinien oder Erstattungsanzeigen. Keine neuen Grafikassets, Altstand-Migration oder automatischen Profilresets.

## Baseline, Tarnung und Aktionen

- Cooldown **12 Sekunden ab erfolgreicher Aktivierung**; Attrappen-Lebensdauer **6 Sekunden**; Tarnung **6 Sekunden**.
- Aktuelle HP, maximale HP und aktuelle Rüstung werden beim Erzeugen exakt kopiert. Spätere Heilung des Besitzers verändert die Attrappe nicht. Es gibt keine Mindest-HP-Garantie.
- Die Attrappe läuft mit der beim Einsatz aufgelösten normalen Laufgeschwindigkeit geradeaus in die gewählte Zielrichtung. Kollisionen mit Felsen, Baumstämmen und Basisgebäuden sowie Weltgrenzen bleiben maßgeblich. R1 beschleunigt ausschließlich den getarnten Spieler beim Laufen.
- Höchstens eine aktive Attrappe je Besitzer. Nach ihrem Ende darf bei bereitem Cooldown erneut aktiviert werden, auch während verbliebener Tarnung. Das erneuert die Tarnung mit voller Dauer.
- Früher Attrappen-Tod beendet die Tarnung nicht.
- Tatsächlicher HP- oder Rüstungsverlust beendet die Tarnung, auch durch periodischen Schaden. Vollständig absorbierter Schaden ohne Verlust enttarnt nicht.
- Tatsächlich ausgeführte Angriffe, andere Utilities, Ultimates und Platzierungen enttarnen. Zielen, Vorschau, Waffenwechsel und abgelehnte Versuche enttarnen nicht. Bewegung und Dash erhalten die Tarnung.
- Aufgeladene Waffen enttarnen bei tatsächlicher Auslösung; Dauerwaffen beim nächsten ausgeführten Schuss. Bereits entstandene Decoy-Explosionen und Feuerflächen enttarnen den Besitzer nicht nachträglich.
- Keine manuelle Detonation und keine zusätzliche Wiederverwendungspause.

## Upgradebaum

| Knoten | Stufen | Wirkung | Voraussetzung |
|---|---:|---|---|
| L1 – Massenablenkung | 3 | Endradius 100/200/300 px; 1 s Cooldown-Erstattung je gültigem Gegner | Decoy |
| L2 – Unwiderstehlicher Lockvogel | 3 | Fortlaufende Akquise weiterer Gegner in 100/200/300 px | L1 I |
| R1 – Schattenläufer | 3 | Während Tarnung +10/20/30 % Laufgeschwindigkeit | Decoy |
| R2 – Regeneration im Schatten | 3 | Während Tarnung +10/20/30 % passive Adrenalinregeneration und +5/10/15 HP/s | R1 I |
| Sprengattrappe | 1 Boss-Stufe | Tod/Ablauf: 150 px Radius, linear 100 Schaden im Zentrum bis 25 am Rand, Rückstoß 500 | L2 I **und** R2 I |
| BL1 – Brandbrocken | 3 | 3/6/9 generische Brandbrocken beim Explodieren | Sprengattrappe |
| BR2 – Brennende Fährte | 3 | Bodenfeuer entlang tatsächlicher Bewegung, Feuerdauer 2/4/6 s | Sprengattrappe |

Ein normaler Punkt je regulärer Stufe beziehungsweise Freischaltung. Die Sprengattrappe kostet einen Boss-Punkt und keinen normalen Punkt. Beide Feueräste sind gleichzeitig bis III ausbaubar. Die bisherigen Dauer-Upgrades entfallen.

## Ablenkung und Gegnerverhalten

Bereits ohne L2 übernimmt die Attrappe Gegner, deren aktuelles Bewegungs- oder Angriffsziel ihr Besitzer ist. Diese Übernahme wird vor der Entfernung des Besitzers aus der normalen Zielauswahl ermittelt.

L2 gewinnt zusätzlich andere feindliche KI-Gegner, einschließlich Basis- und strategischer Angreifer. Neue Akquise braucht Sichtkontakt und einen passierbaren Weg. Ein gültiger Lock bleibt außerhalb des Radius und nach späterem Sichtverlust erhalten. Tod, Entfernung oder bestätigte Unerreichbarkeit lösen ihn auf. Ein ausstehendes Worker-Ergebnis ist kein Nachweis der Unerreichbarkeit.

Der erste gültige Lock wird nicht gestohlen. Bei gleichzeitiger Erstakquise gewinnt die nähere Attrappe, bei Gleichstand ihre stabile ID. Bewegung, Kampfpositionierung, normale Angriffe und zielgerichtete Spezialfähigkeiten verwenden denselben Lock.

Bosse sind ablenkbar. Bereits laufende Spezialphasen, normale Angriffe und Salven bleiben bestehen. Ein inzwischen unsichtbares Ziel wird dabei nicht über seine verborgene Position weiterverfolgt. Bereits abgeschossene Projektile behalten Flug- und Homing-Regeln. Zielunabhängige Boss-Flächenmechaniken behalten ihre Auswahlregeln.

Fernkämpfer behalten Wunschabstand und Kampfstil. Rauchverwirrung, Sichtregeln, Ausweichverhalten und geschützte Bewegungsphasen bleiben wirksam; danach wird die Decoy-Verfolgung fortgesetzt.

## Erstattung und Regeneration

L1 wertet beim Ende die letzte Attrappenposition aus. Jeder noch lebende, feindliche KI-Gegner im Radius zählt einmal, sofern er diese konkrete Attrappe tatsächlich als Bewegungs- oder Angriffsziel verwendet hat. Eine bloße Lock-Vormerkung zählt nicht.

Die Zählung erfolgt vor der eigenen Endexplosion. Die verbleibende Abklingzeit wird bis höchstens null reduziert. Es gibt keine Erstattungsobergrenze. Lückenlose Tarnungs- und Regenerationsketten sind ausdrücklich erlaubt.

R2 multipliziert die bereits aufgelöste passive Adrenalinregeneration. Bestehende Regenerationspausen gelten weiter. HP-Heilung ist zeitbasiert, endet mit der Tarnung und überschreitet die maximalen HP nicht.

## Explosion und Feuer

Explosion und Rückstoß treffen ausschließlich feindliche Ziele. Bestehende Schadensmodifikatoren und Rückstoßresistenzen werden berücksichtigt. Der normale radiale Schadenspfad verwendet den Mindestschaden 25 am Rand.

Beide Feueräste verwenden vorhandenes Bodenfeuer, normale Brandstacks und Nachbrennen. Separate Decoy-Ziel-DPS entfallen.

Generisches Brockenprofil: 96 px Auswurfradius, 320 ms Flugzeit, 2 s Bodenfeuer, 2 s Branddauer und 0,25 Schaden je normalem Brandtick. Alle Werte bleiben zentral konfigurierbar.

Die Fährte nutzt dasselbe Brandprofil und das vorhandene 16-px-Bodenraster. Ihre Breite bleibt über alle Stufen gleich. Tatsächliche Host-Bewegungssegmente werden nach der Physik im Raster abgetastet; Segmentfunktionen schließen Lücken auch bei großen Zeitschritten. Stillstand erzeugt keine weiteren Segmente. Stabile Quellschlüssel je Attrappe und Rasterzelle verhindern zusätzliche Quellen bei wiederholter Verarbeitung. Bestehendes Feuer läuft nach Attrappen-Ende normal aus.

## Technische Verträge

Die World verwaltet den von Phaser und Netzwerk unabhängigen `DecoyRuntime` über ihre bestehenden Bindings. Er besitzt Lebenswerte, Aktivierungsparameter, Tarnungszustände und Enderegeln. Nicht rendernde Physikkörper liefern Position und Kollision; `DecoyEntity` stellt den Zustand dar.

Die Endgründe `killed`, `expired` und `cleanup` sind getrennt. Nur Tod und Ablauf lösen Erstattung, Explosion und Brandbrocken aus. Endverarbeitung entfernt die Attrappe als gültiges Ziel und führt Folgeeffekte genau einmal aus. Spielerentfernung und World-Abbau erzeugen keine künstlichen Explosionen oder Erstattungen.

Ein Activity-eigenes `CoopDefenseDecoyTargetSystem` besitzt Locks und tatsächlich erfolgte Ablenkung. Es erfasst die Zielzuordnung aktiver gewöhnlicher Flowfields und bestehende Angriffsziele. Zielzuordnung und berechnetes Feld werden atomar aktiviert. Je Attrappe und benötigtem Clearance-Profil teilen sich alle Verfolger ein Feld im vorhandenen `FlowFieldCoordinator`. Die Felder werden beim Ende freigegeben; bestehende Worker-, Tick- und Geometrieverträge gelten weiter.

`PlayerUtilityActionRuntime` besitzt den Cooldown und veröffentlicht verkürzte Endzeitpunkte. Aktive Attrappe und Cooldown sind getrennte Bedingungen. Bestehende Decoy-Snapshots liefern auch bei Bootstrap und erneuter Synchronisierung den Aktivitätszustand an Client-Eingabe und HUD. KI-Locks benötigen keine Client-Simulation.

`DecoyUtilityConfig`, Validatoren, Stat-Resolver und Beschreibungsparameter führen die beschlossenen Werte. Deutsche und englische Texte verwenden diese Konfiguration. Die Runtime erhält schmale Combat-, Ressourcen-, Effekt- und Netzwerkports.

## Nachvollziehbare Änderungen gegenüber der ursprünglichen v2

- Cooldown beginnt bei erfolgreichem Einsatz; Tarnung und Attrappen-Lebensdauer sind unabhängig.
- Enttarnung richtet sich nach tatsächlichem Ressourcenverlust beziehungsweise erfolgreicher Ausführung, nicht nach Eingabe oder Vorschau.
- Ablenkung hat einen gemeinsamen, klebrigen Lock-Owner; Baseline-Übernahme und zusätzliche L2-Akquise sind getrennt.
- L1 verlangt tatsächliche Zielverwendung, zählt vor der Explosion und besitzt keine Erstattungsgrenze.
- R2 ist ein Multiplikator der aufgelösten passiven Regeneration; Tarnungsketten bleiben zulässig.
- Separate Feuer-DPS werden durch das vorhandene generische Brandprofil ersetzt. Beide Feueräste sind kombinierbar.
- Runtime, Physikkörper und Darstellung sind getrennt; Cleanup hat keine offensiven Folgeeffekte.

## Automatisierte Abnahme

Die bestehenden Suites werden für Aktivierung/Ende, Cooldown, Aktionen, Schaden, Ressourcen, KI-Locks und geteilte Navigation, Feuer, Content, Replikation und Lifecycle erweitert. Ein Belastungsfall deckt zwölf Besitzer mit mehreren Attrappen, großen Gegnergruppen, begrenzter Feldanzahl und vollständigem Abbau ab. Konkrete Tuning-Parität gehört ins Balance-Lab.

Abschluss: `npm run check` sowie betroffene Integrations-, Stress-, Asset- und Balance-Lab-Suiten. Keine neue Testinfrastruktur. Browserprüfung ist ausgeschlossen; Spielgefühl und visuelle Wirkung sind dadurch nicht manuell abgenommen.
