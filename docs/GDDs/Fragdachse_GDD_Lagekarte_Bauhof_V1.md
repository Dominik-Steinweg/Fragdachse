# Lagekarte im Bauhof (V1)

Status: ersetzt durch [V2](Fragdachse_GDD_Lagekarte_Bauhof_V2.md) (2026-10-27). Konzept vom 2026-10-22. Grundlage ist die
[Gameplay-Analyse vom 22.10.2026](../reports/gameplay-review-2026-10-22-inspector-td.md), Vorschlag V1.
Die Entscheidungen hat der Projektinhaber am selben Tag getroffen.

## 1. Anlass

Für Tower-Defense-Spieler, vor allem den Inspector Gadachs, findet die Planung **zwischen den Runden**
statt; in der Runde überwiegt die Action. Geplant wird die persistente Basis im Bauhof. Der Bauhof zeigt
heute aber eine leere Fläche aus der Lobby, nicht die nächste Mission. Gleichzeitig wechseln die
Angriffsrichtungen von Map zu Map stark. Auf Map 18 kommen die Gegner hauptsächlich von Westen, auf
Map 19 hauptsächlich von Osten. Eine Basis, die für die eine Map gebaut ist, steht auf der anderen
falsch herum.

Zwei weitere Lücken:

- **Nur der Host kann den Bauhof öffnen.** `lobbyMenuDenialCode` lehnt `base` für Gäste ab, und
  `openBaseEditor` prüft `bridge.isHost()`. Gäste bringen ihren Beitrag zwar in jeden Raum mit, können ihn
  dort aber weder sehen noch anpassen.
- **Der Bauhof zeigt nur den eigenen Beitrag.** In der Mission führt der Host die Beiträge aller
  anwesenden Spieler zu einer Basis zusammen und sortiert Kollisionen aus
  ([`PersistentBaseComposite.ts`](../../src/persistentBase/PersistentBaseComposite.ts)). Das sieht man beim
  Planen nicht.

## 2. Ziele und Nicht-Ziele

**Ziele**
- Im Bauhof die vom Host gewählte Map um die Basis zeigen: Gelände, Angriffsrichtungen und Laufwege.
- Die Basis bleibt **ein** globaler Grundriss, der mit der Progression wächst. Vor einer Map wird er
  angepasst, nicht neu geplant.
- Alle Spieler eines Raums planen ihren eigenen Teil und sehen dabei die Teile der Mitspieler.

**Nicht-Ziele**
- Keine Änderung an der Lobby-World, auch keine Markierungen dort. Schießstand, Werkstatt, Bauhof,
  Ausrüstung und Schrotthändler bleiben, wie sie sind.
- Kein zusätzlicher Platz auf den Maps. Reservierung (`resolvePersistentBaseReservationRadiusCells`) und
  Bauradius der Ausbaustufen bleiben unverändert.
- Keine Grundrisse pro Map und keine automatischen Vorschläge für die Aufstellung.
- Keine Angaben zur Stärke der Bedrohung, zu Gegnertypen oder zum Zeitplan der Wellen.
- Laufwege zeigen nur den Zustand beim Missionsstart.
- Am Ablauf in der Mission ändert sich nichts.

## 3. Entscheidungen (2026-10-22)

