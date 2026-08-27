# Architektur

Diese Seite beschreibt stabile Systemgrenzen. Einzelne Methoden, Werte und Featuredetails direkt im Code prüfen.

## Boot und Orchestrierung

src/main.ts lädt UI-Schriften, initialisiert die Lobby-Verbindung über NetworkBridge und erzeugt danach Phaser.Game. Es gibt genau eine Phaser-Scene: src/scenes/ArenaScene.ts. Die Lobby ist ein Overlay in dieser Scene, keine zweite Scene.

ArenaScene erzeugt Scene-Lifetime-Dienste, baut ArenaContext und delegiert den Betrieb an:

- ArenaLifecycleCoordinator für Phasenwechsel, Arena-Aufbau/-Abbau, Teilnahme und Rundenergebnis;
- HostUpdateCoordinator für autoritative Simulation und Publikation;
- ClientUpdateCoordinator für Snapshot-Verarbeitung, Interpolation und lokale Prediction;
- RpcCoordinator für fachliche RPC-Handler, während der Zugriff auf den Transport in NetworkBridge bleibt.

Die Scene darf orchestrieren, aber keine neue umfangreiche Regel- oder Effektlogik aufnehmen.

## Ownership und Abhängigkeitsrichtung

| Bereich | Eigentümer | Darf nicht übernehmen |
|---|---|---|
| Netzwerkgrenze | NetworkBridge, darunter src/network/peer/ | Gameplay direkt an PeerJS koppeln |
| Regeln und autoritativer State | src/systems/ und Host-Coordinators | Renderer oder Client als Entscheidungsinstanz |
| Entity-Lifecycle | src/entities/ und Manager | UI/Effects als versteckte Entity-Quelle |
| Arena/Layout | src/arena/, ArenaBuilder, Registries | feste Mapwerte in Renderer kopieren |
| Darstellung | src/effects/, src/ui/, Renderer | Schaden, Sieg, Spawn oder Persistenz entscheiden |
| Verträge/Content | src/types.ts, src/config.ts, JSON und Loader | parallele Markdown- oder UI-Konfiguration |

Die normale Richtung ist Scene/Coordinator → System/Manager/Renderer. Renderer lesen autoritative Zustände oder replizierte Ereignisse; Systems kennen keine visuellen Entscheidungen. Bestehende Resolver und Callbacks nutzen, statt dieselbe Regel für Host, Client und UI neu zu implementieren.

## Zustandsarme gemeinsame Kerne

Vier Module tragen Mechanik, die außerhalb eines Matches wiederverwendbar bleiben muss. Sie halten keinen Runden-, Ressourcen- oder Netzwerkzustand; ihre Anbindung läuft ausschließlich über die genannten Grenzen. Wer eine dieser Funktionen braucht, benutzt den Kern, statt eine zweite Variante zu bauen.

| Modul | Kern | Grenze |
|---|---|---|
| src/entities/OwnerVisualSource.ts | Position, Farbe und Sichtbarkeit eines Projektil-/Effektbesitzers | OwnerVisualSource; PlayerManager implementiert sie für das Gameplay |
| src/systems/CombatGeometry.ts | Segment/Rechteck, Segment/Kreis, nächstes Hindernis, Sichtlinie, Korridorfreiheit, Melee-Bogen, überstrichener Kreistreffer | ArenaObstacleIndex als einzige Hindernisquelle |
| src/loadout/WeaponFireExecutor.ts | WeaponConfig → Projektil-, Hitscan- oder Melee-Auftrag für die Fire-Typen projectile, hitscan, melee | WeaponFireSink; Ressourcen nur über resolvePaidAdrenalineCost |
| src/systems/EnvironmentDamageResolver.ts | Radius, Falloff, computeRadialDamage, rockDamageMult, tatsächlich betroffene Felsen | EnvironmentRockSink inklusive Zielstatus-Trichter |

Alle übrigen Fire-Typen (flamethrower, leaf_blower, tesla_dome, healing_aura, energy_shield, reinforcement_matrix, energy_injector) hängen an Ressourcen- oder Rundenzustand und laufen nicht über den Executor. Sie werden nicht vereinfacht nachgebaut.

PlayerEntity kennt zusätzlich einen Presentation-Modus (PlayerEntityOptions.presentation): Sprite, Rotation, Glow, Held Item und VFX bleiben identisch, Namensschild und Welt-Balken entstehen gar nicht erst.

