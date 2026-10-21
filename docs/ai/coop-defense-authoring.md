# Coop-Defense-Authoring

## Geltungsbereich

Coop Defense ist eine Activity auf einer World. Diese Seite beschreibt die stabile Aufteilung von authored Daten und die Grenzen für neue Missionen. Balancewerte, aktuelle Map-Listen und konkrete Eventdaten bleiben in authored JSON, Resolvern und Tests.

## Aufteilung des Authorings

[src/config/authoring/coopDefenseAuthoringAdapter.ts](../../src/config/authoring/coopDefenseAuthoringAdapter.ts) nimmt den bereits normalisierten und validierten Coop-Defense-Map-Vertrag entgegen und projiziert ihn in zwei Verträge:

- World-Inhalt: Arena-Geometrie und Metrics, Rocks und Trees, Track-Daten, World-Zeitbasis, World-Basen und die optionale persistente Base-Site.
- Activity-Inhalt: Objective und Überlebensregeln, Respawns, Encounters, Spawns, Map-Events, Secondary Objectives, Missionsprogress, Boss, Power-Ups, Item-Drops, dynamische Activity-Umgebung und Tutorial.

Der Adapter normalisiert nicht erneut, materialisiert keine Defaults und ersetzt keine Validierung. Änderungen am Eingabeformat werden am normalisierten Map-Vertrag und am Round-Trip abgesichert; die Quelle bleibt die authored Definition, nicht die Adapterimplementierung.

Eine Activity referenziert ihre World über worldDefinitionId und liefert keine alternative Layout- oder Metrics-Quelle. Dadurch kann dieselbe World ohne Activity geladen, angezeigt oder activity-unabhängig resident gehalten werden.

Die optionale World-seitige persistentBase-Konfiguration entspricht CoopDefenseMapPersistentBaseConfig und beschreibt nur die Stelle des Basiskerns: baseId, Anker und Ausrichtung. Sie authoriert keine Build Area; diese wird ausschließlich aus der host-autoritativ eingefrorenen `PersistentBaseAreaStage` über `resolvePersistentBaseBuildAreaForStage()` abgeleitet. Die Kernform ist Code-Definition; die Map-Normalisierung erzeugt daraus den `bases`-Eintrag und prüft die räumliche Reservierung. Eine Map, die dieselbe baseId zusätzlich selbst in `bases` beschreibt, wird abgelehnt: Zwei Beschreibungen derselben Basis könnten über Maps hinweg auseinanderlaufen.

**Bereits normalisierte Coop-Configs nicht erneut normalisieren.** `normalizeCoopDefenseMapConfig()` ist nicht idempotent: Der erste Lauf materialisiert zum Beispiel die persistente Basis und für Gruppen mit generierter Inline-`spawnArea` (Dawn) den Default für `front`; ein zweiter Lauf kann dann an der gegenseitigen Ausschließlichkeit scheitern. Adapter erhalten daher bereits normalisierte Configs.

## Wasser-Authoring

`CoopDefenseMapAuthoringConfig` erlaubt neben `water`-Einzelzellen kompakte `waterAreas`:
`{ "gridX": 10, "gridY": 5, "widthCells": 12, "heightCells": 8 }` beschreibt ein Rechteck
ab der eingeschlossenen Startzelle mit ganzzahligen, positiven Abmessungen. Bereiche dürfen
sich untereinander und mit Einzelzellen überlappen; sie bilden eine Vereinigungsmenge.
Explizit doppelte Einzelzellen bleiben ein Authoring-Fehler. Außerhalb der Map liegende Bereiche
und Überschneidungen mit geschützter Geometrie werden abgelehnt, nicht abgeschnitten.

`normalizeCoopDefenseMapConfig()` löst Bereiche einmalig in nach Zeile und Spalte sortierte
Wasserzellen auf. Die normalisierte `CoopDefenseMapConfig`, World-Adapter und Runtime kennen
nur `water`; `waterAreas` wird nicht weitergereicht. Reine Einzelzellenlisten behalten ihre
bisherige Reihenfolge. Maßgeblich sind `tests/WaterTerrain.test.ts` und
`tests/WorldActivityAuthoring.test.ts`.

