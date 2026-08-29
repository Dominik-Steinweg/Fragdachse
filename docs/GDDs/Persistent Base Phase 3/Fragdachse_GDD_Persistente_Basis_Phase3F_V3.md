# Fragdachse – GDD Persistente Basis
## Phase 3F – Repositioning & Radial Menu V2

**Status:** Implementierungs-GDD V3  
**Referenzstand:** `c35b705b47d57a318b04cce0bcbd7480d11d3d46` (`PB 3E-2`)  
**Voraussetzung:** Phase 3C, 3D und 3E abgeschlossen  
**Ziel:** Abschluss der Persistent-Base-Phase 3 durch ein einheitliches Coop-Defense-Aktionsradial für alle Klassen sowie atomisches Repositioning persönlicher Konstruktionen und Base-owned Rewards.


## 1. Zielbild

Phase 3F führt die bisher getrennten Bedienpfade für Konstruktionen, Utilities, temporäre Utilities, Persistent-Base-Rewards und Verwaltungsaktionen in einem gemeinsamen Aktionsmodell zusammen.

Für alle Coop-Defense-Klassen gilt anschließend:

```text
R halten
→ Radial Menu V2 öffnen
→ Richtung / Eintrag wählen
→ R loslassen
→ Aktion auswählen

E
→ ausgewählte Aktion verwenden / Interaktionsmodus starten
```

Platzierungs- und Management-Modi verwenden zusätzlich:

```text
E oder LMB
→ bestätigen

R oder RMB
→ abbrechen
```

Das Radial bleibt in Phase 3F bewusst **flat**. Kategorien dürfen im Datenmodell existieren, erzeugen aber noch keine Untermenüs oder mehrstufige Navigation.

Die zweite Säule von 3F ist Repositioning:

```text
Verschieben auswählen
→ bestehendes Objekt als Quelle auswählen
→ Ziel über vorhandene Placement-Vorschau wählen
→ Host validiert Quelle und Ziel
→ bestehendes Objekt atomar verschieben
```

Repositioning ist ausdrücklich **kein**:

```text
Dismantle
→ neues Objekt bauen
```

Nach 3F soll die Persistent Base als produktionsfähiges Phase-3-System gelten. Größere spätere Systeme wie Structure Occupancy, Wachturm oder Dachsbau bleiben außerhalb dieses GDDs.

---

## 2. Relevanter Ausgangsstand

Dieses GDD beschreibt nur die Änderungen gegenüber dem nach Phase 3E vorhandenen System.

### 2.1 Aktuelles Radial

Das vorhandene `InspectorToolRadialMenu` ist bereits teilweise verallgemeinert, aber fachlich weiterhin Inspector-zentriert.

Die aktuelle Selection-Domain kennt im Wesentlichen:

```ts
tool
persistent-reward
dismantle
global-dismantle
```

Das Menü zeigt derzeit unter anderem:

- Konstruktionen,
- unplatzierte Persistent-Base-Rewards,
- Rückbau,
- globalen Rückbau,
- statische Cooldown-Dauern,
- Baukapazitätskosten.

`ConstructionToolRadialMenu` ist aktuell lediglich ein Alias auf die Inspector-Implementierung. Phase 3F soll daraus einen tatsächlich neutralen Aktionspfad machen.

### 2.2 Parallele Input-Zustände

`InputSystem` hält momentan mehrere getrennte Selection-/Interaction-Zustände, unter anderem für:

- normale Utility,
- normale Konstruktionen,
- Inspector-Konstruktionen,
- Persistent-Base-Rewards,
- Dismantle,
- Global Dismantle,
- Utility Placement,
- temporäre Utility Overrides.

Diese Zustände waren für die schrittweise Entwicklung sinnvoll, sollen nach 3F aber nicht mehr als konkurrierende Auswahlmodelle bestehen bleiben.

### 2.3 Construction Access

`ConstructionAccessResolver` ist bereits die gemeinsame fachliche Quelle für:

- freigeschaltet,
- klassenerlaubt,
- im Loadout aktiv,
- tatsächlich platzierbar als Construction Action.

Diese Auflösung bleibt erhalten. Das Radial darf keine parallelen Unlock-/Class-Regeln nachbauen.

### 2.4 Cooldown-Zustände

Utility-Cooldowns werden bereits als autoritative `cooldownUntil`-Werte repliziert.

Auch Construction Build Cooldowns werden beim erfolgreichen Bauen über denselben bestehenden Cooldown-Kanal unter der jeweiligen Construction-ID veröffentlicht.

Das Radial V2 soll diese **laufenden** Zustände verwenden. Die bisherige reine Anzeige von `cooldownMs` aus der Definition reicht nicht mehr.

### 2.5 Persistent Base Reward State

`PersistentBaseRewardStore` besitzt aktuell:

- `committed`,
- `baseline`,
- `working`,
- `placements`,
- `everPlacedRewardIds`.

In 3D wurde `everPlacedRewardIds` absichtlich verwendet, um ein nach Dismantle erneut platzierbares Reward vor 3F zu verhindern.

Diese Zwischenregel endet mit 3F.

### 2.6 Persönliche Persistent-Base-Contributions

`PersistentBaseContributionStore` besitzt bereits:

- stabile `persistentId`,
- `placementOrder`,
- Ownership pro `ownerId`,
- committed/baseline/working,
- Runtime-Bindings zu materialisierten Objekten.

Es gibt noch keine atomare Move-Mutation. Genau diese wird in 3F ergänzt.

---

## 3. Architekturprinzip: ein Aktionsmodell, keine Mega-Gameplayklasse

Radial Menu V2 soll eine gemeinsame **Auswahl- und Präsentationsdomain** schaffen.

Es soll **nicht** alle Gameplay-Systeme in einem neuen zentralen Manager zusammenziehen.

Konzeptionell soll ein Action Descriptor mindestens ausdrücken können:

```ts
type RadialActionCategory =
  | 'construction'
  | 'utility'
  | 'temporaryUtility'
  | 'persistentReward'
  | 'managementAction'
  | 'specialPower'; // perspektivisch
```

Ein konkreter Descriptor braucht sinngemäß:

```text
stable action identity
category
label / icon
selected state
visible
available
disabled reason
cooldown until
cooldown duration
charges / amount, falls vorhanden
capacity cost, falls vorhanden
placement / targeting behavior
domain-specific action reference
```

Die finalen TypeScript-Namen dürfen an die aktuelle Architektur angepasst werden.

Wichtig ist die Trennung:

```text
Domain-Systeme
→ liefern Action State / Action Identity

Radial Action Resolver
→ vereinigt und sortiert die Actions

Radial Menu
→ rendert nur und liefert eine Selection zurück

Input / RPC Dispatch
→ delegiert die Selection wieder an das zuständige Domain-System
```

Das Radial selbst darf insbesondere nicht entscheiden:

- ob eine Construction wirklich freigeschaltet ist,
- ob ein Reward wirklich platziert werden darf,
- ob ein Utility wirklich Charges besitzt,
- ob ein fremdes Objekt verschoben werden darf,
- ob ein Host-Request autorisiert ist.

Diese Entscheidungen bleiben in den bestehenden fachlichen Systemen.

### 3.1 Kein Zwang zu einem Mega-RPC

Ein gemeinsames Radial bedeutet nicht, dass alle Aktionen über denselben Netzwerk-RPC laufen müssen.

Bestehende spezialisierte host-autoritative Pfade dürfen erhalten bleiben, z. B.:

- Loadout-/Utility-Use,
- Persistent-Base-Reward-Placement,
- Construction Placement,
- Management-/Move-Requests.

Entscheidend ist eine gemeinsame Action Identity auf der Client-Seite und eine eindeutige hostseitige Validierung.

Der Host darf nicht aus einem rein lokalen Radialzustand erraten, welche Aktion der Client gemeint hat.

---

## 4. Radial Menu V2 – Bedienung

### 4.1 Geltungsbereich

Das neue Radial gilt für **alle Coop-Defense-Klassen**.

Es ist kein allgemeiner Zwangsumbau der übrigen Spielmodi.

Andere Modi sollen nur dann denselben UI-Baustein wiederverwenden, wenn dies ohne eigene Phase-3F-Sonderregeln möglich ist.

### 4.2 Öffnen und Auswahl

Standard:

```text
R gedrückt halten
→ Radial öffnen

Pointer bewegen
→ Eintrag hervorheben

R loslassen
→ hervorgehobenen Eintrag auswählen
```

Das Loslassen von `R` **wählt** die Aktion nur aus. Es führt sie nicht automatisch aus.

### 4.3 Aktionsausführung

```text
E
→ ausgewählte Aktion ausführen
```

Je nach Action führt `E` entweder direkt zur Ausführung oder startet einen bestehenden Interaktionsmodus, z. B.:

