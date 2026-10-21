# Gameplay

## Geltungsbereich

Diese Seite hält die fachlichen Grenzen zwischen World-Spielraum, Activity/Runde, lokaler Eingabe und Player-Runtime fest. Konkrete Gegnerwerte, Waffenbalance, Map-Inhalte und Ablaufdetails gehören in authored Daten, Systems oder Tests.

## Host-authoritative Spielregeln

Der Host entscheidet Simulation, Treffer, Ressourcen, Spawns, Ziele, Rundenzustand und persistente Ergebnisse. Clients senden Eingaben oder Aktionen; eine lokale Prediction oder ein UI-Zustand ist kein Beweis für eine erlaubte Aktion.

Die zuständige Netzwerkschnittstelle ist [NetworkBridge.ts](../../src/network/NetworkBridge.ts). Gameplay darf weder PeerJS noch Wire-Channel direkt importieren.

## WorldParticipation und Fähigkeiten

[WorldParticipation.ts](../../src/world/WorldParticipation.ts) ist nicht aus GamePhase, RoundParticipation oder canPlayerAct abzuleiten. Room-Mitgliedschaft, World-Admission, Activity-Teilnahme und lokale Presentation sind getrennte Zustände.

Der Host veröffentlicht die Participation. joining, interactive, observer und leaving können unterschiedliche Runtime- und Rechtefolgen haben; none bedeutet keine World-Teilnahme. Ein observer darf World-Daten und eine spectatorische Presentation erhalten, aber keine interaktive Player-Aktion senden.

[PlayerCapabilities.ts](../../src/world/PlayerCapabilities.ts) beschreibt die fachliche Erlaubnis in einzelnen Domänen, etwa Bewegung, Combat, Platzierung, Dismantling, Interaktion, Missionsaktionen und Kamerasteuerung. [InputPolicy.ts](../../src/world/InputPolicy.ts) entscheidet daraus zusammen mit lokalem UI-, Countdown- und Diagnosezustand, welche Eingabe angeboten wird. Der Host revalidiert die Aktion unabhängig davon.

Shift-Interaktionen mit Weltobjekten (Turm bemannen, Wachturm, Lobby-Gebäude, Schießstand) laufen über genau einen Kandidatenvertrag, [WorldInteractionCandidate.ts](../../src/systems/WorldInteractionCandidate.ts). `x`, `y` und `radius` steuern die blick- und distanzgewichtete Auswahl in [WorldInteractionSelection.ts](../../src/systems/WorldInteractionSelection.ts). `footprint`, `label`, `subject` und optional `blocked` steuern die Darstellung. Sichtbar wird der Fokus ausschließlich über [WorldInteractionRenderer.ts](../../src/effects/WorldInteractionRenderer.ts): Klammern um die echte Grundfläche, eine Plakette mit Tastenkappe und dezente Marken an weiteren erreichbaren Zielen. Ein neues interagierbares Objekt liefert einen Kandidaten mit Grundfläche und baut keinen eigenen Marker und keinen eigenen Shift-Pfad. Shift führt genau den angezeigten Kandidaten aus.

## World, Activity und Runde

World-Zustand umfasst dauerhafte Geometrie, Basen, World-Sites, World-Identität und WorldParticipation. Activity- und Round-Zustand umfasst Ziele, Timer, Gegner, Wellen, Missionsprogress, Respawns, Events und Ergebnis. Eine World ohne Activity ist ein gültiger Betriebszustand; ein Activity-Start darf World-Geometrie oder World-Identity nicht heimlich neu erzeugen.

World Loading ist an worldRevision gebunden. Round Loading wartet auf die World-Readiness und die für den Aktivitätsstart nötigen Teilnehmer, bleibt aber ein eigener Vertrag. Siehe [WorldLoadReady.ts](../../src/world/WorldLoadReady.ts) und [WorldRoundLoadingContracts.test.ts](../../tests/WorldRoundLoadingContracts.test.ts).

## KI-Absicht und Navigation

Offensive Ausweichwünsche laufen über den `EnemyDodgeRequestPort` des
[CoopDefenseEnemyDodgeSystem](../../src/systems/CoopDefenseEnemyDodgeSystem.ts). Ein akzeptierter
Request wartet bis zum Schritt vor der Physik: Dort haben erkannte Projektilgefahren Vorrang,
und Ability-Sperre, Bewegungsweg und Landung werden erneut geprüft. Beide Distanzmodi teilen
den aktiven Dash und den Cooldown dieses Owners; die anfordernde KI besitzt nur ihre lokale
Entscheidungsverweildauer. Dies sichern die Dodge- und Brandstifter-Verhaltenstests.

Die Coop-Activity besitzt die gemeinsame Zielentscheidung im [EnemyIntentSystem](../../src/systems/navigation/EnemyIntentSystem.ts).
Gewöhnliche Gegnerbewegung, Gefechtspositionierung und neue gezielte Angriffe lesen dieselbe Zielbindung.
Ein Waffenmodus `all` erlaubt keinen strategischen Zielwechsel; ausdrücklich konfigurierte Nebenaktionen
und bereits verbindlich begonnene Fähigkeiten behalten ihre eigenen Verträge.