Wasserfreiräume und Überschneidungen werden zentral durch
`src/config/coopDefenseWater.ts` geprüft. Map-Normalisierung (einschließlich Editor-Speichern)
und Arena-Generierung verwenden dieselbe Prüfung. Der Wasserfreiraum gewöhnlicher Basen
ist unabhängig vom Schutzabstand für Felsen und Bäume; die persistente Basis behält
ihren eigenen Kernfreiraum und die vollständige kreisförmige Reservierung. Maßgeblich sind
auch `tests/MapEditorFileStore.test.ts` für die Parität von Speichern und Vorschau.

Power-Up-Podeste benötigen keinen Basis-Schutzabstand; die tatsächlich belegten Basiszellen
bleiben ausgeschlossen. Feste Podestpositionen werden im Arena-Generator vor der prozeduralen
Terrain-Erzeugung auf seedunabhängige Geometriekonflikte geprüft. Maßgeblich sind
`src/arena/ArenaGenerator.ts` und `tests/MapEditorPreview.test.ts`.

## Basen und Overlays

Eine Basis ist zunächst World-Geometrie und World-Identität: Position, Form, Faction, Rolle, maximale Struktur, Turrets und Spawn-Zentrum gehören zur World. Startzustand, Spieler-Skalierung, Dormancy und missionsbezogene Pedestals sind Activity-Overlay.

Ob Basen Ziel der Gegner sind, ist Activity-Inhalt (`enemyTargeting`). Die Politik wirkt ausschließlich über die Zielquellen der Navigation ([`applyEnemyTargetingToBaseDescriptors`](../../src/systems/flowfield/FlowFieldSources.ts)): Ohne Basisziel fallen Belagerer, Basis-Präferenzen und Spawn-Felder gemeinsam auf die Spielerjagd zurück. Einzelne Gegnersysteme bekommen dafür keine eigenen Sonderfälle.

Die dauerhafte Base-Konfiguration ist nicht mit dem laufenden HP- oder Cooldown-Zustand gleichzusetzen. Solche Laufzeitwerte gehören zur Activity-Simulation oder zur Replikation, nicht zum authored PersistentBase-Zustand.

## Spawnzonen

Feste Spawnorte gehören zur World ([`src/config/spawnZones.ts`](../../src/config/spawnZones.ts), `WorldDefinition.spawnZones`).
Eine Spawnzone ist ein benanntes Rechteck in Arenazellen mit kebab-case-ID. Optional sind:

- `medium: 'water'` für eine Wasserhöhle (nur amphibische Arten);
- `cluster` für einen Rudel-Spawn;
- `keepClear: false`: Der Generator hält dann keinen Kern frei.

Die Activity referenziert Zonen nur per ID:

- Encounter-Gruppen über `spawnZoneId`;
- Dauerquellen über `source: { type: 'zone', zoneId }`;
- der Boss über `spawnZoneId`, außer bei einem Kraken-Habitat.

`front` und `spawnZoneId` schließen sich aus. Die Normalisierung leitet die `spawnArea` der Gruppe bei jedem Lauf aus
der Zone ab. Jede Zone muss benutzt werden, und eine Wasserzone muss Wasser enthalten.

Kampagnenkarten spawnen ausschließlich aus Zonen ([CoopDefenseSpawnZones.test.ts](../../tests/CoopDefenseSpawnZones.test.ts)).
Fronten bleiben technischer Rückfall und Dawn vorbehalten. Dawn-Angriffswellen behalten ihre generierte Inline-Fläche.

Eine Zonengruppe ist nie eine West-Front. Der Encounter-Zustand nennt Zonen (`encounterZones`, `zones`); die Frontlisten
dürfen dann leer sein, und der West-Rückfall gilt nur ohne beides.