| # | Entscheidung |
|---|---|
| E1 | Die Lagekarte liegt **im Bauhof-Editor**. Die Lobby-World bleibt die Lobby; eine Vorschau in ihr wurde verworfen. Grund: Ein Weltwechsel pro Map-Auswahl müsste bei allen Spielern neu laden, und die Lobby-Gebäude bräuchten auf jeder Map einen Platz. |
| E2 | Gezeigt wird die **vom Host gewählte Coop-Map** (`bridge.getCoopDefenseMapId()`). Wechselt der Host die Map, lädt die Lagekarte neu; der Entwurf bleibt erhalten. |
| E3 | Ansicht: **Detailbereich plus Miniübersicht**. Der Detailbereich zeigt die Basis und das Gelände bis etwa zur größten Turmreichweite (rund 20 Zellen um den Anker). Die Miniübersicht zeigt die ganze Map mit Basis, genutzten Spawnzonen und dem Rahmen des Detailbereichs. |
| E4 | Bedrohung: **nur Richtungen**. Jede genutzte Spawnzone erscheint als gleich starker Pfeil oder Marker, ohne Stärke, ohne Gegnersymbole und ohne Zeitangabe. |
| E5 | **Volle Laufwege** von jeder genutzten Spawnzone bis zur Basis. Sie werden nach jedem Umsetzen und Drehen neu berechnet und gelten für den Zustand beim Missionsstart. |
| E6 | **Mitspieler als Schatten:** Die Bauwerke der anderen Spieler im Raum erscheinen halbtransparent und lassen sich nicht bearbeiten. |
| E7 | **Ein globaler Grundriss.** Einzelnes Umsetzen bleibt wie heute. |
| E8 | **„Drehen 90°“** dreht alle eigenen Objekte im Uhrzeigersinn um den Anker. Es gibt keinen Vorschlag; der Spieler entscheidet. Spiegeln gibt es nicht. |
| E9 | **Gäste bearbeiten ihren eigenen Teil.** Der Host prüft jede Änderung und übernimmt sie. Belohnungsplätze (Podeste) gehören weiterhin dem Host. |
| E10 | **Konflikte sind sichtbar.** Ein Objekt, das der Host auf dieser Map aussortieren würde, wird markiert und nennt den Grund. Gründe sind Gelände, Mitspieler, Kapazität oder „außerhalb des Baubereichs“. |
| E11 | **Reichweitenringe** der eigenen Türme können über dem Gelände eingeblendet werden. |
| E12 | Für Maps ohne persistente Basis (01, 07, 09) zeigt der Bauhof einen Hinweis statt einer Lagekarte. |
| E13 | **Der Einsatz-Seed wird schon in der Lobby festgelegt.** Der Host bestimmt ihn mit der Map-Wahl und repliziert ihn; die Runde nutzt genau diesen Seed. Die Lagekarte zeigt damit das echte Gelände der nächsten Runde. Nach jeder Runde und bei jedem Map-Wechsel gibt es einen neuen Seed, die Abwechslung zwischen Runden bleibt also. |

## 4. Ablauf für den Spieler

1. Der Host wählt eine Map, zum Beispiel Map 19.
2. Ein Spieler, Host oder Gast, öffnet den Bauhof. Sein Bereit-Status wird wie heute zurückgesetzt.
3. Die Lagekarte zeigt rund um die Basis Felsen, Bäume, Wasser und Gleise von Map 19. Pfeile zeigen, aus
   welchen Richtungen Gegner kommen. Linien zeigen ihre Hauptrouten bis zur Basis. Die Bauwerke der
   Mitspieler sind als Schatten zu sehen.
4. Der Spieler stellt fest, dass seine Raketentürme nach Westen stehen, die Routen aber von Osten kommen.
   Zweimal „Drehen 90°“, dann zwei Barrieren umsetzen: Die Routen laufen jetzt durch die Reichweitenringe.
5. Ein Turm ist rot markiert: „Entfällt auf dieser Map: Kollision mit Bauwerk von Spieler B“. Der Spieler
   setzt ihn um.
6. Er übernimmt die Änderung. Der Host prüft sie, und der neue Grundriss gilt global für alle weiteren Maps.

## 5. Darstellung

Die Darstellung folgt [`visual-guidelines.md`](../ai/visual-guidelines.md): orthografische Top-down-Sicht,
klare Lesbarkeit.

- **Bezugsrahmen:** Die Karte wird in die Sicht der Basis gedreht. Eine Map mit gedrehtem Kern wie Map 16
  (`open-right`) wird um die Gegenrichtung gedreht, damit eine Stelle im Grundriss auf jeder Map dieselbe
  Richtung meint.
- **Detailbereich:**
  - Map-Gelände ohne Simulation. Gegner, Spieler, Wetter und Tageszeitwechsel gibt es dort nicht.
  - Der Baubereich ist klar abgegrenzt.
  - Spawnzonen im Bild erscheinen als Markierung; Zonen außerhalb als Pfeil am Rand des Detailbereichs.
