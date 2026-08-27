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

`detachRuntime()` fällt auf `creating` zurück, solange die Instanz existiert — es gibt eine World, nur keine lokale Runtime dafür; `descriptor` bleibt dabei gesetzt. Erst `endInstance()` macht daraus `none`. Jeder Peer beendet seine Instanz beim Rückweg in die Lobby; den replizierten Kanal räumt nur der Host.

Die Activity hat ihren eigenen Lebenszyklus daneben (`ActivityLifecycle`, `none → creating → active → ending`) und gehört der World: `worldLifecycle.activity`. Eine Activity setzt zwingend eine aktive World voraus — umgekehrt nicht. Sie steht erst nach ihrer World und fällt vor ihr; das Ende der World beendet sie zwingend mit. World und Activity gehen atomar auf den Draht, damit nie eine Activity ohne ihre World sichtbar wird; ihre Zustände bleiben trotzdem getrennt. Ein Client erzeugt keine Activity, sondern übergibt die beobachtete an `attachRuntime()`.

Activity-Systeme entstehen dadurch, weil eine Activity läuft — nicht weil ein Modus-Flag gesetzt ist. `buildArena()` trifft die Entscheidung genau einmal (`activityDescriptor?.kind === 'coop-mission'`) statt sie sechzehnmal aus `descriptor.gameMode` abzuleiten. Eine World ohne Activity läuft mit `activity.phase === 'none'`, ohne dass irgendwo Missionssysteme „auf null" gesetzt werden müssten.

## Presentation- und Input-Policy

Die Scene interpretiert Zustandskombinationen nicht mehr selbst. `resolvePresentationPolicy()` (src/world/PresentationPolicy.ts) leitet `showLobby`, `showWorld`, `showHud`, `useWorldCamera` und `useSpectatorCamera` aus Raumzustand, `WorldPresentationRequirement`, Sichtbarkeit, Gameplay-Zustand, Rundenrolle und Abbruchzustand ab. `resolveInputPolicy()` (src/world/InputPolicy.ts) leitet `movement`, `combat`, `placement`, `worldInteraction`, `cameraNavigation` und `aim` aus den `PlayerCapabilities`, dem Gameplay-/Countdown-Zustand, dem UI-Zustand und der Diagnose-Arena ab.

`resolveInputPolicy()` wird ausschließlich aus den kanonischen `PlayerCapabilities` des lokalen Spielers gespeist (`lifecycle.getPlayerCapabilities(bridge.getLocalPlayerId())`), also aus seiner echten replizierten `WorldParticipation` — nicht aus einem lokal nachgebauten Rollenzustand wie `spectator ? 'observer' : 'interactive'` und nicht aus einem parallelen `canPlayerAct()`-Gate.

Beide sind rein und rein lokal: sie steuern Darstellung und Eingabe-UX. Ob eine Handlung zählt, entscheidet weiterhin der Host über dieselben Capabilities. Der Countdown hält Bewegung an, lässt Zielen und Weltinteraktion aber offen; die Diagnose-Arena sperrt das laufende Gameplay, nicht ihre Countdown-Interaktion.

## Entity-Runtime und Entity-Presentation

Figuren und Bäume folgen demselben Muster wie die Felsen: **die Runtime ist die kanonische Quelle, die Darstellung ein optionaler Verbraucher.**

`PlayerBody` (src/entities/PlayerBody.ts) trägt Position, Ausrichtung, Aktivität, Bounds und den Arcade-Körper einer Figur — an einer nicht rendernden `Zone`, wie `RockPhysicsProxy` und `TreePhysicsProxy`. `PlayerEntity` hält sie als `runtime` und beantwortet `x`, `y`, `rotation`, `active`, `getBounds()` und `body` daraus. Das Sprite ist **privat** und `null`-fähig; Simulation und Systeme können es nicht mehr erreichen. Für echte Darstellungszugriffe (Effekte, Schatten, Tweens) gibt es den benannten `displayObject`-Zugang, für den replizierten Todeseffekt `getDeathVisual()`.

Kollisionen registrieren auf `player.physicsProxy`, nicht auf dem Bild. Der Trefferradius kommt aus `getHitRadius()` statt aus `displayWidth` — sonst entschiede die Darstellung über Treffer. `HitscanTarget` trägt entsprechend nur noch Position und Radius.