## Lobby-Inszenierung (src/lobby/)

Die Lobby zeigt lokale Ambient-Gefechte. Verbindliche Grenzen:

- Rein lokal: keine RPCs, kein Raumzustand, keine Host-Autorität. Clients dürfen unterschiedliche Sequenzen sehen.
- Die Lobby-Phase benutzt dasselbe Arenamass wie Deathmatch (getArenaMetricsProfile). Weltgrenzen, Kameragrenzen, Audio-Panning und das Beschneiden von Effekten decken sich damit mit der Vorschaufläche.
- Fels-Rollen aus MenuArenaPreviewConfig: structural (Felsschriftzug, Rahmen) ist unzerstörbar und löst nie Inspector-Arbeit aus; ambient trägt normale Landschaftsfels-HP.
- Die Vorschau bleibt gebacken. Fels-Änderungen laufen über MenuArenaPreviewRenderer.setRockAlive und werden zu einem gebündelten Rebuild im POST_UPDATE zusammengefasst.
- Kollisionskörper für Felsen entstehen nur pro Sequenzzone (LobbyRockBodyPool); Sichtlinie und Hitscan laufen über den kartenweiten ArenaObstacleIndex.
- Der Inspector erscheint ausschliesslich nach echter Zerstörung, repariert nur Felsen mit HP > 0 und baut zerstörte einzeln sichtbar als neutrale Landschaftsfelsen neu auf.
- LobbyAmbientRuntime.setActive(false) räumt synchron und vollständig auf; ein Fehler schaltet die Inszenierung ab, ohne den Matchstart zu blockieren.

## Scene- und Round-Lifetime

src/scenes/arena/ArenaContext.ts ist der Vertrag:

- Scene-Lifetime-Objekte werden nach ArenaScene.create() erstellt und behalten ihre Identität bis zur Scene-Zerstörung.
- Round-Lifetime-Objekte und -Daten sind außerhalb einer aktiven Runde null bzw. leer. buildArena() darf defensiv zuerst tearDownArena() aufrufen, den Merge-Cache zurücksetzen und danach Layout, Registries und Round-Systeme verdrahten.
- tearDownArena() zerstört dynamische Phaser-Objekte, leert Manager/Renderer, entfernt Callback-Sinks und Resolver und setzt alle Round-Referenzen zurück. Ein Provider darf keine alte Round-Instanz dauerhaft capturen; er liest die aktuelle Referenz aus ArenaContext und toleriert null.
- Die statische Kulisse kommt aus ArenaBuilder.buildStatic(). Rundenspezifische Objekte werden separat erzeugt und über ArenaBuilder.destroyDynamic() beziehungsweise den zentralen Teardown entfernt.

Round-Systeme werden nur für den aktiven Modus bzw. die Host-Rolle erzeugt. Host-only-Systeme bleiben auf Clients null; Client-Code muss aus replizierten Zuständen arbeiten.

## World-Lifecycle

`WorldLifecycle` (src/world/WorldLifecycle.ts) besitzt die laufende World-Instanz und ist der einzige Ort, der ihren Zustand wechselt: `none → creating → active → destroying`. `ArenaContext.world` wird ausschließlich von seinem Sink geschrieben, der World-Kanal ausschließlich von ihm bedient.

Instanz und lokale Realisierung sind zwei Schritte: `beginCreate()` eröffnet und repliziert die Instanz (host-only), `attachRuntime()` hängt die lokale Runtime daran und prüft über `isSameWorldInstance()`, dass beide dieselbe World meinen. `detachRuntime()` löst nur die lokale Runtime — ein Teardown mitten im Aufbau derselben Instanz darf sie nicht beenden. `endInstance()` beendet beides und ist idempotent, damit Rundenabschluss, Diagnose-Abbruch und technischer Abbruch denselben Weg nehmen.

Die Activity hat ihren eigenen Lebenszyklus daneben (`ActivityLifecycle`, `none → creating → active → ending`) und gehört der World: `worldLifecycle.activity`. Eine Activity setzt zwingend eine aktive World voraus — umgekehrt nicht. Sie steht erst nach ihrer World und fällt vor ihr; das Ende der World beendet sie zwingend mit. World und Activity gehen atomar auf den Draht, damit nie eine Activity ohne ihre World sichtbar wird; ihre Zustände bleiben trotzdem getrennt. Ein Client erzeugt keine Activity, sondern übergibt die beobachtete an `attachRuntime()`.