- Throw Charge,
- Targeting,
- Placement,
- Dismantle Targeting,
- Reposition Source Selection.

### 4.4 Placement-/Management-Bestätigung

In einem aktiven Placement- oder Repositioning-Modus:

```text
E
oder
LMB
→ bestätigen
```

Der bestehende Pointer-Handoff/Consume-Mechanismus muss weiterverwendet werden, damit ein bestätigender LMB nicht zusätzlich Waffe 1 abfeuert.

### 4.5 Abbruch

In einem aktiven Placement-, Dismantle- oder Repositioning-Modus:

```text
R
oder
RMB
→ abbrechen
```

Der Abbruch-Gesture wird konsumiert.

Insbesondere:

```text
R während eines aktiven Interaktionsmodus
→ nur abbrechen
→ nicht mit demselben Tastendruck zusätzlich das Radial öffnen
```

Für ein anschließendes Öffnen des Radials ist ein neuer `R`-Press erforderlich.

Analog darf ein RMB-Abbruch nicht im selben Gesture Waffe 2 auslösen.

### 4.6 Flat Menu

Phase 3F verwendet genau einen flachen Ring.

Keine:

- Unterkategorien,
- Untermenüs,
- Page-Navigation,
- inneren/äußeren Aktionsringe.

Das Datenmodell darf Kategorien kennen, damit eine spätere UX-Iteration ohne erneuten Domain-Umbau möglich bleibt.

---

## 5. Inhalt und Reihenfolge des Radials

Die konkrete Anzahl der Einträge hängt von Klasse, Loadout, Rewards und aktuellem World-State ab.

Eine stabile, deterministische Reihenfolge ist wichtig, damit Einträge nicht ständig ihre Position ändern.

Empfohlene Reihenfolge:

```text
1. normale ausgerüstete Utility / Utility-Action
2. temporäre Utility-Instanzen in stabiler Pickup-Reihenfolge, falls vorhanden
3. aktive Konstruktionen in Loadout-/Slot-Reihenfolge
4. unplatzierte Persistent-Base-Rewards
5. Management: Verschieben
6. Management: Rückbau
7. Management: Alle eigenen zurückbauen
```

Wenn eine Utility fachlich bereits als Construction normalisiert wird, z. B. eine shared Utility-Construction, darf sie nicht doppelt als:

```text
Utility
+
Construction
```

im Radial erscheinen.

Die bestehende kanonische Construction Identity soll weiterverwendet werden.

---

## 6. Sichtbarkeit und Disabled-State

### 6.1 Nicht freigeschaltete Inhalte

Noch nicht freigeschaltete Gameplay-Inhalte werden nicht gezeigt.

Beispiele:

- nicht freigeschaltete Construction,
- noch nicht freigeschalteter Persistent-Base-Reward.

Das Gameplay-Radial ist kein Progression-Teaser.

### 6.2 Freigeschaltet, aber aktuell nicht nutzbar

Ein grundsätzlich verfügbarer Eintrag bleibt sichtbar, wenn er nur temporär blockiert ist.

Beispiele:

- Cooldown aktiv,
- zu wenig freie Construction Capacity,
- keine Charges,
- Spieler darf gerade nicht agieren,
- Placement-Kontext aktuell ungültig,
- Base-/World-Zustand erlaubt die Aktion momentan nicht.

Der Eintrag wird deaktiviert dargestellt und liefert einen fachlichen Sperrgrund.

### 6.3 Bereits platzierte Base Rewards

Ein bereits platzierter Persistent-Base-Reward wird **nicht** weiterhin als Reward-Placement-Eintrag im Radial dargestellt.

Zustände:

```text
locked
→ nicht sichtbar

unlocked + unplaced
→ Reward-Eintrag sichtbar

unlocked + placed
→ kein Reward-Placement-Eintrag
→ Verwaltung erfolgt über Move/Dismantle am World-Objekt

dismantled
→ wieder unlocked + unplaced
→ Reward-Eintrag erscheint erneut
```

### 6.4 Management Actions

Management Actions sind keine Campaign-Unlocks.

Sie sollen nur in einem World-/Loadout-Kontext angeboten werden, in dem die jeweilige Aktion fachlich Sinn ergeben kann.

Wenn eine Management Action grundsätzlich anwendbar ist, aber gerade kein gültiges Ziel unter dem Cursor liegt, bleibt die Aktion ausgewählt; die World-Vorschau zeigt lediglich ein ungültiges Ziel.

---

## 7. Einheitliche Selection für alle E-Aktionen

Nach 3F soll es eine kanonische lokale Selection für den aktuellen `E`-Action-Pfad geben.

Die bisher getrennten States wie:

- ausgewählte normale Construction,
- Inspector Tool,
- Inspector Persistent Reward,
- Dismantle Selection,
- Global Dismantle Selection,

sollen nach der 3F-Umstellung nicht mehr als parallel konkurrierende Auswahlquellen bestehen.

Eine Radial Selection verweist auf genau eine fachliche Action Identity.

Beispiele:

```text
utility:HE_GRENADE
temporaryUtility:<instanceId>
construction:rocket_turret
persistentReward:base_health_pedestal
management:reposition
management:dismantle
management:dismantle-own-all
```

Die konkrete String-/Union-Darstellung ist Implementierungsdetail.

### 7.1 Alte Selection-Pfade entfernen

Nach erfolgreicher 3F-Umstellung sollen parallele Construction-Auswahlwege entfernt werden, wenn sie dasselbe Konzept unabhängig vom Radial steuern. Alte Pfade sollen nicht nur aus Kompatibilitätsgründen neben dem neuen Modell bestehen bleiben.

Dazu gehören insbesondere alte Inspector-/Non-Inspector-Sonderauswahlen wie:

- separate Radial Selection States,
- Wheel-Cycling als zweites autoritatives Construction-Auswahlmodell,
- Number-Key-Selection als zweites autoritatives Construction-Auswahlmodell.

Falls Number Keys oder Wheel aus UX-Gründen später wieder gewünscht werden, sollen sie lediglich die **gleiche** zentrale Action Selection verändern und kein eigenes Selection-System besitzen.

Für Phase 3F ist das Radial der kanonische Auswahlweg.

---

## 8. Normale Utilities

Die ausgerüstete normale Utility jedes Spielers gehört in Radial Menu V2.

Beispiel:

```text
Dachs Nukem
→ HE-Grenade im Radial
→ auswählen
→ E verwendet HE-Grenade über den vorhandenen Utility-Aktivierungspfad
```

Bestehende Utility-Aktivierungsformen bleiben erhalten:

- instant,
- charged throw,
- targeting,
- placement,
- andere bestehende Activation Contracts.

Das Radial ersetzt nicht die Utility-Gameplaylogik. Es bestimmt nur, welche `E`-Action aktiv ist.

---

## 9. Temporäre Utilities

Temporäre Utilities wie:

- Nuke,
- BFG,
- Holy Hand Grenade,
- bestehende Objective-Placement-Overrides,

werden als **eigenständige Runtime-Instanzen** behandelt und als zusätzliche Einträge im Radial dargestellt.

Sie ersetzen im UI nicht mehr unsichtbar die normale Utility.

### 9.1 Multi-Instance-Modell

Ein Spieler kann gleichzeitig beliebig viele temporäre Utility-Instanzen besitzen. Phase 3F führt **keine künstliche Gameplay-Begrenzung** ein.

In normalen Spielsituationen ist davon auszugehen, dass meist höchstens ein bis zwei temporäre Utilities gleichzeitig vorhanden sind. Diese Erwartung ist aber keine technische Obergrenze.

Jeder erfolgreiche Pickup erzeugt eine eigene Instanz mit stabiler Runtime-Identität, sinngemäß:

```text
temporaryUtilityInstanceId
utilityId
charges / remaining uses
cooldown / runtime state
acquisitionOrder
```

Die konkrete Datenstruktur ist Implementierungsdetail. Entscheidend ist:

```text
Utility-Typ != Utility-Instanz
```

Dadurch sind auch mehrere Instanzen desselben Typs erlaubt.

Beispiel:

```text
Nuke A eingesammelt
Nuke B eingesammelt

→ zwei getrennte Nuke-Instanzen
→ zwei getrennte Radial-Actions
→ keine Zusammenfassung zu einem einzigen künstlichen Slot
```

Die Instanzen dürfen unterschiedliche Charges, Cooldowns oder sonstige Runtime-Zustände besitzen.

### 9.2 Radial-Darstellung

Jede aktuell verfügbare Temporary-Utility-Instanz erzeugt genau einen eigenen Radial-Eintrag.

Mehrere identische Utilities werden nicht zu einem gemeinsamen Eintrag mit implizitem Stack zusammengefasst. Das Radial muss sie als getrennte Actions behandeln, weil ihre Runtime-Zustände unabhängig sein können.