- **Laufwege:**
  - Eine ruhige, einheitliche Linie pro Spawnzone mit Fließrichtung zur Basis.
  - Überlagern sich mehrere Routen, wird die Linie dicker. Das ist eine Folge der Geometrie, keine Angabe
    zur Bedrohung.
  - Gibt es keinen freien Weg, erscheint am Basisrand die Warnung „Kein freier Weg – Gegner brechen durch“.
- **Schatten:** Mitspieler-Bauwerke halbtransparent, ohne Interaktion, mit Spielerfarbe als Kontur.
- **Konflikte:** rote Kontur am Objekt und ein kurzer Grund in der Liste rechts.
- **Reichweitenringe:** ein Schalter für alle eigenen Türme. Das ausgewählte Objekt zeigt seinen Ring
  immer.
- **Miniübersicht:** ganze Map mit Basis, Spawnzonen und dem Rahmen des Detailbereichs; ohne Routen.

## 6. Regeln

### 6.0 Einsatz-Seed
- **Ist-Stand:** Das Gelände der Kampagnen-Maps wird bei jedem Rundenstart mit einem neuen Seed erzeugt.
  Der Host setzt ihn heute in `ArenaLifecycleCoordinator` erst beim Start:
  `const seed = this.nextScenarioSeed ?? Date.now()`.
  - Fest vorgegeben sind Spawnzonen, Basisanker, Wasser, Felsfeld-Korridore und ähnliche Elemente.
  - Felsen und Bäume werden pro Runde gestreut. Auf den Maps 10–19 liegt `rockFillRatio` zwischen 0,08
    und 0,4, auf den Maps 13, 14 und 16 kommt ein Felsfeld mit wandernden Gängen dazu.
  - Ohne festen Seed wären Gelände und Hauptrouten in der Lobby nicht bekannt.
- **Neu:**
  - Der Host würfelt den Einsatz-Seed, wenn ein Raum entsteht, wenn er die Map wechselt und wenn das Team
    nach einer Runde in die Lobby zurückkehrt.
  - Der Seed wird zusammen mit der Map-ID über die Lobby-Synchronisation (`KEY_LOBBY_SYNC`) veröffentlicht.
  - Der Rundenstart verwendet ihn statt `Date.now()`. Ein Szenario-Seed (`setNextScenarioSeed`) hat
    weiterhin Vorrang.
- **Gleiche Erzeugung:** Die Lagekarte erzeugt das Layout mit demselben Generator und denselben Eingaben
  wie der Rundenstart: Map-Config, Seed und World-Parameter. Die Erzeugung ist schon heute bei Host und
  Clients identisch, deshalb kann jeder Client das Gelände lokal erzeugen.
- **Caching:** Das Layout wird je Map und Seed einmal im Hintergrund erzeugt und zwischengespeichert,
  nicht bei jedem Öffnen des Bauhofs.
- **Dawn:** Die Dawn-Pläne werden ebenfalls aus dem Seed erzeugt (`composeHostDawnRoundPlans(seed)`). V1
  übernimmt den Lobby-Seed auch für Dawn, damit es nur einen Seed-Pfad gibt. Eine Lagekarte für Dawn ist
  ein offener Punkt (Abschnitt 11).

### 6.1 Map-Quelle und Baubereich
- Die Lagekarte liest die World-Definition der gewählten Map und nur deren authored Daten. Das gestreute
  Gelände kommt aus dem Einsatz-Seed (6.0).
- Spawnzonen kommen aus `WorldDefinition.spawnZones`. Gezeigt werden nur Zonen, die die Activity
  dieser Map benutzt: Encounter-Gruppen, Dauerquellen und der Boss.
- Der Baubereich ist der, den die Mission einfrieren würde:
  `resolveFrozenPersistentBaseAreaStage({ personalStage, siteMaxAreaStage })`. Objekte aus einer Dawn-Ausbaustufe,
  die auf der Map keinen Platz haben, erscheinen als Konflikt „außerhalb des Baubereichs“.

### 6.2 Konflikte
- Konflikte berechnet **dasselbe Zusammenführen** wie die Mission (`PersistentBaseComposite`). Eingaben
  sind die blockierten Zellen der Map, die Beiträge der Mitspieler und der eigene Entwurf.
