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

## ArenaWorld-Core, MissionRuntime und PersistentBaseEditorRuntime

`buildArena()` ist der gemeinsame ArenaWorld-Core beider Laufzeiten. Er nimmt ausschließlich einen generischen `ArenaWorldDescriptor` (src/scenes/arena/ArenaWorldDescriptor.ts) entgegen, nie einen Netzwerk-Descriptor direkt:

- Die MissionRuntime speist ihn über `toMissionWorldDescriptor()` aus dem replizierten `ArenaDescriptor`.
- Die PersistentBaseEditorRuntime speist ihn über `toPersistentBaseEditorWorldDescriptor()` aus `PersistentBaseEditorWorld`, einem eigenen global-reliable Kanal. Der `ArenaDescriptor` trägt deshalb keinen Laufzeitmodus, und ein verlassener Editor kann keinen alten globalen Zustand in der Lobby-/Mission-Auflösung hinterlassen.

`ArenaRuntimeProfile` (src/scenes/arena/ArenaRuntimeProfile.ts) ist der einzige Vertrag, an dem Missionsanteile hängen: `enemies`, `objectives`, `roundConclusion`, `worldEvents`, `combatSimulation`, `roundLifecycle`, `missionPersistentBaseSession`. `buildArena()` schreibt das Profil nach `ArenaContext.runtimeProfile`; Host- und Client-Tick lesen es dort und leiten daraus ab, ob dieser Tick überhaupt an Countdown und Rundenstart gebunden ist. Neue laufzeitabhängige Unterschiede gehören als Profilflag hierher, nicht als zusätzliche Phasen-/Präsenzabfrage.

Weitere dauerhafte Regeln:

- Die Ladebarriere (`setLocalArenaLoadProgress`, `arenaBuilt`, Terrain-Snapshot, Countdown) gehört ausschließlich zur MissionRuntime und wird nur unter `profile.roundLifecycle` berührt. Der Ladeschleier hängt an der ARENA-Phase, nicht an der Sichtbarkeit der Welt: Während des Ladens existiert noch kein Countdown-Zeitpunkt.
- Kamera und Surface-Residency laufen, sobald eine Welt lokal aufgebaut ist – auch während die Missionswelt noch hinter dem Ladeschleier verborgen ist. Ohne das erreicht die Ladebarriere nie ihren Bereitzustand.
- Mission und Editor benutzen denselben Player-Runtime-Aktivierungspfad (`activatePlayerRuntime`/`deactivatePlayerRuntime`) und dieselbe Loadout-Auflösung. Der einzige Unterschied ist der Spawn-Fokus, den der `PlayerManager`-Spawn-Kontext liefert.
- Die Editor-Welt benutzt die Arena-Metrik ihrer Karte (`applyArenaMetricsForMode(..., 'ARENA', ...)`), nicht das Lobby-Vollbildmaß. `ArenaGenerator` liest `GRID_COLS`/`GRID_ROWS` global; mit Lobby-Metrik lägen authored Basiszellen außerhalb des Rasters.
- Der Host hält die Editor-Runtime, solange mindestens ein Teilnehmer existiert; ein Client baut sie nur, wenn er selbst teilnimmt. Solange lokal eine Welt steht, weichen Lobby-Vorschau und Ambiente ihr, weil beide auf denselben Bodentiefen liegen.
- Bau-Zugriff und Baukapazität laufen in beiden Laufzeiten über `resolveConstructionAccess`/`resolveConstructionCapacity`. Der Editor ersetzt nur die Snapshot-Quelle (`NetworkBridge.getPlayerRuntimeLoadout`: Editor-Build statt Ready-Commit) und überspringt die Prüfung nicht. Klassenunabhängig sind allein base-owned Rewards.

## Persistente Basis: kartenunabhängiger Grundriss

`persistentBase/PersistentBaseSite.ts` ist die einzige Quelle des Basiskerns: immer `PERSISTENT_BASE_CORE_SIZE_CELLS`×`PERSISTENT_BASE_CORE_SIZE_CELLS`, freundliche Hauptbasis unter der reservierten Id `PERSISTENT_BASE_CORE_ID`, ohne Türme und ohne Power-Up-Podeste. Eine Karte autort ausschließlich die *Platzierung* (`persistentBase.anchor`, beim Laden zu `anchorGridX/anchorGridY` normalisiert); sie nominiert keine ihrer eigenen Basen mehr. `resolveCoopDefenseBases()` ergänzt den Kern über denselben `resolveBaseSpec`-Pfad wie jede authored Basis – es gibt keinen zweiten Geometriecode.