Activity-Systeme entstehen dadurch, weil eine Activity läuft — nicht weil ein Modus-Flag gesetzt ist. `buildArena()` trifft die Entscheidung genau einmal (`activityDescriptor?.kind === 'coop-mission'`) statt sie sechzehnmal aus `descriptor.gameMode` abzuleiten. Eine World ohne Activity läuft mit `activity.phase === 'none'`, ohne dass irgendwo Missionssysteme „auf null" gesetzt werden müssten.

## World Loading und Round Loading

Beides sind getrennte Bedingungen. Die replizierte Ladebarriere (`wlr`, `resolveWorldLoadProgress`) beantwortet ausschließlich, ob die lokale World gebaut und darstellbar ist — bei jedem Peer, Host wie Client. Ob eine Runde starten darf, entscheidet zusätzlich `prepareRoundStart()` host-lokal: alle aktiven Teilnehmer stehen wirklich in der Welt und der Host-Tick hat seine Caches aufgebaut. `tryScheduleArenaStart()` prüft erst die World-Barriere, dann das Round-Gate.

Steckten beide in einem Flag, könnte eine World ohne Activity nie „fertig geladen" melden, und ein Client könnte nicht unterscheiden, ob der Host noch lädt oder auf die Runde wartet. Wer aktiv an der Runde teilnimmt, kommt aus `getActiveRoundParticipantIds()` — dieselbe Regel, die auch die Ergebnisberechtigung trägt.

## World-Kontext

`ArenaContext.world` trägt den `WorldRuntimeContext` der laufenden World-Instanz (src/world/WorldRuntimeContext.ts): Descriptor, authored `WorldDefinition` (null für die prozedurale Arena), `WorldMetrics`, Basen und die aufgelöste `persistentBaseSite` mit Anker und Radius. Er wird in buildArena() erzeugt und im Teardown wie jede andere Round-Referenz auf null gesetzt.

Verbindlich: Daten, die zu genau einer World gehören, werden über diese World gebunden. Der Kontext ist kein zweiter God-Context — Activity-Systeme (Gegner, Boss, Missionsziele, Encounter, Respawn-Budget) gehören nicht hinein, und ein Test hält die Feldmenge klein.

`WorldMetrics` ist die unveränderliche Metrik einer World. Sie wird über `resolveWorldMetrics(getArenaMetricsProfile(...))` abgeleitet und ist wertgleich mit den mutablen Kompatibilitäts-Globals in src/config.ts (`ARENA_WIDTH`, `ARENA_OFFSET_X`, `GRID_COLS`, …). Diese Globals bleiben Quelle noch nicht migrierter Presentation-/Runtime-Aufrufer, aber nicht mehr der World-Generierung. Zwei Worlds können so gleichzeitig existieren, was eine einzelne globale Metrik nicht kann.

Basen und die persistente Basisstelle löst der Kontext aus der eigenen Map auf (`resolveCoopDefenseBases`); die `BaseRegistry` besitzt keinen Lobby- oder Netzwerk-Fallback. `BaseManager`/`BaseEntity`, die Spawn-Geometrie des `PlayerManager`, der Persistent-Base-Restore und `PersistentBaseVisuals` erhalten Basen, Site und Metrik explizit aus diesem Kontext. Ein aktives World-System darf die in der Lobby gewählte Map nicht erneut aus NetworkBridge lesen.

`createWorldRuntimeContext()` erzwingt beides: die übergebene Map muss zur `definitionId` des Descriptors gehören, sonst wirft der Aufbau. Das ist nötig, weil `getCoopDefenseMapConfig()` bei unbekannter ID still die Default-Map liefert — ohne die Prüfung entstünde eine World, die eine fremde Map behauptet. Der aktive Persistent-Base-Radius kommt ausschließlich aus `descriptor.parameters`; ein lokaler Ersatzwert wäre pro Peer verschieden und würde aus einem Übertragungsfehler still zwei verschiedene Welten machen.

