# Coop-Defense-Authoring

Coop-Maps sind authored Daten. Die JSON-Dateien unter src/config/coopDefenseMaps/ werden über src/config/coopDefenseMaps/index.ts registriert, in src/config/coopDefenseMaps.ts normalisiert und validiert und anschließend von Host und Client aus der replizierten Map-ID identisch aufgelöst.

## Map-Vertrag

CoopDefenseMapConfig bündelt Layout und Round-Inhalt:

- Arena-Größe, Time-of-Day samt optionaler Runtime-Steuerung, Tutorial/Layout und optionales Rock-Field;
- `rockWalls` authoriert Bänder aus ganz normalen zerstörbaren Felsen. Sie sind keine Missionsbarriere: Jede vorhandene Zerstörungs- und Bewegungsmechanik löst sie wie generierten Fels auf. `ArenaGenerator` stempelt sie erst **nach** Konnektivitäts-, Baum- und Routenprüfung ein – sonst läse `ensureConnected` ein bewusst gesetztes Band als abgeschnürte Tasche und fräste es wieder auf. Gleisspalten, Basisreservierungen, Barrierezellen und bereits gesetzte Bäume bleiben frei;
- `tutorialAnchor` verschiebt Tutorial-Fenster und die Felsformation darunter gemeinsam an eine authored Zelle (`gridX` = Mittelspalte, `gridY` = obere Zeile). Ohne Anker bleibt das Fenster in der Arenamitte – auf einer Routenkarte läge diese Mitte aber weit weg vom Startbereich;
- ein authored `rockField` ersetzt die prozedurale CA-Verteilung vollständig: Die Arena wird zugebaut, nur die Korridore werden freigefräst, und es wachsen keine Bäume. Ohne `rockField` steuert `rockFillRatio` die Ausgangsdichte vor dem Smoothing, das die effektive Felsfläche deutlich darunter drückt;
- sichtbare vertikale Gleise werden über `trackPosition` authored: `left`, `center`, `right` oder `{ kind: "grid", gridX }`; `gridX` bezeichnet die linke Spalte des zweispaltigen Gleis-Fußabdrucks. Der Standard ist `center`, und jede Position muss den bestehenden Basisabstand einhalten;
- bases, powerUps, persistentSpawns und endliche encounters;
- optionale secondaryObjectives, boss und mapEvents;
- genau ein Objective: repel-assault, survive, defeat-boss, destroy-hostile-bases oder advance.
- Der Boss-Slot authoriert nur Boss-ID und Spawnzeit; Bosswerte bleiben zentral in `coopDefenseEnemies.json`.
- Die Kampagnenregistry enthält Sandbox 00 sowie genau die Kampagnenmaps 01 bis 17; Map 1 ist die geführte Vorstoß-Tutorialroute, Map 9 basisloses Survival, Map 14 Survival mit Stellung, Map 16 repel-assault und Map 17 destroy-hostile-bases mit optionalem Carry.
- Klassenfreischaltungen sind pro Klasse über `unlockAfterMapId` authoriert; der Fortschritt speichert die freigeschalteten Klassen-IDs und leitet keine alten globalen Map-5-Freischaltungen mehr ab.

Die Map-ID ist der gemeinsame Schlüssel. Alles, was beide Peers deterministisch aus der Map auflösen können, braucht keinen eigenen Netzwerk-Key. Dynamische Änderungen wie HP, aktive Lebenszyklen oder Carry-Positionen werden dagegen über die bestehenden Round-/Game-State-Verträge repliziert.

## Encounters und Druckquellen

CoopDefenseMapDirector steuert endliche Encounters. Eine Encounter-Gruppe beschreibt Gegnertyp, Anzahl, relative Verzögerung, Einzelspawn-Stagger und optional eine Front (west, north, east, south). Starts sind eine kleine discriminated union: time, after-previous, after-encounter, after-event, after-checkpoint, after-defense, boss-phase und base-destroyed. `after-defense` bedeutet dabei terminal aufgelöst (`completed` oder `failed`), nicht zwingend erfolgreich. Die beiden Missionstrigger werden im `ArenaLifecycleCoordinator` über semantische Callbacks aufgelöst; MapDirector und SecondaryObjectiveSystem importieren das Missionssystem nicht. Diese Union ist keine allgemeine Trigger-Engine.

