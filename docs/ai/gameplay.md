# Gameplay

Fragdachse ist ein actionlastiger 2D-Arena-Shooter für PvP und PvE. Schnelle Reaktionen, unmittelbares Trefferfeedback, Bewegung und eine große Auswahl unterschiedlicher Waffen stehen im Zentrum. Arena-Shooter wie Quake und Unreal Tournament sind spielerische Vorbilder; Fragdachse überträgt ihre Direktheit in eine 2D-Top-down-Perspektive und in den Desktop-Browser des Jahres 2026.

## Phasen

`GamePhase` in `src/types.ts` kennt bewusst nur `LOBBY` und `ARENA`.

- Lobby: Vorspiel-Overlay innerhalb der laufenden `ArenaScene`. Spieler wählen Modus, Map, Team und Loadout, sehen Raumqualität und Rundenergebnisse und bestätigen einen verbindlichen Loadout-Snapshot mit „Bereit“.
- Arena: aktive Runde mit Countdown, hostseitiger Simulation, HUD, Weltkamera und replizierten Entities/Effekten. Round-Systeme existieren nur in dieser Phase.

Der Host startet erst, wenn alle verbundenen Spieler bereit sind, ein gültiges committed Loadout vorliegt und der Qualitäts-Startschutz nicht blockiert. Beim Rundenende setzt der Host Ready-Zustände zurück, speichert Ergebnisse und wechselt zurück in die Lobby.

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
- Der visuelle Schadensradius sollte, wo als Gameplay-Telegraph verwendet, den autoritativen Radius nachvollziehbar abbilden.