Das Angriffssystem liefert vor der gewöhnlichen Bewegung eine lesende Gefechtsvorgabe aus
denselben Ziel-, Reichweiten- und Sichtprüfungen wie die Angriffsausführung. Cooldown und Scan-Takt
heben eine gültige Standposition nicht auf; die Abfrage verbraucht keine Waffenzeit oder Ziel-Locks.
Gewollter Rückzug, bewegliche Angriffe und exklusive Aktionen behalten ihre Bewegungsverträge.
Gefechtsausrichtung und Angriffspausen verwenden die fachliche Host-Zeit.

Fähigkeitsbewegung läuft über die geordnete `EnemySpecialMovementSource` der Coop-Runtime und
ersetzt pro Frame die gewöhnliche Bewegung. Ein Override ist standardmäßig exklusiv: Auch ein
Nekromantie-Verbündeter routet und greift dann nicht an. `keepsRouting` markiert einen Owner, der
den Körper nur hält (ruhende Hüpfer): Verbündete routen weiter, melden ihren Steuerpunkt und greifen
an, laufen aber nicht. Dies sichert [NecromancyLifecycle.test.ts](../../tests/NecromancyLifecycle.test.ts).

Verfolgungsgedächtnis gehört dem `EnemyIntentSystem`. Der Zielkatalog trennt dafür die Erlaubnis,
eine beobachtete Spielerposition zu behalten, vom Zugriff auf ein aktuelles Angriffsziel.
Einbuddeln erhält nur die Erinnerung; unterirdische Positionen aktualisieren sie nicht.
Andere gültige Ziele und geeignete Basisziele haben Vorrang. Eine Erinnerung erlaubt Bewegung
zum beobachteten Ort, aber weder neue Angriffe noch Durchbruchsaufträge. Ankunft, Tod, Entfernung,
Zielersatz und Activity-Teardown beenden die Erinnerung. Dies prüfen die bestehenden
Intent-Tests und [NavigationPursuit.test.ts](../../tests/integration/NavigationPursuit.test.ts).

Die Navigation leitet ihre Körpergeometrie aus der aktuellen World ab. Ein Worker-Ergebnis wird zusammen
mit Profil, Zielzuordnung und Generation aktiviert. Physische Änderungen entziehen veralteten Routen
sofort ihre Erreichbarkeits- und Durchbruchsaussage. Ein Fortsatz zum selben Ziel darf weiterführen,
wenn der aktuelle Körperanschluss und jedes vorgeschlagene Segment gegen die neue Geometrie frei sind.
`pending`, ein ungültiger Anschluss oder Gedränge beweisen keine Unerreichbarkeit und erlauben keinen
Durchbruchsangriff. Ein solcher Angriff benötigt einen aktuellen Auftrag für das konkrete beschädigbare
Hindernis und die Rechte der Einheit; der Schaden läuft weiterhin durch Combat. Dies sichern
[EnemyIntentAndBreach.test.ts](../../tests/EnemyIntentAndBreach.test.ts) und
[NavigationBodyGraph.test.ts](../../tests/NavigationBodyGraph.test.ts).

Amphibische Gegner (`amphibious`) navigieren über ein eigenes Körperprofil, dessen Graph Wasser nicht
als Hindernis führt und Wasser nach dem Schwimmtempo gewichtet; ihre Angriffsplätze bleiben an Land.
Getaucht gelten sie über `EnemyEntity.isBurrowed()` als nicht treffbar und nicht angriffsfähig. Neue
Ziel-, Treffer- und Angriffsprüfungen verwenden deshalb `isBurrowed()` und nie das Feld `burrowed`
direkt. Der Zustand wird als `submerged` repliziert und erzeugt keine Grabeffekte. Ein Wasser-Spawn
(Spawnzone mit `medium: 'water'`) ist nur für amphibische Arten zulässig. Dies sichern
[MiniKraken.test.ts](../../tests/MiniKraken.test.ts) und
[EnemyIntentAndBreach.test.ts](../../tests/EnemyIntentAndBreach.test.ts).

Portale haben einen einzigen Akteur-Transport.
- **Transport:**
  - Der World-Owner [WorldPortalTransport](../../src/systems/portal/WorldPortalTransport.ts) führt die Paare aller registrierten Quellen zusammen; Translokator und Portal-Generator sind solche Quellen.
  - Er allein versetzt Spieler und Gegner. Projektile und Hitscan lesen dieselbe Paarsicht.
  - Eine Quelle bestimmt nur, wen ihr Paar zulässt, wie es aufblitzt und wann sich ein Austrittstor wieder öffnet. Ihre Lebenszeit bleibt beim Quellen-Owner.