Der Generator behandelt Zonen als Quellen der Spawn-zu-Basis-Routenprüfung. Eine Zone, deren Zellen in der
Reservierung der persistenten Basis liegen, lässt jeden Generierungsversuch scheitern. Zonen gehören deshalb in
offenes Randgelände.

Der Host kündigt Zonen an, die gleich Gegner freigeben (`SyncedSpawnZoneAlert`, Key `csz`): Director-Gruppen ab
`SPAWN_ZONE_ALERT_LEAD_MS` vor dem ersten geplanten Spawn, jeder Takt einer Dauerquelle und die Boss-Zone ab dem
Intro. Die Ankündigung ist reine Darstellung, das Void-Gefahrenfeld verdichtet damit den Dunst. Daneben
veröffentlicht der Host den Zustand der Spawnorte (`SyncedSpawnPlaceState`, Key `csp`): Zonen in Benutzung, Zonen,
die ein späterer Encounter, eine spätere Quelle oder der Boss noch nutzt, und verfallene schlafende Ziele. Eine
World-Zone, die in keiner Liste steht, gibt nie mehr Gegner frei.

Der Map-Editor legt Zonen an, benennt sie um (alle Referenzen ziehen mit) und löscht nur unbenutzte Zonen
([MapEditorDocument.test.ts](../../tests/MapEditorDocument.test.ts)).

## Mission und Zeit

Der Host hat die Authority über Objective, Pressure, Wellen, Gegner, Events, Missionsprogress und das Ergebnis. Clients visualisieren replizierte Activity-Daten und senden Aktionen; sie konstruieren keine Mission aus lokaler Uhr oder lokaler Presentation.

Fachliche Zeit folgt der Activity-/Round-Simulation und den replizierten Zuständen. Date.now, lokale Renderzeit und Browser-Takt dürfen keine Entscheidungen über Sieg, Niederlage, Spawns oder Missionsfortschritt treffen. Darstellung darf zwischen validierten Zuständen interpolieren.

`after-defense` bedeutet, dass die referenzierte Defense terminal aufgelöst ist: `completed` oder `failed`. Es bedeutet nicht „nach erfolgreicher Defense“. Ob ein fehlgeschlagenes Hold die gesamte Mission beendet, entscheidet separat das authored Flag `failureEndsMission`.

## Generierte Szenarien (Dawn)

Generierte Coop-Szenarien besitzen keinen Registry-Eintrag. Der Host komponiert pro Runde einen
World-Plan (`WorldParameters.dawn`) und einen Activity-Plan (`ActivityDescriptor.parameters.dawn`);
beide reisen mit den Descriptoren, auch per Welcome zu Late Joinern. Jeder Peer löst sie mit
demselben reinen Resolver
([DawnScenarioResolution.ts](../../src/dawn/resolution/DawnScenarioResolution.ts)) zu einer normalen
Coop-Config auf: Plan → Authoring-Config → genau eine Normalisierung → `toAuthoredScenario` mit
`world:dawn:*`/`activity:dawn:*`. Ein Content-Hash über die Dawn-Registries bricht bei abweichendem
Stand ab; nichts wird in die Kampagnenregistry injiziert. Die World-Seite hängt nur vom World-Plan ab,
eine Dawn-World ist aber nur gepaart mit ihrer Dawn-Activity gültig.

Definitionen und die aktive Coop-Config werden über
[WorldDefinitionResolution.ts](../../src/world/WorldDefinitionResolution.ts) aufgelöst, nicht über
`getWorldDefinition(definitionId)` oder `toMapId → getCoopDefenseMapConfig` (stiller Default-Fallback).
[WorldDefinitionResolutionBoundary.test.ts](../../tests/architecture/WorldDefinitionResolutionBoundary.test.ts)
hält die verbleibenden direkten Lookups als schrumpfende Allowlist fest.