Migrierte world-scoped Aufloeser lesen keine mutable Arena-Variable mehr: `resolveCoopDefenseBases()` leitet die Metrik aus den authored Zellmassen der Map ab (`resolveCoopDefenseWorldMetrics`), `PlacementSystem`, `BaseManager`/`BaseEntity`, `PlayerManager`, `CombatSystem`, `ArenaLifecycleCoordinator`, `HostUpdateCoordinator`, `RockVisualHelper` und `PersistentBaseVisuals` bekommen ihre konkrete `WorldMetrics`; `ArenaGenerator.generate()` erhält sie als Teil von `ArenaGenerationInput`. Baumzahl und Base-Modus-Flags werden ebenfalls als unveränderliche Generatorparameter gebunden. Der gemeinsame `ArenaObstacleIndex` erhält seine Bounds explizit vom Besitzer: im Match aus `CombatSystem`/`WorldMetrics`, in der Lobby aus dem eigenen `RockWorldFrame`. tests/WorldMetricsScopeContracts.test.ts haelt die Liste der migrierten Module und prueft, dass keines `GRID_COLS`, `ARENA_OFFSET_*` und Verwandte importiert. Runtime-Pfade wählen den aktiven Modus aus dem kanonischen Arena-/Activity-Snapshot vor dem Lobby-Wert; die Lobby bleibt nur vor der World-Erzeugung die Authoring-Quelle.

Die Prüfung gilt auch für Config-*Funktionen*, die dieselben Variablen intern lesen (`isPointInsideArena`, `clipPointToArenaRay`, `isCaptureTheBeerBaseCell` …) — sonst hängt ein Modul mit eigener `WorldMetrics` weiter still an der aktiven Arena. `createWorldRuntimeContext()` leitet die Metrik genau einmal ab und reicht sie an `resolveCoopDefenseBases()` weiter; eine zweite Ableitung dort könnte bei unpassendem Profil still von `world.metrics` abweichen.

Vorher hingen Basisgeometrie und Generator am zuletzt global gesetzten Raster — die Lobby-Vorschau konnte dieselbe Map deshalb anders auflösen als die Runde. Rendering und Effekte lesen die Globals teilweise weiterhin; `resolveActiveArenaWorldMetrics()` ist die Uebergangshilfe fuer diese Aufrufer und ausdruecklich nichts fuer World-Simulation.

## Zeit und deterministische Quellen

Authoring und Round-Systeme verwenden die von den jeweiligen Directors weitergereichte Rundenuhr aus Frame-Deltas. Date.now() ist keine allgemeine Round-Uhr: absolute Zeitstempel sind nur dort erlaubt, wo sie ausdrücklich als replizierter Vertrag definiert sind. Neue zeitbasierte Fachlogik muss sich an den bestehenden Director-/System-Lifecycle anschließen und darf nicht nebenher eine zweite Uhr starten.

Die visuelle Arena-Tageszeit ist kein Director-Timer: `ArenaTimeOfDayController` rekonstruiert ihren aktuellen Wert aus dem replizierten `RoundState.roundStartTime`, optionalen einmaligen Ereignisankern und `NetworkBridge.getSynchronizedNow()`. Während des lokalen Arena-Aufbaus bleibt der Zeitanker bei null; beim autoritativen Start wird er auf den gemeinsamen `arenaStartTime` re-anchored. Dadurch brauchen kontinuierliche Lichtverläufe keinen laufenden Netzwerk-State und Late Joiner keine lokale Aufholintegration. Der Controller ist Round-Lifetime, Phaser-frei und die einzige Runtime-Quelle; Lighting, Shadows, EmissiveScale und WorldGrade erhalten denselben effektiv gesampelten Wert.

## Tests und Änderungen

Tests sollen Verträge, Invarianten, Parser, Referenzintegrität und Berechnungen schützen. Veränderliche Balancewerte und Registry-Anzahlen nicht als Snapshot duplizieren. Für Phaser-freie Modelle Phaser nur als Typ importieren; Phaser-Module greifen beim Laden auf das DOM zu und sind deshalb nicht automatisch für Vitest geeignet.

Kanonische Einstiegspfade: src/main.ts, src/scenes/ArenaScene.ts, src/scenes/arena/ArenaContext.ts, src/scenes/arena/ArenaLifecycleCoordinator.ts, src/scenes/arena/RendererBundle.ts, src/arena/ArenaBuilder.ts, src/network/NetworkBridge.ts, src/world/ (kanonische World-/Activity-Identität), src/config/authoring/ (getrennte World-/Activity-Verträge).