- **Navigation:**
  - Die Navigation plant Portale ausschließlich als authored Links über `FlowFieldCoordinator.setPortalLinks`.
  - Diese Links schreibt allein das Activity-eigene [PortalLinkSystem](../../src/systems/portal/PortalLinkSystem.ts), und nur für offene Links.
  - Translokator-Paare bleiben rein physisch: Gegner können hineinlaufen, planen aber nie mit ihnen.
- **Nach dem Sprung:** Ein Sprung erhöht die `positionRevision`. Das Intent entscheidet dann außerhalb seines Scan-Budgets neu.

Dies sichern [WorldPortalTransport.test.ts](../../tests/WorldPortalTransport.test.ts) und
[PortalLinkNavigation.test.ts](../../tests/integration/PortalLinkNavigation.test.ts).

Authored Spawn-Bereiche und Konstrukte bleiben im 32-px-Weltraster. Navigationsindizes gehören
zum separaten Punktraster und dürfen nicht als World-Zellen materialisiert werden. Der Spawn-Executor
prüft den vollständigen Körper an genau der Position, die er erzeugt; ungeprüfter Jitter ist dort unzulässig.
Bei bewegten Zielen darf die aktuelle Regionsverbindung einen Spawn vor Abschluss der neuen Wegkosten
bestätigen. Eine neue physische Topologie benötigt dagegen einen passenden Graphen.

Der Spawn-Executor meldet belegte, ansonsten gültige Zellen und ausstehende Navigation als
vorübergehend verzögert an den `CoopDefenseMapDirector`. Der Director behält die noch fehlenden
Gegner in seinem hostseitigen Encounter-Zustand und wiederholt die Platzierung mit zeitlichem
Abstand. Solche Wartezustände dürfen weder die Wellenstärke vermindern noch den technischen
Abbruch für dauerhaft unbrauchbare Spawn-Bereiche auslösen, auch wenn noch kein Gegner dieser
Welle lebt. Nachrückende Gegner werden erneut gegen aktuelle Geometrie und Belegung geprüft;
die Warteschlange endet mit dem Encounter-/Activity-Lifetime und wird nicht repliziert.

Auch bestätigte Unerreichbarkeit hängt an aktuellen Körperregionen und gültigen Start-/Zielanschlüssen,
nicht an fertig berechneten Wegkosten. Bei unveränderter Topologie prüft die Navigation die aktuell
angeforderten Angriffsplätze gegen diese Regionen. Ein Durchbruchsauftrag bleibt bei Zielbewegung
innerhalb derselben Zielregion gültig; ein frei erreichbarer Zielbereich hebt ihn sofort auf.
Die Suche verwendet dabei die aktuellen Zielanschlüsse, keine veralteten Ziele des Kostenfeldes.
Fehlen einem gültigen Ziel sämtliche freien Angriffsplätze, prüft die Durchbruchssuche mögliche
Angriffsplätze nach einer hypothetischen Öffnung. Ein aktueller freier Startanschluss bleibt erforderlich;
die Öffnung muss sowohl Körperfreiheit als auch Reichweite und Sicht zum Ziel herstellen.
Ein tatsächlich ungültiges Ziel wird dadurch nicht zum Durchbruchsziel.

Ein `pending`-Ergebnis kann einen sicheren Bewegungsfortsatz tragen. Dieser bleibt an dasselbe Ziel
gebunden und erteilt keine Durchbruchserlaubnis. Eine direkte Verbindung zu einem aktuellen Angriffsbereich
kann die normale Zielerlaubnis bestätigen; ein Fortsatz aus dem vorigen Feld allein kann dies nicht.
Die Verträge sind in [CoopDefenseSpawnExecutor.test.ts](../../tests/CoopDefenseSpawnExecutor.test.ts) und
[NavigationPursuit.test.ts](../../tests/integration/NavigationPursuit.test.ts) abgesichert.

Nekromantie behält Entity-Lifetime, Besitzerbindung und Leash. Ihre gewöhnliche Bewegung benutzt dieselbe
körpergerechte Navigation wie feindliche Einheiten. Interne Felder, Dichte und Suchzustände sind
hostlokale Activity-Ressourcen und werden nicht repliziert.
Die Nachbarschaft liest einen gemeinsamen Positionsstand und die zuletzt physikalisch angewendeten
Geschwindigkeiten, einschließlich Statusfaktoren und Impulsen. Eingebuddelte, inaktive und physikalisch
deaktivierte Einheiten sind keine gewöhnlichen Bewegungsnachbarn.

Verbündete Gegner (`faction: 'allied'`) zeigen ihre Waffen- und Fähigkeitseffekte in der gemeinsamen
Verbündeten-Palette (`ALLIED_PALETTE`), nie in Gegnerfarben. Der Host übersetzt Waffen-Configs, Brandflächen
und Wolkenvarianten zentral in [AlliedEnemyEffects.ts](../../src/systems/AlliedEnemyEffects.ts); getönte
Feuerfamilien laufen über den Feuerstil `allied`. Brandflächen eines Verbündeten zielen auf `enemies`, damit sie
Spieler auch nach dem Tod ihres Erzeugers nicht treffen. Eine neue Gegnerfähigkeit, die Verbündete auslösen
können, muss beides über dieses Modul beziehen.