Innerhalb der Temporary-Utility-Gruppe gilt eine stabile Pickup-Reihenfolge. Ein neuer Pickup darf bestehende Instanzen nicht ersetzen oder verdrängen.

Das Flat-Radial bleibt auch bei mehreren temporären Utilities bestehen. Eine ungewöhnlich hohe Anzahl darf die Gameplay-Collection nicht künstlich begrenzen oder Pickups verwerfen.

### 9.3 Pickup und Auto-Selection

Beim erfolgreichen host-bestätigten Pickup:

```text
neue Temporary-Utility-Instanz anlegen
→ bisherige Radial Selection als Rückkehrreferenz merken
→ neue Instanz als zusätzliche Action verfügbar machen
→ zuletzt eingesammelte Instanz automatisch auswählen
```

**Immer die zuletzt eingesammelte Temporary-Utility-Instanz wird automatisch ausgewählt.**

Beispiel:

```text
HE-Grenade ausgewählt
→ Nuke A Pickup
→ Nuke A ausgewählt
→ BFG Pickup
→ BFG ausgewählt
→ Nuke B Pickup
→ Nuke B ausgewählt
```

Alle vorher eingesammelten, noch verfügbaren temporären Utilities bleiben gleichzeitig im Radial vorhanden.

### 9.4 Normale Utility bleibt unabhängig

Die ausgerüstete normale Utility bleibt jederzeit als eigener Radial-Eintrag vorhanden und auswählbar.

Der Spieler darf frei zwischen:

```text
normaler Utility
Temporary Utility A
Temporary Utility B
Temporary Utility C
...
```

wechseln.

### 9.5 Nutzung, Verbrauch und Selection-Persistenz

Die aktuell ausgewählte Action bleibt grundsätzlich ausgewählt, solange genau diese Action nach der Nutzung weiterhin verfügbar ist.

Es gibt **keinen generischen Restore der vorherigen Selection nach jeder Aktion**. Insbesondere bleiben folgende Management-Aktionen nach erfolgreicher Ausführung ausgewählt:

```text
Verschieben
Rückbau
```

Auch eine Temporary-Utility-Instanz bleibt ausgewählt, wenn sie nach der Nutzung noch Charges besitzt und damit weiterhin verfügbar ist.

Eine vorherige Selection wird nur dann wiederhergestellt, wenn die aktuell genutzte Action nach ihrer Nutzung **nicht mehr verfügbar** ist. Typischer Fall:

```text
Action A ausgewählt
→ Temporary Utility X wird aufgenommen und automatisch ausgewählt
→ letzter Charge von X wird verbraucht
→ nur Instanz X verschwindet
→ vorherige noch gültige Selection wiederherstellen
```

Bei mehreren nacheinander eingesammelten temporären Utilities muss diese Rückkehrsemantik verschachtelt funktionieren. Beispiel:

```text
HE-Grenade ausgewählt
→ Nuke A Pickup      → Nuke A ausgewählt
→ BFG Pickup         → BFG ausgewählt
→ BFG verbraucht     → Nuke A wieder auswählen, falls noch vorhanden
→ Nuke A verbraucht  → HE-Grenade wieder auswählen, falls noch vorhanden
```

Dafür darf keine Logik verwendet werden, die nur genau einen globalen `previousSelection`-Slot für beliebig viele Auto-Selections voraussetzt, wenn dadurch die Rückkehrkette verloren geht.

Ist die gewünschte Rückkehrreferenz nicht mehr gültig, wird auf die jüngste noch gültige Rückkehrreferenz bzw. deterministisch auf eine sinnvolle Action zurückgefallen. Bevorzugter Fallback:

```text
zuletzt relevante noch verfügbare Action
→ sonst normale Utility
→ sonst erste verfügbare Action
→ sonst keine Selection
```

### 9.6 Host- und Runtime-Modell

Das aktuelle Utility-Override-Modell ersetzt intern den Utility-Slot temporär und speichert die vorherige Utility. Dieses Modell ist für das finale 3F-Ziel ungeeignet.

3F trennt deshalb fachlich:

```text
equipped base utility
!=
temporary utility collection
```

Die normale Utility behält ihre eigene Runtime und ihren eigenen Cooldown.

Temporäre Utilities werden in einer Collection unabhängiger Instanzen gehalten. Ein sauberer Zielzustand ist sinngemäß:

```text
baseUtility
temporaryUtilityInstances[]
selectedRadialActionRef
```

Keine permanente Hin-und-her-Umschaltung des `loadout.utility`-Objekts beim Radialwechsel.

Die bisherige Slot-Swap-/Single-Override-Architektur soll nach der Umstellung nicht als paralleler Kompatibilitätspfad weitergeführt werden, sofern sie nicht außerhalb des 3F-Geltungsbereichs weiterhin fachlich benötigt wird.

### 9.7 Identität und Netzwerk

Da zwei Instanzen denselben `utilityId` besitzen dürfen, reicht die Utility-ID zur eindeutigen Auswahl oder Nutzung nicht aus.

Jede Temporary-Utility-Instanz benötigt eine eindeutige host-autoritativ nachvollziehbare Instanz-ID.

Requests und replizierter State müssen deshalb sinngemäß unterscheiden können:

```text
NUKE instance A
NUKE instance B
```

Ein Use-Request referenziert die konkrete Instanz, nicht nur den Utility-Typ.

Der Host validiert:

- Instanz existiert,
- Instanz gehört dem Player,
- Charges/State erlauben Nutzung,
- Cooldown/Activation Contract ist erfüllt.

Nur die verwendete Instanz wird verändert oder entfernt. Andere Instanzen desselben Typs bleiben unberührt.

---

## 10. Laufende Cooldowns und Charges im Radial

### 10.1 Keine statische Dauer als Status

Die bisherige Anzeige:

```text
Cooldown: X Sekunden
```

 aus der reinen Definition reicht nicht.

Radial V2 verwendet den echten laufenden Zustand:

```text
cooldownUntil
now
cooldownDuration
→ remaining / progress
```

### 10.2 Bestehende Quellen wiederverwenden

Für normale und temporäre Utilities sollen vorhandene autoritative Cooldown-Werte genutzt werden.

Für Constructions existiert bereits der bestehende Cooldown-Kanal unter der Construction-ID.

Es soll keine zweite parallele Cooldown-Replikation nur für das Radial entstehen.

### 10.3 Darstellung

Ein Eintrag auf Cooldown:

- bleibt sichtbar,
- ist nicht ausführbar,
- wird abgedunkelt,
- zeigt einen radialen Cooldown-Fill,
- kann eine Restzeit anzeigen.

### 10.4 Charges

Wenn eine Action Charges besitzt:

- verbleibende Anzahl im Eintrag anzeigen,
- `0` Charges → disabled oder Action wird entfernt, abhängig vom fachlichen Lifecycle,
- nach vollständigem Verbrauch nur die betroffene Temporary-Utility-Instanz aus dem Radial entfernen.

---

## 11. All-Class Persistent-Base-Management

Die bisherige Inspector-Sonderrolle für Base-owned Rewards endet mit 3F.

Alle Coop-Defense-Klassen dürfen – sofern der aktuelle Player-/World-Capability-State dies erlaubt – Base-owned Rewards:

- platzieren,
- verschieben,
- zurückbauen.

Das Ownership-Modell selbst ändert sich nicht:

```text
Base Reward gehört der Host-Basis
!=
Spieler, der den Request ausgelöst hat
```

Der ausführende Spieler erhält dadurch kein persönliches Ownership.

### 11.1 Host Authority

Jeder berechtigte Spieler darf Management-Requests stellen.

Der Host entscheidet autoritativ.

Bei konkurrierenden Requests gilt:

```text
first valid host-accepted mutation wins
```

Ein späterer Request muss gegen den danach aktuellen State erneut validiert und gegebenenfalls abgelehnt werden.

### 11.2 World Revision

Move-/Placement-/Dismantle-Requests bleiben an die aktuelle World Revision gebunden.

Ein Request aus einer alten World darf nicht auf die neue Lobby-/Mission-Instanz angewandt werden.

---

## 12. Ownership-Regeln für persönliche Konstruktionen

Für **Verschieben und Rückbau gelten dieselben Rechte**.

### Eigene persönliche Konstruktion

Der Owner darf:

- verschieben,
- zurückbauen.

### Fremde persönliche Konstruktion

Andere Spieler – einschließlich Host – dürfen über den normalen Management-Pfad nicht:

- verschieben,
- zurückbauen.

Der Host bleibt technische Autorität, erhält dadurch aber keine zusätzliche Gameplay-Besitzberechtigung.

### Base-owned Reward

Jeder berechtigte Spieler darf:

- verschieben,
- zurückbauen.

### Global Dismantle

`Alle eigenen zurückbauen` steht allen Klassen zur Verfügung.

Es entfernt ausschließlich:

```text
persönliche Konstruktionen des auslösenden Players
```

Es entfernt niemals:

- fremde Contributions,
- Base-owned Rewards,
- authored World-Objekte.

Die bereits vorhandene owner-basierte Bulk-Removal-Logik soll weiterverwendet werden.

---

## 13. Persistent-Base-Reward Lifecycle nach 3F

Nach 3F gilt:

```text
locked
→ kein Zugriff

unlocked + unplaced
→ platzierbar

unlocked + placed
→ nicht als Placement-Action sichtbar
→ repositionierbar
→ dismantlebar

dismantled
→ unlocked + unplaced
→ erneut platzierbar
```

### 13.1 `everPlacedRewardIds` aufräumen

Die 3D-Zwischenregel `everPlacedRewardIds` wird in 3F nicht mehr benötigt, um Re-Place zu blockieren.

Kanonisches Placement-Gate:

```text
Reward ist freigeschaltet
AND
Reward besitzt aktuell kein Placement
→ placeable
```

`everPlacedRewardIds` wird in 3F **vollständig aus Domain-Modell, Save-State und Hilfslogik entfernt**. Seine einzige Phase-3D-Aufgabe – Re-Place vor 3F zu blockieren – entfällt mit dem finalen Reward-Lifecycle.

Es wird kein Ersatz-Historienfeld nur zur Kompatibilität mit älteren Persistent-Base-Ständen eingeführt.

Sauberer finaler Code hat hier Vorrang vor dem Laden älterer Zwischenstände.

### 13.2 Status-Helfer

Ein Status wie:

```text
unplaced
```

muss nach 3F tatsächlich bedeuten:

```text
freigeschaltet
+
aktuell nicht platziert
+
grundsätzlich wieder platzierbar
```

Hilfsfunktionen leiten Placeability ausschließlich aus Unlock- und aktuellem Placement-State ab; ein historisches Placeability-Gate existiert nicht mehr.

---

# 14. Repositioning – UX

## 14.1 Start

Radial:

```text
Verschieben
```

auswählen.

Danach:

```text
E
→ Move Source Selection starten
```

## 14.2 Quelle wählen

Der Spieler zielt auf ein vorhandenes, für ihn verschiebbares Objekt.

Gültige Quellen:

- eigene persönliche persistente Konstruktion,
- Base-owned Persistent-Base-Reward.

Ungültige Quellen:

- fremde persönliche Konstruktion,
- authored World-Geometrie,
- normale Map-Felsen,
- nicht persistente fremde Runtime-Objekte,
- nicht materialisierte/dormante Blueprints ohne World-Objekt.

Die Quellprüfung soll dieselbe Ownership-Domain wie Dismantle verwenden.

## 14.3 Move Preview

Nach erfolgreicher Quellwahl:

- Originalobjekt bleibt vollständig in der World aktiv,
- ein Placement Ghost zeigt das potenzielle Ziel,
- bestehende Placement-Regeln liefern `valid/invalid`.

Das Original darf während der Vorschau nicht temporär entfernt werden.

Damit bleiben während der Vorschau erhalten:

- Collision,
- Enemy Targeting,
- HP,
- Turret-Funktion,
- Pedestal-Funktion,
- Multiplayer-Sichtbarkeit.

## 14.4 Bestätigung

```text
E
oder
LMB
→ Move Request an Host
```

## 14.5 Abbruch

```text
R
oder
RMB
→ Move vollständig abbrechen
```

Ergebnis:

```text
Original unverändert
kein Persistenz-Delta
kein Cooldown
```

Ein ungültiges Ziel verändert die Quelle ebenfalls nicht.

## 14.6 Selection nach erfolgreichem Move

Nach einem erfolgreichen Move bleibt die Action `Verschieben` ausgewählt.

```text
Verschieben ausgewählt
→ Objekt A verschieben
→ Verschieben bleibt ausgewählt
→ Objekt B kann direkt als neue Quelle gewählt werden
```

Es wird **keine** vorherige normale Utility-/Construction-Selection restauriert. Restore-Semantik ist ausschließlich für automatisch ausgewählte Actions vorgesehen, die nach ihrer Nutzung nicht mehr verfügbar sind, insbesondere verbrauchte Temporary Utilities.

---

# 15. Repositioning – fachliche Mutation

Repositioning verändert die bestehende Entität.

Es erzeugt semantisch kein neues Objekt.

## 15.1 Persönliche Konstruktionen

Erhalten bleiben:

- `persistentId`,
- `ownerId`,
- `placementOrder`,
- Tool-/Construction-Provenienz,
- aktuelles Runtime-HP,
- Runtime-relevante persistente Metadaten,
- bestehende Ownership.

Geändert werden:

- relative Grid-Position,
- gegebenenfalls Winkel,
- Runtime-World-Position / Grid Binding.

### HP

Die vorhandenen Persistent Blueprints speichern aktuell kein HP.

3F soll deshalb **kein neues HP-Persistenzmodell** einführen.

Die Regel lautet ausschließlich:

```text
Repositioning innerhalb derselben Runtime
→ aktuelles HP bleibt unverändert
→ Move heilt das Objekt nicht
```

Das bestehende Map-/Round-Persistenzmodell für HP bleibt unverändert.

## 15.2 Runtime Identity

Bevorzugt wird ein echter Relocate-Pfad im `PlacementSystem`:

```text
bestehende Runtime-ID
→ Grid-Binding atomar auf neue Zelle verschieben
```

Dadurch bleiben Referenzen und Runtime-State stabil.

Ein Remove+Create-Pfad, der:

- neue Runtime-ID,
- volle HP,
- neue Construction-Lifecycle-Effekte,
- erneute Build-Sounds/Build-Semantik

erzeugt, ist nicht zulässig.

## 15.3 Flüchtige Combat-Zustände

Nicht jeder flüchtige Targeting-Zustand muss persistiert werden.

Beispiele:

- aktuelles Turret Target darf neu aufgelöst werden,
- laufende Projektile bleiben unabhängig,
- rein visuelle Transienten dürfen neu aufgebaut werden.

Bestehende Cooldown-/Use-Zustände des Objekts sollen erhalten bleiben, soweit sie an derselben Runtime hängen.

---

## 16. Neue Store-Mutation für persönliche Contributions

`PersistentBaseContributionStore` benötigt einen atomaren Move-Vertrag.

Sinngemäß:

```text
move existing blueprint
(ownerId, persistentId, target)
```

Der Store muss:

1. aktuellen Owner-/Blueprint-State prüfen,
2. `persistentId` erhalten,
3. `placementOrder` erhalten,
4. nur Position/Winkel ändern,
5. committed/working-Regeln wie bei anderen Mutationen respektieren,
6. Runtime-Binding auf denselben Blueprint aktualisieren,
7. bei Ablehnung unverändert bleiben.

### Mission

```text
Mission aktiv
→ Move verändert Working State
→ Victory committed
→ Defeat/Abort rollback auf Baseline
```

### LobbyWorld/Testgelände

```text
keine Mission
→ host-bestätigter Move wird unmittelbar committed
```

Für Gast-Contributions gelten dieselben vorhandenen Confirmation-/Owner-Save-Regeln wie bei Build/Dismantle.

Es darf kein separater „Guest Move Save“ entstehen.

---

## 17. Repositioning – Placement-Validierung

Die vorhandenen Geometriequellen bleiben maßgeblich:

- World Metrics,
- authored Geometry,
- Rock Grid,
- Hazard-/Barrier-Regeln,
- `PersistentBaseBuildArea`,
- Reward Placement Domain,
- Construction Footprint,
- Player-/Placement Range,
- Occupancy-/Conflict-Regeln.

Move darf keine vereinfachte zweite Placement-Prüfung implementieren.

### 17.1 Source-Zelle bei der Zielprüfung

Das zu verschiebende Objekt darf seine eigene aktuelle Belegung nicht als Zielkonflikt verursachen.

Die Zielvalidierung muss deshalb die Quelle kontrolliert als „movable source“ ignorieren können, ohne andere Occupancy-Regeln abzuschalten.

### 17.2 Persönliche Construction

Für persönliche Konstruktionen gelten dieselben Zielregeln wie beim regulären Bauen desselben Konstruktionstyps.

### 17.3 Base Turret Reward

Base Turrets bleiben auf:

```text
base-surface
```

beschränkt.

Die durch 3E vergrößerte Build Area erzeugt weiterhin keine zusätzlichen Base-Turret-Slots.

### 17.4 Base Pedestal Reward

Base Pedestals verwenden weiterhin die aktive `PersistentBaseBuildArea`.

Stage 0/1 aus 3E bleibt die einzige Build-Area-Geometriequelle.

---

## 18. Konflikte mit Personal Contributions

Die in 3D definierte Priorität bleibt erhalten:

```text
authored/core
> Base-owned Reward
> Host Personal Contribution
> Guest Personal Contribution
```

