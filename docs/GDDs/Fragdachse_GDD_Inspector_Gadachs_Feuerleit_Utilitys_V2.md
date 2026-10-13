# Fragdachse Inspector Gadachs Feuerleit Utilitys GDD V2

**Version:** 2.0

**Stand:** 13. Oktober 2026

**Klasse:** Inspector Gadachs

**Geltungsbereich:** Gameplay, Progression, Mehrspieler und Darstellung für Coop-Defense

**Status:** Umsetzungsgrundlage für den Branch `fire-control`. V2 ersetzt V1. Sie übernimmt die
User-Entscheidungen vom 13.10.2026 und die Design-Defaults des Umsetzungsplans. Defaults sind im
[Entscheidungslog](#9-entscheidungslog) markiert und an jedem Meilenstein-Gate (G0–G3) kippbar. Alle
Zahlen sind Startwerte, stehen später in authored JSON und sind tunebar. Die Regeln beschreiben
Soll-Verhalten. Was bereits umgesetzt ist, steht im Gate-Bericht `build/fire-control/GATE-Gx.md`.

Inspector Gadachs erhält zwei Utilities, mit denen seine gebauten Türme entfernte Kämpfe unterstützen:

- **Turmkopien** (V1: „Feuerleit-Relais“): Der Spieler platziert per Maus temporäre Projektionen
  eigener Türme.
- **Portale** (V1: „Feuerleitgranate“): Ein geworfenes Gerät öffnet einen festen Ausgang. Vor dem Rohr
  jedes aktiven eigenen Turms entsteht ein Mündungsportal, durch das der Turm feuert.

Dazu kommt eine allgemeine Regel: **Spielereigene Türme greifen im Coop-Defense feindliche Basen
selbstständig an**, als dritte Zielpriorität.

### Änderungen gegenüber V1

| Thema | V1 | V2 |
|---|---|---|
| Name und Bedienung der Kopien | Relais wird geworfen | **Turmkopien werden per Maus platziert**: E startet die Vorschau, ein Linksklick platziert |
| Quellenwahl der Kopien | Bedienung offen | Automatisch nach Bau-Slot-Reihenfolge und Nähe zum Platzierungspunkt, mit Live-Vorschau |
| Kosten der Portale | offen | 1 Upgradepunkt, ohne weitere Voraussetzung |
| HE-Granate beim Inspektor | offen | Kostet den Inspektor 1 Punkt; Bestandsschutz für gekaufte HE-Upgrades |
| Laufzeiten, Cooldowns, Bäume | offen | Defaults, siehe §3.6, §4.7 und §7.1 |
| Salven, Pause, Identität, Tod | offen | Defaults, siehe §3.4, §3.5, §5 und §7 |
| Basisbeschuss | „geeignete Türme“ | Spielereigene Türme im Coop. Kontrolltürme schießen nie auf Basen, auch nicht über den Fokus |

## 1 Zielbild und Umfang

Die Klassenstärke des Inspektors hängt an vorbereiteten Konstruktionen. Bei der Basisverteidigung ist
diese Stärke gut verfügbar, bei entfernten Missionsaufgaben bisher deutlich weniger. Beide Utilities
machen die vorhandene Turminvestition an einem anderen Ort nutzbar. Turmwahl, Aufbau und Upgrades
bleiben für die Unterstützung bestimmend.

| Merkmal | Turmkopien | Portale |
|---|---|---|
| Wirkung | Temporäre Kopien ausgewählter eigener Türme am Platzierungspunkt | Beschuss durch Mündungsportale vor aktiven eigenen Feuerquellen und einen gemeinsamen Ausgang |
| Aktivierung | `placement_mode`: E → Vorschau, Linksklick → platzieren | `charged_throw` wie HE, ohne Abpraller |
| Einsatzdauer | 12 s, mit Upgrades +3 s je Stufe | 5 s, mit Upgrades +1,5 s je Stufe |
| Feuerquellen | 1 Kopie, mit Upgrades 2 und 3 | Alle geeigneten aktiven eigenen Feuerquellen einschließlich Kopien |
| Originale in der Grundversion | Pausieren während der Projektion | Richten ihr Feuer auf Ziele am Ausgang |
| Boss-Upgrade | Parallelbetrieb: Original und Kopie kämpfen gleichzeitig | Lokale Feuerfreigabe: lokales Feuer ohne Ziel am Ausgang |
| Einstieg | Standard-Utility, ersetzt HE im Standard-Loadout | Freischaltung für 1 Upgradepunkt |

Beide Fähigkeiten verfolgen bewusst dasselbe Gameplay-Ziel. Dauer, Quellenzahl und Bündelung geben ihnen
eigene Einsatzmöglichkeiten, ohne künstlich getrennte Rollen zu erzwingen.

**Zum Umfang gehören:** die Basis als Zielstufe für Spielertürme, beide Utilities und ihre Upgrades,
die gemeinsame Nutzung, Startausrüstung und Persistenz sowie die nötigen Darstellungs- und
Mehrspielerregeln.

**Nicht in dieser Version:**
- das Ultimate „Festung auf Beinen“
- ein Umbau des Tesla-Turms
- allgemeine Bewegungs- oder Transport-Upgrades
- eine Ausweitung auf andere Klassen oder Spielmodi

## 2 Gemeinsame Turmregeln

### 2.1 Feindliche Basen als dritte Zielstufe

**Geltung:** alle **spielereigenen** Türme im Coop-Defense, auch ohne Utility. Ein vorgeschobener
Turmaufbau kann so eine feindliche Basis allein zerstören.
- Das Kriterium ist der Spielerbesitz, nicht `targetMode`. Spielertürme haben keinen `targetMode`.
- Basisgeschütze und basisgehörige Konstruktionen (`ownership: 'base-owned'`) sind nicht erfasst.

Die automatische Zielpriorität lautet:

1. ein ausdrücklich gesetztes, gültiges Fokusziel (Energieinjektor)
2. geeignete feindliche Figuren in Reichweite
3. eine erreichbare feindliche Basis, gegen die die Waffe wirksam ist

Reichweite, Zielberechtigung und freie Schusslinie gelten auf jeder Stufe.

**Ermittlung des Basisziels**
- Gezielt wird auf einen Punkt der tatsächlichen Außenfläche, nicht auf den Mittelpunkt.
- Freiliegende Zellkanten werden je Hindernis-Generation gecacht. Eine Kante ist verdeckt, wenn die
  Nachbarzelle zur Basis gehört oder blockiert ist.
- Je Turm werden die nächstgelegenen freiliegenden Flächen in Reichweite nach Distanz geprüft. Die Zahl
  der Schusslinienprüfungen je Turm und Tick ist begrenzt.
- Die Suche läuft nur, wenn weder ein Fokus- noch ein Figurenziel vorhanden ist.
- Damit genügt eine nahe Außenwand auch bei weit entferntem Mittelpunkt. Konkave oder verdeckte Flächen
  werden nicht durchschossen.

**Wirksamkeit**
- Die reine Regel `canWeaponDamageBases` bewertet den gesamten Angriff: direkten Treffer, Explosion,
  Schadenswolke, Brand und Flamme.
- Ob ein Anteil eine Basis tatsächlich trifft, sieht man der Config nicht an. Deshalb sichert ein
  Integrationstest je Turmwaffe ab, dass Regel und Laufzeit übereinstimmen
  (`tests/integration/TurretBaseWeaponMatrix.test.ts`).
- **Kontrolltürme** wie Gravitation und Zeitblase schießen nie auf Basen. Das gilt auch für den
  bestehenden Injektor-Fokus auf eine Basis: Ein wirkungsloser Turm ignoriert diesen Fokus und sucht
  stattdessen Figurenziele.

Die Prüfung der Strukturberechtigung folgt dem Muster der Angriffsdrohne
(`canDamageStructure(..., 'hostile')`).

### 2.2 Geeignete Quellen der Utilities

Beide Utilities beziehen sich auf **eigene, bestehende, kampffähige** Türme. Verbündete Türme anderer
Spieler, feindliche Türme, Basisgeschütze und basisgehörige Konstruktionen sind ausgeschlossen. Ein
eigener Turm auf einer Basis bleibt eine eigene Konstruktion, solange sein Träger intakt ist.

| Quelle | Turmkopien | Portale |
|---|---|---|
| Eigener Raketen-, MG- oder Flammenturm | Als Original wählbar | Feuerquelle |
| Eigener Gravitations- oder Zeitblasenturm | Als Original wählbar | Feuerquelle; schadenfreie Kontrolle bleibt schadenfrei |
| Eigener Sporenturm einschließlich Plasmavariante | Als Original wählbar | Feuerquelle |
| Tesla-Turm | Ausgeschlossen | Ausgeschlossen |
| Turmkopie eines geeigneten Turms | Keine Quelle weiterer Kopien | Feuerquelle, sobald materialisiert |
| Durch Kopien pausiertes Original | Nicht erneut wählbar | Keine Feuerquelle, bleibt pausiert |
| Angriffsdrohne und Station | Nicht kopierbar | Kein Teilnehmer |
| Podeste, Barrieren, Wachtürme | Keine Turmprojektion | Kein Teilnehmer |

Eignung setzt zwei Bedingungen voraus:
- Die Konstruktion ist eine der sechs Turmarten (`spore_turret`, `rocket_turret`,
  `machine_gun_turret`, `flame_turret`, `gravity_turret`, `slow_bubble_turret`).
- Ihre tatsächliche Waffe hat den Feuertyp `projectile` oder `flamethrower`.

Die zweite Bedingung schützt gegen spätere Waffenvarianten. Beide Utilities und die Vorschau nutzen
dieselbe reine Regel in `src/systems/fireControl/`.

### 2.3 Feuerquellen und Identität

Das Turmfeuer arbeitet mit **Feuerquellen** statt mit Konstruktions-IDs. Jede Quelle trägt:

| Feld | Bedeutung |
|---|---|
| `identityId` | ID des Originals. Owner von MG-Stacks, Injektor-Buff, Fernsteuerung und Kill-Attribution |
| `sequenceKey` | Owner von Cooldown (`nextFireAt`) und laufender Salve |
| `sequenceSeedKey` | Startzustand einer neuen eigenen Folge, nur bei Parallelbetrieb |
| `fireState` | `active` oder `paused`. Pausierte Quellen bleiben in der Liste, damit ihr Feuerfolge-Zustand erhalten bleibt |
| `visualId` | Welches Sprite die Schussanimation spielt (Original oder Kopie) |
| `route` | `local` oder `portal`, wird bei der Schussabgabe festgelegt |

**Regeln**
- **Kopien gehören nie** in die Konstruktionsliste (`getTurretDefinitions()` / `getTurrets()`). Sonst
  würden Bemannung, Interaktion, Homing-Ziele, Tesla-Ziele und Fernsteuerung sie als Bauwerk behandeln.
  Kopien kommen über einen eigenen Feuerquellen-Provider ins Turmfeuer; ein Architekturtest sichert das
  ab.
- Cooldowns und Salven werden nach `sequenceKey` aufgeräumt, nicht nach Konstruktions-ID. Ein Wechsel
  zwischen Original und Kopie setzt deshalb nichts zurück.
- Jede Salve trägt ihren Owner-Eintrag. Eine Kopie kann keine fremde Salve fortsetzen.
- Ohne Feuerleitung ist jede Konstruktion genau eine Quelle mit `identityId = sequenceKey = visualId =`
  ihrer ID. Das Verhalten bleibt dann gleich.

## 3 Turmkopien

### 3.1 Aktivierung per Maus

- **E** startet den Vorschaumodus über die vorhandene Aktivierung `placement_mode`, wie bei
  Felsbarriere und Sporenturm (`InputSystem.beginPlacementUtilityAim`). Die Vorschau zeigt:
  - einen Reichweitenring um den Spieler (Default **280 px**)
  - hervorgehobene Originale, die gewählt würden
  - Hologramm-Geister in der späteren Formation am Cursor
- **Linksklick** platziert. Der Host prüft:
  - Reichweite
  - freie Formationsplätze
  - geeignete Originale
  - ob die Utility bereit ist und kein eigener Kopieneinsatz läuft
- **E** oder **Rechtsklick** bricht ohne Verbrauch ab.
- Ist die Platzierung ungültig, zeigt die Vorschau sie rot an, und der Klick wird ohne Verbrauch
  abgelehnt.
- Ohne geeignetes Original wird die Nutzung vor dem Verbrauch abgelehnt, mit dem Text **„Keine
  kampffähigen eigenen Türme“** (eigener Failure-Grund mit Client-Text).
- Kopien sind keine Konstruktionen und laufen nicht durch `PlacementSystem`. Der Host leitet die
  Aktivierung über einen eigenen Zweig in `dispatch` an den Feuerleit-Port weiter.

### 3.2 Quellenwahl

Die Wahl ist automatisch, nachvollziehbar und in der Vorschau sichtbar. Host-Validierung und Vorschau
nutzen dieselbe reine Funktion:

1. Turmtypen in der Reihenfolge der **Bau-Slots** des Spielers. **Verschiedene Typen zuerst:** In Runde 1
   kommt je Typ ein Original zum Zug, in Runde 2 das jeweils zweite.
2. Innerhalb eines Typs wird das Original gewählt, das dem **Platzierungspunkt am Cursor am nächsten** ist.
3. Typen ohne aktuellen Bau-Slot (gebaut und später umgerüstet) folgen nach allen Slot-Typen,
   alphabetisch.
4. Bei Gleichstand gewinnt die kleinere Konstruktions-ID.

Die Kopienzahl ist durch die Upgrades und durch die Zahl geeigneter Originale begrenzt.

### 3.3 Formation

- Bei **einer Kopie** steht sie genau am Platzierungspunkt.
- Bei **mehreren Kopien** stehen sie gleichmäßig auf einem **Ring von etwa 36 px** um den
  Platzierungspunkt. Die Formation beginnt oben und rotiert bei Bedarf, bis alle Punkte frei und begehbar
  sind (keine Wand, kein Wasser, innerhalb der Arena).
- Ist keine gleichmäßige Formation frei, werden freie Ringpunkte mit größtmöglichem Winkelabstand
  gewählt. Reicht der Platz nicht, ist die Platzierung ungültig.
- Am Platzierungspunkt steht ein kleines **Relais-Projektorgerät**. Es ist in V2 unzerstörbar und kein
  Angriffsziel.
- Die Formationsplätze werden den Quellen in Wahlreihenfolge zugeordnet.

### 3.4 Kopien und Originale

**Grundsätze**
- Jede Kopie ist an genau ein Original gebunden und übernimmt dessen Waffe, dauerhafte Turm-Upgrades und
  Reichweite. Eine zusätzliche universelle Waffe gibt es nicht.
- Kopien **materialisieren sich in 0,4 s**. Erst danach feuern sie und gelten als Portalquelle.

**Pause in der Grundversion**
- Das Original pausiert während der Projektion (`fireState: 'paused'`). Es bleibt physisch vorhanden,
  verwundbar und in der Turmliste.
- Eine laufende Salve des Originals wird während der Materialisierung zu Ende geführt.
- In der Grundversion teilt die Kopie die Feuerfolge des Originals (gleicher `sequenceKey`). Pausieren,
  Übertragen und Wiederaufnehmen erzeugen weder einen Reset noch eine kostenlose Salve.

**Eigenschaften der Kopien**
- nicht anvisierbar, nicht blockierend
- weder bemannbar noch reparierbar, abbaubar oder gespeichert
- belegen keine Baukapazität und erzeugen keine zusätzlichen Angriffsziele

**Ende einer Projektion**
- Sie endet, wenn das Original zerstört oder abgebaut wird oder seine Kampfberechtigung verliert, zum
  Beispiel weil sein Träger zerstört ist.
- Endet ein Einsatz mitten in einer Salve, wird die Salve abgebrochen und der reguläre Cooldown gesetzt.
- **Bemannung:** Bemannt der Spieler ein pausiertes Original, endet dessen Projektion. Das Original kämpft
  wieder bemannt. Mit Parallelbetrieb ist die Bemannung frei, und die Kopie läuft weiter.

### 3.5 Parallelbetrieb

Mit dem Boss-Knoten **Parallelbetrieb** kämpfen ausgewählte Originale während der Projektion weiter.

**Feuerfolge**
- Die Kopie erhält eine eigene Feuerfolge (eigener `sequenceKey`).
- Diese startet mit dem aktuellen `nextFireAt` des Originals (`sequenceSeedKey`). Der Einsatz erzeugt
  damit keine Sofortsalve.
- Jede Folge feuert mit der regulären Feuerrate des Turms.

Die zusätzliche Feuerleistung ist der beabsichtigte Effekt.

### 3.6 Upgradebaum (bestehendes D-U-Muster)

| Knoten | Wirkung | Default |
|---|---|---|
| Wurzel | 1 Turmkopie, 12 s Laufzeit | gratis, Standard-Utility des Inspektors |
| L1 / L2 „Mehr Verbindungen“ | maximal 2 bzw. 3 Kopien | je 1 Punkt |
| R1 / R2 „Längere Übertragung“ | +3 s Laufzeit je Stufe | je 1 Punkt |
| B „Parallelbetrieb“ | Originale kämpfen weiter (§3.5) | Boss-Punkt |

## 4 Portale

### 4.1 Wurf

- Geworfen wird mit `charged_throw` wie bei HE, aber **ohne Abpraller**. Das Gerät kommt durch
  Luftreibung zur Ruhe.
- Der Client zeigt eine deterministische Landepunkt-Vorschau.
- Ist der Landeort ungültig (Wand, Wasser, außerhalb), wird er auf die letzte gültige Flugposition
  verlegt.
- Wie die Zeitblase wird der Wurf über einen eigenen Zweig in `HostUpdateCoordinator.resolveGrenadePayload`
  aufgelöst. Ohne diesen Zweig fiele der Wurf auf Rauch durch.
- Der Ausgang öffnet sich bei der Landung.
- Hat der Spieler keine geeignete Feuerquelle, wird der Wurf vor dem Verbrauch abgelehnt, mit demselben
  Failure-Grund wie in §3.1.
- Ein fehlender Gegner macht den Einsatz nicht ungültig.

### 4.2 Zeitfenster und Teilnehmer

**Zeitfenster**
- Der Ausgang bleibt **5 s** offen, über mehrere Feuerzyklen mit normalen Feuerraten und Salven.

**Teilnehmer**
- Teilnehmen dürfen alle geeigneten, aktiven eigenen Feuerquellen nach §2.2, einschließlich
  materialisierter Kopien.
- Die Teilnahme wird jeden Tick aus den Fakten abgeleitet. Eine neue Kopie bekommt automatisch einen
  Eingang; eine entfernte Quelle verliert ihn.
- Ein von Kopien pausiertes Original bleibt pausiert. Die Portale heben die Pause nicht auf.
- Die Reihenfolge, in der beide Utilities aktiviert werden, spielt keine Rolle.

### 4.3 Zielsuche am Ausgang

- Jede teilnehmende Quelle sucht **vom Ausgang aus** nach Zielen, und zwar in **ihrer eigenen
  Reichweite**. Für die Sichtlinie vom Ausgang gelten keine Ausnahmen der Quelle (kein `skipRockIndex`,
  kein Träger-Ausnahmerecht).
- Freie Schusslinien werden auf den realen Abschnitten geprüft:
  - Mündung → Eingang
  - Ausgang → Ziel

  Eine Wand auf der übersprungenen Strecke blockiert nicht.
- Der Portalsprung verbraucht keine Waffenreichweite. Reichweite und Lebensdauer werden durch den
  Transport aber auch nicht erneuert.
- Die Sichtlinie Ausgang → Ziel wird je Einsatz und Tick gecacht.
- Die Zielpriorität aus §2.1 gilt unverändert, einschließlich Basen.

### 4.4 Mündungsportal und Schusswinkel

Der Ort des Ausgangs bleibt fest. Pro Quelle läuft der Schuss so ab:

1. Ziel vom Ausgang aus bestimmen.
2. Richtung Ausgang → Ziel berechnen.
3. Das Rohr mit der normalen Drehgeschwindigkeit in diese Richtung führen. Es gibt keinen sofortigen,
   kostenlosen Richtungswechsel.
4. Den Eingang unmittelbar vor der Mündung platzieren; er folgt dem Rohr.
5. Bei erfüllter Zielausrichtung und Feuerbereitschaft schießen.
6. Das Geschoss tritt am Ausgang mit derselben Flugrichtung aus, ohne Drehung oder Spiegelung.

Mehrere Türme können gleichzeitig in verschiedene Richtungen aus demselben Ausgang schießen. Der Ausgang
wirkt deshalb rundum.

### 4.5 Route und Transport

- Die **Route wird bei der Schussabgabe festgelegt**: Die Spawn-Anfrage trägt
  `fireControlRoute {contributionId, entry, exit, bonus}`.
  - Das Geschoss wird **einseitig** direkt nach dem Spawn an den Ausgang versetzt, noch vor dem Start
    der Flammen-Emission.
  - Fremde Eintritte, Pingpong und Homing-Konflikte sind dadurch ausgeschlossen.
  - Spieler, Gegner, fremde Geschosse und nicht zugeordnete eigene Schüsse nutzen keinen Eingang.
- Die Frage nach „noch nicht transportierten Schüssen beim Portalende“ entfällt damit. Ein bereits
  abgegebener Schuss ist schon versetzt. Danach abgegebene Schüsse sind lokal oder unterbleiben.
- Translocator und Feuerleitung nutzen denselben Transfer-Helper für Bonus, Flugpfad-Bruch und
  Carrier-Release. Die Stacking-Regel des Translocators bleibt unverändert.
- Der zweite Projektilpfad (`secondProjectileDamageFactor`) nutzt dieselbe Route.
- Geeignete Turmwaffen sind ausschließlich vom Feuertyp `projectile` oder `flamethrower`; das wird
  validiert.

### 4.6 Modi je Quelle und lokale Feuerfreigabe

Jede angeschlossene Quelle hat genau einen Modus. Die Modi werden repliziert.

| Modus | Bedeutung |
|---|---|
| `portal` | Ziel am Ausgang vorhanden; der Eingang ist offen |
| `waiting` | Kein Ziel am Ausgang; die Quelle schweigt (Grundversion) |
| `local` | Kein Ziel am Ausgang; die Quelle kämpft lokal. Nur mit Boss-Knoten „Lokale Feuerfreigabe“; der Eingang wird deaktiviert dargestellt |

**Regeln**
- Der Fallback hängt nur am **Vorhandensein eines Ziels**, nicht an der Feuerbereitschaft. Nachladen oder
  eine laufende Drehung erzeugen keinen lokalen Zusatzangriff.
- Eine begonnene Salve bleibt auf ihrer Route. Ein Wechsel setzt keine Nachladezeit zurück.
- Pro Quelle gibt es eine Feuerfolge; der Boss-Knoten erzeugt keine zweite.
- Eine Kopie kämpft lokal an ihrem Projektionsort. Ein pausiertes Original erhält keine lokale
  Freigabe.

### 4.7 Upgradebaum und Schaden

| Knoten | Wirkung | Default |
|---|---|---|
| Wurzel | Portaleinsatz, 5 s | 1 Upgradepunkt, ohne weitere Voraussetzung |
| L1 / L2 „Längere Öffnung“ | +1,5 s je Stufe | je 1 Punkt |
| R1 / R2 „Verstärkter Durchschuss“ | +20 % Schaden transportierter Schüsse je Stufe | je 1 Punkt |
| B „Lokale Feuerfreigabe“ | Modus `local` (§4.6) | Boss-Punkt |

**Bonusregeln**
- Der Bonus wirkt **höchstens einmal je Einsatz und Projektil** (Contribution-ID `fc:<deploymentId>`).
- Er gilt für alle schadentragenden Anteile: direkter Treffer, Explosion, zugehöriger Brand und
  Flammen-Kinder (über den vorhandenen Kontext).
- Er erhöht nicht Radius, Reichweite, Zugkraft, Verlangsamung, Effektlaufzeit oder Reparatur.
  Schadenfreie Kontrolle bleibt schadenfrei.

## 5 Gemeinsame Nutzung, Identität und Buffs

| Quelle während eines Kopieneinsatzes | Portalteilnahme | Ergebnis |
|---|---|---|
| Nicht kopiertes aktives Original | Ja | Portalfeuer, mit Boss-Knoten gegebenenfalls lokal |
| Pausiertes Original ohne Parallelbetrieb | Nein | Bleibt pausiert |
| Materialisierte Kopie | Ja | Eigener Eingang an der Kopie |
| Original mit Parallelbetrieb | Ja | Original und Kopie haben je einen Eingang |
| Zerstörtes oder nicht kampffähiges Original | Nein | Kopie und Eingänge enden |

**Identitätsregeln** (Freigabe an G0):

| Effekt | Regel |
|---|---|
| MG-Attrition (Stacks) | Hängt an der ID des Originals. Mit Parallelbetrieb füllen beide Läufe einen gemeinsamen Stack; das Cap gilt |
| Energieinjektor-Buff | Wird über die **Identität** des Originals bestimmt, nie über die Position der Kopie. Ein Buff wirkt nicht doppelt |
| Örtliche Verstärkungsfelder | Werden an der Position der tatsächlich feuernden Quelle geprüft (Original am Standort, Kopie am Projektionsort). Portaltransport verlegt die Quelle nicht an den Ausgang |
| Fernsteuerung | Wählt nur echte Konstruktionen. Die Kopie erbt den Bonus über ihr Original |
| Kill-Attribution | `sourceTurretId` bleibt die ID des Originals |
| Schussanimation | Spielt auf dem Sprite der feuernden Quelle (`turretVisualId`). Das pausierte Original täuscht keinen Schuss vor |
| Fokusziel des Injektors | Gilt für alle Quellen desselben Besitzers, also auch für Kopien |

## 6 Einstieg, Progression und Persistenz

**Freischaltung und Kosten**
- **Turmkopien** sind für den Inspektor anfänglich freigeschaltet und ausgerüstet. Das Standard-Loadout
  ist `[rocket_turret, FIRE_CONTROL_RELAY]`; `getDefaultToolLoadout(classId)` wird dafür
  klassenabhängig.
- **Portale** kosten 1 Upgradepunkt.
- **HE-Granate:** Für den Inspektor kostet sie 1 Punkt (klassenspezifischer Startlevel). Andere Klassen
  behalten HE gratis.

**Bestehende Profile** (eigene Decoder-Stufe)
- Ein altes Standard-Loadout wird umgestellt: HE wird durch die Turmkopien ersetzt.
- Profile mit gekauften HE-Upgrades behalten HE kostenneutral.
- Einmalig erscheint ein Hinweis in der Lobby.
- Die Schema-Nummer wird bei der Integration vergeben: 7, falls Dawn noch nicht gelandet ist, sonst 8.

Das Einstiegsverhalten ist: Raketenturm bauen, einen entfernten Kampf aufsuchen und dessen Feuerkraft
über Turmkopien einsetzen. Die Grundversion mit dem Raketenturm muss ohne Pflichtupgrades nützlich sein.

## 7 Lebensdauer und Mehrspieler

### 7.1 Einsätze und Cooldown

- Je Spieler läuft **höchstens ein Kopien- und ein Portaleinsatz** gleichzeitig. Eine erneute Nutzung
  während eines Einsatzes wird abgelehnt.
- Es gibt eine Ladung und keine Adrenalinkosten.
- Der **Cooldown beginnt erst mit dem Einsatzende**: Kopien 25 s, Portale 20 s.
- Nutzungszustand in `PlayerUtilityActionRuntime`:
  - Kopien: aktiv → Cooldown
  - Portale: fliegt → aktiv → Cooldown
- Weltzustand der Einsätze in `WorldCombatGameplayBinding`, neben der Zeitblase. Beide sind über einen
  `FireControlUtilityPort` verbunden, nach dem Muster von `setTimeBubblePort`.
- Gespeichert werden nur Fakten:
  - Besitzer, Art, Position
  - `startedAt` und `expiresAt`
  - die bei der Aktivierung eingefrorene Konfiguration (Upgradestufen)
  - die gewählten Originale und die Kopienwinkel

  Quellen und Eingänge werden jeden Tick abgeleitet.

### 7.2 Tod, Ende und Aufräumen

| Ereignis | Verhalten |
|---|---|
| Tod des Besitzers | Einsätze laufen bis zu ihrem Ablauf weiter; Respawn ändert nichts |
| Einsatzende | Kopien vergehen, Eingänge schließen, pausierte Originale setzen ihre Folge fort, ohne Reset |
| Quelle zerstört oder entfernt | Zugehörige Kopie und Eingang enden; keine verwaiste Pause |
| Besitzer verlässt die Partie | `removePlayer` räumt seine Einsätze sofort auf |
| Activity-Ende | `clearActivityBindings()` räumt alle Einsätze auf |
| World-Wechsel | `destroy()` räumt alles auf |

Bereits abgegebene Geschosse behalten ihre Herkunft und erworbenen Beiträge. Ein Einsatzende erneuert
keine Waffenbereitschaft. `ArenaLifecycleCoordinator` wird für das Aufräumen nicht angefasst; die
vorhandenen Binding-Pfade genügen.

### 7.3 Replikation

- Der Host entscheidet über Aktivierung, Quellenwahl, Zielwahl, Pausen, Transport, Schaden und Ende.
  Clients zeigen den bestätigten Zustand.
- Neuer Netz-Slice `fc` nach dem Muster der Zeitblase, mit Pflichteintrag im Full-Snapshot
  (`FullGameStateBootstrap`). Inhalt ist der `FireControlSnapshot`
  (`src/systems/fireControl/FireControlSnapshot.ts`):
  - Einsätze mit absolutem `expiresAt`
  - Kopien mit Winkel und Status (`materializing` / `active`)
  - Eingänge mit Modus (`portal` / `waiting` / `local`)
- Ein nachträglich beitretender Spieler sieht aktive Kopien und Verbindungen mit Restlaufzeit.
- `sourceTurretId` bleibt die ID des Originals. Ein neues Feld `turretVisualId` im Projektil-Snapshot
  steuert die Schussanimation; `flameStreamKey` gilt je Quelle.
- Das Protokoll wird einmal angehoben, auf 30, aber erst nach dem Merge von Shield-Charger.

## 8 Darstellung und Lesbarkeit

Die Darstellung folgt der orthografischen 90°-Top-down-Ansicht und den
[visuellen Projektregeln](../ai/visual-guidelines.md). Effekte laufen nach Möglichkeit auf der GPU.

| Element | Umsetzung |
|---|---|
| Kopien | Vorhandenes Turm-Visual mit eigenem Phaser-4-Filter: Scanlines, Rim, Flackern, Noise-Dissolve beim Erscheinen und Vergehen |
| Relais-Projektor | Kleines Top-down-Gerät am Platzierungspunkt; Entwurf in Blender, Texturen per Imagegen |
| Portale | Ein RenderNode-Batch für alle Ein- und Ausgänge. Eingänge folgen dem Rohr; der Ausgang wirkt rundum, ohne feste Öffnung |
| Flashes | Austrittsflash in Schussrichtung und Schluck-Effekt am Eingang über `GpuVfxSystem` |
| Marker | Pausiertes Original und Vorschau-Highlights als `SpriteGPULayer` |
| Vorschau | Reichweitenring, hervorgehobene Originale, Hologramm-Geister in Formation, gültig oder ungültig (rot) |
| HUD | Restzeit, aktiver Einsatz, pausierte Originale und lokales Feuer unterscheidbar |

**Lesbarkeitsregeln**
- Es gibt keine Linien, Spuren oder Audio-Cues über die übersprungene Strecke.
- Feuerleit-Portale sind klar von Translocator-Portalen unterscheidbar; niemand soll einen begehbaren
  Durchgang erwarten.
- Viele Quellen dürfen Ziele und Gefahren am Ausgang nicht verdecken.
- Ein pausiertes Original zeigt keine Schussanimation.

**Farbwelt:** Sie wird an G0 aus Kandidaten gewählt.
- Vorschlag: Signal-Türkis/Minze mit weißem Kern.
- Ausgeschlossen: Rot (Telegraph), Lila (Gegnergefahr), Gelb und Orange (Translocator).
- Abstand zum Translocator-Blau.

Depth-Contract-Einträge folgen erst nach dem Merge von Shield-Charger.

## 9 Entscheidungslog

Status:
- **User** = User-Entscheidung, bindend bis zu einer neuen Entscheidung des Users.
- **Default** = Design-Default, dokumentiert und umkehrbar, an jedem Gate kippbar.

| Nr. | Datum | Entscheidung | Begründung | Status |
|---|---|---|---|---|
| E1 | 2026-10-13 | Quellenwahl der Kopien automatisch: Bau-Slot-Reihenfolge, verschiedene Typen zuerst, je Typ das nächste Original; Live-Vorschau mit Highlights und Geistern; eine reine Funktion für Host und Vorschau | Nachvollziehbar ohne eigene Auswahloberfläche; nie zufällig | User |
| E2 | 2026-10-13 | Turmkopien werden per Maus platziert (`placement_mode`: E → Vorschau, Linksklick → platzieren), nicht geworfen; Reichweite um den Spieler; ungültig wird rot angezeigt und ohne Verbrauch abgelehnt | Präzise Platzierung der Formation; vorhandenes Bedienmuster von Felsbarriere und Sporenturm | User |
| E3 | 2026-10-13 | HE-Granate kostet den Inspektor 1 Punkt; andere Klassen gratis; Bestandsschutz für gekaufte HE-Upgrades | Turmkopien ersetzen HE als Startutility, ohne bestehende Käufe zu entwerten | User |
| E4 | 2026-10-13 | Turmkopien sind Standard: freigeschaltet, ausgerüstet, ersetzen HE im Standard-Loadout | GDD-Ziel: Einstieg über Raketenturm plus Kopien | User |
| E5 | 2026-10-13 | Portale kosten 1 Upgradepunkt, ohne weitere Voraussetzung | Wie andere Utilities | User |
| E6 | 2026-10-13 | Fragen, Sichtprüfung und Abnahme gebündelt an den Gates G0–G3; dazwischen autark mit dokumentierten Defaults | Arbeitsfluss | User |
| D1 | 2026-10-13 | Laufzeit Kopien 12 s (+3 s je Stufe „Längere Übertragung“, 2 Stufen); Portale 5 s (+1,5 s je Stufe „Längere Öffnung“, 2 Stufen) | GDD: Portale kürzer als Kopien; Startwerte für Tuning | Default, an Gate kippbar |
| D2 | 2026-10-13 | Cooldown beginnt erst mit dem Einsatzende (Kopien 25 s, Portale 20 s); eine Ladung; kein Adrenalin | Verhindert Überlappung ohne Sperrlogik; Utilities kosten kein Adrenalin | Default, an Gate kippbar |
| D3 | 2026-10-13 | Je Spieler höchstens ein Kopien- und ein Portaleinsatz; erneute Nutzung während eines Einsatzes wird abgelehnt | Keine unbegrenzte Vervielfachung; einfache V2-Regel | Default, an Gate kippbar |
| D4 | 2026-10-13 | Bäume: Kopien L „Mehr Verbindungen“ (2/3), R „Längere Übertragung“, B „Parallelbetrieb“; Portale L „Längere Öffnung“, R „Verstärkter Durchschuss“ (+20 % je Stufe), B „Lokale Feuerfreigabe“ | Bestehendes D-U-Muster; Spitzenupgrades laut GDD | Default, an Gate kippbar |
| D5 | 2026-10-13 | Platzierungsreichweite der Kopien 280 px; abbrechen mit E oder Rechtsklick | Wurfweite in ähnlicher Größenordnung; vorhandene Abbruchgesten | Default, an Gate kippbar |
| D6 | 2026-10-13 | Portale werden geworfen (`charged_throw` ohne Abpraller, Luftreibung, deterministische Landepunkt-Vorschau, ungültiger Ort → letzte gültige Flugposition) | GDD-Bedienung; HE-Muster | Default, an Gate kippbar (Frage F1) |
| D7 | 2026-10-13 | Fehlt eine geeignete Quelle, wird die Nutzung vor dem Verbrauch abgelehnt („Keine kampffähigen eigenen Türme“, eigener Failure-Grund) | GDD §3.1; kein frustrierender Verbrauch | Default, an Gate kippbar |
| D8 | 2026-10-13 | Formation: 1 Kopie am Punkt, mehrere auf einem Ring von etwa 36 px an freien, begehbaren Punkten; Relais-Projektor am Punkt, in V2 unzerstörbar | Kompakte, lesbare Gruppe; kein neues Angriffsziel | Default, an Gate kippbar (Frage F2) |
| D9 | 2026-10-13 | Kopien materialisieren sich in 0,4 s; eine laufende Salve beendet das Original in dieser Zeit | Sichtbarer Übergang; keine kostenlose Salve | Default, an Gate kippbar |
| D10 | 2026-10-13 | Kopien sind nicht anvisierbar, nicht blockierend, weder bemannbar noch reparierbar | GDD §3.2 | Default, an Gate kippbar |
| D11 | 2026-10-13 | Pausiertes Original bleibt mit `fireState: 'paused'` in der Turmliste; die Kopie teilt seine Feuerfolge; mit Parallelbetrieb eigene Folge ab `nextFireAt` des Originals | Kein Reset, keine Sofortsalve | Default, an Gate kippbar |
| D12 | 2026-10-13 | Endet ein Einsatz mitten in einer Salve, wird sie abgebrochen und der Cooldown gesetzt | Eindeutige Route; keine freie Salve | Default, an Gate kippbar |
| D13 | 2026-10-13 | Bemannt der Spieler ein pausiertes Original, endet dessen Projektion; mit Parallelbetrieb ist die Bemannung frei | Bemannung hat Vorrang; keine Doppelsteuerung | Default, an Gate kippbar |
| D14 | 2026-10-13 | Identität: MG-Stacks an der ID des Originals (gemeinsamer Stack bei Parallelbetrieb), Injektor-Buff über Identität, Fernsteuerung nur auf echte Konstruktionen | GDD §5.2: weder still entfallen noch vervielfachen | Default, Freigabe an G0 |
| D15 | 2026-10-13 | Einsätze laufen über den Tod des Besitzers hinaus; Besitzerentfernung, Activity-Ende und World-Wechsel räumen auf | Einfach, keine Strafe beim Tod; keine Verwaisung | Default, an Gate kippbar |
| D16 | 2026-10-13 | Portalroute wird bei der Schussabgabe fixiert; Bonus einmal je Einsatz und Projektil (`fc:<deploymentId>`); Translocator-Stacking unverändert | Löst die offene Frage nach „nicht transportierten Schüssen“; ein Transfer-Helper für beide | Default, an Gate kippbar |
| D17 | 2026-10-13 | Basisbeschuss gilt für alle spielereigenen Türme im Coop; Kontrolltürme nie, auch nicht über den Fokus | GDD §2.1; Korrektur eines bestehenden Fehlverhaltens | Default, an Gate kippbar |
| D18 | 2026-10-13 | Farbwelt-Vorschlag Signal-Türkis/Minze mit weißem Kern; Ausschlüsse Rot, Lila, Gelb/Orange | Abgrenzung zu Telegraph, Gegnergefahr und Translocator | Default, Auswahl an G0 |
| D19 | 2026-10-13 | Turmtypen ohne aktuellen Bau-Slot folgen in der Quellenwahl nach allen Slot-Typen, alphabetisch; Gleichstand → kleinere Konstruktions-ID | Deterministisch und vorhersehbar | Default, an Gate kippbar |
| D20 | 2026-10-13 | Ist keine gleichmäßige Ringformation frei, werden freie Ringpunkte mit maximalem Winkelabstand gewählt; sonst ist die Platzierung ungültig | Nutzbar an Wänden, ohne Kopien in Wände zu setzen | Default, an Gate kippbar |
| D21 | 2026-10-13 | Eine vorzeitig endende Kopie verschwindet aus dem Snapshot; die Darstellung spielt das Vergehen beim Entfernen; kein eigener Endstatus | Kleiner Netzvertrag; Darstellung bleibt abgeleitet | Default, an Gate kippbar |
| D22 | 2026-10-13 | Basisziel-Regeln liegen in `src/systems/TurretBaseTargeting.ts` statt in `src/systems/fireControl/` | Die Regel gilt für alle Spielertürme, unabhängig von der Feuerleitung | Default, an Gate kippbar |
| D23 | 2026-10-13 | Basisgeschütze und basisgehörige Konstruktionen greifen Basen weiterhin nicht selbstständig an | Plan: Spielerbesitz als Kriterium; Basisgeschütze haben eigene Zielmodi | Default, an Gate kippbar (Frage F4) |
| D24 | 2026-10-13 | Für die Platzierung der Kopien ist keine Sichtlinie vom Spieler zum Punkt nötig, nur Reichweite und freie Formation | Projektion, kein Wurf; einfache Regel | Default, an Gate kippbar |
| D25 | 2026-10-13 | Freiliegende Basisflächen werden nur aus der Basisgeometrie abgeleitet (je Basis-Generation gecacht). Verdeckung durch Felsen klärt allein die Schusslinie; je Turm und Suche werden höchstens die 4 nächsten Flächen geprüft | Felsen ändern sich unabhängig von der Basis-Generation; begrenzte Sichtlinienprüfungen | Default, an Gate kippbar |
| D26 | 2026-10-13 | Automatische Basisziele sind nur beschädigbare feindliche Basen (`isDamageable`, HP > 0). Der bestehende Fokus-Pfad bleibt bis auf das Kontrollturm-Gate unverändert | Keine Schüsse auf immune Basen; kein ungeplanter Eingriff in den Injektor-Fokus | Default, an Gate kippbar |

## 10 Abnahmeszenarien und Testzuordnung

Die Szenarien beschreiben langlebiges Verhalten. Jedes ist mindestens einem Test zugeordnet. „Geplant“
heißt: Der Test entsteht im genannten Paket. Der Stand wird im jeweiligen Gate-Bericht fortgeschrieben.

| Nr. | Szenario | Geplante Tests | Paket |
|---|---|---|---|
| 1 | Ein Schadensturm greift ohne Utility eine erreichbare feindliche Basis an. Eine nahe Außenfläche genügt auch bei fernem Mittelpunkt; verdeckte Flächen werden nicht durchschossen | `tests/TurretBaseTargeting.test.ts` (Flächen, Konkavität, Verdeckung); `tests/TurretAim.test.ts` (dritte Zielstufe im TurretSystem); `tests/integration/TurretBaseWeaponMatrix.test.ts`; Kontaktbogen G0 | P0.2 |
| 2 | Ein Kontrollturm verschwendet keine Angriffe auf eine Basis; Figuren- und Fokusziele folgen der gemeinsamen Priorität | `tests/TurretAim.test.ts` (Fokus-Pfad: Kontrollturm ignoriert Basisfokus); `tests/integration/TurretBaseWeaponMatrix.test.ts`; Kontaktbogen G0 | P0.2 |
| 3 | Die Grundversion erzeugt eine passende Kopie und pausiert ihr Original; nach dem Ende setzt das Original seine Feuerfolge ohne Reset fort | `tests/TurretFireSources.test.ts` (Übergangsmatrix: Pause, Ende, Salve); `tests/integration/FireControlLifecycle.test.ts` | P0.3, P1.5 |
| 4 | Höhere Kopienzahl erzeugt nur aus geeigneten Originalen zusätzliche Projektionen; Kopien erzeugen keine Kopien | `tests/FireControlEligibility.test.ts`; `tests/FireControlSourceSelection.test.ts`; `tests/FireControlCopyLayout.test.ts`; `tests/integration/FireControlLifecycle.test.ts` | P0.5, P1.5 |
| 5 | Parallelbetrieb lässt Original und Kopie gleichzeitig kämpfen; die Zerstörung des Originals beendet die Kopie | `tests/TurretFireSources.test.ts` (eigene Folge, Seed, Zerstörung); `tests/integration/FireControlLifecycle.test.ts` | P0.3, P1.5 |
| 6 | Ein Portal bleibt über mehrere Feuerzyklen offen; ein Turm trifft am Ausgang einen Gegner weit außerhalb seiner Standortreichweite | `tests/FireControlPortalMode.test.ts` (TurretSystem-Portalmodus); `tests/integration/FireControlPortal.test.ts` | P2.1, P2.4 |
| 7 | Ziele in verschiedenen Richtungen um den Ausgang führen zu passender Rohrdrehung und Austrittsrichtung; Eingang und Mündung bleiben zusammen | `tests/FireControlPortalMode.test.ts`; `tests/integration/FireControlPortal.test.ts` | P2.1, P2.4 |
| 8 | Hindernisse auf der übersprungenen Strecke blockieren nicht, auf realen Abschnitten schon; Restreichweite und Lebensdauer werden nicht erneuert | `tests/WorldProjectileRuntime.test.ts` (einseitiger Transfer); `tests/FireControlPortalMode.test.ts` (Sichtlinien-Abschnitte); `tests/integration/FireControlPortal.test.ts` | P0.4, P2.1, P2.4 |
| 9 | Spieler, Gegner, fremde und nicht zugeordnete Schüsse nutzen keinen Eingang; kein Rücktransport, kein Pingpong | `tests/WorldProjectileRuntime.test.ts` (Route nur über Spawn-Anfrage); `tests/PortalTraversal.test.ts` (Translocator unverändert); `tests/integration/FireControlPortal.test.ts` | P0.4, P2.4 |
| 10 | Ohne Boss-Knoten bleibt eine Quelle ohne Ausgangsziel untätig; mit Boss-Knoten kämpft sie lokal und kehrt zurück; Salvenweg und Nachladezustand bleiben konsistent | `tests/FireControlPortalMode.test.ts` (Modi `portal`/`waiting`/`local`); `tests/integration/FireControlPortal.test.ts` | P2.1, P2.4 |
| 11 | Beide Aktivierungsreihenfolgen funktionieren; neue Kopien erhalten Eingänge; pausierte Originale bleiben pausiert | `tests/integration/FireControlPortal.test.ts` (Kombination, beide Reihenfolgen) | P2.1, P2.4 |
| 12 | Portalschaden wird je Einsatz einmal angewandt und erreicht Explosion, Brand und Flammen-Kinder ohne doppelte Skalierung; schadenfreie Kontrolle bleibt unverändert | `tests/WorldProjectileRuntime.test.ts` (Contribution-ID); `tests/integration/FireControlPortal.test.ts` | P0.4, P2.4 |
| 13 | Turm-Upgrades, örtliche Buffs und Identitätseffekte verhalten sich an Original und Kopie konsistent | `tests/TurretFireSources.test.ts` (`identityId`, `visualId`); `tests/integration/FireControlIdentity.test.ts` (MG-Stacks, Injektor, Fernsteuerung); `tests/MgAttritionRuntime.test.ts` | P0.3, P1.1, P1.5 |
| 14 | Entfernen von Quellen, Einsatzende, Besitzerentfernung und World-Wechsel hinterlassen weder Portale noch Pausen; Clients und Late Join sehen den richtigen Zustand | `tests/integration/FireControlLifecycle.test.ts`; `tests/integration/FireControlNetwork.test.ts` (Host/Client/Late Join); `tests/architecture/FireControlSourceBoundary.test.ts` (Kopien nie in Konstruktions-Konsumenten); `tests/stress/FireControlStress.test.ts` | P1.1, P1.3, P1.5, P2.4 |
| 15 | Ein neuer Inspektor startet mit Raketenturm und Turmkopien; fehlende Originale werden verständlich gemeldet; bestehende Ausrüstungen folgen der Migration | `tests/LoadoutToolSlots.test.ts`; `tests/CoopDefenseClassLoadoutPersistence.test.ts`; `tests/LocalPersistence.test.ts`; `tests/I18n.test.ts` (Failure-Text); `tests/integration/FireControlLifecycle.test.ts` (Ablehnung ohne Verbrauch) | P1.2, P3.1 |

## 11 Offene Fragen für G0

| Nr. | Frage | Default bis zur Antwort |
|---|---|---|
| F1 | Sollen auch die Portale per Maus platziert statt geworfen werden? | Wurf (D6) |
| F2 | Bei genau einer Kopie stehen Kopie und Relais-Projektor auf demselben Punkt. Ist das lesbar genug, oder soll die Einzelkopie leicht versetzt stehen? | Kopie am Punkt, Projektor darunter (D8) |
| F3 | Freigabe der Identitätsregeln aus §5 (gemeinsamer MG-Stack, Injektor über Identität, Fernsteuerung über das Original) | Wie in §5 (D14) |
| F4 | Sollen auch freundliche Basisgeschütze und basisgehörige Spielerbauten feindliche Basen angreifen? | Nein (D23) |
| F5 | Turmwaffen, die laut Waffenmatrix keine Basen schädigen, zielen nie auf Basen. Ist das für jede dieser Waffen gewollt, oder soll ihre Wirkung gegen Basen ergänzt werden? Konkrete Liste im Gate-Bericht G0 | Regel folgt der beobachteten Laufzeit |
| F6 | Farbwelt der Feuerleitung (Kopien, Portale, Projektor) | Auswahl der Leit-Session aus den Kandidaten (D18) |
| F7 | Zielwechsel bei Basisbeschuss: Taucht während einer Salve auf eine Basis eine Figur auf, läuft die Salve auf die Basis zu Ende (heutige Salvenregel). Soll stattdessen sofort umgeschwenkt werden? | Salve läuft zu Ende |

## 12 Technische Anknüpfungspunkte

| Bereich | Anknüpfungspunkt |
|---|---|
| Zielwahl, Drehen, Feuerraten, Salven, Feuerquellen | [TurretSystem](../../src/systems/TurretSystem.ts) |
| Turmliste, Feuerquellen-Provider, Einsatz-Owner, Waffenabgabe | [WorldCombatGameplayBinding](../../src/world/WorldCombatGameplayBinding.ts), [WorldMgTurretBinding](../../src/world/WorldMgTurretBinding.ts) |
| Reine Feuerleit-Regeln und Snapshot | `src/systems/fireControl/` ([FireControlSnapshot](../../src/systems/fireControl/FireControlSnapshot.ts)) |
| Basis als Zielstufe | `src/systems/TurretBaseTargeting.ts`; Vorlage [WorldAttackDroneBinding](../../src/world/WorldAttackDroneBinding.ts) |
| Portaltransfer bei Schussabgabe | [WorldProjectileRuntime](../../src/projectile/WorldProjectileRuntime.ts), [PortalTraversal](../../src/systems/PortalTraversal.ts), [PortalDamagePayload](../../src/combat/PortalDamagePayload.ts) |
| Nutzungszustand der Utilities | [PlayerUtilityActionRuntime](../../src/world/PlayerUtilityActionRuntime.ts) |
| Platzierungsvorschau | `ArenaInputBindings`, `PlacementPreviewRenderer`, `InputSystem.beginPlacementUtilityAim` |
| Startausrüstung und Profile | [coopDefenseUpgrades](../../src/utils/coopDefenseUpgrades.ts) |
| Vergleichbare Portalfähigkeit | [Translocator GDD](Fragdachse_GDD_Translocator_Utility_Rework_v2.md) |
| Architektur und Prüfung | [Architektur-Leitbild](../ai/architecture-principles.md), [Gameplay-Verträge](../ai/gameplay.md), [Testregeln](../ai/testing.md) |