Brandstifter-Combos dürfen mit `allowCrossTeam` auch gegnerische Kugeln zünden. Der Zünder besitzt
den Schaden; seine bei der Detonation erfasste Provenance gilt auch nach seinem Despawn.
Die Feuer-Payload (Explosion, Brand und Chunks) wird über `AlliedEnemyEffects` auf diese Fraktion
aufgelöst. Verbündete Combos treffen damit feindliche Gegner, keine Spieler oder Bauwerke;
die ursprüngliche Kugelfraktion entscheidet nicht über den Combo-Schaden. Dies sichert
[SharedCombatEffects.test.ts](../../tests/integration/SharedCombatEffects.test.ts).

## RoundParticipation bleibt separat

[RoundParticipationPolicy.ts](../../src/scenes/arena/RoundParticipationPolicy.ts) bildet den Teilnehmer-Snapshot einer laufenden Runde ab und ist nicht mit WorldParticipation zu vermischen:

- `participantIds` ist die unveränderliche Kohorte beim Rundenstart. Ein Late Joiner wird nur Spectator und nicht rückwirkend Teilnehmer dieser Runde.
- Ein aktiver Teilnehmer kann während derselben Runde nach `spectatorIds` wechseln; die historische Zugehörigkeit in `participantIds` bleibt erhalten.
- Spawn, Respawn, Reward und Ergebnisberechtigung verwenden die effektive aktuelle Rolle. Ein separates authored Respawn-Budget oder andere Eligibility-Regeln bleiben davon unabhängig.
- Die nächste Runde erzeugt einen neuen Teilnehmer-Snapshot. WorldParticipation beantwortet weiterhin die World-Aufnahme und ist kein Ersatz für diese Rundengrenze.

## Player-Runtime

[PlayerWorldRuntime.ts](../../src/world/PlayerWorldRuntime.ts) liefert eine gemeinsame Feature-Beschreibung für Entity, Combat, Ressourcen, Loadout, Targeting und World-scoped Player-Build. Autoritative Simulationsfeatures sind hostgebunden; ein Client darf keinen Serverzustand aus einer lokalen Visualisierung herstellen. Build- und Item-Modifikatoren können in einer Activity-losen World laufen, während Missionsstatus Activity-spezifisch bleibt.

Die Runtime kann ohne Renderer oder lokale Phaser-Szene existieren. PlayerBody ist der kanonische physische Körper; PlayerEntity kapselt ihn und die optionale Sprite-Präsentation. Attach- und Detach-Operationen sind atomar und müssen bei einem Fehler zurückrollen.

`WorldPlayerGameplayRuntime` besitzt den World-Lifetime der Player-Gameplay-Systeme und stellt nach außen nur benannte Lifecycle-, Action-, Read-, Resource- und Combat-Integration-Ports bereit. Activity-, Construction-, Support-, Host- und Client-Adapter konsumieren diese semantischen Sichten; sie traversieren weder den internen Child-Graphen noch greifen sie auf `.systems` zu. Die Runtime bleibt dabei ohne Renderer, ArenaContext und direkte NetworkBridge-Abhängigkeit.

Die Combat-Authority gehört zur laufenden World und wird über [WorldCombatRuntime](../../src/combat/WorldCombatRuntime.ts) gebunden. [WorldCombatCore](../../src/combat/WorldCombatCore.ts) stellt den autoritativen Resolution-/Mutation-Kern bereit; andere Gameplay-Owner erhalten nur die jeweils benötigten schmalen Ports. Immediate-Attacks verwenden den normalisierten `CombatImmediateAttackPort`, nicht optionale positional Legacy-Aufrufe.

## Primärtreffer und verzögerte Ressourcen

Primärtreffer transportieren einen expliziten neutralen [Reward-Intent](../../src/combat/PrimaryHitReward.ts). Gain-Basis, Erzeugerposition und Activity-/World-/Combat-Scope werden bei der Aktivierung erfasst und durch Salven, Ketten und Kinder erhalten; eine zugerechnete Reflection ersetzt die Erzeugerbasis. Nur bestätigter positiver HP-/Rüstungsschaden veröffentlicht ein Reward-Faktum. Herkunft darf weder aus Allegiance noch aus Darstellung nachträglich erraten werden.