Salvage-Sites sind World-Inhalt: ruhende Bauwerke plus `siteClearings`, deren Kern der Generator
wie Checkpoint-Lichtungen garantiert freihält; die Lichtung ist zugleich Aktivierungsradius. Ihre Ziele
sind `concurrent` (aktivieren ohne Fokus-Slot), starten mit `site-activated` und scheitern über
`expiresAt`. Das Zeitlimit zeitgesteuerter Ziele (`survive`, `defend-until-dawn`) kommt ausschließlich
aus `getCoopMissionTimeLimitSec`.

Bauwerke mit `surface: 'none'` (World-Feld) zeichnen weder Blobfläche noch Basisleuchten; ihre Darstellung besitzt ein
eigener Präsentations-Owner (Dawn: `DawnSitePropRenderer`, auch im ruhenden Zustand). Encounter-Ansagen steuert
`announce`: fehlt es, ist jeder Encounter eine eigene Welle; `false` hält ihn aus Wellenkarte, -ansage und -zählung;
`{ group, finale? }` fasst Encounter zu einer angesagten Welle zusammen. Index, Anzahl und Finale bestimmt der Host im
`CoopDefenseMapDirector`; Clients zeigen nur den replizierten Zustand.

## Portal-Links

Ein Portal-Generator teilt sich wie jede Struktur auf World und Activity auf.
- **World:** Die Endpunkte sind World-Geometrie (`portalAnchors`). Der Generator hält ihre Lichtungen frei und prüft sie als Erreichbarkeitsquellen.
- **Activity:** Was eine Mission daraus macht, ist Activity (`portalLinks`): welcher feindliche, ruhende `outpost` sie speist, wann der Aufbau startet und wie lange er dauert, wer durchgeht und wie sie kollabiert.
- **Generator:** Er braucht genau ein nicht ablaufendes `destroy`-Ziel.
- **Defaults:** Alle Tuning-Defaults stehen in [coopDefensePortalLinks.ts](../../src/config/coopDefensePortalLinks.ts).
- **Wachen:** Eine `siteClearings`-Lichtung mit `structureBaseId` aktiviert ihre Site auch durch einen berechtigten Treffer auf das Bauwerk, nicht nur durch Betreten.

In `repel-assault` gilt ein Encounter mit Start `site-activated` als Neben-Encounter.
- Er muss `announce: false` tragen, nach der Angriffskette stehen und darf von keinem Trigger referenziert werden.
- Er läuft in einem eigenen, stillen Director neben der Kette und blockiert oder beendet sie nie.

Dies sichern [CoopDefensePortalLinks.test.ts](../../tests/CoopDefensePortalLinks.test.ts) und
[DawnPortalGenerator.test.ts](../../tests/DawnPortalGenerator.test.ts).

## Checkpoint-Fortschritt

Checkpoint-Aktivierung und -Abschluss sind getrennte host-autoritative Zustände des
`CoopDefenseMissionProgressSystem`. Nur der Abschluss gibt den nächsten Checkpoint frei;
das Betreten durch einen berechtigten lebenden Teilnehmer aktiviert ihn für das gesamte Team,
startet `after-checkpoint`-Trigger und setzt gegebenenfalls den Respawn-Fokus. `completeOn`
beschreibt die zusätzliche Abschlussbedingung; ohne sie genügt Betreten. Zugeordnete Mandatory
Defenses müssen vorher terminal aufgelöst sein; eine missionsbeendende Niederlage zählt nicht
als Checkpoint-Abschluss. Bereits erfüllte Bedingungen dürfen nach Aktivierung sofort abschließen.

Mauerbedingungen referenzieren World-Mauern per ID. Zerstörung liest die ursprünglichen Fels-IDs
und deren kanonischen World-Zustand, keine Renderobjekte oder nachträglich platzierten Steine.
Fehlende World-Daten erfüllen keine Bedingung. Der Missionssnapshot repliziert Aktivierungs- und
Abschlusszeitpunkte; `nextCheckpointId` ist während einer offenen Aufgabe `null`. Marker, HUD
und Tutorial leiten ihren Zustand daraus ab; sie treffen keine eigenen Fortschrittsentscheidungen.

