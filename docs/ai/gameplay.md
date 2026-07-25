# Gameplay

Fragdachse ist ein actionlastiger 2D-Arena-Shooter für PvP und PvE. Schnelle Reaktionen, unmittelbares Trefferfeedback, Bewegung und eine große Auswahl unterschiedlicher Waffen stehen im Zentrum. Arena-Shooter wie Quake und Unreal Tournament sind spielerische Vorbilder; Fragdachse überträgt ihre Direktheit in eine 2D-Top-down-Perspektive und in den Desktop-Browser des Jahres 2026.

## Phasen

`GamePhase` in `src/types.ts` kennt bewusst nur `LOBBY` und `ARENA`.

- Lobby: Vorspiel-Overlay innerhalb der laufenden `ArenaScene`. Spieler wählen Modus, Map, Team und Loadout, sehen Raumqualität und Rundenergebnisse und bestätigen einen verbindlichen Loadout-Snapshot mit „Bereit“.
- Arena: aktive Runde mit Countdown, hostseitiger Simulation, HUD, Weltkamera und replizierten Entities/Effekten. Round-Systeme existieren nur in dieser Phase.

Der Host startet erst, wenn alle verbundenen Spieler bereit sind, ein gültiges committed Loadout vorliegt und der Qualitäts-Startschutz nicht blockiert. Beim Rundenende setzt der Host Ready-Zustände zurück, speichert Ergebnisse und wechselt zurück in die Lobby.

Jedes vorzeitige Rundenende läuft über `ArenaLifecycleCoordinator.hostCompleteRound(conclusion)`; der `RoundConclusion` (`victory` | `defeat` | `aborted`) landet im replizierten `RoundState` und steuert allein die Beschriftung im Lobby-Panel. Auslöser für die Coop-XP-Gutschrift ist nicht der Ausgang, sondern das gesetzte `RoundState.endedAt` – abgebrochene Runden schreiben deshalb dieselben XP gut wie gewonnene, während die Map-Freischaltung explizit an `victory` hängt. Für Nicht-Coop-Modi ist `RoundState` sonst `null`; ein Host-Abbruch ist der einzige Fall, in dem dort ein Status publiziert wird.

## Spielmodi

Die tatsächlichen Modus-IDs stehen in `src/types.ts`, die Modusregeln in `src/gameModes.ts`:

- `deathmatch`: Jeder gegen jeden; mindestens zwei Spieler.
- `team_deathmatch`: zwei gegnerische Teams; mindestens zwei Spieler.
- `capture_the_beer`: Teammodus mit Bier-Objekt, Basen und erweitertem/dynamischem Arena-Ausschnitt; mindestens zwei Spieler.
- `coop_defense` („Dachs vs. Zombies“): gemeinsames `Team Fragdachse` gegen Wellen, Spezialgegner und Basenbedrohungen; ab einem Spieler.

PvP- und PvE-Regeln teilen Kernsysteme wie Spieler, Combat, Projektile, Ressourcen und Loadouts. Coop-spezifische Gegner-, Wellen-, Upgrade- und Flow-Field-Systeme werden nur für entsprechende Runden erzeugt. Neue Moduslogik soll diese Trennung bewahren und nicht den allgemeinen Pfad mit dauerhaften Coop-Sonderfällen belasten.

## Spielgefühl und Lesbarkeit

- Netzwerk-, Input- und Feedbackpfade auf niedrige wahrgenommene Latenz optimieren; lokale Prediction darf die Host-Autorität nicht umgehen.
- Effekte sollen Treffer, Gefahrenzonen und Waffencharakter schnell lesbar machen, ohne relevante Spielflächen dauerhaft zu verdecken.
- Loadout-Daten und Konstanten in `src/loadout/` beziehungsweise `src/config.ts` erweitern, statt Waffenregeln als Scene-Sonderfälle zu verteilen.
- Coop-Defense-Upgrades wirken nur auf die pro Spieler aufgelöste Loadout-Config. Systeme, die platzierte Objekte global verwalten (z. B. `TurretSystem` über `UTILITY_CONFIGS`), sehen die unveränderte Basis-Config; besitzerabhängige Upgrade-Werte müssen deshalb beim Platzieren in den `SyncedPlaceableRock` eingefroren werden.
- Waffen, die nur von NPCs, Basen oder platzierbaren Objekten geführt werden, sind reguläre `WEAPON_CONFIGS`-Einträge mit leerem `allowedSlots`; das ist der einzige Filter, der sie aus der Spieler-Waffenwahl heraushält.
- Zerstörte Coop-Defense-Basen verlieren ihre Kollision sofort, während ihre Zellbilder lokal mit zufälligen 48–96-ms-Abständen als Kettenreaktion explodieren und je Zelle vier Feuerbrocken erzeugen. Die Brocken hinterlassen host-autoritativ teamfreundlichen Brandboden; nur der Host wendet außerdem einen einmaligen, schadensfreien Radialimpuls auf Spieler und Gegner an.
- Basen sind für jedes Flowfield nicht begehbar, auch für das der wiederbelebten Verbündeten. Der Destroy-Callback des `BaseManager` muss deshalb `setActiveBaseIds()` an *alle* Flowfields melden – neben den drei Gegner-Feldern auch an jedes Feld in `ArenaContext.allyFlowFieldServices`, sonst bleibt eine zerstörte Basis für die betroffene Gruppe dauerhaft blockiert.
- Brandquellen tragen neben Schaden und Herkunft ihre visuelle Feuerfamilie. Der Host leitet daraus den replizierten Entitaetsbrand ab; solange mindestens ein aktiver `void`-Brandstapel existiert, verwenden Spieler und Gegner lila Partikel, Glow und Licht, sonst die normale orange Variante.
- Der visuelle Schadensradius sollte, wo als Gameplay-Telegraph verwendet, den autoritativen Radius nachvollziehbar abbilden.
- Die Geometrie des Coop-Tutorial-Fensters gehört nach `src/config/coopDefenseTutorial.ts` und darf nicht aus gemessenem Text abgeleitet werden: Die Arena-Generierung baut denselben Bereich mit Felsen zu (`ArenaGenerator.applyTutorialRockFormation`) und kennt weder Phaser noch Textmetrik. Variantenabhängige Höhen (z. B. `tutorialShowControls` für die Steuerungstabelle der Einstiegs-Map) müssen deshalb über dieselbe Funktion in Panel *und* Felsregion einfließen, sonst passen Fenster und Felsformation nicht mehr zusammen.
- Coop-Defense-Maps sind eine lineare Kampagne: Reihenfolge und Freischaltung ergeben sich aus der Position in der Map-Registry (`src/config/coopDefenseMapUnlocks.ts`), nicht aus der numerischen Map-ID. Gespeichert wird nur die höchste freigeschaltete Map – lokal pro Browser wie der übrige Coop-Fortschritt, nie über das Netz. Die Lobby-Auswahl gehört weiterhin dem Host; Clients folgen dem replizierten Wert, ihr eigener Freischaltstand begrenzt ihn nicht.