[AdrenalineEssenceBinding](../../src/adrenalineEssence/AdrenalineEssenceBinding.ts) gehört in Matches zum Activity-Slot. Im ausdrücklich unterstützten Lobby-Testgelände gehört dasselbe Binding zur Lobby-World; sein `activityRevision: null` bezeichnet die tatsächlich fehlende Activity, ohne eine Runde oder Ersatz-Activity anzulegen. Andere Activity-lose Worlds erhalten dadurch keinen Reward-Owner. Combat besitzt keinen Essenz-State. Der Host reserviert und validiert Sammler; erst die Ankunft ruft den atomaren Commit eines bereits aufgelösten Gains beim [ResourceSystem](../../src/systems/ResourceSystem.ts) auf. Lifecycle-Abbrüche geben ausschließlich unbestätigten Wert zurück. Synchrone Resource-Observer können eine bereits geschriebene Gutschrift nicht rückgängig machen oder erneut verfügbar machen.

Bestätigte Combo-Detonationen sind eine zusätzliche Essenz-Quelle, unabhängig von Primärtreffern oder getroffenem Gegner. Der bestehende Essenz-Owner materialisiert die Belohnung am Detonationsort mit der Zugehörigkeit des Ballbesitzers und dedupliziert über Scope und Projektilidentität. Dessen Gewinnbasis wird bei der Detonation einmal aufgelöst; auch bei Aufnahme durch Verbündete wird erst bei Ankunft und ohne erneute Gewinnskalierung gutgeschrieben.

Resource-Replikation bleibt unabhängig von kosmetischen Receipts und Flügen; Clients visualisieren ausschließlich den bestätigten Zustand. Der jeweilige Owner-Detach entfernt Reservierungen, Replica und Presentation gemeinsam. Diese Grenzen sichern [Core-Tests](../../tests/AdrenalineEssenceRuntime.test.ts), [Binding-Integration](../../tests/integration/AdrenalineEssenceBinding.test.ts) und [Replication-Tests](../../tests/AdrenalineEssenceReplication.test.ts).

Die Aufteilung eines Reward-Faktums in mehrere Beiträge vervielfacht weder dessen Wertauflösung noch Treffer- und Attributionszähler. Jeder Beitrag behält bei Merge, Reservierung und gewöhnlicher Transferrückgabe seine Herkunft und Ablaufzeit. Abgeleitete Weltlichter konsumieren ausschließlich zugriffsgefilterte Darstellungspositionen; Zugriffsverlust und Owner-Detach entfernen auch ausblendende Lichtquellen sofort. Der Licht-Helper besitzt keine Gameplay-Authority. Dies sichern die [Fragmentierungsregressionen](../../tests/AdrenalineEssenceRuntime.test.ts) sowie [Licht-Lifetime-Tests](../../tests/AdrenalineEssenceLighting.test.ts).

Mini-Raketen transportieren bestehende Essenz: Der Essenz-Owner besitzt Reservierungen und Ladungen innerhalb seines Scopes; der Projektil-Owner liefert Flugphase, Position, Abschusskapazität und das einmalige Endereignis. Spieler und zurückkehrende Raketen teilen Magnetradius, Sichtlinienprüfung und Entfernungsauswahl. Ladung bleibt auch bei erneutem Angriff erhalten und verfällt an Bord nicht. Erst die gültige Rückkehr zum Besitzer schreibt den bereits aufgelösten Wert gut; Überschuss oder endgültiger Verlust legt ihn ohne neue Reward-Zählung und mit voller neuer Bodenlebensdauer am Endpunkt ab. Herkunft und Zugriffsgruppe bleiben erhalten. Scope-Teardown verwirft Ladungen gemeinsam mit der übrigen Essenz und erzeugt keine Drops in einer nachfolgenden Activity. Diese Grenzen sichern die [Runtime-Tests](../../tests/AdrenalineEssenceRuntime.test.ts), [Binding-Integration](../../tests/integration/AdrenalineEssenceBinding.test.ts) und [Projectile-Lifecycle-Tests](../../tests/ProjectileLifecycleAuthority.test.ts).

Die `CombatScope` eines Target-Owners ist keine gemeinsame globale Generation: `EnemyManager` und `DecoySystem` besitzen eigene Scope-/Instanzprüfungen. Reward-Projektion prüft den eingefrorenen Aktivierungs-Scope gegen den aktuellen World-Combat-Owner und die aktuelle Reward-Bindung; sie vergleicht ihn nicht mit der privaten Scope des bereits bestätigten Target-Outcomes. Die [Glock-Cutover-Integration](../../tests/integration/AdrenalineEssenceCombatCutover.test.ts) verwendet deshalb echte Target-Owner mit abweichenden Kennungen.

## Projectile-Runtime

[`WorldProjectileRuntime`](../../src/projectile/WorldProjectileRuntime.ts) ist die einzige
world-owned Projectile-Authority. Execution übergibt aufgelöste Spawn-Requests; externe Systeme
erhalten semantische Commands oder zweckgebundene Reads, keine Runtime-Records oder Physics-Handles.
Die private Registry beendet alle ihre Sichten vor terminalen Reactions. Bereits verbrauchte,
noch nicht freigegebene Projectiles sind für weitere externe Interaktionen nicht mehr aktiv.
Finalisierung verwendet eine feste Stage-Menge, damit reentrante Entfernung, Spawn und World-Teardown
keine fremde Identity aus der Verarbeitung entfernen. Die Contracts sichern
[`WorldProjectileRuntime.test.ts`](../../tests/WorldProjectileRuntime.test.ts) und die
[`Projectile-Architecture-Ratchets`](../../tests/architecture/ProjectileRuntimeContracts.test.ts).

