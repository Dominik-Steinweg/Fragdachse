# Coop-Defense-Authoring

Coop-Maps sind authored Daten. Die JSON-Dateien unter src/config/coopDefenseMaps/ werden über src/config/coopDefenseMaps/index.ts registriert, in src/config/coopDefenseMaps.ts normalisiert und validiert und anschließend von Host und Client aus der replizierten Map-ID identisch aufgelöst.

## Map-Vertrag

CoopDefenseMapConfig bündelt Layout und Round-Inhalt:

- Arena-Größe, Zeit-of-day, Tutorial/Layout und optionales Rock-Field;
- ein authored `rockField` ersetzt die prozedurale CA-Verteilung vollständig: Die Arena wird zugebaut, nur die Korridore werden freigefräst, und es wachsen keine Bäume. Ohne `rockField` steuert `rockFillRatio` die Ausgangsdichte vor dem Smoothing, das die effektive Felsfläche deutlich darunter drückt;
- sichtbare vertikale Gleise werden über `trackPosition` authored: `left`, `center`, `right` oder `{ kind: "grid", gridX }`; `gridX` bezeichnet die linke Spalte des zweispaltigen Gleis-Fußabdrucks. Der Standard ist `center`, und jede Position muss den bestehenden Basisabstand einhalten;
- bases, powerUps, persistentSpawns und endliche encounters;
- optionale secondaryObjectives, boss und mapEvents;
- genau ein Objective: repel-assault, survive, defeat-boss oder destroy-hostile-bases.
- Der Boss-Slot authoriert nur Boss-ID und Spawnzeit; Bosswerte bleiben zentral in `coopDefenseEnemies.json`.
- Die Kampagnenregistry enthält Sandbox 00 sowie genau die Kampagnenmaps 01 bis 17; Map 9 ist basisloses Survival, Map 14 Survival mit Stellung, Map 16 repel-assault und Map 17 destroy-hostile-bases mit optionalem Carry.
- Klassenfreischaltungen sind pro Klasse über `unlockAfterMapId` authoriert; der Fortschritt speichert die freigeschalteten Klassen-IDs und leitet keine alten globalen Map-5-Freischaltungen mehr ab.

Die Map-ID ist der gemeinsame Schlüssel. Alles, was beide Peers deterministisch aus der Map auflösen können, braucht keinen eigenen Netzwerk-Key. Dynamische Änderungen wie HP, aktive Lebenszyklen oder Carry-Positionen werden dagegen über die bestehenden Round-/Game-State-Verträge repliziert.

## Encounters und Druckquellen

CoopDefenseMapDirector steuert endliche Encounters. Eine Encounter-Gruppe beschreibt Gegnertyp, Anzahl, relative Verzögerung, Einzelspawn-Stagger und optional eine Front (west, north, east, south). Starts sind eine kleine discriminated union: time, after-previous, after-encounter, after-event, boss-phase und base-destroyed.

Im scheduled-Modus können authored Encounters unabhängig geplant werden. repel-assault nutzt die Reihenfolge als Clear-/Rest-Kette. Clear wird aus dem konkreten Spawnaufruf und dessen Enemy-IDs abgeleitet; Präsentationsdaten dürfen diesen Zustand nicht entscheiden.

CoopDefensePersistentPressureSystem taktet dauerhafte Quellen. Eine mapgebundene Quelle kann eine Front verwenden, eine basisgebundene Quelle bleibt an baseId/spawnCenter gebunden. CoopDefenseSpawnExecutor ist die gemeinsame Spawn-Grenze; neue Spawnarten dort anschließen, nicht parallel in Director, Scene und Renderer implementieren. Das Spawn-Flowfield folgt dem `movementTarget` des Gegners: Spielerziele verwenden das Spieler-Flowfield und dürfen auf basislosen Maps auch vor dem ersten dynamischen Ziel-Refresh aus einer begehbaren Randzelle starten.

## Events und Objectives

CoopDefenseMapEventDirector besitzt den Lifecycle der authored Events train, airstrike und ground-hazard: Trigger, Warnverzögerung, Wiederholung und Presentation-Snapshot. Fachhandler delegieren Bewegung, Schaden und Visuals an die bestehenden Systeme (CoopDefenseTrainEventHandler, CoopDefenseAirstrikeEventHandler, CoopDefenseGroundHazardEventHandler). Ein Event-Handler darf keine eigene Completion- oder Wanduhrlogik neben dem Director führen. Zugmechanik und Zug-UI sind getrennt; Coop-Defense-Züge bleiben aktiv, erzeugen aber keine HUD-Ankündigungen.

Secondary Objectives sind destroy, hold oder carry. Destroy/Hold referenzieren Basen; Carry verwendet authored Spawn-/Delivery-Zonen. Jede so referenzierte Basis muss `dormant` sein, und dormante Missionsbasen werden mit genau einem Objective verknüpft und erst durch dessen Lifecycle aktiv. focusUntil steuert HUD-Fokus, nicht automatisch den Abschluss; Hold verwendet holdUntil als Lebens- und Fokusfenster. Objective-Rewards werden über die vorhandenen Objective-/Reward-Systeme verbucht, nicht aus dem HUD.

## Zeitbasis

Directors akkumulieren delta in elapsedMs. Authored atMs, Verzögerungen und Wiederholungen beziehen sich auf diese Rundenuhr. Kein Map-Event darf Fälligkeit gegen Date.now() prüfen: Das würde bei Fokusverlust und Frame-Klemmung von der Phaser-Uhr abweichen und kann Completion-Ketten entkoppeln. Ein absoluter Zeitstempel ist nur dann zulässig, wenn er ausdrücklich als replizierter Vertrag für HUD und Runtime definiert ist.

## Erweiterungsmuster

1. Zuerst den Vertrag als Type/JSON-Schema in coopDefenseMaps.ts festlegen und die Normalisierung/Referenzprüfung ergänzen.
2. Abhängigkeiten (encounter, event, base) validieren; unbekannte IDs und Zyklen müssen den Map-Aufbau ablehnen.
3. Einen zuständigen Round-Lifetime-Director oder Fachhandler erweitern. ArenaLifecycleCoordinator verdrahtet nur, CoopDefenseRoundStateSystem bleibt die einzige Abschlussinstanz.
4. Presentation getrennt vom autoritativen Zustand replizieren und fehlende Daten defensiv behandeln.
5. Tests für Normalisierung, Referenzintegrität, Lifecycle und Host-/Client-Parität hinzufügen; keine Balance-Snapshots als Vertrag verwenden.