Im scheduled-Modus können authored Encounters unabhängig geplant werden. repel-assault nutzt die Reihenfolge als Clear-/Rest-Kette. Clear wird aus dem konkreten Spawnaufruf und dessen Enemy-IDs abgeleitet; Präsentationsdaten dürfen diesen Zustand nicht entscheiden.

Eine Encounter-Gruppe authoriert entweder eine Front oder – sich gegenseitig ausschliessend – einen rechteckigen `spawnArea`. Die Front ist ein Randband der ganzen Arena und liegt auf einer langen Routenkarte fast immer im falschen Abschnitt; der Bereich verschiebt nur, wo `CoopDefenseSpawnExecutor` sucht, nicht wie er auswählt (begehbar, erreichbar, nicht in einem anderen Gegner). `ArenaGenerator.hasAcceptableSpawnToBaseRoutes` prüft für solche Gruppen denselben Bereich statt des Randbands.

CoopDefensePersistentPressureSystem taktet dauerhafte Quellen. Eine mapgebundene Quelle kann eine Front verwenden, eine basisgebundene Quelle bleibt an baseId/spawnCenter gebunden. CoopDefenseSpawnExecutor ist die gemeinsame Spawn-Grenze; neue Spawnarten dort anschließen, nicht parallel in Director, Scene und Renderer implementieren. Das Spawn-Flowfield folgt dem `movementTarget` des Gegners: Spielerziele verwenden das Spieler-Flowfield und dürfen auf basislosen Maps auch vor dem ersten dynamischen Ziel-Refresh aus einer begehbaren Randzelle starten.

## Gegnerwaffen und Waffenwahl

Der optionale Salvenwert `targetDistribution: "round_robin"` prueft fuer Spieler-Salven pro Geschoss alle gueltigen Spielerziele neu, verteilt deterministisch und verwendet keine Mindestdistanz-Hysterese.

Gegnerwerte stehen in `coopDefenseEnemies.json`; die Waffe selbst bleibt eine normale `WeaponConfig`. Der Eintrag in `weapons` authoriert nur, wie der Gegner sie führt, und die Reihenfolge des Arrays ist die Waffenpriorität: Die erste Waffe mit gültigem Ziel gewinnt, und ist eine höher priorisierte Waffe im Cooldown, wartet der Gegner statt auf eine schwächere zu wechseln. Ausgenommen bleiben das Freibeißen von Felsen und der Angriff auf Basen – ein blockierter Gegner muss sich befreien bzw. weiter an seiner strategischen Basis arbeiten dürfen.

Verhaltensunterschiede zwischen Gegnern gehören als Waffen-Eigenschaft in die Registry, nicht als Fallunterscheidung nach Gegner-ID in ein System:

- `attackMovementSpeedFactor` ersetzt den pauschalen Halt der Angriffspause durch einen Geschwindigkeitsanteil. Fehlt der Wert, bleibt der Gegner wie bisher stehen; bei Werten über 0 läuft er gebremst weiter und behält dabei die Blickrichtung auf sein Ziel.
- `minTargetDistancePx` grenzt Fernwaffen nach unten ab. Zusammen mit der Waffenreichweite entstehen so Distanzbänder ohne eigene Entscheidungslogik; eine Lücke zwischen zwei Bändern lässt den Gegner weiter auf sein Ziel zulaufen, statt passiv zu stehen.
- `salvo` gibt einer Waffe `count` Schuss im Abstand `intervalMs` und danach `cooldownMs` Pause. Der Salventakt läuft bewusst neben `attackScanIntervalMs` – über den Zielscan getaktet würde er auf dessen Raster einrasten. Eine abgebrochene Salve startet ihre Pause sofort, damit ein wiederholt blockierter Gegner nicht beliebig viele Salven ohne Cooldown feuert.

