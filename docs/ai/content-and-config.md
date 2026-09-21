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

Der [Coop-Defense-Adapter](../../src/config/authoring/coopDefenseAuthoringAdapter.ts) nimmt den bereits normalisierten und validierten Map-Vertrag entgegen und projiziert ihn in World- und Activity-Verträge beziehungsweise wieder zurück. Er führt selbst keine fachliche Normalisierung durch, materialisiert keine Defaults und ersetzt keine Validierung; die Round-Trip-Tests schützen die verlustfreie Feldzuordnung. `normalizeCoopDefenseMapConfig()` ist nicht idempotent: Bereits normalisierte Configs dürfen nicht erneut normalisiert werden.

Die registryfreien Map-Typen und Normalisierungsregeln liegen in [coopDefenseMapAuthoring.ts](../../src/config/coopDefenseMapAuthoring.ts); [coopDefenseMaps.ts](../../src/config/coopDefenseMaps.ts) lädt die Kampagnenregistry und exportiert diese Verträge weiterhin. [coopDefenseMapSources.json](../../src/config/coopDefenseMapSources.json) besitzt die gemeinsame Zuordnung von Map-ID, Quelldatei und Kampagnenreihenfolge. Authoring-Werkzeuge bearbeiten und speichern ausschließlich den Rohentwurf; expandierte Wasserflächen, injizierte persistente Basen und materialisierte Defaults aus normalisierten Kopien dürfen nicht in die Quelldatei zurückfließen. Die Dokument-, Datei- und Generator-Paritätstests des Map-Editors sichern diese Grenze.

Besonders wichtig ist die Base-Trennung: dauerhafte Geometrie, Fraktion, Rolle, Anker und Spawn-Zentrum sind World-Inhalt; Missionsfaktoren, Dormancy und Power-Up-Flächen sind Activity-Overlay. Neue Felder werden dem fachlichen Owner zugeordnet, nicht einfach in beide Modelle kopiert.

Gleismodi unterscheiden sichtbare Schienen und reservierte Geometrie: `rails` erzeugt beides, `void-fire` reserviert den Korridor ohne Schienen, `none` erzeugt weder Schienen noch eine Korridorreservierung. Eine gespeicherte `trackPosition` bleibt bei `none` erhalten, sperrt aber keine Wasserzellen. Zugereignisse sind ausschließlich mit `rails` gültig; Werkzeuge dürfen sie beim Abschalten der Gleise nicht stillschweigend entfernen. Die Normalisierung und Generatorprüfungen in `MapEditorPreview.test.ts` sichern diese Grenze.

## Lobby

Die Lobby ist eine normale authored World mit world:lobby. Sie hat keine authored Activity, keine Sonder-Scene und keine Ambient-Simulationsarchitektur. World-Definition und Layout werden über die normalen Resolver und Renderer verarbeitet. Siehe [lobbyWorld.ts](../../src/config/authoring/lobbyWorld.ts) und [LobbyWorldLayout.ts](../../src/arena/LobbyWorldLayout.ts).

## Persistent World-Sites

Eine persistente Base-Site ist World-Inhalt: Die World bindet Site, kanonischen Basiskern, Lage,
Ausrichtung, Grunddauerhaftigkeit und ihre World-Geometrie. Sie trägt keine einzelnen persönlichen
Konstruktionen und authoriert keine Build Area. Die aktive Build Area wird ausschließlich aus der
host-autoritativ eingefrorenen `PersistentBaseAreaStage` über
`resolvePersistentBaseBuildAreaForStage()` abgeleitet. Die zugehörige Basis wird aus der Site
erzeugt und darf nicht zusätzlich authored sein; die maximale Reservierungsfläche, Clearance und
Arena-Grenzen werden durch den Validator geprüft. Konkrete Base-IDs gehören in authored Daten und
Tests, nicht in diese Übersicht.

Ob eine World-Instanz ihren Basiskern tatsächlich trägt, ist keine Aussage der Definition, sondern ein host-autoritativ gebundener World-Parameter. Die dauerhaften Blueprint-Konstruktionen gehören zum persönlichen Progress beziehungsweise Contribution des jeweiligen Besitzers. Eine Runtime oder Working Copy materialisiert und bearbeitet diesen Zustand nur für ihren aktuellen Lebenszyklus; ein Activity-/Round-Ausgang kann den Arbeitsstand committen oder verwerfen. Host-Authority über Materialisierung und Validierung ist kein fachlicher Besitz. Eine World ohne Activity kann den Basiskern und persönliche Konstruktionen daher weiterhin materialisieren oder bearbeiten, sofern ihr aktueller World-Runtime-Vertrag diese Aktion erlaubt.

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