- Die Lagekarte führt keine eigene Konfliktregel ein. Was sie anzeigt, ist genau das, was der Host beim
  Rundenstart tun würde.

### 6.3 Laufwege
- **Grundlage:** Laufwege nutzen die bestehende Flowfield-Berechnung
  ([`FlowFieldEngine`](../../src/systems/flowfield/FlowFieldEngine.ts) über `FlowFieldCoordinator`). Sie
  läuft bereits außerhalb von Missionen, etwa für den Schießstand
  ([`ArenaWorldGameplayComposition.ts`](../../src/scenes/arena/ArenaWorldGameplayComposition.ts)).
- **Topologie:** Map-Geometrie beim Missionsstart (Barrieren, Brücken und Portale im Anfangszustand), dazu
  die zusammengeführte Basis aus Mitspieler-Schatten und eigenem Entwurf.
- **Ziel:** die Basisziele wie in der Mission (`FlowFieldSources`). Die Route wird von jeder genutzten
  Spawnzone entlang des Feldes bis zur Basis nachgezeichnet.
- **Körperprofil:** V1 zeigt nur den gewöhnlichen Bodenkörper. Amphibische Routen sind offen (Abschnitt 11).
- **Neuberechnung:** gebündelt nach dem Loslassen eines Objekts und nach „Drehen“, nicht während des
  Ziehens.
- **Kennzeichnung:** Die Linie heißt in der UI „Hauptroute“. In der Mission bewegen sich Gegner über die
  feinere, körpergerechte Navigation; Gedränge, Ausweichen, Spezialbewegung und Durchbruch können
  abweichen.

### 6.4 Drehen 90°
- Dreht alle Konstruktionen des eigenen Beitrags im Uhrzeigersinn um den Anker. Beim Host gehören auch
  seine Belohnungsplätze dazu.
- Der Kern (7×7, vier Eingänge) und jeder Baubereich sind unter Vierteldrehungen deckungsgleich
  ([`PersistentBaseCore.ts`](../../src/persistentBase/PersistentBaseCore.ts)). Gedrehte Objekte bleiben
  deshalb immer innerhalb des Baubereichs.
- Mehrzellige Grundflächen (2×2) werden mit der vorhandenen Drehlogik gedreht, die auch die Ausrichtung
  der Map verwendet (`PersistentBasePlacementRules`). Danach wird die Ecke oben links neu bestimmt.
- Die Startausrichtung (`angle`) von Türmen dreht um 90° mit.
- Kollisionen mit Mitspieler-Schatten blockieren das Drehen nicht. Sie erscheinen als Konflikt.
- Gedreht wird der Entwurf. Erst „Übernehmen“ schickt die Änderung an den Host.

### 6.5 Gäste
- Gäste dürfen den Bauhof öffnen. Sie bearbeiten nur Konstruktionen ihres eigenen Beitrags; Belohnungen
  zeigen sie nur an.
- Gespeichert wird über die vorhandene Host-RPC `pble`
  (`NetworkBridge.sendPersistentBaseLayoutEdit`). Die Host-Seite
  (`ArenaPersistentBaseSession.editPersonalLayout`) arbeitet bereits mit der Spieler-ID des Aufrufers und
  prüft Phase, Bereit-Status, World-Revision und Beitrags-Revision.
- Ein Gast speichert das bestätigte Ergebnis lokal als seinen persönlichen Beitrag, so wie der Host
  heute.
- Gleichzeitige Bearbeitung: Die Schatten zeigen den zuletzt übernommenen Stand der anderen. Ein
  veralteter Entwurf scheitert wie heute mit `stale` und wird mit dem neuen Stand neu geladen.

## 7. Architektur und Ownership

Geprüft gegen das [Architektur-Leitbild](../ai/architecture-principles.md):