## Persistente Base

Die persistente Base ist eine World-Site. Ihre sichtbare Runtime-Zusammensetzung entsteht aus der authored Site und den persönlichen Beiträgen der anwesenden Spieler:

- [PersistentBaseTypes.ts](../../src/persistentBase/PersistentBaseTypes.ts) definiert den persönlichen Beitrag samt Sanitizing für Speicher und Netzwerk.
- [PersistentBaseComposite.ts](../../src/persistentBase/PersistentBaseComposite.ts) mischt authored Geometrie, Host-Beitrag und Gastbeiträge deterministisch zu einem reinen Ergebnis.
- [PersistentBaseContributionStore.ts](../../src/persistentBase/PersistentBaseContributionStore.ts) hält den host-seitigen Zustand aller Beiträge; in der Lobby als direkten committed Stand, in einer Mission als Working State.
- [PersistentBaseRoundOutcome.ts](../../src/persistentBase/PersistentBaseRoundOutcome.ts) koppelt Sieg an Commit und Niederlage, Abbruch oder fehlendes Ergebnis an Rollback.

Es gibt genau einen Besitzpfad: Der dauerhafte Blueprint-Besitz liegt im persönlichen Progress des jeweiligen Besitzers, unabhängig davon, ob dieser im aktuellen Raum Host oder Gast ist. Die Base-Site und die Activity besitzen keine persönlichen Konstruktionen. Der hostseitige Store materialisiert und bearbeitet sie laufzeitbezogen: ohne Mission mit sofortigem Commit, in einer Mission über die Working Copy. Freischaltung, Loadout und Kapazität gelten je Besitzer, nicht je Host und nicht als gemeinsamer Basis-Pool.

Die Priorität des Merges ist authored Geometrie, dann der Beitrag des Raum-Hosts, dann Gastbeiträge; „Host-Beitrag“ bezeichnet dabei die aktuelle Raumrolle, nicht eine zusätzliche Besitzklasse. Gäste werden nach stabiler Besitzeridentität sortiert, damit die Beitrittsreihenfolge das Ergebnis nicht verändert. Ein Konflikt materialisiert nicht und löscht nichts: Der Blueprint bleibt im Beitrag seines Besitzers und kann in einem anderen Raum wieder erscheinen.

Der Host hat die Authority über Materialisierung, Validierung, Merge-Ergebnis und laufende Simulation. Diese Authority macht ihn nicht zum fachlichen Eigentümer der Beiträge. Eine Activity oder Runde liefert nur Laufzeitregeln und kann den aktuellen Arbeitsstand committen oder verwerfen.

Runtime-IDs, HP, Cooldowns und temporäre Beziehungsdaten bleiben aus dem Blueprint heraus. Die
authored Site liefert den Anker; die aktive Build Area kommt aus der World-Stage. Generator-
Reservation und Baurecht bleiben getrennte Begriffe.

Verwaltungsrechte hängen an der Herkunft des Objekts, nicht an der Klasse des handelnden Spielers.
Ein base-owned Reward gehört der Host-Basis; jeder berechtigte Coop-Spieler darf es platzieren,
verschieben und zurückbauen, ohne dadurch persönliches Ownership zu erwerben. Persönliche
Konstruktionen bleiben davon unberührt strikt owner-basiert, und der globale Rückbau entfernt
ausschließlich die eigenen Beiträge des auslösenden Spielers. Die Platzierbarkeit eines Rewards
leitet sich ausschließlich aus Freischaltung und aktuellem Placement ab: Ein zurückgebautes Reward
ist wieder platzierbar, und es gibt bewusst kein historisches Placeability-Feld.