Projectile-IDs bleiben innerhalb einer `worldRevision` einmalig, auch bei lokalem Runtime-Rebuild.
Reflection/Deflection ändern den bestehenden Record; Source, Attribution, Allegiance und Lineage
bleiben getrennte Dimensionen. Combat-, World- und Explosion-Ports lassen fremde Mutation bei ihren
Domain-Ownern. Replication, Client-Replica und Presentation sind abgeleitete World-Ressourcen ohne
Projectile-Gameplay-Authority.

`lineage.originTarget` bezeichnet mit `{ kind, id }` ein temporär ausgenommenes Ursprungsziel,
unabhängig von Waffe und Zielart. Nur dieses Ziel bleibt bis zum vollständigen Körperaustritt
kontaktgesperrt; fremde Hindernisse behalten ihre Wirkung. `contacts.originExited` wird erst nach
Figurenkontakten und World-Sweeps freigegeben, damit auch die Austrittsfläche im selben Schritt
geschützt bleibt. Basisursprünge nutzen zusätzlich die bestehende `sourceCarrierBaseId`-Geometrie.
Die Freigabe ist endgültig: Ein späterer Wiedereintritt darf treffen. Homing darf den Ursprung
bis zum Austritt nicht erfassen und kann ihn danach als Rückfallziel behandeln; die Lineage
erteilt selbst weder Zielberechtigung noch Schadens- oder Heilwirkung. Geprüft in
[`WorldProjectileRuntime.test.ts`](../../tests/WorldProjectileRuntime.test.ts) und
[`ProjectileCollisionSearch.test.ts`](../../tests/ProjectileCollisionSearch.test.ts).

Nicht-penetrierende Geschosse mit aktivem Zell-Sweep erhalten weder Arcade-Rock- noch Arcade-Base-Collider.
Auch die generische Combat-Zielaufloesung laesst diese Kontakte dem Runtime-Sweep.
BaseEntity-Zellkoerper (einschliesslich persistenter Basiszellen) sind im Index OBSTACLE_BASE,
nicht OBSTACLE_ROCK; beide nutzen dieselbe Kontaktgeometrie, behalten aber ihre Schadensidentitaet.
Der Runtime-Sweep besitzt fuer diese Kontakte Positionierung, Schaden und Reflexion;
Physics- und Overlap-Geschosse behalten ihre eigenen Kontaktwege.
Der Sweep beruecksichtigt die Ausdehnung des Projektilkoerpers auch bei der raeumlichen Vorauswahl
und trennt dessen Kontakt-Center vom Oberflaechenpunkt. Die Sweep-Normale folgt der zuerst betretenen Rechteckflaeche,
nicht einer benachbarten Kante oder einer Austrittsflaeche. Gemeinsame Wandkanten erzeugen keine
zusaetzliche Reflexionsachse. Dies prueft
[`ProjectilePhysicsBoundary.test.ts`](../../tests/ProjectilePhysicsBoundary.test.ts).

## Hindernisse, Schusslinien und Bauschutz

[`ObstacleRules`](../../src/systems/ObstacleRules.ts) trennt Hindernisklasse und Abfragezweck.
Objekte ohne feste Geometrie gehören zu `ground`, gebaute Mauern und normale Turmsockel zu
`low`, Basiszellen zu `high`, Naturfelsen, Stämme, aktive Missionssperren und Zug zu `veryHigh`.
Der bestehende `ArenaObstacleIndex` bleibt die einzige statische Geometrieprojektion.
Direktfeuer ignoriert niedrige Geometrie vor Kontaktgedächtnis, Schaden, Reflexion und Verbrauch;
Support darf berechtigte niedrige Ziele treffen. Physische Sicht-, Bewegungs-, Nahkampf-,
Wurf- und Landungsprüfungen übernehmen diese Durchlässigkeit nicht.

`sourceCarrierBaseId` bezeichnet ausschließlich den konkreten Abschussträger. Authored Türme
nutzen ihre `baseId`; persistente Dachtürme erhalten die Zuordnung beim Materialisieren ihrer
Base-Site. Die Bauzone allein erteilt keine Freigabe. Die Projectile-Runtime beendet ihre
hostseitige Freigabe beim ersten vollständigen Austritt des Körpers aus der anfänglich
zusammenhängend durchquerten Zellfläche, auch innerhalb eines Frames oder in eine Nische.
Für die persistente Basis umfasst die Freigabe stattdessen das umschließende Rechteck aller
vier Kernecken einschließlich der Zwischenräume, unabhängig von Erweiterungen der Bauzone.
Erst der vollständige Austritt aus dieser Grundfläche beendet sie; ein späterer Wiedereintritt
erteilt keine neue Freigabe. `WorldGeometryBinding` bindet diese Überflugfläche an die World,
und der gemeinsame Hindernisindex entfernt sie beim Abbau. Sie ersetzt keine Kollisionszellen.
Portaltransport und Reflexion beenden sie ebenfalls; Folgegeschosse erben sie nicht.
Basis-Rechtecke zur Vorauswahl ersetzen niemals die tatsächlichen Zellen als Treffergeometrie.