**Die Darstellung wird jeden Frame an die Runtime nachgezogen** — `syncBar()` ruft dafür `syncVisualPosition()`. Das ist derselbe Hook, der schon immer „jeden Frame, wenn Physik die Figur bewegt hat" bedeutete. Fehlt er, bewegt die Physik die Runtime, während das Bild am Spawnpunkt stehen bleibt; Position, Mündungspunkt und Zielen laufen dann auseinander. Der Mündungspunkt liest deshalb ebenfalls die Runtime, nicht das Bild.

Bäume: `trunkBodies` (`TreePhysicsProxy`, zugleich `ObstacleCircleBody`) ist die Runtime; `trunkVisuals` und `canopyObjects` sind Darstellung und entstehen nur mit `options.presentation`. Hindernis- und Lichtindex lesen die Körper.

Ohne lokale World-Presentation entstehen weder Stämme und Kronen noch Figur-Sprites: `ArenaBuilder` bekommt `presentation`, `PlayerManager` einen `setVisualsEnabledResolver()`, beide gespeist aus `getLocalWorldPresentation().required`. Die Runtime bleibt davon unberührt — der Host simuliert identisch.

Eine bewusste Folge: der Kollisionsradius skaliert nicht mehr implizit mit dem Sprite mit. Er wird ausschließlich explizit gesetzt (`setCollisionRadius()`), so wie `HostPhysicsSystem` ihn für den Dash ohnehin schon führt.

## World Simulation und World Presentation

`resolveWorldPresentation({ participation, worldActive })` (src/world/WorldPresentation.ts) entscheidet, ob ein Peer die laufende World lokal darstellt. Ohne Teilnahme entsteht **keine** Darstellungsfläche — der Zielzustand ist: Shared World aktiv, Host simuliert autoritativ, Host stellt nichts dar. „Host bleibt in der Lobby" heißt weder, die World vollständig zu rendern und die Lobby darüberzulegen, noch einen unsichtbaren World-Render-Tree zu halten.

`WORLD_PRESENTATION_SURFACES` benennt, was dazugehört: Terrain-Surfaces, World-Sprites, Weltkamera, World-HUD, Aim, World-Overlays, lokale Player-Visuals. Nicht-rendernde Infrastruktur, die die Simulation technisch braucht, darf bestehen — Physikdaten dürfen Phaser-gebunden bleiben, solange daraus keine Darstellung entsteht.

Der autoritative Host-Tick führt deshalb **keine** Darstellung als Voraussetzung: `HostUpdateCoordinator` erreicht Renderer, Effekte und Audio nur über `visuals`, `effects` und `audio`, die alle an einer Entscheidung (`setPresentationActive()`) hängen und `null` sein dürfen; World-HUD, Kamera-Feedback und Gegner-Dash-Visuals stehen hinter derselben Bedingung. Der Coordinator bindet sie an die eigene Teilnahme (`setPresentationActive(getLocalWorldPresentation().required)`). Derselbe Tick simuliert also identisch, ob dieser Peer die World darstellt oder nicht.

Presentation darf Simulation beobachten, aber nie deren Voraussetzung sein. tests/WorldPresentationContracts.test.ts hält die Abhängigkeitsrichtung fest: kein Simulationsmodul (Placement, Combat, Physics, PlayerManager, die World-Schicht) hat eine Wertabhängigkeit auf `effects/`, `ui/`, `RendererBundle` oder `scenes/`, und die Darstellungssenken der Player-Runtime bleiben nullable.

## World Update und Activity Update

Der Host-Tick trifft die Activity-Entscheidung einmal (`bridge.getActivityDescriptor()?.kind === 'coop-mission'`) und aktiviert damit zwei benannte Gruppen: `runCoopMissionProgressPhase()` (Boss, Missionsfortschritt, Map-/Event-Direktoren, Nebenziele, Dormant-Sync, Objective-Repair, Dauerdruck) und `runCoopMissionCombatPhase()` (Timebomb, Enemy-Burrow, Gefechtsposition, Gegnerbewegung, Nekromantie, Void-Hunter, Fähigkeiten, Angriff).

Verbindlich ist nicht ein grober `world.update(); activity.update();`-Block, sondern dass Activity-Systeme durch die Activity aktiviert und gruppiert werden statt durch verstreute Nullable-Abfragen. Die bestehende Simulationsreihenfolge bleibt unangetastet: Weltanteile wie `decoySystem.hostUpdateLifecycle()`, die Flowfield-Aktualisierung und die Messpunkte stehen weiterhin zwischen den beiden Phasen und dürfen nicht mitgegattert werden. Die Phasen selbst entscheiden nicht erneut über ihre eigene Aktivierung.

## Capability Policy