Das Verschieben ist eine atomare Mutation des vorhandenen Objekts und ausdrücklich kein Rückbau
mit anschließendem Neubau. Die Runtime behält ihre ID, HP und alle Systemregistrierungen
([`PlacementSystem.relocateRock`](../../src/systems/PlacementSystem.ts)); innerhalb des Speicherbereichs behält der Blueprint
`persistentId`, Owner und `placementOrder`
([`PersistentBaseContributionStore.moveConstruction`](../../src/persistentBase/PersistentBaseContributionStore.ts)),
ein Reward seine Identität und Freischaltung
([`PersistentBaseRewardStore.moveReward`](../../src/persistentBase/PersistentBaseRewardStore.ts)),
und ein Reward-Podest seinen Item- und Respawn-Zustand
([`PowerUpSystem.repositionPersistentBaseRewardPedestal`](../../src/powerups/PowerUpSystem.ts)).
Ein Ab- und Neuanmelden der Runtime über die vorhandenen Remove-/Register-Pfade wäre hier falsch: Es würde
neue Identitäten, volle HP und neue Lifecycle-Effekte erzeugen. Nur die Darstellung darf neu
aufgebaut werden. Der Host validiert Quelle und Ziel unmittelbar vor der Mutation erneut gegen
dieselbe Vorschau, die der Client sieht; bei konkurrierenden Anfragen gewinnt die erste vom Host
akzeptierte Mutation, und ein Fehlschlag lässt die Quelle vollständig unverändert.

Eigene Konstruktionen dürfen die Grenze des persistenten Baubereichs beim Verschieben in beide
Richtungen überschreiten. Beim Hinausschieben werden nur Blueprint und Persistenzbindung entfernt;
die Runtime bleibt erhalten. Beim Hineinschieben wird die vorhandene Runtime als persönlicher
Beitrag registriert. Außerhalb entsteht kein gespeicherter Blueprint. Diese Änderungen folgen
denselben Commit-/Rollback-Regeln wie Bauen und Rückbau; der Baubereich ist eine Speichergrenze,
keine Bewegungsgrenze für persönliche Konstruktionen. Base-owned Rewards behalten ihre authored
Platzierungsdomain. Maßgeblich sind
[`ConstructionWorldRuntime.movePersonalConstruction`](../../src/world/ConstructionWorldRuntime.ts)
und [`PersistentBaseManagementAllClasses.test.ts`](../../tests/integration/PersistentBaseManagementAllClasses.test.ts).

## Dauerhafte Basis-HP

Die maximale Gesundheit der persistenten Basis gehört ihrem persönlichen Ausbau und wird nicht
je Karte authoriert. `PersistentBaseHealth` löst den gemeinsamen Grundwert und die unabhängigen,
einmaligen HP-Belohnungen auf. Der Host friert seine Freischaltungen in
`WorldParameters.persistentBaseHealthRewards` ein; `WorldRuntimeContext` leitet daraus die HP
der Basis ab. Clients und Late Join verwenden ausschließlich diesen replizierten Stand.
Missions-Overlays übernehmen für den persistenten Kern dieselben maximalen und vollen Start-HP,
unabhängig von der Spielerzahl. Andere Basen behalten ihre authored Werte und Skalierung.

Ein berechtigter Rundenteilnehmer erhält seine persönliche HP-Belohnung über den bestehenden
Sieg-/Meta-Fortschrittsablauf. Sie wirkt in der nächsten World-Instanz, nicht rückwirkend in der
abgeschlossenen Mission. Es handelt sich um einen automatischen Ausbau ohne platzierbares Objekt.
Maßgeblich sind [PersistentBaseHealth.ts](../../src/persistentBase/PersistentBaseHealth.ts),
[WorldRuntimeContextContracts.test.ts](../../tests/WorldRuntimeContextContracts.test.ts) und
[ArenaMetaController.test.ts](../../tests/ArenaMetaController.test.ts).

## Erweiterung einer Mission