Der Basis-Editor läuft auf `persistent-base-editor.internal.json`: eine eigene, ebene Welt mit dem Bereich exakt in der Mitte, registriert wie die Balance-Lab-Map neben der Kampagnenregistry. Das Basisbau-Menü der Lobby ist damit von der Kartenauswahl unabhängig.

Zwei Regeln, deren Verletzung sich als „Spieler unsichtbar / Basis an falscher Stelle“ zeigte:

- **Eine Welt, eine Metrik.** `ArenaGenerator`, der `PlayerManager`-Spawn und alle Rasterprüfungen lesen `GRID_COLS`/`GRID_ROWS` global. Die Metrik MUSS zu der Welt gehören, die gerade steht – auch in der LOBBY-Phase (Editor). Läuft sie gegen eine andere Karte, liegt der Spawn außerhalb des Rasters.
- **Eine Welt, eine Basenmenge.** `buildArena()` hinterlegt sie über `setActiveCoopDefenseBases()`; `tearDownArena()` löscht sie. Argumentlose `getCoopDefenseBases()`-Leser bekommen genau diese Menge, statt die ausgewählte Kampagnenkarte neu aufzulösen. Ebenso liest jeder Konsument des persistenten Bereichs (Kies, Bauzone, Zonenvorschau, Platzierungsprüfung) `ArenaLifecycleCoordinator.getPersistentBaseSite()` – ein zweites Auflösen aus Map-Konfiguration und Spielerzahl ist die Ursache dafür gewesen, dass Kiesfläche und Basiskern auseinanderliefen.

Bildschirmfeste UI-Wurzeln neben den Panel-Containern (`badgerPreview`, der Power-Up-/Baukapazitäts-Stapel, der Loadout-Picker) werden von `LeftSidePanel.setPanelSuppressed()` mit ausgeblendet; der Stapel zeigt sich bei jedem HUD-Update selbst wieder an und wird deshalb in `ArenaHUD.setSuppressed()` gesperrt statt nachträglich versteckt.

## Zeit und deterministische Quellen

Authoring und Round-Systeme verwenden die von den jeweiligen Directors weitergereichte Rundenuhr aus Frame-Deltas. Date.now() ist keine allgemeine Round-Uhr: absolute Zeitstempel sind nur dort erlaubt, wo sie ausdrücklich als replizierter Vertrag definiert sind. Neue zeitbasierte Fachlogik muss sich an den bestehenden Director-/System-Lifecycle anschließen und darf nicht nebenher eine zweite Uhr starten.

Die visuelle Arena-Tageszeit ist kein Director-Timer: `ArenaTimeOfDayController` rekonstruiert ihren aktuellen Wert aus dem replizierten `RoundState.roundStartTime`, optionalen einmaligen Ereignisankern und `NetworkBridge.getSynchronizedNow()`. Während des lokalen Arena-Aufbaus bleibt der Zeitanker bei null; beim autoritativen Start wird er auf den gemeinsamen `arenaStartTime` re-anchored. Dadurch brauchen kontinuierliche Lichtverläufe keinen laufenden Netzwerk-State und Late Joiner keine lokale Aufholintegration. Der Controller ist Round-Lifetime, Phaser-frei und die einzige Runtime-Quelle; Lighting, Shadows, EmissiveScale und WorldGrade erhalten denselben effektiv gesampelten Wert.

## Tests und Änderungen

Tests sollen Verträge, Invarianten, Parser, Referenzintegrität und Berechnungen schützen. Veränderliche Balancewerte und Registry-Anzahlen nicht als Snapshot duplizieren. Für Phaser-freie Modelle Phaser nur als Typ importieren; Phaser-Module greifen beim Laden auf das DOM zu und sind deshalb nicht automatisch für Vitest geeignet.

Kanonische Einstiegspfade: src/main.ts, src/scenes/ArenaScene.ts, src/scenes/arena/ArenaContext.ts, src/scenes/arena/ArenaLifecycleCoordinator.ts, src/scenes/arena/RendererBundle.ts, src/arena/ArenaBuilder.ts, src/network/NetworkBridge.ts.