Utilities eines Gegners (Wurfwaffen, Translocator, Brandsätze) gehören dagegen ins `CoopDefenseEnemyAbilitySystem`. Es läuft im Host-Frame vor dem Angriffssystem und meldet über `blocksRegularAttacks()` an den `ActionBlockedChecker`, dass eine laufende Utility die regulären Waffen sperrt – darüber und nicht über eine eigene Prioritätsliste gewinnt eine bereite Utility gegen die Waffe im selben Distanzband.

Geworfene Gegner-Projektile teilen sich die Flugphysik des Translocator-Pucks: gedämpft mit `v(t) = v0 * decay^t` ab `frictionDelayMs`. Der pauschale Reibungsaufschlag darauf trägt nur, solange der Ankunftszeitpunkt frei wählbar ist – der Translocator teleportiert einfach dann, wenn der Puck angekommen ist. Ein Projektil mit fester Zündzeit explodiert dagegen dort, wo es zu diesem Zeitpunkt gerade ist: Seine Wurfgeschwindigkeit wird aus der Dämpfung zurückgerechnet, damit es zur Zündung auf dem Ziel liegt, und die Zieldistanz zählt ab der Mündung, nicht ab der Gegnermitte.

## Events und Objectives

CoopDefenseMapEventDirector besitzt den Lifecycle der authored Events train, airstrike und ground-hazard: Trigger, Warnverzögerung, Wiederholung und Presentation-Snapshot. Fachhandler delegieren Bewegung, Schaden und Visuals an die bestehenden Systeme (CoopDefenseTrainEventHandler, CoopDefenseAirstrikeEventHandler, CoopDefenseGroundHazardEventHandler). Ein Event-Handler darf keine eigene Completion- oder Wanduhrlogik neben dem Director führen. Zugmechanik und Zug-UI sind getrennt; Coop-Defense-Züge bleiben aktiv, erzeugen aber keine HUD-Ankündigungen.

Secondary Objectives sind destroy, hold oder carry. Destroy/Hold referenzieren Basen; Carry verwendet authored Spawn-/Delivery-Zonen. Jede so referenzierte Basis muss `dormant` sein, und dormante Missionsbasen werden mit genau einem Objective verknüpft und erst durch dessen Lifecycle aktiv. `focusUntil` steuert HUD-Fokus, nicht automatisch den Abschluss. Hold authoriert genau eines von `holdUntil` (absolute Rundenzeit) und `holdDurationMs` (Dauer ab tatsächlicher Aktivierung in Host-Rundenzeit). Hold kann mit `requiredSurvivors` eine Mindestzahl überlebender Targets authoren; fehlt der Wert, müssen alle Targets überleben. Objective-Rewards werden über die vorhandenen Objective-/Reward-Systeme verbucht, nicht aus dem HUD.

## Vorstoß-Routen und Missionsbarrieren

Der optionale `missionProgress`-Block beschreibt ausschließlich geordneten Routenfortschritt. `checkpoints` besitzen eine ID, Grid-Position, `radiusCells` und optional `setRespawn`. Punkt- und Segmenttests laufen nur auf dem Host mit berechtigten Round-Participants; Spawn, Respawn und autoritative Teleports setzen die Positionshistorie zurück. Ein aktivierter Respawn-Checkpoint wird als bevorzugter Fokus in die vorhandene sichere Spawnbewertung gegeben, nie als erzwungene Spawnzelle. Solange keiner aktiviert ist, übernimmt der optionale `startArea` denselben Fokus – ohne ihn verteilt sich der Initialspawn einer langen Routenkarte über die ganze Arena. Solange keiner aktiviert ist, übernimmt der optionale  denselben Fokus – ohne ihn verteilt sich der Initialspawn einer langen Routenkarte über die ganze Arena.