| Thema | Owner und Grenze |
|---|---|
| Lagekarte | Lokale Präsentation in der Editor-Scene ([`PersistentBaseEditorScene.ts`](../../src/scenes/PersistentBaseEditorScene.ts)) über einer lokalen, nicht teilnehmenden World ([`PersistentBaseEditorWorld.ts`](../../src/persistentBase/PersistentBaseEditorWorld.ts)). Keine Activity, keine Participation, keine Netzwerkidentität. |
| Richtungen | Reine Funktion aus authored Map-Daten: Spawnzonen und deren Nutzung durch die Activity. Liegt bei den Coop-Map-Daten oder der persistenten Basis, nicht in der Scene. |
| Laufwege | Wiederverwendung der Flowfield-Berechnung. Keine neue Navigation und kein zweites Wegmodell. |
| Konflikte | `PersistentBaseComposite` bleibt die einzige Regel. |
| Autorität | Unverändert: Der Host prüft beim Speichern (`pble`) und beim Rundenstart. Die Lagekarte ist kein Beweis für eine erlaubte Aufstellung. |
| Seed | Der Host besitzt den Einsatz-Seed. Er gehört zum Lobby-Zustand wie die Map-ID und gilt für genau eine Runde. Erst der Rundenstart friert ihn in die World ein. |
| Wire | Keine neue Nachricht, aber zwei Vertragsänderungen. Erstens bekommt die Lobby-Synchronisation (`KEY_LOBBY_SYNC`) ein Feld für den Seed; das ist eine Änderung am Drahtformat, `PEER_PROTOCOL_VERSION` wird also erhöht. Zweitens ändert sich bei `pble` die Bedeutung: `applyPersistentBaseLayoutEdit` akzeptiert künftig geänderte `angle`-Werte, nötig für „Drehen“. Ein alter Host würde gedrehte Entwürfe als `invalid` ablehnen. |
| Map-Authoring | Unverändert. Keine neuen Felder, keine neue Reservierung. |

## 8. Umsetzungspakete

Jedes Paket hat für sich einen Nutzen und kann einzeln abgenommen werden.

| Paket | Inhalt | Abnahme |
|---|---|---|
| L0 Einsatz-Seed | Seed bei Raumstart, Map-Wechsel und Lobby-Rückkehr würfeln, über `KEY_LOBBY_SYNC` veröffentlichen, beim Rundenstart verwenden | Das in der Lobby erzeugte Layout hat denselben Layout-Fingerprint wie die gestartete Runde; ein Map-Wechsel und die Rückkehr nach einer Runde ergeben einen neuen Seed; Szenario-Seeds funktionieren unverändert. |
| L1 Gäste im Bauhof | UI-Sperre für Gäste aufheben, Speicherpfad für Gäste, Belohnungsliste nur lesbar | Ein Gast setzt einen Turm um und übernimmt; der Host sieht die Änderung in der Lobby-World; ein veralteter Entwurf meldet `stale`. |
| L2 Drehen 90° | Modell-Operation, Drehung von Grundfläche und `angle`, erweiterte Edit-Prüfung | Viermal Drehen ergibt den Ausgangsstand; kein gedrehtes Objekt liegt außerhalb des Baubereichs; der 2×2-Wachturm dreht korrekt. |
| L3 Gelände und Konflikte | Editor-World aus der World-Definition der Map (Ausschnitt), Miniübersicht, Ausrichtung der Map, Konflikte über `PersistentBaseComposite`, Mitspieler-Schatten, Reichweitenringe | Die Maps 10–20 zeigen ihr Gelände in der Sicht der Basis; Map 16 ist korrekt gedreht; ein absichtlicher Felskonflikt wird mit Grund angezeigt. |
| L4 Richtungen | Pfeile und Zonenmarker aus den genutzten Spawnzonen | Map 18 und Map 19 zeigen gespiegelte Hauptrichtungen; ungenutzte Zonen fehlen. |
| L5 Hauptrouten | Flowfield im Editor, Nachzeichnen, gebündelte Neuberechnung, Warnung „Kein freier Weg“ | Eine verschobene Barriere verlagert die Route sichtbar; eine vollständige Abriegelung zeigt die Warnung. |

Empfohlene Reihenfolge: L1 und L2 (klein, sofort nützlich), dann L0, das L3 und L5 voraussetzen, danach
L3, L4 und L5.