`resolvePlayerCapabilities({ participation, activityKind })` (src/world/PlayerCapabilities.ts) ersetzt die universelle Freigabe `canPlayerAct()` durch spezifische Rechte: `canMove`, `canUseCombat`, `canPlace`, `canDismantle`, `canInteract`, `canUseMissionActions`, `canControlCamera`. Eine World ohne Activity erlaubt Bauen ohne Kampf; ein Beobachter führt nur die Kamera; ohne Teilnahme gibt es gar nichts.

Host und Client verwenden dieselbe reine Regel, aber mit getrennter Autorität: der Client leitet daraus nur Eingabe-UX, Vorschau und lokale Freigabe ab, der Host löst sie aus seinem eigenen Zustand erneut auf und validiert damit. Client-seitig übermittelte Capabilities besitzen keine Autorität.

## World Participation

`WorldParticipation` (src/world/WorldParticipation.ts) ist ein eigener host-autoritärer Zustand je Spieler: `none | joining | interactive | observer | leaving`. `Lobby` ist ausdrücklich kein Participation-State — wer in der Lobby steht, nimmt an keiner World teil.

Sie beantwortet die weltbezogenen Fragen über kleine Prädikate: `hasWorldRuntimeEntry()`, `maySendWorldInput()` (nur `interactive`), `consumesWorldReplication()` und `requiresLocalWorldPresentation()` (alles außer `none`). `WorldParticipationInput` kennt bewusst keinen Rundenbegriff. Wer nicht handeln darf, ist `observer` — auch ohne eigenen Runtime-Eintrag, denn ein Zuschauer wartet auf keine Figur.

Sie ist ein **eigener replizierter World-Kanal** (`wpp`, `WorldParticipationState`), an `WorldDescriptor.worldRevision` gebunden: der Host leitet sie in `hostSyncWorldParticipation()` genau einmal aus seinem autoritativen Zustand ab, alle Peers lesen über `bridge.getWorldParticipation()` denselben Wert. Sie wird nirgends aus `canPlayerAct()`, `canPlayerSpawnOrRespawn()` oder `GamePhase` rekonstruiert — sonst hinge eine World ohne Runde an einer Runde. Eine neue World-Instanz startet ohne Teilnehmer; ein verspätetes Paket der Vorinstanz wird beim Lesen verworfen.

Raum-Mitgliedschaft ist **keine** World-Mitgliedschaft. Wer in der Lobby steht, während eine Shared World läuft, bleibt außerhalb, bis er wirklich eintritt — nur so gibt es überhaupt ein Join und ein Leave. Die Aufnahme liegt host-seitig in `admittedToWorld` und ändert sich ausschließlich über `hostAdmitToWorld()` / `hostRemoveFromWorld()`; `hostSyncWorldParticipation()` liest sie, erfindet aber keine. Mit der World-Instanz endet jede Aufnahme.

Der einzige Automatismus ist die Activity: eine laufende Runde nimmt ihre eigene Besetzung auf (`admitActivityRoster()`, Teilnehmer **und** Zuschauer). Was ein Mitglied darf, entscheidet danach die Activity; läuft keine, handelt jedes aufgenommene Mitglied. `setHostParticipatesInWorld(false)` ist zugleich der Austritt des Hosts — er simuliert die Shared World, ohne in ihr zu stehen.

Die Rundenrolle bleibt getrennt: ein Missions-Spectator ist in der World `observer` und in der Runde `spectator`. `RoundParticipationPolicy` bleibt die Quelle für Spawn-, Handlungs- und Belohnungsrechte der Runde; World Participation ersetzt sie nicht.

Die Teilnahme speist den Player-Lifecycle: `resolvePlayerRuntimeFeatures()` nimmt sie entgegen, und ein `observer` bekommt keine Kampf-, Ressourcen- oder Missionsmodule. Der Abbau läuft dagegen bewusst immer mit dem vollen Anteil, damit von einem Beobachter kein Kampfzustand stehen bleibt.

## Player-Lifecycle

`PlayerWorldRuntime` (src/world/PlayerWorldRuntime.ts) ist der gemeinsame Weg hinein und hinaus — kein getrennter Mission-, Editor- oder PvP-Pfad. Welche Module laufen, entscheidet `resolvePlayerRuntimeFeatures({ activityKind, isHost })`: Rolle und laufende Activity, nicht „welches System ist gerade nicht null". Eine World ohne Coop-Mission führt keinen missionsgebundenen Spielerzustand; ein Client führt keine autoritative Simulation, aber seine Spielfigur.