### Reward wird auf persönliche Construction verschoben

Ist die Zielzelle für den Reward fachlich zulässig und dort liegt eine persönliche persistente Construction:

```text
Reward gewinnt
→ Personal Runtime wird dormant
→ persönlicher Blueprint bleibt gespeichert
```

### Reward verlässt eine Konfliktzelle

Wird ein Reward von einer Zelle wegbewegt:

```text
Composite neu auflösen
→ zuvor verdrängte persönliche Construction kann wieder materialisiert werden
```

### Atomicity

Der Wechsel von:

```text
Reward auf A
→ Reward auf B
```

darf keinen Zwischenzustand erzeugen, in dem:

- Reward verloren geht,
- beide Placements persistiert sind,
- verdrängte Contributions gelöscht werden.

Nach erfolgreichem Move wird das bestehende Composite einmal gegen den neuen Zustand aufgelöst.

Bei Fehlschlag bleibt der vorherige Zustand vollständig erhalten.

---

# 19. Base Reward Repositioning

Der `PersistentBaseRewardStore` erhält einen Move-Vertrag für ein bereits platziertes Reward.

Sinngemäß:

```text
moveReward(rewardId, nextPlacement)
```

Dabei bleiben erhalten:

- Reward-ID,
- Unlock,
- Provenienz,
- fachlicher Reward-Typ.

Geändert werden nur:

- relative Grid-Position,
- Winkel.

### Revisionen

Wie bei anderen Reward-Mutationen:

```text
Lobby edit
→ committed Revision fortschreiben

Mission edit
→ Working State ändern
→ Revision beim Outcome-Commit
```

Ein Move darf nicht als:

```text
dismantleReward()
+
placeReward()
```

implementiert werden.

---

# 20. Power-up-Pedestals beim Repositioning

Persistent-Base-Reward-Pedestals besitzen im `PowerUpSystem` einen eigenen Runtime-Zustand.

Relevant sind unter anderem:

- `persistentRewardId`,
- Pedestal Runtime ID,
- Position,
- `currentUid`,
- `nextRespawnAt`,
- `respawnMs`,
- `spawnOnArenaStart`.

Deshalb ist folgende Implementierung ausdrücklich verboten:

```text
unregisterPersistentBaseRewardPedestal()
→ registerPersistentBaseRewardPedestal()
```

Dieser Pfad würde den bestehenden Item-/Respawn-Lifecycle verändern.

## 20.1 Dedicated Move Mutation

Das `PowerUpSystem` benötigt einen echten Move-Pfad, z. B. sinngemäß:

```text
repositionPersistentBaseRewardPedestal(
  rewardId,
  newX,
  newY
)
```

Der konkrete Name ist frei.

Er muss erhalten:

- Pedestal Runtime ID,
- `currentUid`,
- `nextRespawnAt`,
- Respawn-Konfiguration,
- Activation-State.

## 20.2 Aktuell vorhandenes Power-up

Beim Host-Commit wird der **dann aktuelle** Zustand geprüft.

### Power-up existiert noch

```text
Pedestal verschieben
+
aktuelles WorldItem auf neue Pedestal-Position verschieben
```

Das Item behält seine UID.

Es wird nicht neu gespawnt.

### Power-up wurde während der Move-Vorschau eingesammelt

```text
currentUid ist beim Commit nicht mehr vorhanden
→ nur Pedestal verschieben
→ kein neues Power-up erzeugen
```

Der bestehende Respawn-Timer läuft unverändert weiter.

## 20.3 Netzwerk

Wird ein vorhandenes WorldItem verschoben, müssen Power-up- und Pedestal-Snapshots die neue Position sauber ausliefern.

Kein Client darf:

- kurzzeitig Duplikate sehen,
- einen alten Pickup behalten,
- einen neuen Pickup mit neuer UID erhalten.

---

## 21. Atomarer Host-Commit beim Move

Ein Move ist ein host-autoritärer synchroner Commit.

Vor jeder Mutation validiert der Host erneut:

1. World Revision stimmt,
2. Player darf agieren,
3. Source existiert weiterhin,
4. Source ist noch dasselbe Objekt,
5. Ownership/Reward-Provenienz stimmt,
6. Source darf vom Player verwaltet werden,
7. Target ist noch gültig,
8. Target verletzt keine aktuellen Occupancy-/Placement-Regeln.

Erst danach wird mutiert.

### 21.1 Personal Construction Transaction

Sinngemäß:

```text
validate source + target
→ move runtime/grid binding
→ mutate persistent blueprint
→ refresh dependent systems
→ persist/publish according to mission/lobby semantics
```

Wenn ein nachgelagerter Schritt fehlschlagen kann, muss entweder:

- vor Mutation vollständig vorvalidiert werden,
- oder ein klarer Rollback auf Source State existieren.

### 21.2 Reward Transaction

Sinngemäß:

```text
validate reward placement + runtime
→ move reward store placement
→ move runtime/grid binding
→ bei Pedestal: move PedestalRuntime + optional current WorldItem
→ refresh composite
→ persist/publish
```

Kein teilweise verschobener Zustand darf sichtbar oder persistiert bleiben.

---

# 22. Construction- und Management-Cooldowns

Phase 3F vereinheitlicht die relevanten Coop-Defense-Construction-Cooldowns auf einen sehr kurzen Schutz gegen Doppelinput.

## 22.1 Build Cooldown

Alle aktuellen permanenten Coop-Defense-Constructions verwenden einen **Build Cooldown von 100 ms**.

Das gilt ausdrücklich auch für den Spore-Turret. Sein aktuell im zentralen Construction-Registry vorhandener Wert von `10.000 ms` ist ein historischer Refactor-Ausreißer und wird auf `100 ms` korrigiert.

Der Spore-Turret bleibt gleichzeitig permanent:

```text
lifetime / expiresAt
→ permanent

buildCooldownMs
→ 100 ms
```

Es gibt in 3F keinen Spore-Turret-Sonderfall mehr.

## 22.2 Repositioning

Repositioning besitzt einen festen **Management-Cooldown von 100 ms**:

```text
Move erfolgreich
→ 100 ms bis zum nächsten erfolgreichen Repositioning
```

Der Wert gilt unabhängig vom Objekt-Typ. Er wird nicht aus einem individuellen historischen Build-Cooldown abgeleitet.

## 22.3 Dismantle

Auch erfolgreicher Einzel-Rückbau verwendet **100 ms** Schutz gegen Doppelinput:

```text
Dismantle erfolgreich
→ 100 ms bis zum nächsten erfolgreichen Dismantle
```

Ungültige Versuche und Abbruch verbrauchen weder Move- noch Dismantle-Cooldown.

## 22.4 Keine weiteren Kosten

Repositioning:

- verbraucht keine zusätzliche Capacity,
- kostet keine Ressourcen,
- erzeugt keine neue Construction,
- setzt keine HP zurück.

---

## 23. Repositioning während Missionen

Repositioning ist erlaubt:

- in LobbyWorld/Testgelände,
- während laufender Coop-Defense-Missionen,
- während laufender Kampfphasen.

Es gibt keine zusätzliche Combat-Lockout-Regel.

Begründung:

```text
Bauen und Rückbau sind bereits während Missionen erlaubt.
Repositioning wird daher nicht künstlich stärker eingeschränkt.
```

Die bestehende hostseitige Player-Capability bleibt trotzdem bindend:

- tot,
- burrowed,
- spectator,
- nicht handlungsfähig,

darf weiterhin keine Management-Mutation ausführen, wenn der bestehende Capability-Vertrag dies verbietet.

---

# 24. Dismantle in 3F

Der bisherige Inspector-spezifische Base-Reward-Dismantle-Vertrag wird neutralisiert.

Für alle Klassen gilt derselbe Preview-/Host-Vertrag.

## 24.1 Personal

```text
own personal construction
→ valid

foreign personal construction
→ invalid
```

## 24.2 Base Reward

```text
base-owned persistent reward
→ valid für jeden berechtigten Coop-Spieler
```

Es darf nicht mehr vorkommen, dass:

```text
Client Preview = valid
Host = wegen Klasse invalid
```

Die klassenabhängige 3D-Zwischenregel entfällt vollständig.

## 24.3 Selection bleibt aktiv

Nach einem erfolgreichen Einzel-Rückbau bleibt die Action `Rückbau` ausgewählt.

```text
Rückbau ausgewählt
→ Objekt A zurückbauen
→ Rückbau bleibt ausgewählt
→ Objekt B kann direkt zurückgebaut werden
```

Der Spieler verlässt den Modus erst durch expliziten Action-Wechsel oder Abbruch.

---

# 25. Global Dismantle

Der bestehende globale Rückbau bleibt erhalten und wird für alle Coop-Klassen zugänglich.

Semantik:

```text
remove all own personal constructions
```