`mandatoryDefenses` verbinden eine Defense-ID und einen Checkpoint mit einem bestehenden Hold-Secondary-Objective. Das Hold muss mit `after-checkpoint` am selben Checkpoint starten. Mandatory bedeutet nicht überspringbar: Ab Checkpoint-Aktivierung sperrt die Defense den nächsten Routenabschnitt, bis das Hold `completed` oder `failed` ist, und übernimmt dafür den HUD-Fokus auch dann, wenn ein optionales Objective bereits fokussiert ist. Das optionale Objective bleibt aktiv und als Hintergrund-Objective zählbar. Nur `completed` führt die vorhandenen Reward-Hooks aus. Optionale Verteidigungen bleiben normale Hold-Secondary-Objectives und werden nicht zusätzlich unter `missionProgress` authoriert.

Eine Defense kann zusätzlich `failureEndsMission` authoren. Damit meldet `isMissionFailed()` das gescheiterte Hold als Missionsniederlage, statt die Route nur ohne Reward freizugeben – gedacht für Stellungen, ohne die der Vorstoß gegenstandslos wäre. Ohne das Flag bleibt es bei der Grundregel, dass `failed` ein aufgelöster Zustand ist.

`barriers` reservieren stabile Grid-Zellen und öffnen einmalig über die kleine `openOn`-Union `after-checkpoint`, `after-defense` oder `after-encounter`. Reservierte Zellen bleiben frei von generierten Felsen, Bäumen, Podesten und Hazards. Geschlossene Barrieren blockieren Placement und Tunnel. Laufzeitseitig bleiben ihre Rect-Proxies stabil indexiert; beim Öffnen wechseln nur `active`, Arcade-Body, Flowfield-Belegung und Light-Occluder. Im ObstacleIndex haben sie einen eigenen Treffertyp, im Flowfield verwenden sie ohne neuen Cell-Code die bestehende nicht-destruktible Hard-Wall-Semantik. Gameplay-State und Geometrie besitzen keine Visuals; Checkpoints und Tore rendert ausschließlich der MissionProgressRenderer aus Konfiguration und repliziertem Zustand.

`CoopDefenseMissionProgressSystem.isRouteComplete()` wird wahr, sobald der finale Checkpoint aktiviert ist und keine dort oder davor ausgelöste Mandatory Defense ungelöst bleibt. Für `advance` ist genau dieser Zustand die host-autoritative Siegbedingung.

## Objective advance

`advance` (Vorstoß) besitzt keine eigene Routen-, Respawn- oder Encounter-Architektur: der authored `missionProgress` *ist* die Route, sein letzter Checkpoint die Extraktion. Die Normalisierung verlangt deshalb einen `missionProgress`-Block mit mindestens einem Checkpoint, fordert im Gegenzug aber keine Friendly Main Base und verbietet `surviveDurationSec`. Wo die Respawns landen, authoriert `setRespawn` am Checkpoint; wie viele es sind, authoriert `respawnsPerPlayer` wie bei `survive`.

`CoopDefenseRoundStateSystem` erhält für `advance` zwei eigene Callbacks: `isAdvanceComplete` liest `isRouteComplete()`, `isAdvanceFailed` liest `isMissionFailed()`. Da nur lebende, berechtigte Round-Participants Checkpoints auslösen, genügt ein einziger lebender Spieler an der Extraktion für den Teamsieg. Die Niederlage teilt sich `advance` mit `survive` über denselben `isTeamWipedOut`-Callback und dieselbe `CoopDefenseRespawnBudgetSystem.isTeamWiped()`-Quelle: verloren ist erst, wenn kein verbundener, aktiver Teilnehmer mehr lebt **und** keiner sein Budget noch einsetzen kann. Ein momentaner Team-Wipe mit freiem Budget ist damit kein Defeat; eine gefallene optionale Basis beendet die Mission nicht. Bei gleichzeitigem Signal hat die Niederlage Vorrang.

Ohne gültiges Basisziel – der Regelfall auf einer basislosen Vorstoß-Map – lesen basisorientierte Gegner das vorhandene Spieler-Flowfield statt des zielleeren Basisfelds. Das gilt für Bewegung und Spawnplatzierung gleichermaßen und ist bewusst als Feld-Auswahl umgesetzt, nicht als zweite Navigation. Eine dormante Missionsbasis ist kein Ziel: Bis ihr Objective sie aktiviert, greifen auch basisorientierte Gegner die Spieler an – das reicht, um denselben Gegnertyp früh als Spielerdruck und später als Basisangreifer zu verwenden, ohne eine eigene Tutorial-Enemy-Config.