[`WorldObjectMutationRuntime`](../../src/world/WorldObjectMutationRuntime.ts) prüft eigene und
verbündete Bauwerke vor dem autoritativen HP-Abzug. Die Zugehörigkeitsentscheidung liegt im
`WorldCombatCore`; sie bleibt unabhängig von Teamschaden an Figuren und von physischer
Schussblockierung. Bereits erzeugte Angriffe und verzögerte Wirkungen erhalten ihre
`CombatSource` beziehungsweise `ProjectileProvenance` mit erfasster Zugehörigkeit, auch nach
Entfernung des Angreifers. Natur, Zug und neutrale Gefahren erhalten dadurch keinen Bauschutz;
Rückbau verwendet weiterhin den separaten Entfernungspfad. Diese Grenzen sichern die
[Geometrie-Tests](../../tests/CombatSystemLineOfFire.test.ts),
[Träger- und Kontakttests](../../tests/ProjectilePhysicsBoundary.test.ts) und die
[Mutation-Integration](../../tests/integration/WorldObjectMutationRuntime.test.ts).

Reaktive Map-Objekte (Fässer, Boviste, Strohkörbe) teilen den Hindernis-ID-Raum: authored Felsen belegen
`[0, R)`, reaktive Objekte `[R, R+P)`, Runtime-Placeables beginnen bei `R+P`
([`ReactivePropObstacleIds`](../../src/world/reactiveProps/ReactivePropObstacleIds.ts)). Sie stehen
weder in `layout.rocks` noch in `RockRegistry` oder `PlacementSystem`; Owner ist der World-scoped
[`ReactivePropRuntime`](../../src/world/reactiveProps/ReactivePropRuntime.ts), den der Mutationstrichter
als `reactive_prop` anspricht. Sie nehmen den vollen Treffer unabhängig vom `rockDamageMult` der
Waffe; jeder Schadenspfad auf Hindernisse (Radial, Hitscan, Melee, Projektil, Impuls) fragt dafür
`isFullDamageTarget`. `commitDamage` ändert nur Zustand, Entfernen und Folgewirkung laufen in
`hostAdvance` vor dem Explosions-Drain. Lade-Kinds (Riesenbovist, Strohkorb) verlassen den
Hindernisraum nie: Während Vorlauf und Aufladen antworten sie `immune` und melden sich immer
intakt, weil `inert` oder `destroyed` downstream „Ziel tot“ bedeuten. Ihre Folgewirkungen tragen
den erfassten Combat-Source des Auslösers, umgemarkt über `combatSourceForFollowUpEffect` auf den
Ursprung der Wirkung (`ground`, `direct`), ohne Waffenslot und ohne Teamschaden; die
Schadensauflösung verwirft sonst Schaden mit abweichendem Ursprung, oder Stiche zählten als
Primärwaffentreffer. Abgesichert in
[ReactivePropRuntime.test.ts](../../tests/ReactivePropRuntime.test.ts),
[ReactivePropCombat.test.ts](../../tests/integration/ReactivePropCombat.test.ts) und
[EnvironmentDamageResolver.test.ts](../../tests/EnvironmentDamageResolver.test.ts).

Zeitweise Turmsperren (etwa das Netz der Kabummtula) sind Activity-eigene Zustände, die über die
Turm-ID (`AutomatedTurretId`, numerisch für Bauwerke, Zeichenkette für Basistürme) adressiert
werden und nicht über Kollision. Das World-Turmfeuer liest sie nur an zwei Stellen:
`WorldCombatGameplayBinding.getTurretFireSources` setzt betroffene Quellen per `identityId` auf
`fireState: 'disabled'`, inklusive Feuerleit-Kopien und ohne Portal, und die Tesla-Quellenliste
lässt sie aus. `disabled` beendet eine eigene Salve und unterbindet Zielen und manuelles Feuer;
`paused` würde eine laufende Salve zu Ende schießen. Neue Sperren nutzen diesen Weg und verändern
keine Bauwerke. Abgesichert in [TurretFireSources.test.ts](../../tests/TurretFireSources.test.ts).

## Eingaben und Aktionen