Nicht betroffen:

- Base Rewards,
- fremde persönliche Konstruktionen,
- authored Objekte.

Falls der bestehende Held-Action-/Bestätigungsmechanismus für Global Dismantle bereits zuverlässig funktioniert, soll er weiterverwendet und nur an die neue Action Selection angeschlossen werden.

Kein zweiter Bulk-Dismantle-Pfad.

---

# 26. HUD und Held-Item-Darstellung

Der lokale HUD-/Held-Item-State soll aus derselben kanonischen Action Selection abgeleitet werden.

Es darf nach 3F keinen Zustand geben, in dem:

```text
Radial zeigt Action A
HUD zeigt Action B
E führt Action C aus
```

Besonders zu prüfen:

- normale Utility,
- Temporary Utility,
- Construction,
- Persistent Reward,
- Move,
- Dismantle.

### Temporary Utility

Beim automatischen Select nach Pickup zeigt HUD/Held-Item sofort die zuletzt eingesammelte Temporary-Utility-Instanz.

Wechselt der Spieler zu einer anderen Temporary-Utility-Instanz oder zurück zur normalen Utility, muss auch die Held-Item-Darstellung folgen.

Verschwindet die aktuell ausgewählte Temporary-Utility-Instanz nach der Nutzung und wird deshalb eine vorherige Selection restauriert, muss die Held-Item-Darstellung diesem Restore ebenfalls folgen.

---

# 27. Radial Presentation

Das bestehende Radial-Rendering darf als Grundlage weiterverwendet werden.

Phase 3F verlangt keine vollständige grafische Neugestaltung.

Mindestens erforderlich:

- eindeutige Icons,
- Name,
- Selected/Hovered State,
- Disabled State,
- Capacity Cost bei Constructions,
- laufender Cooldown-Fill,
- Restzeit, wenn sinnvoll,
- Charges, wenn vorhanden.

### Flat-Menu-Lesbarkeit

Da Phase 3F bewusst ein Flat Menu verwendet, soll die Darstellung für die aktuell realistisch mögliche Entry-Anzahl robust bleiben.

Keine Einführung eines Kategorien-Systems nur aufgrund hoher Segmentzahl.

Falls die Zahl später UX-seitig problematisch wird, ist das ein Folgeprojekt.

---

# 28. Suggested Action-State Contract

Die konkrete API darf anders heißen. Als Leitbild:

```ts
interface RadialActionState {
  readonly ref: RadialActionRef;
  readonly category: RadialActionCategory;

  readonly label: string;
  readonly iconKey: string | null;

  readonly visible: boolean;
  readonly available: boolean;
  readonly disabledReason?: RadialActionDisabledReason;

  readonly cooldownUntil: number;
  readonly cooldownDurationMs: number;

  readonly charges?: number;
  readonly capacityCost?: number;
}
```

Mögliche `RadialActionRef`-Form:

```ts
type RadialActionRef =
  | { kind: 'utility'; utilityId: string }
  | { kind: 'temporary-utility'; instanceId: string; utilityId: string }
  | { kind: 'construction'; constructionId: ConstructionId }
  | { kind: 'persistent-reward'; rewardId: PersistentBaseRewardId }
  | { kind: 'management'; action: 'reposition' | 'dismantle' | 'dismantle-own-all' };
```

Dies ist ein Architekturbeispiel, keine Pflicht für exakt diese Typnamen.

Wichtig ist, dass die Action Identity:

- stabil,
- serialisierbar, wenn für Requests benötigt,
- hostseitig erneut validierbar,
- nicht an UI-Objekte gebunden

ist.

---

# 29. Bestehende Systeme weiterverwenden

Phase 3F soll insbesondere auf folgenden bestehenden Systemen aufbauen:

- `ConstructionAccessResolver`
- `PlacementSystem`
- `PersistentBaseContributionStore`
- `PersistentBaseRewardStore`
- Persistent Base Composite
- `PersistentBaseBuildArea`
- Reward Catalog / Reward Definitions
- `PowerUpSystem`
- bestehende Utility Activation Contracts
- bestehende Utility-/Construction-Cooldown-Replikation
- World Revision
- Player Capabilities
- Round Outcome Commit/Rollback
- bestehende Host-/Guest-Confirmation-Semantik
- Pointer Button Handoff
- bestehende Placement Preview Renderer

Keine parallelen Alternativen für diese Konzepte einführen.

---

# 30. Implementierungsschritte

## 3F-1 – Generic Action Model & Radial Menu V2 Foundation

Ziel: Die Auswahlarchitektur für alle Coop-Klassen vereinheitlichen, ohne Repositioning bereits vollständig umzusetzen.

### Änderungen

- neutralen Radial-Action-Typ einführen
- `InspectorToolRadialMenu` fachlich neutralisieren/ersetzen
- `R` öffnet das Radial bei allen Coop-Klassen
- Flat Menu
- stabile Sortierung
- normale Utility integrieren
- aktive Constructions integrieren
- unplatzierte Persistent Rewards integrieren
- Management Actions als Action-Refs integrieren
- Locked Content ausblenden
- temporär blockierte Actions sichtbar/disabled darstellen
- kanonische Selection für `E`
- alte Inspector-spezifische Selection-Sonderpfade vollständig entfernen, sobald ihre Aufrufer auf das neue Modell migriert sind
- Pointer-/R-Abbruchsemantik absichern
- `E/LMB`-Commit und `R/RMB`-Cancel als gemeinsamen Interaktionsvertrag vorbereiten

### Noch nicht zwingend in 3F-1

- vollständiger Temporary-Utility-Runtime-Refactor
- Repositioning-Store-Mutationen
- Pedestal-Item-Move

---

## 3F-2 – Utilities, Temporary Utilities & Live Radial State

Ziel: Alle Utility-Arten sauber über dasselbe Auswahlmodell bedienen.

### Änderungen

- Equipped Utility und Temporary-Utility-Collection fachlich trennen
- bisheriges Single-Slot-/Single-Override-Modell durch echte Multi-Instance-Collection ersetzen
- jede Temporary-Utility-Instanz erhält eine eindeutige Runtime-/Netzwerk-Identität
- mehrere Instanzen desselben Utility-Typs gleichzeitig erlauben
- keine künstliche Obergrenze für gleichzeitig gehaltene Temporary Utilities
- jede Instanz als eigenen Action-Eintrag anbieten
- Pickup → neue Instanz erzeugen und immer die zuletzt eingesammelte Instanz automatisch selecten
- Rückkehrreferenz/Selection-History so modellieren, dass mehrere aufeinanderfolgende Auto-Selections korrekt zurückkehren können
- nur wenn die aktuell genutzte Action nach Nutzung nicht mehr verfügbar ist → vorherige gültige Selection restaurieren
- bleibt die Utility-Instanz verfügbar, bleibt sie ausgewählt
- normale Utility bleibt während beliebig vieler Temporary Utilities auswählbar
- Objective-Placement-Temporary-Utilities ebenfalls als Instanzen integrieren
- Use-/State-Networking referenziert `instanceId`, nicht nur `utilityId`
- echte `cooldownUntil`-States im Radial verwenden
- Construction Cooldowns über bestehenden keyed Cooldown-State verwenden
- Charges darstellen
- Disabled Reasons vereinheitlichen
- HUD/Held-Item an kanonische Selection koppeln
- keine doppelte Darstellung von Utility-Constructions

---

## 3F-3 – All-Class Reward Management & Atomic Repositioning

Ziel: Finale Persistent-Base-Management-Semantik.

### Änderungen

- Base Reward Placement für alle Coop-Klassen erlauben
- Base Reward Dismantle für alle Coop-Klassen erlauben
- Personal Move/Dismantle strikt owner-basiert
- Global Dismantle für alle Klassen, nur eigene Contributions
- `everPlacedRewardIds` aus Reward-Domain und Save-State entfernen
- dismantled Reward wieder placeable machen
- Move Source Selection
- Move Placement Preview
- `PlacementSystem` um echten Relocate-Pfad erweitern
- `PersistentBaseContributionStore` um Move-Mutation erweitern
- `PersistentBaseRewardStore` um Move-Mutation erweitern
- World Revision / Host Authority / first-valid-wins
- 100-ms-Management-Cooldown für Move und Einzel-Rückbau
- Spore-Turret-Build-Cooldown auf 100 ms korrigieren; keine Construction-Sonderregel
- Reward-vs-Personal-Composite-Konflikte beim Move korrekt neu auflösen
- Base Turret Domain = `base-surface`
- Base Pedestal Domain = aktive Build Area
- Mission Working/Commit/Rollback für Moves

### Pedestal

- `PowerUpSystem` um echten Pedestal-Move erweitern
- `currentUid` und `nextRespawnAt` erhalten
- vorhandenes Item mit gleicher UID mitverschieben
- während Preview eingesammeltes Item nicht neu erzeugen
- kein unregister/register als Move-Implementierung