## Lokale Tutorial-Schritte

`tutorialSteps` authoriert Step-ID, `checkpointId` und optional `durationMs`; der Text kommt über `map.tutorialStep.<id>` aus dem bestehenden Content-/i18n-Pfad, nicht aus der Map. Die Auswertung ist reine Präsentation und liegt vollständig in `ui/coopDefenseTutorialStepModel.ts`: Sie prüft nur die Position des **eigenen** Spielers gegen die vorhandene Checkpoint-Geometrie, erzeugt keinen Rundenzustand, wird nicht repliziert und bekommt keine eigenen Physics-Zonen oder GameObjects. Ein vorauslaufender Mitspieler löst nichts aus, Tod und Respawn setzen nichts zurück, eine neue Runde beginnt mit frischem Zustand. Der Hinweis erscheint im screen-space Panel `CenterHUD.updateTutorialHint()`; das World-Space-Tutorialfenster des Rundenstarts bleibt davon unberührt. Das ist ausdrücklich keine allgemeine Quest- oder Scripting-Engine.

## Zeitbasis

Directors akkumulieren delta in elapsedMs. Authored atMs, Verzögerungen und Wiederholungen beziehen sich auf diese Rundenuhr. Kein Map-Event darf Fälligkeit gegen Date.now() prüfen: Das würde bei Fokusverlust und Frame-Klemmung von der Phaser-Uhr abweichen und kann Completion-Ketten entkoppeln. Mission-Snapshots identifizieren sich durch `roundRevision` und eine nur bei semantischen Änderungen erhöhte `missionRevision`; Zeitfelder heißen ausdrücklich `activatedAtRoundMs`, `startedAtRoundMs`, `endsAtRoundMs` oder `resolvedAtRoundMs`. Der vollständige reliable Snapshot wird bei semantischen Änderungen publiziert und steht Late Joinern als aktueller Gesamtzustand zur Verfügung. `roundStartTime` und absolute `Date.now()`-Werte sind keine Mission-Snapshot-Identität.

Die rein visuelle Arena-Uhr ist eine solche ausdrücklich synchronisierte Ausnahme: `ArenaTimeOfDayController` berechnet sie ohne Delta-Akkumulation aus `RoundState.roundStartTime` und `NetworkBridge.getSynchronizedNow()`. `timeOfDay` bleibt der Startwert. `dynamicTimeOfDay` kann eine kontinuierliche Rate sowie vorwärts laufende weiche Transitionen ab Rundenzeit oder dem tatsächlich erfolgreichen Boss-Spawn authoren; Maps ohne diesen Block bleiben statisch. Der Spawn publiziert dafür einmalig einen reliable Anker im RoundState, keinen laufenden Zeit-State. Bossphasen sind bereits replizierte Zustände und dürfen als abschließende, sofortige Zielzustände folgen. Sie starten keinen pro Client zeitversetzten lokalen Tween.

## Erweiterungsmuster

1. Zuerst den Vertrag als Type/JSON-Schema in coopDefenseMaps.ts festlegen und die Normalisierung/Referenzprüfung ergänzen.
2. Abhängigkeiten (encounter, event, base) validieren; unbekannte IDs und Zyklen müssen den Map-Aufbau ablehnen.
3. Einen zuständigen Round-Lifetime-Director oder Fachhandler erweitern. ArenaLifecycleCoordinator verdrahtet nur, CoopDefenseRoundStateSystem bleibt die einzige Abschlussinstanz.
4. Presentation getrennt vom autoritativen Zustand replizieren und fehlende Daten defensiv behandeln.
5. Tests für Normalisierung, Referenzintegrität, Lifecycle und Host-/Client-Parität hinzufügen; keine Balance-Snapshots als Vertrag verwenden.
