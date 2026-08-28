# Content und Config

## Geltungsbereich

Authored Content ist die Quelle für World- und Activity-Definitionen. Resolver, Parser und Validatoren bilden daraus Laufzeitverträge; Scenes und Systems sollen keine konkurrierenden Defaults oder handcodierten Szenario-Kopien führen.

## World und Activity

[src/config/authoring/WorldDefinition.ts](../../src/config/authoring/WorldDefinition.ts) beschreibt World-eigene Inhalte:

- World-Identität und optionale sourceMapId;
- Metrics, Terrain, Basen, Tracks und World-Action-Policy;
- Presentation- und Participation-Policy;
- Spawn-Ausschlusszonen, persistente World-Sites und anfängliche World-Umgebung.

[src/config/authoring/ActivityDefinition.ts](../../src/config/authoring/ActivityDefinition.ts) beschreibt Activity-Inhalte:

- Objective, Timing und Missionsprogress;
- Respawns, Encounters, Events, Secondary Objectives und Boss;
- Activity-spezifische Base-Overlays, Power-Ups, Item-Drops und Tutorials.

ActivityDefinition besitzt eine worldDefinitionId und keine zweite Geometriequelle. Die gemeinsame Form [AuthoredScenario.ts](../../src/config/authoring/AuthoredScenario.ts) erlaubt deshalb ausdrücklich activity: null. World- und Activity-Definition müssen beim Auflösen dieselbe World-Identität referenzieren.

## IDs und Auflösung

Definitionen werden über Registry- und Loader-Grenzen aufgelöst. Wire- und Ready-Snapshots führen IDs und vertraglich definierte Zustände; sie rekonstruieren keine zufällige Config aus lokalen Map- oder Balance-Defaults.

[authoredScenarios.ts](../../src/config/authoring/authoredScenarios.ts) verbindet native authored Worlds mit Szenario-Adaptern. [WorldLayout.ts](../../src/world/WorldLayout.ts) entscheidet anschließend zwischen authored Layout und deterministischem Generator. Der resultierende WorldDescriptor bindet Definition, Seed, Generatorversion und Layout-Fingerprint an eine World-Revision.

## Adapter für bestehendes Authoring

Der [Coop-Defense-Adapter](../../src/config/authoring/coopDefenseAuthoringAdapter.ts) normalisiert ein bestehendes Map-Format und teilt es in World- und Activity-Besitz. Er erzeugt keine fachlichen Defaults und ersetzt keine Validierung. Die Eingabe muss vor dem Adapter bereits normalisiert und validiert sein; die Round-Trip-Tests schützen die Feldzuordnung.

Besonders wichtig ist die Base-Trennung: dauerhafte Geometrie, Fraktion, Rolle, Anker und Spawn-Zentrum sind World-Inhalt; Missionsfaktoren, Dormancy und Power-Up-Flächen sind Activity-Overlay. Neue Felder werden dem fachlichen Owner zugeordnet, nicht einfach in beide Modelle kopiert.

## Lobby

Die Lobby ist eine normale authored World mit world:lobby. Sie hat keine authored Activity, keine Sonder-Scene und keine Ambient-Simulationsarchitektur. World-Definition und Layout werden über die normalen Resolver und Renderer verarbeitet. Siehe [lobbyWorld.ts](../../src/config/authoring/lobbyWorld.ts) und [LobbyWorldLayout.ts](../../src/arena/LobbyWorldLayout.ts).

## Persistent World-Sites

Eine persistente Base-Site ist World-Konfiguration, während der veränderliche Bauzustand in der lokalen Progress-Grenze liegt. Der authored Verweis persistentBase.baseId muss auf eine vorhandene freundliche Main-Base zeigen; Radius, Clearance und Arena-Grenzen werden durch den aktuellen Validator geprüft. Konkrete Base-IDs gehören in authored Daten und Tests, nicht in diese Übersicht.

## Erweiterungsregeln

- Neue World-Geometrie gehört in WorldDefinition, authored Layout oder Generator.
- Neue Ziele, Gegner, Timer oder Missionsprogress gehören in ActivityDefinition und Activity-Systeme.
- Neue Stats oder Content-Verträge brauchen einen Descriptor, einen Resolver und einen Consumer; keine parallele Balance- oder Config-Kopie im Renderer.
- Neue Präsentationsparameter bleiben Policy/Renderer-Input und werden nicht zu Gameplay-Autorität.
- Registry- und Parser-Verträge müssen unbekannte oder inkonsistente IDs ablehnen.
- Eine Änderung an authored Daten darf nicht durch einen stillen Laufzeit-Default kaschiert werden.

## Maßgebliche Quellen

- [src/config/authoring/WorldDefinition.ts](../../src/config/authoring/WorldDefinition.ts)
- [src/config/authoring/ActivityDefinition.ts](../../src/config/authoring/ActivityDefinition.ts)
- [src/config/authoring/AuthoredScenario.ts](../../src/config/authoring/AuthoredScenario.ts)
- [src/config/authoring/coopDefenseAuthoringAdapter.ts](../../src/config/authoring/coopDefenseAuthoringAdapter.ts)
- [src/config/coopDefenseMaps.ts](../../src/config/coopDefenseMaps.ts)
- [tests/WorldRuntimeContextContracts.test.ts](../../tests/WorldRuntimeContextContracts.test.ts)