Der Attach ist atomar: lehnt ein Modul ab (`run` liefert `false`) oder wirft es, werden die bereits angehängten Module in umgekehrter Reihenfolge zurückgenommen — ein Spieler bleibt nie halb initialisiert. Der Detach läuft über dieselbe Feature-Entscheidung und ist deshalb auch für Spieler gültig, die diese Runtime nie selbst angehängt hat (Client-Pfad).

Spawn, Respawn, Spectator-Wechsel, Disconnect und Rundenende nehmen alle diesen Weg. Verbleibende Ausnahme: `onTransitionToArena()` legt die Spielfiguren der Startbesetzung noch selbst an — auf Clients der einzige Weg, auf dem Host ohne Ally-Flowfield und ohne Ultimate-Reset. Das ist in tests/PlayerWorldRuntimeContracts.test.ts festgehalten.

## World-Aufbau ohne Runde

Der Aufbau gehört der World. `buildWorld(worldDescriptor, activityDescriptor | null)` nimmt keinen `ArenaDescriptor` mehr entgegen und liest weder `GamePhase` noch `getArenaDescriptor()`: Generatorversion, Seed, Fingerprint und Ladefortschritt kommen aus dem `WorldDescriptor`, die Metrik aus `resolveWorldLayout()`. Eine Activity ist ein optionaler Parameter, der nur ihre eigenen Systeme anhängt.

`resolveWorldLayout(world, activity)` ist die eine Ableitung von Modus und authored Map. Die Map gehört **immer** der World (`toMapId(world.definitionId)`) — eine Coop-World ohne Mission bleibt eine Coop-World. Das ist die Voraussetzung dafür, dass `WorldRuntimeContext` seine Zusicherung halten kann, dass Map und `definitionId` zusammenpassen. Den Modus leitet eine laufende Activity ab; ohne Activity antwortet die World aus ihrer eigenen Identität (authored Map → `coop_defense`, sonst `deathmatch`).

Weil die Map jetzt auch ohne Activity aufgelöst wird, trägt `missionMapConfig = isCoopMission ? coopDefenseMapConfig : null` die Activity-Sicht auf dieselbe Map. Ohne diese Trennung würde eine Coop-World ohne Runde Bosse, Missionsziele, Encounter und Respawn-Budgets aufbauen, für die es keine Runde gibt.

`onTransitionToArena()` gattert entsprechend zweistufig: die World ist die Bedingung, `activityReady` ist ohne Activity trivial erfüllt. Ausgelöst wird der Aufbau einer World **mit** Activity weiterhin vom Rundenwechsel (ihre Besetzung und ihr Startzeitpunkt kommen aus der Runde); eine World **ohne** Activity entsteht und vergeht mit ihrem eigenen Kanal über `detectWorldChange()`.

Die lokalen Presentation-Schritte des Übergangs — Ladeschirm, Lobby-Overlay, HUD-Wechsel, Arenamusik — hängen an `entersWorld`. Eine Runde nimmt jeden Teilnehmer mit hinein; ohne Activity betritt die World nur, wer aufgenommen wurde. Ein nur simulierender Host behält Lobby, Lobby-HUD und Lobby-Musik. Ebenso entscheidet ohne Activity die World-Teilnahme darüber, wer eine Spielfigur bekommt — `canPlayerSpawnOrRespawn()` verlangt eine Runde und kann eine World ohne Runde nicht beantworten.

## World Loading und Round Loading

Beides sind getrennte Bedingungen. Die replizierte Ladebarriere (`wlr`, `resolveWorldLoadProgress`) beantwortet ausschließlich, ob die lokale World gebaut und darstellbar ist — bei jedem Peer, Host wie Client. Ob eine Runde starten darf, entscheidet zusätzlich `prepareRoundStart()` host-lokal: alle aktiven Teilnehmer stehen wirklich in der Welt und der Host-Tick hat seine Caches aufgebaut. `tryScheduleArenaStart()` prüft erst die World-Barriere, dann das Round-Gate.

Der Ladezustand hängt an `WorldDescriptor.worldRevision`, nicht an einer Rundenrevision, und `areWorldParticipantsLoadReady()` erwartet genau die Teilnehmer dieser World-Instanz — es gibt keine zweite, rundengebundene Barriere daneben. Wer keine lokale World-Presentation hat, meldet sofort fertig: ohne Darstellung gibt es nichts zu laden. Ein Host, der eine Shared World nur simuliert, wartet deshalb auf niemanden und lässt auch niemanden auf sich warten.

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