## 9. Prüfung

Nach [`testing.md`](../ai/testing.md), verhältnismäßig:
- Reine Funktionen bekommen Tests für dauerhafte Eigenschaften:
  - Richtungsermittlung: nur genutzte Zonen, Drehung in die Sicht der Basis;
  - Drehen: geschlossen nach vier Schritten, bleibt im Baubereich, korrekte Grundfläche.
- Die Edit-Prüfung bekommt Fälle für Drehung und für Gäste. Vorhandene Tests der persistenten Basis
  werden erweitert, etwa
  [`PersistentBaseManagementAllClasses.test.ts`](../../tests/integration/PersistentBaseManagementAllClasses.test.ts).
- Laufwege: ein kleines Fixture, in dem eine Barriere die Route nachweislich umlenkt.
- Einsatz-Seed: ein Vertragstest, dass Lobby-Vorschau und Rundenstart mit gleichem Seed dasselbe Layout
  erzeugen, gleicher Fingerprint. Dazu passt
  [`WorldRoundLoadingContracts.test.ts`](../../tests/WorldRoundLoadingContracts.test.ts).
- Sichtbare Änderungen: `npm run build`. Netzwerk und Lifecycle: `npm run check`.

## 10. Risiken

- **Erzeugung in der Lobby kostet Zeit:** Der Generator ist teuer; der Rundenstart verschiebt ihn bewusst
  hinter einen Ladebildschirm. In der Lobby läuft er deshalb verzögert und zwischengespeichert. Bis er
  fertig ist, zeigt der Bauhof die festen Elemente und den Hinweis „Gelände wird erkundet …“.
- **Große Maps:** Map 16 hat 264×150 Zellen. Der Editor baut nur den Detailausschnitt in voller
  Darstellung. Die Miniübersicht ist eine vereinfachte, einmal erzeugte Textur.
- **Route und Mission weichen ab**, besonders bei Gedränge und Durchbruch. Die Kennzeichnung als
  Hauptroute und Spieltests mit Map 18/19 sollen zeigen, ob die Linie genug Vertrauen schafft.
- **Map-Wechsel durch den Host bei offenem Editor:** neu laden, ohne Entwurf und Auswahl zu verlieren.
- **Gleichzeitige Bearbeitung durch mehrere Spieler:** wird über den vorhandenen Revisionsvergleich
  abgefangen; die Schatten müssen nach jedem Speichern eines Mitspielers aktualisiert werden.

## 11. Offene Punkte

- Woher die Schatten kommen: aus den in der Lobby-World replizierten Bauwerken anderer Besitzer oder aus
  einem eigenen Beitragsabzug vom Host. Wird in L3 geprüft; bevorzugt ohne neue Replikation.
- Lagekarte für Dawn: Arena und Angriffsseiten kommen aus den Dawn-Plänen desselben Seeds, hängen aber
  auch vom Fortschritt ab.
- Routen für amphibische Gegner auf Maps mit Wasser-Spawnzonen (z. B. 16, 20).
- Ob bewegliche Bauwerke (Persistente Basis Phase 3F) in der Route berücksichtigt werden.
- Farben und Linienstil der Routen nach einer Sichtprüfung.

## 12. Entscheidungslog

- 2026-10-22: Vorschau in der Lobby-World verworfen, Lagekarte im Bauhof (E1). Keine Markierungen in
  der Lobby-World.
- 2026-10-22: Keine Grundrisse pro Map; nur Einzelumsetzen und „Drehen 90°“ ohne Vorschlag (E7, E8).
- 2026-10-22: Reservierung und Bauradius unverändert (Nicht-Ziel).
- 2026-10-22: Detail plus Miniübersicht, nur Richtungen, volle Routen im Startzustand, Mitspieler als
  Schatten, Gäste bearbeiten ihren Teil (E3–E6, E9).
- 2026-10-22: Einsatz-Seed in der Lobby statt beim Rundenstart, damit die Lagekarte das echte Gelände
  zeigt (E13). Verworfen: nur feste Elemente zeigen (Routen zu ungenau) und ein fester Seed pro Map
  (keine Abwechslung mehr).
