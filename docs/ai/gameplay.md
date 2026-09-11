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

## World, Activity und Runde

World-Zustand umfasst dauerhafte Geometrie, Basen, World-Sites, World-Identität und WorldParticipation. Activity- und Round-Zustand umfasst Ziele, Timer, Gegner, Wellen, Missionsprogress, Respawns, Events und Ergebnis. Eine World ohne Activity ist ein gültiger Betriebszustand; ein Activity-Start darf World-Geometrie oder World-Identity nicht heimlich neu erzeugen.

World Loading ist an worldRevision gebunden. Round Loading wartet auf die World-Readiness und die für den Aktivitätsstart nötigen Teilnehmer, bleibt aber ein eigener Vertrag. Siehe [WorldLoadReady.ts](../../src/world/WorldLoadReady.ts) und [WorldRoundLoadingContracts.test.ts](../../tests/WorldRoundLoadingContracts.test.ts).

## RoundParticipation bleibt separat

[RoundParticipationPolicy.ts](../../src/scenes/arena/RoundParticipationPolicy.ts) bildet den Teilnehmer-Snapshot einer laufenden Runde ab und ist nicht mit WorldParticipation zu vermischen:

- `participantIds` ist die unveränderliche Kohorte beim Rundenstart. Ein Late Joiner wird nur Spectator und nicht rückwirkend Teilnehmer dieser Runde.
- Ein aktiver Teilnehmer kann während derselben Runde nach `spectatorIds` wechseln; die historische Zugehörigkeit in `participantIds` bleibt erhalten.
- Spawn, Respawn, Reward und Ergebnisberechtigung verwenden die effektive aktuelle Rolle. Ein separates authored Respawn-Budget oder andere Eligibility-Regeln bleiben davon unabhängig.
- Die nächste Runde erzeugt einen neuen Teilnehmer-Snapshot. WorldParticipation beantwortet weiterhin die World-Aufnahme und ist kein Ersatz für diese Rundengrenze.

## Player-Runtime

[PlayerWorldRuntime.ts](../../src/world/PlayerWorldRuntime.ts) liefert eine gemeinsame Feature-Beschreibung für Entity, Navigation, Combat, Ressourcen, Loadout, Targeting, World-scoped Player-Build und Missionsstatus. Autoritative Simulationsfeatures sind hostgebunden; ein Client darf keinen Serverzustand aus einer lokalen Visualisierung herstellen. Build- und Item-Modifikatoren können in einer Activity-losen World laufen, während Missionsstatus Activity-spezifisch bleibt.

Die Runtime kann ohne Renderer oder lokale Phaser-Szene existieren. PlayerBody ist der kanonische physische Körper; PlayerEntity kapselt ihn und die optionale Sprite-Präsentation. Attach- und Detach-Operationen sind atomar und müssen bei einem Fehler zurückrollen.

`WorldPlayerGameplayRuntime` besitzt den World-Lifetime der Player-Gameplay-Systeme und stellt nach außen nur benannte Lifecycle-, Action-, Read-, Resource- und Combat-Integration-Ports bereit. Activity-, Construction-, Support-, Host- und Client-Adapter konsumieren diese semantischen Sichten; sie traversieren weder den internen Child-Graphen noch greifen sie auf `.systems` zu. Die Runtime bleibt dabei ohne Renderer, ArenaContext und direkte NetworkBridge-Abhängigkeit.

Die Combat-Authority gehört zur laufenden World und wird über [WorldCombatRuntime](../../src/combat/WorldCombatRuntime.ts) gebunden. [WorldCombatCore](../../src/combat/WorldCombatCore.ts) stellt den autoritativen Resolution-/Mutation-Kern bereit; andere Gameplay-Owner erhalten nur die jeweils benötigten schmalen Ports. Immediate-Attacks verwenden den normalisierten `CombatImmediateAttackPort`, nicht optionale positional Legacy-Aufrufe.

## Primärtreffer und verzögerte Ressourcen

Primärtreffer transportieren einen expliziten neutralen [Reward-Intent](../../src/combat/PrimaryHitReward.ts). Gain-Basis, Erzeugerposition und Activity-/World-/Combat-Scope werden bei der Aktivierung erfasst und durch Salven, Ketten und Kinder erhalten; eine zugerechnete Reflection ersetzt die Erzeugerbasis. Nur bestätigter positiver HP-/Rüstungsschaden veröffentlicht ein Reward-Faktum. Herkunft darf weder aus Allegiance noch aus Darstellung nachträglich erraten werden.

[AdrenalineEssenceBinding](../../src/adrenalineEssence/AdrenalineEssenceBinding.ts) gehört in Matches zum Activity-Slot. Im ausdrücklich unterstützten Lobby-Testgelände gehört dasselbe Binding zur Lobby-World; sein `activityRevision: null` bezeichnet die tatsächlich fehlende Activity, ohne eine Runde oder Ersatz-Activity anzulegen. Andere Activity-lose Worlds erhalten dadurch keinen Reward-Owner. Combat besitzt keinen Essenz-State. Der Host reserviert und validiert Sammler; erst die Ankunft ruft den atomaren Commit eines bereits aufgelösten Gains beim [ResourceSystem](../../src/systems/ResourceSystem.ts) auf. Lifecycle-Abbrüche geben ausschließlich unbestätigten Wert zurück. Synchrone Resource-Observer können eine bereits geschriebene Gutschrift nicht rückgängig machen oder erneut verfügbar machen.

Resource-Replikation bleibt unabhängig von kosmetischen Receipts und Flügen; Clients visualisieren ausschließlich den bestätigten Zustand. Der jeweilige Owner-Detach entfernt Reservierungen, Replica und Presentation gemeinsam. Diese Grenzen sichern [Core-Tests](../../tests/AdrenalineEssenceRuntime.test.ts), [Binding-Integration](../../tests/integration/AdrenalineEssenceBinding.test.ts) und [Replication-Tests](../../tests/AdrenalineEssenceReplication.test.ts).

Die Aufteilung eines Reward-Faktums in mehrere Beiträge vervielfacht weder dessen Wertauflösung noch Treffer- und Attributionszähler. Jeder Beitrag behält bei Merge, Reservierung und Rückgabe seine Herkunft und Ablaufzeit. Abgeleitete Weltlichter konsumieren ausschließlich zugriffsgefilterte Darstellungspositionen; Zugriffsverlust und Owner-Detach entfernen auch ausblendende Lichtquellen sofort. Der Licht-Helper besitzt keine Gameplay-Authority. Dies sichern die [Fragmentierungsregressionen](../../tests/AdrenalineEssenceRuntime.test.ts) sowie [Licht-Lifetime-Tests](../../tests/AdrenalineEssenceLighting.test.ts).

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