---

## 3F-4 – Cleanup, Regression & Phase-3-Abschluss

Ziel: Alte Zwischenpfade entfernen und Phase 3 produktionsfähig abschließen.

### Cleanup

- verbleibende `Inspector...`-Namen nur dort behalten, wo wirklich Inspector-spezifisch
- Radial-/Selection-Aliase bereinigen
- konkurrierende alte Selection-Pfade entfernen
- alte Single-Override-/Slot-Swap-Sonderlogik entfernen
- Dismantle-Preview auf finalen all-class Vertrag bringen
- HUD-/Input-Sonderfälle auf gemeinsamen Action State umstellen
- Kommentare aktualisieren, die 3D-/3E-Zwischenzustände beschreiben

### Regression

- Host
- Guest
- Latejoin/Reconnect, soweit bestehende Systeme dies unterstützen
- LobbyWorld
- Mission
- Victory Commit
- Defeat Rollback
- Stage 0
- Stage 1
- Base destroyed/inert
- Reward conflict with personal contribution
- Temporary Utility
- Construction Utility
- Personal ownership
- Base reward management
- Pedestal pickup during Move Preview

---

# 31. Testanforderungen

Source-String-Tests dürfen ergänzend bestehen, ersetzen für die Kernverträge aber keine Verhaltenstests.

## 31.1 Radial / Selection

Mindestens:

```text
alle Coop-Klassen
→ R öffnet dasselbe Radialmodell
```

```text
normale Utility ausgewählt
→ E dispatcht genau diese Utility
```

```text
Construction ausgewählt
→ E startet Placement
```

```text
Reward placed
→ Reward Placement Action verschwindet
```

```text
Reward dismantled
→ Reward Placement Action erscheint erneut
```

```text
R während Placement
→ Placement abbrechen
→ Radial öffnet nicht mit demselben Press
```

```text
RMB während Placement
→ abbrechen
→ Weapon 2 feuert nicht
```

## 31.2 Temporary Utilities

```text
normale Utility ausgewählt
→ Nuke A Pickup
→ Nuke A Action erscheint
→ Nuke A wird automatisch ausgewählt
→ normale Utility bleibt auswählbar
```

```text
Nuke A vorhanden
→ BFG Pickup
→ beide Temporary Actions bleiben vorhanden
→ BFG als zuletzt eingesammelte Instanz wird ausgewählt
```

```text
Nuke A Pickup
→ Nuke B Pickup

Erwartung:
→ zwei getrennte Nuke-Instanzen mit unterschiedlichen instanceIds
→ zwei getrennte Radial-Actions
→ keine Instanz wird ersetzt oder überschrieben
```

```text
Nuke A + Nuke B + BFG vorhanden
→ keine Gameplay-Obergrenze greift
→ alle drei Instanzen bleiben verfügbar und im Radial
```

```text
HE-Grenade ausgewählt
→ Nuke A Pickup
→ BFG Pickup
→ BFG letzten Charge verbrauchen
→ BFG Action verschwindet
→ Nuke A wird wieder ausgewählt, sofern noch vorhanden
→ Nuke A letzten Charge verbrauchen
→ HE-Grenade wird wieder ausgewählt, sofern noch vorhanden
```

```text
Temporary Utility besitzt nach Nutzung weiterhin Charges
→ dieselbe Instanz bleibt verfügbar
→ dieselbe Temporary Utility bleibt ausgewählt
```

```text
Nuke A und Nuke B vorhanden
→ Nuke B verwenden und verbrauchen
→ nur Nuke B wird entfernt
→ Nuke A bleibt unverändert vorhanden
```

```text
Rückkehrreferenz inzwischen ungültig
→ jüngste noch gültige Rückkehrreferenz verwenden
→ sonst deterministischer Fallback
```


## 31.3 Cooldowns

```text
Construction erfolgreich gebaut
→ Radial liest echten keyed cooldownUntil
→ Eintrag disabled bis readyAt
```

```text
Utility Cooldown
→ laufender Fill basiert auf aktuellem authoritative/predicted readyAt
```

Keine Prüfung nur auf statisches `cooldownMs`.

## 31.4 Ownership

```text
Player A personal construction
→ A Move valid
→ A Dismantle valid
```

```text
Player B auf A-Construction
→ Move invalid
→ Dismantle invalid
```

```text
Host auf Guest-Construction
→ ohne Ownership Move invalid
→ Dismantle invalid
```

```text
Base Reward
→ alle berechtigten Klassen Move/Dismantle valid
```

## 31.5 Management-Selection und Cooldown

```text
Verschieben ausgewählt
→ Move erfolgreich
→ Verschieben bleibt ausgewählt
→ weiterer Move nach 100 ms möglich
```

```text
Rückbau ausgewählt
→ Dismantle erfolgreich
→ Rückbau bleibt ausgewählt
→ weiterer Rückbau nach 100 ms möglich
```

```text
Spore-Turret bauen
→ permanent
→ Build Cooldown = 100 ms
```

## 31.6 Personal Repositioning

```text
Construction mit persistentId X
HP = 40/100
placementOrder = N

→ Move

danach:
persistentId X
HP = 40/100
placementOrder N
Owner unverändert
neue Position
```

Zusätzlich:

```text
ungültiges Ziel
→ Source vollständig unverändert
```

## 31.7 Mission Rollback

```text
Baseline Position A
→ während Mission Move nach B
→ Defeat
→ nächste Materialisierung Position A
```

```text
Baseline Position A
→ während Mission Move nach B
→ Victory
→ nächste Materialisierung Position B
```

## 31.8 Reward Re-place

```text
Reward unlocked
→ place
→ dismantle
→ canPlaceReward == true
→ erneut place
```

`everPlacedRewardIds` existiert im finalen 3F-Reward-State nicht mehr.

## 31.9 Reward Repositioning / Conflict

```text
Reward A auf Zelle X
Personal Blueprint dormant unter X

→ Reward nach Y verschieben

Erwartung:
Reward nur auf Y
Personal X kann rematerialisieren
Personal Y wird bei Konflikt dormant
kein persönlicher Blueprint gelöscht
```

## 31.10 Pedestal Move mit vorhandenem Item

```text
Reward Pedestal auf A
currentUid = 42
WorldItem 42 liegt auf A

→ Move nach B

Erwartung:
Pedestal auf B
currentUid weiterhin 42
WorldItem 42 auf B
kein neues Item
kein Respawn-Reset
```

## 31.11 Pedestal Pickup während Preview

```text
Move Preview startet
currentUid = 42

→ anderer Spieler sammelt UID 42 ein

→ Move Commit nach B

Erwartung:
Pedestal auf B
kein Item auf B neu erzeugt
currentUid bleibt null
bestehender Respawn-Timer bleibt erhalten
```

## 31.12 Multiplayer Race

```text
Guest A und Guest B versuchen denselben Reward gleichzeitig zu verschieben

→ erster valider Host-Commit gewinnt
→ zweiter Request validiert gegen neuen State und scheitert/aktualisiert
→ kein Doppelplacement
```

---

# 32. Persistenz- und Netzwerkmodell

## 32.1 Priorität: sauberer Zielzustand vor Altstand-Kompatibilität

Für Phase 3F ist die Wartbarkeit des finalen Quellcodes wichtiger als die Lesbarkeit alter Persistent-Base-Zwischenstände.

Daraus folgt:

- veraltete Felder dürfen entfernt werden,
- Save-Schemas dürfen vereinfacht oder geändert werden,
- eine Save-Version darf erhöht werden,
- alte Saves dürfen bei Bedarf bewusst verworfen oder zurückgesetzt werden,
- es muss **keine Migration nur zur Kompatibilität mit älteren Entwicklungsständen** gebaut werden.

Wenn eine Datenstruktur ohne Migrations-/Kompatibilitätscode sauber weiterverwendet werden kann, ist das selbstverständlich erlaubt. Es soll aber kein technischer Ballast ausschließlich für alte Alpha-Stände bestehen bleiben.

Insbesondere soll kein paralleles Alt-/Neu-Modell entstehen.

## 32.2 Personal Contribution State

Repositioning benötigt für persönliche Konstruktionen weiterhin eine stabile Entity-Identität.

Fachlich erforderlich bleiben mindestens:

- `persistentId`,
- Construction-/Tool-Identität,
- relative Position,
- angle,
- `placementOrder`,
- Ownership.

Die konkrete Save-Form darf in 3F aufgeräumt werden, wenn dies den finalen Store vereinfacht.

## 32.3 Reward State

Für Rewards soll der finale State nur Informationen enthalten, die nach 3F fachlich benötigt werden.

`everPlacedRewardIds` wird entfernt. Ein Feld soll nicht nur deshalb bestehen bleiben, weil ältere Zwischenstände es gespeichert haben.