Im Coop-Loadout ist `CoopDefenseUpgradeProfile.toolLoadout` die maßgebliche Utility-Auswahl für
alle Klassen. `LoadoutToolRef` unterscheidet die Ausführung normaler Utilities und Konstrukte;
die einzelnen Utility-Felder und Netzwerk-Toollisten werden daraus abgeleitet. Die Speichergrenze
in [localPreferences.ts](../../src/utils/localPreferences.ts) migriert alte Utility-Auswahlen einmalig.
Klassenfreigaben stehen als `availableClasses` am Upgrade-Freischaltknoten in
[coopDefenseUpgrades.json](../../src/config/coopDefenseUpgrades.json); ohne Liste gelten alle Klassen.
Folgeknoten erben Ausschlüsse über ihre Voraussetzungen. Bildschirmkategorien sind keine
Berechtigungsgrenze. Klassenfreigabe, investierte Freischaltung, Ausrüstung und Modusfreigabe
bleiben getrennte Prüfungen; für Konstrukte bündelt sie
[ConstructionAccessResolver.ts](../../src/systems/ConstructionAccessResolver.ts), auch für die
persistente Wiederherstellung. Der Vertrag wird einschließlich einer ausschließlich im Test
erweiterten Klassenfreigabe in
[SharedToolClassAvailability.test.ts](../../tests/integration/SharedToolClassAvailability.test.ts) geprüft.

World-scoped Aktionen werden an die aktuelle worldRevision gebunden und vor dem Handler zentral geprüft. Activity- oder Round-Aktionen erhalten zusätzlich die fachlich nötige Activity-/Round-Identität. Ein alter Client kann so weder nach einem World-Wechsel noch nach einem Activity-Wechsel veraltete Aktionen ausführen.

Temporäre Utilities sind keine Mutation des ausgerüsteten Utility-Slots. [TemporaryUtilityCollection.ts](../../src/loadout/TemporaryUtilityCollection.ts) besitzt hostseitig jede Aufnahme als eigene Instanz mit stabiler `instanceId`, Erwerbsreihenfolge, Charges und Cooldown. Auswahl, Use-RPC, Radialzustand und Objective-Placement referenzieren diese Instanzidentität; mehrere Instanzen desselben Utility-Typs bleiben deshalb unabhängig. Clients rekonstruieren daraus nur Präsentation und Auswahl und erzeugen weder beim Pickup-ACK noch beim lokalen Einsatz eigenen Bestand.

Die TimeBubble ergänzt eine spielerweite Einsatz-Lifetime in [PlayerUtilityActionRuntime.ts](../../src/world/PlayerUtilityActionRuntime.ts): ausgerüstete, temporäre und Inspector-Quellen teilen die Sperre vom Wurf bis zum Ende des anschließenden Cooldowns. Ein aktiver Einsatz bleibt über seinen replizierten Zustand bedienbar, auch wenn seine letzte temporäre Ladung bereits verbraucht ist; der Radial-Eintrag rekonstruiert dabei keinen Bestand. Die Bedienungszuordnung folgt dem ursprünglichen Werfer (`gameplaySourceId`), unabhängig von einer später übertragenen Projektil-Trefferzurechnung.

Ein Projectile-`resolved`-Outcome mit `grenadePayloadPending` bestätigt das Entfernen des Flugkörpers, während dessen vorbereitete Wirkung noch im nachgelagerten Host-Schritt aussteht. Ability-Lifetimes dürfen diesen Übergang nicht als fehlgeschlagene Wirkung abschließen. Der reale Übergang ist in [TimeBubbleLifecycle.test.ts](../../tests/integration/TimeBubbleLifecycle.test.ts) abgesichert.

Für ein neues Eingabefeld oder eine neue Aktion zuerst festlegen:

- Welcher Capability-Bereich ist betroffen?
- Ist es World-, Activity-, Round- oder rein lokale Interaktion?
- Welcher Host-Handler validiert sie?
- Welche replizierte Bestätigung verändert die sichtbare Darstellung?

## Fachliche Zeit

Aktivitäts- und Rundensysteme arbeiten mit ihrer definierten Simulationszeit und replizierten Zuständen. Wellen, Gegner, Events und Ziele dürfen für fachliche Entscheidungen nicht von lokaler Wanduhr oder Date.now abhängen. Die Darstellung darf interpolieren, bleibt aber gegenüber Host-Zustand und Revisionen nachgeordnet.

## Verifikation und Einstiegspunkte

- [src/world/PlayerCapabilities.ts](../../src/world/PlayerCapabilities.ts)
- [src/world/InputPolicy.ts](../../src/world/InputPolicy.ts)
- [src/world/PlayerWorldRuntime.ts](../../src/world/PlayerWorldRuntime.ts)
- [tests/PlayerCapabilityContracts.test.ts](../../tests/PlayerCapabilityContracts.test.ts)
- [tests/PlayerWorldRuntimeContracts.test.ts](../../tests/PlayerWorldRuntimeContracts.test.ts)
- [tests/integration/SharedWorldWithoutActivity.test.ts](../../tests/integration/SharedWorldWithoutActivity.test.ts)
- [tests/TemporaryUtilityLifecycle.test.ts](../../tests/TemporaryUtilityLifecycle.test.ts)
- [tests/RadialActionInput.test.ts](../../tests/RadialActionInput.test.ts)