Fortschreitende Ground-Hazards beschreiben mit ihrem Rechteck oder Polygon die maximale Ausdehnung, nicht
bereits brennenden Boden. Eine `sweep`-Front läuft entlang `headingDeg` durch Rechteck, Polygon oder
Zellenliste; ihre Unregelmäßigkeit bleibt unter Ausdehnung/π, damit keine Linie zurückweicht. Der Activity-gebundene `CoopDefenseGroundHazardEventHandler` aktiviert
die vorbereitete Zündreihenfolge hostseitig und hält blockierte, bereits erreichte Zellen zum
Nachzünden vor. Platzierung und sichere Spawns lesen bei solchen Events dieselbe aktuelle
Feuer-/Warnprojektion wie die Darstellung; sie dürfen nicht die gesamte zukünftige Fläche sperren.
`SyncedBurningGroundSnapshot.warnings` ist ausschließlich eine Hostprojektion, keine clientseitige
Zündentscheidung. Der bestehende Snapshotpfad liefert sie auch an Late Join.

Radiale `expanded-patches` referenzieren ein permanentes `random-patches`-Ereignis ab
Rundenstart. Der Layoutgenerator bewahrt dessen Mittelpunkte und Radien und bereitet nur die
zusätzlichen, gültigen Zellen vor; deren `expansionProgress` ist normierte Geometrie, keine
Laufzeit. Überlappungen verwenden den frühesten Fortschrittswert. Der Ground-Hazard-Handler
leitet daraus Zündzeiten und Bodenwarnungen ab; Clients würfeln oder vergrößern keine Flächen
selbst. Maßgeblich sind `CoopDefenseVoidHunterMap.test.ts`, `GroundHazardSpread.test.ts` und
`CoopDefenseC3.test.ts` unter `tests/`.

Der zusätzliche Void-Basisbrand gehört zur Activity (`BaseVoidFireSystem`), nicht zum Blueprint
oder World-Layout. Er prüft tatsächliche Basiszellen statt Bounding-Boxen, verwendet einen
Schadensstrom je Basis und führt Schaden über `applyBaseStatusDamage` samt Fraktionsprüfung aus.
`SyncedBaseState.voidBurning` projiziert nur die Darstellung; Activity-Ende verwirft den Status.

Bei einer neuen Activity oder Map zuerst entscheiden, welche Daten World-weit und welche Activity-spezifisch sind. Danach:

1. authored Definition und Registry-Eintrag anlegen;
2. den vorhandenen Resolver/Adapter und die Validatoren verwenden;
3. World- und Activity-Descriptor mit derselben World-Identität prüfen;
4. host-authoritative Runtime und replizierten Snapshot ergänzen;
5. Persistenz nur über die PersistentBase- und LocalPersistence-Verträge anbinden;
6. passende Contract- und Round-Trip-Tests aktualisieren.

Neue Map-Geometrie in Activity-Systemen, lokale Mission-Uhren oder konkrete Testwerte in dieser Seite wären Vertragsverletzungen.

## Einstiegspunkte und Tests

- [src/config/coopDefenseMaps.ts](../../src/config/coopDefenseMaps.ts)
- [src/config/authoring/ActivityDefinition.ts](../../src/config/authoring/ActivityDefinition.ts)
- [src/config/authoring/coopDefenseAuthoringAdapter.ts](../../src/config/authoring/coopDefenseAuthoringAdapter.ts)
- [src/scenes/arena/ArenaLifecycleCoordinator.ts](../../src/scenes/arena/ArenaLifecycleCoordinator.ts)
- [tests/integration/WorldWithoutActivityProof.test.ts](../../tests/integration/WorldWithoutActivityProof.test.ts)
- [tests/PersistentBaseContributionStore.test.ts](../../tests/PersistentBaseContributionStore.test.ts)
- [tests/PersistentBaseRoundOutcome.test.ts](../../tests/PersistentBaseRoundOutcome.test.ts)
- [tests/PersistentBaseComposite.test.ts](../../tests/PersistentBaseComposite.test.ts)
- [tests/PersistentBaseRepositioning.test.ts](../../tests/PersistentBaseRepositioning.test.ts)
- [tests/integration/PersistentBaseManagementAllClasses.test.ts](../../tests/integration/PersistentBaseManagementAllClasses.test.ts)