Kanonischer Zustand:

```text
unlocked + placement vorhanden
oder
unlocked + kein placement
```

## 32.4 Temporary-Utility Runtime State

Temporäre Utilities sind keine Single-Slot-Overrides mehr, sondern eine Collection unabhängiger Instanzen.

Der autoritative Runtime-State muss mindestens eindeutig auflösen können:

```text
instanceId
utilityId
ownerId
charges / remaining uses
cooldown / activation state
acquisition order
```

Die genaue Replikationsform darf kompakter sein, solange zwei gleiche Utility-Typen niemals miteinander verwechselt werden können.

Temporary Utilities müssen nicht in die langfristige Persistent-Base-Save-Persistenz aufgenommen werden, sofern das bestehende Gameplay sie nur als Session-/Mission-Runtime behandelt.

## 32.5 Network Requests

Move-Requests müssen:

- World Revision tragen,
- Source eindeutig identifizieren,
- Target eindeutig beschreiben,
- hostseitig sanitisiert werden.

Für Personal Constructions ist die persistente Identität vorzuziehen:

```text
ownerId + persistentId
```

statt nur einer flüchtigen Runtime-ID.

Runtime-ID darf zusätzlich zur Race-/Consistency-Prüfung verwendet werden.

Für Rewards ist:

```text
rewardId
```

die stabile Identität.

Für Temporary Utilities muss ein Use-/Selection-relevanter Request die konkrete Instanz referenzieren:

```text
temporaryUtilityInstanceId
```

`utilityId` allein ist dafür nicht eindeutig genug.

---

# 33. Fehler- und Race-Semantik

## Source verschwindet während Preview

Beispiel:

- Construction wird zerstört,
- anderer Player dismantled Reward,
- World wechselt.

Ergebnis:

```text
Move Request wird abgelehnt
→ kein Ersatzobjekt
→ kein State wird rekonstruiert
```

## Target wird während Preview belegt

Host validiert beim Commit erneut.

Ergebnis:

```text
Request abgelehnt
→ Source bleibt unverändert
```

## World Revision wechselt

Request ist stale und wird abgelehnt.

## Temporary-Utility-Instanz wird während offenem Radial verbraucht/entfernt

Beim Schließen des Radials wird die Action erneut gegen den aktuellen Action State geprüft.

Eine inzwischen nicht mehr vorhandene Instanz darf nicht ausgewählt werden. Andere Temporary-Utility-Instanzen desselben Typs bleiben davon unberührt.

---

# 34. Nicht Bestandteil von Phase 3F

- Kategorien-/Untermenü-Radial
- Pagination im Radial
- Structure Occupancy
- Wachturm
- Dachsbau
- neue Persistent-Base-Area-Stufen
- neue Permanent Rewards
- neue Klassen
- neues Construction-Capacity-System
- neues generisches Ressourcensystem fürs Bauen
- allgemeines Rebalancing von Construction Build Cooldowns jenseits der 100-ms-Vereinheitlichung
- allgemeiner Umbau von PvP-Input
- vollständige grafische Neugestaltung des Radials
- neue Gameplay-Kosten für Repositioning

---

# 35. Definition of Done

Phase 3F ist abgeschlossen, wenn:

- alle Coop-Defense-Klassen dasselbe Radial Menu V2 über `R` verwenden,
- alle `E`-Actions über eine kanonische Selection aufgelöst werden,
- normale Utilities im Radial auswählbar sind,
- jede Temporary-Utility-Instanz als eigener zusätzlicher Action-Eintrag erscheint,
- mehrere Temporary Utilities gleichzeitig gehalten werden können, ohne künstliches Limit,
- zwei Instanzen desselben Utility-Typs gleichzeitig möglich sind,
- Temporary-Utility-Pickup immer die zuletzt eingesammelte Instanz automatisch auswählt,
- eine vorherige Selection nur restauriert wird, wenn die aktuell genutzte Action nach Nutzung nicht mehr verfügbar ist,
- mehrere aufeinanderfolgende Temporary-Utility-Auto-Selections eine korrekte Rückkehrkette besitzen,
- Constructions über das gemeinsame Action-Modell laufen,
- unplatzierte Base Rewards im Radial erscheinen,
- platzierte Base Rewards dort nicht mehr als Placement Action erscheinen,
- dismantled Base Rewards wieder placeable sind,
- `everPlacedRewardIds` vollständig entfernt ist und Re-Place ausschließlich vom aktuellen Unlock-/Placement-State abhängt,
- Base Rewards von allen Coop-Klassen verwaltet werden können,
- persönliche Konstruktionen nur durch ihren Owner verschoben/zurückgebaut werden,
- Global Dismantle für alle Klassen ausschließlich eigene Personal Constructions entfernt,
- Repositioning für Personal Constructions und Base Rewards funktioniert,
- `E` und LMB Move/Placement bestätigen,
- `R` und RMB Move/Placement abbrechen,
- der Abbruch-Gesture keinen Waffen-/Radial-Doppelinput erzeugt,
- Repositioning ein atomarer Move und kein Dismantle+Build ist,
- `persistentId`, Owner und `placementOrder` bei Personal Moves erhalten bleiben,
- aktuelles Runtime-HP bei Repositioning erhalten bleibt,
- Verschieben und Einzel-Rückbau jeweils einen festen 100-ms-Management-Cooldown besitzen,
- Move und Rückbau nach erfolgreicher Ausführung ausgewählt bleiben,
- alle aktuellen permanenten Coop-Defense-Constructions einen Build Cooldown von 100 ms besitzen,
- der Spore-Turret permanent bleibt und keinen 10-s-Cooldown-Sonderfall mehr besitzt,
- Mission Moves korrekt committen/rollbacken,
- Base Turret Rewards weiterhin nur `base-surface` nutzen,
- Base Pedestal Rewards weiterhin die aktive Build Area aus 3E nutzen,
- Pedestal Move den vorhandenen Power-up-/Respawn-State erhält,
- ein beim Commit noch vorhandenes Power-up mit gleicher UID mitverschoben wird,
- ein während der Vorschau eingesammeltes Power-up nicht neu erzeugt wird,
- laufende Cooldowns/Charges im Radial aus echten States dargestellt werden,
- Host Authority und first-valid-wins bei konkurrierenden Requests erhalten bleiben,
- keine Single-Override-/Single-Temporary-Utility-Altarchitektur parallel zum neuen Multi-Instance-Modell bestehen bleibt,
- keine Save-Kompatibilitätsfelder oder Migrationspfade ausschließlich für ältere Alpha-Zwischenstände den finalen 3F-Code belasten,
- und die Inspector-spezifischen Zwischenpfade aus 3D dort entfernt sind, wo 3F sie fachlich ersetzt.

---

# 36. Implementierungshinweise für Coding-KIs

Dieses Dokument ist delta-orientiert.

Vor der Implementierung müssen die bestehenden Systeme gelesen und wiederverwendet werden, insbesondere:

```text
src/systems/InputSystem.ts
src/ui/InspectorToolRadialMenu.ts
src/ui/InspectorToolRadialGeometry.ts
src/systems/ConstructionAccessResolver.ts
src/systems/PlacementSystem.ts
src/loadout/LoadoutManager.ts
src/network/NetworkBridge.ts
src/scenes/arena/RpcCoordinator.ts
src/scenes/arena/ArenaLifecycleCoordinator.ts
src/scenes/arena/ClientUpdateCoordinator.ts
src/persistentBase/PersistentBaseContributionStore.ts
src/persistentBase/PersistentBaseRewardStore.ts
src/persistentBase/PersistentBaseRewardTypes.ts
src/persistentBase/PersistentBaseComposite.ts
src/persistentBase/PersistentBaseCore.ts
src/powerups/PowerUpSystem.ts
```

Außerdem müssen die bestehenden GDDs für 3C, 3D und 3E als bereits implementierte Voraussetzungen behandelt werden.

Nicht aus alten Tests oder Legacy-Namen ableiten, dass:

- Persistent Rewards Inspector-only bleiben,
- `everPlacedRewardIds` weiterhin Re-Place blockieren soll,
- Temporary Utility den normalen Utility-Slot im finalen UX vollständig ersetzt,
- nur eine Temporary Utility gleichzeitig existieren darf,
- `utilityId` zur Identifikation einer Temporary-Utility-Instanz ausreicht,
- Repositioning über Dismantle+Build erfolgen darf.

Die Phase soll bestehende fachliche Quellen zusammenführen, nicht dieselben Regeln erneut in UI/Input/RPC duplizieren.

Bei Konflikten zwischen sauberem finalem Domain-Modell und Kompatibilität zu älteren Alpha-Persistenzständen hat das saubere Domain-Modell Vorrang. Veraltete Zwischenarchitekturen sollen nach erfolgreicher Umstellung entfernt statt dauerhaft adaptiert werden.
