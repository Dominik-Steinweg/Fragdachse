# FRAGDACHSE

**Game Design Document**

## Coop Defense – Ausbaustufe B · Nebenmissionen & Missionsbelohnungen

**Version 3 – Lebenszyklus getrennt, Praxis-Test-Maps eingeplant**

> **Leitidee**
>
> Ausbaustufe A gibt Coop Defense einen Rhythmus aus endlichen Angriffen, Frontwechseln und bewusst gesetzten Ruhefenstern. Ausbaustufe B macht aus diesen Freiräumen **echte Entscheidungen**: freiwillige Secondary Objectives, die entweder die laufende Map spürbar verändern oder sichtbaren Meta-Fortschritt geben.
>
> Drei wiederverwendbare Archetypen – **Destroy**, **Hold**, **Carry** – erzeugen durch Map-Authoring viele konkrete Missionen. Das Risiko entsteht aus Zeit, Raum und Positionierung, nicht aus zusätzlichen Pflichtgegnern.

**Designstatus:** Zielkonzept / Implementierungsgrundlage
**Umsetzungsstand:** Ausbaustufe A abgeschlossen. B1 (Objective-Grundlage) umgesetzt, B2 (dormante Strukturen) in Arbeit.
**Scope-Prinzip:** maximal ein **fokussiertes** Secondary Objective gleichzeitig (§4).

### Änderungen gegenüber Version 2

- **§4** Lebenszyklus und HUD-Fokus sind getrennt. `resolved` entfällt; ein Objective ist erst `completed`, wenn sein Ziel wirklich erreicht ist.
- **§5.1** Trigger-Umfang für Objectives präzisiert.
- **§7.2** Ein bei Rundenende unvollständiger Hold ist nicht erfolgreich.
- **§7.4** Genau eine Verlustregel für die einmalige Podest-Ladung.
- **§13** Die Rare-Garantie wird beim Würfeln angewandt, nicht nachträglich rekonstruiert.
- **§16.1** Validierung erkennt nur deterministisch entscheidbare Konflikte; der Rest ist ein Runtime-Guard.
- **§18** Jeder Archetyp-Schritt liefert spielbare Map-Daten mit (§18.1). B10 in technische Stabilisierung und Balancing getrennt.

---

# 1. Ziele

| Ziel | Beschreibung |
|---|---|
| **Primärziel** | Ruhefenster und große Arenen werden durch freiwillige Nebenmissionen spielerisch relevant. |
| **Entscheidung** | Spieler wägen Verteidigungssicherheit gegen zusätzliche Vorteile ab. |
| **Content** | Wenige Archetypen erzeugen viele Map-Situationen. |
| **Belohnung** | Entweder unmittelbarer Map-Vorteil oder klar sichtbarer Meta-Reward. |
| **Pacing** | Nebenmissionen verlängern die Pflichtdramaturgie nicht. |
| **Architektur** | Secondary Objectives bleiben von Hauptziel und MapDirector getrennt, lesen aber deren semantischen Zustand. |
| **Multiplayer** | Fortschritt und Rewards sind host-autoritativ und teamweit. |

---

# 2. Designprinzipien

**2.1 Optional ist wirklich optional.** Eine Nebenmission darf den Mapsieg nie blockieren. Erfüllen, teilweise erfüllen, ignorieren, scheitern lassen – nichts davon erzeugt automatisch eine Niederlage. Das Hauptziel bleibt Eigentümer der Siegbedingung.

**2.2 Die beste Belohnung verändert die laufende Map.** Zerstörte Spawnstrukturen erzeugen keinen weiteren Hintergrunddruck; ein geretteter Außenposten unterstützt spätere Wellen; ein starkes Podest steht für den Rest der Map bereit.

**2.3 Risiko entsteht aus Zeit, Raum und Aufmerksamkeit** – nicht aus Challenge-Waves.

**2.4 Gute Spieler werden nicht bestraft.** Ein schneller Clear erzeugt mehr Handlungszeit, nicht mehr Pflichtgegner.

**2.5 Wenige Archetypen, viele Missionen.** Destroy, Hold, Carry. Kein neuer technischer Missionstyp nur, weil Text, Objekt oder Reward sich unterscheiden. Eine Power-up-Mission ist ein **Hold mit anderem Reward**, kein vierter Typ.

**2.6 Authored Content, keine Quest-Skriptsprache.**

**2.7 Teamziel statt Last-Hit.** Fortschritt und Rewards gehören dem Team.

---

# 3. Nicht-Ziele

Elite-/Champion-System, Challenge-Waves, Encounter-Varianten, prozedurale Nebenmissionen, verzweigte Questketten, Dialogsystem, allgemeines Questlog, zufällige Missionsauswahl, individuelle Spielerbelohnungen innerhalb einer Teammission, eigene Meta-Währung, allgemeines Map-Event-System, vollständige Kampagnenmigration, Umbau der Host-Autorität.

Elite/Champion, Challenge-Waves und Encounter-Varianten bleiben spätere Vision, erhalten in B aber **keine vorbereitende Sonderarchitektur**.

---

# 4. Lebenszyklus und HUD-Fokus

Lebenszyklus und Aufmerksamkeit sind **zwei unabhängige Achsen**. Sie zu vermischen erzeugt einen Zustand, der gleichzeitig „abgeschlossen" und „läuft weiter" bedeutet – und damit Sonderfälle in jedem späteren Archetyp.

```text
Lebenszyklus:   dormant → active → completed
                                 ↘ failed

Darstellung:    focused ↔ background
```

## 4.1 Lebenszyklus

| Zustand | Bedeutung |
|---|---|
| `dormant` | Startbedingung nicht erfüllt. Zielobjekte existieren spielerisch nicht (§10). |
| `active` | Mission läuft. Fortschritt wird geführt, Ziele sind interaktiv. |
| `completed` | Die Zielbedingung ist **wirklich erfüllt** (z. B. 3/3). Terminal. |
| `failed` | Nur für Missionen mit echter Fail-Bedingung. Terminal. |

Ein abgelaufenes Aufmerksamkeitsfenster erzeugt **keinen** Zustandswechsel. Eine Destroy-Mission mit 2/3 bleibt `active`, bis das dritte Nest fällt oder die Runde endet. Endet die Runde mit `active`, ist das ein legitimer Teilerfolg – der Reward-Ledger hat die zwei zerstörten Ziele bereits einzeln gebucht (§11.3).

## 4.2 Fokus

`focused` bedeutet: Das Objective besitzt den prominenten HUD-Slot mit Ankündigung, Reward-Vorschau und Weltmarkierung.

> **Maximal ein Objective ist gleichzeitig `focused`.**

Ein Objective erhält den Fokus bei seiner Aktivierung und gibt ihn ab, sobald sein authored `focusUntil` erreicht ist oder es terminal wird. Danach läuft es als `background` weiter: Ziele bleiben interaktiv, Fortschritt zählt weiter, die Anzeige schrumpft auf eine kompakte Restzeile.

Ohne `focusUntil` behält ein Objective den Fokus bis zu seinem Ende.

**Fokus ist nicht rückholbar.** Ein Objective, das in den Hintergrund gewechselt ist, holt den Fokus nicht zurück – auch nicht bei seinem Abschluss. Ein Abschluss erzeugt eine einmalige Meldung, keinen erneuten Slot-Anspruch.

## 4.3 Archetyp-Nutzung

| Archetyp | Fokusverlauf |
|---|---|
| **Destroy** | Fokus während des authored Angriffsfensters, danach Hintergrund. Überlebende Spawner bleiben bis Rundenende zerstörbar. |
| **Carry** | Wie Destroy. Nicht abgegebene Objekte bleiben transportierbar. |
| **Hold** | **Kein Hintergrundzustand.** Hold endet bei `holdUntil` in `completed` oder `failed` und besitzt bis dahin durchgehend den Fokus. `focusUntil` wird für Hold nicht authored. |

---

# 5. Aktivierung statt Annahme

Nebenmissionen haben **keinen Accept-Button**.

```text
Trigger erfüllt → Mission wird sichtbar und fokussiert → Spieler entscheiden durch ihr Verhalten
```

## 5.1 Trigger

Secondary Objectives verwenden dieselben **semantischen Map-Bedingungen** wie Encounter, aber nur, soweit sie fachlich passen. Für Ausbaustufe B sind das genau zwei:

```text
{ type: 'time', atMs: <ms> }
{ type: 'after-encounter', encounterId: '<id>' }
```

`after-previous` bleibt Encounter-spezifische Komfortsyntax: Sie referenziert die Position in der linearen Encounter-Kette, die ein Objective nicht besitzt. `opening-airstrike-complete` und `boss-phase` sind an Systeme gebunden, die nicht jede Map besitzt; sie kommen nur hinzu, wenn eine konkrete B-Map sie braucht.

Nicht unterstützte Varianten werden von der Map-Validierung **abgelehnt**, nicht still ignoriert. Zur Laufzeit bleibt die Auswertung fail-closed.

## 5.2 Verlängerte Ruhephase

Ein Objective darf mit einem bewusst größeren `restAfterMs` des vorherigen Pflicht-Encounters kombiniert werden.

```text
Pflichtangriff gecleart → Brutnester erscheinen → verlängerte Ruhephase
→ gutes Angriffsfenster → nächster Pflichtangriff startet trotzdem planmäßig
```

Die Nebenmission hält den Encounterplan **nie** auf.

---

# 6. Archetyp 1 – Destroy

## 6.1 Kernidee und Reward

Das Team zerstört definierte feindliche Spawnstrukturen. Der zentrale Reward ist systemisch:

```text
Spawnstruktur zerstört → ihre Spawnquelle endet → spätere Wellen werden leichter
```

Teilfortschritt ist unmittelbar wertvoll: Bei drei Spawnern bedeutet 1/3 eine Quelle weniger, 3/3 den kompletten Zusatzdruck beseitigt.

## 6.2 Referenzszenario – neue Brutfront

```text
Encounter 3 gecleart
↓
WARNUNG: NEUE BRUTFRONT  ·  3 Spawnstrukturen erscheinen an anderer Front
↓
verlängerte Ruhephase → Angriffsfenster (Fokus)
↓
Ruhephase endet, nächster Pflichtangriff startet → Mission wechselt in den Hintergrund
↓
überlebende Spawner erzeugen weiter Druck und bleiben zerstörbar
↓
fällt der letzte Spawner später → completed
```

Jeder Spawner: eigene HP, eigene authored Spawnquelle, zerstörbar bis Rundenende, blockiert keinen Encounter-Clear.

Die Entscheidung lautet: *jetzt aggressiv alle Spawner angreifen oder rechtzeitig zur Hauptverteidigung zurück?*

## 6.3 Bonus-XP

- Jeder zerstörte Spawner gibt eine kleine, authored Team-XP-Menge – gebucht beim Ziel, nicht beim Missionsabschluss.
- XP gehört dem Team, nicht dem Last-Hit-Spieler; alle reward-berechtigten Teilnehmer erhalten denselben Betrag.
- Sie fließt in den normalen Coop-XP-Ertrag ein und ist **nicht an den Mapsieg gebunden** (§12).
- Ein Ziel, das nur von Spectators oder Latejoinern Schaden erhält, erzeugt keinen XP-Bonus.

## 6.4 Balancing

> Ignorieren ist möglich, Zerstören fühlt sich deutlich besser an.

---

# 7. Archetyp 2 – Hold

## 7.1 Kernidee

Das Team hält ein definiertes freundliches Objekt während einer gefährlichen Phase am Leben. Hold erzeugt **keine zusätzliche Welle**, sondern nutzt einen ohnehin verpflichtenden Encounter als Verteidigungsfenster.

## 7.2 Erfolg, Fehlschlag, Rundenende

Das Zeitfenster wird **explizit authored**:

```text
holdUntil:
  { type: 'after-encounter', encounterId: '<id>' }   // bevorzugt
  { type: 'time', atMs: <ms> }                        // Fallback
```

- **Erfolg (`completed`):** Das Ziel lebt beim Erreichen von `holdUntil`.
- **Fehlschlag (`failed`):** Das Ziel wird vorher vollständig zerstört. Die Map läuft unverändert weiter.
- **Rundenende vor `holdUntil`:** Der Hold ist **nicht erfolgreich**. Er bleibt `active` und erzeugt keinen Reward – weder Run- noch Meta-Reward. Ein Team darf nicht dafür belohnt werden, eine Dauer nie gehalten zu haben. Soll eine Map ausdrücklich „nur bis zum Mapsieg" verlangen, ist das ein bewusst authored `holdUntil`, kein impliziter Sonderfall.
- Ein Hold darf **nicht** an den letzten Pflicht-Encounter einer `repel-assault`-Map gebunden werden – dessen Clear beendet die Runde, der Reward wäre wertlos. Die Map-Validierung prüft das.

Hold ist bewusst binär – keine Reward-Skalierung nach Rest-HP.

## 7.3 Referenzszenario A – beschädigter Raketen-Außenposten

```text
Pflichtwelle gecleart
↓
AUSSENPOSTEN ENTDECKT  ·  kleine Basis + 2 Raketentürme, ~20–30 % HP
↓
NEBENZIEL: AUSSENPOSTEN HALTEN
↓
nächster Pflicht-Encounter läuft ab; Gegner dürfen den Posten als Ziel wählen
↓
Posten überlebt → HOLD ERFOLGREICH
↓
Reparaturdrohnen fliegen ein → 100 % HP → Türme unterstützen den Rest der Map
```

Die Türme sind einsatzfähig, aber ohne Unterstützung zu verwundbar. Das Team kann beim Posten bleiben, sich aufteilen, Konstrukte ergänzen oder Gegner früh abfangen.

**Fehlschlag:** keine Reparatur, keine spätere Turmunterstützung. Pflichtwelle und Map laufen normal weiter.

**Reparaturdrohnen** übernehmen Optik und Flugbewegung des vorhandenen Drohnensystems, bleiben fachlich aber getrennt: keinem Spieler gehörend, ohne Upgrade, nur für das Missionsziel, danach verschwindend.

## 7.4 Referenzszenario B – starkes Power-up-Podest

Dieselbe Hold-Logik, anderer Reward.

```text
beschädigte Versorgungsbasis entdeckt
↓
NEBENZIEL: VERSORGUNG HALTEN → Pflichtangriff abwehren
↓
Basis überlebt → Teamreward-Pickup erscheint an der Basis
↓
Spieler nimmt die einmalige Missions-Utility auf
↓
Podest wird an gültiger Position platziert → erste Ladung sofort verfügbar
↓
danach normaler Respawn-Zyklus des Power-ups
```

**Missions-Utility:**

- belegt keinen normalen Loadout-Slot, sondern nutzt den vorhandenen temporären Utility-Override,
- existiert nur für die laufende Runde, keine dauerhafte Freischaltung,
- besitzt genau eine Platzierungs-Ladung und verschwindet nach der Platzierung,
- ist **klassenunabhängig**.

**Verlustregel (genau eine).** Die Ladung gehört dem Objective-System, nicht dem Spieler; der Utility-Override ist nur ihre Anzeige.

```text
Tod oder Disconnect vor der Platzierung
↓
Utility-Override wird entfernt
↓
Reward-Pickup erscheint erneut an seiner Missionsbasis
```

Kein Respawn-Sonderfall, keine Bindung an einen bestimmten Spieler. Erst die erfolgreiche Platzierung verbraucht die Ladung.

Erstes Reward-Power-up: **Heilige Handgranate**.

## 7.5 Balancing

Der Außenposten muss ohne Unterstützung glaubwürdig gefährdet sein, darf aber nicht durch einen unlesbaren Burst sofort sterben.

---

# 8. Archetyp 3 – Carry

## 8.1 Kernidee und Grundregeln

Missionsobjekte werden aufgenommen, durch die Arena getragen und in einer definierten Zone abgegeben. Referenz-Content: **Bier**.

- Aufnahme über Nähe; das Objekt folgt dem Träger sichtbar.
- Ein Spieler trägt höchstens **ein** Missionsobjekt.
- Tod lässt das Objekt an nachvollziehbarer Position fallen; es bleibt aufhebbar.
- Disconnect darf das Objekt nicht vernichten.
- Jedes Objekt kann genau einmal abgegeben werden und kehrt nicht zurück.
- Waffen und Bewegung bleiben verfügbar.
- Carry-Objekte sind **Weltobjekte** – kein Item-Stash, kein Loadout, kein Charakterinventar.

## 8.2 Verhältnis zu Capture the Beer

Das vorhandene PvP-System liefert die **Interaktionsregeln** als Referenz. Sein **Zustand** ist jedoch pro Team modelliert – ein Objekt je Team, feste Heimatposition, eigener Sync-Snapshot.

> **Entscheidung:** Capture the Beer wird für B **nicht umgebaut oder extrahiert**. Coop Carry erhält einen eigenen, kleinen host-autoritativen Zustand und übernimmt nur die Interaktionsregeln.

## 8.3 Referenzszenario – Bier retten

```text
Encounter 4 gecleart
↓
BIERLIEFERUNG BEREIT · 3 Flaschen am Seiten-Außenposten
↓
Abgabezone an der Hauptbasis wird dauerhaft markiert
↓
Transport über eine oder mehrere Ruhephasen
↓
Flasche erreicht Zone → gesichert → Fortschritt +1
```

Die Flaschen bleiben nach Aktivierung bis Rundenende verfügbar; die Map erzeugt die guten Zeitfenster über ihr Pacing, nicht über einen Missionstimer.

## 8.4 Gestaffelte Meta-Belohnung

Die Item-Auswahl bleibt bei **drei Optionen**. Jede gerettete Flasche garantiert eine Option mit Mindestseltenheit „selten".

| Gerettete Flaschen | Item-Reward bei Mapsieg |
|---:|---|
| 0 / 3 | normale Dreierauswahl |
| 1 / 3 | mind. 1 von 3 selten oder besser |
| 2 / 3 | mind. 2 von 3 selten oder besser |
| 3 / 3 | alle 3 selten oder besser **+ Team-Buff sofort** |

Die Garantie ist eine **Mindestseltenheit** – natürlich episch gerollte Optionen bleiben episch und zählen bereits an.

## 8.5 Balancing und Einsatzbedingungen

- Laufwege lang genug für eine Entscheidung, nicht überwiegend leeres Laufen.
- Zielmengen skalieren **nicht** mit der Spielerzahl: 3 Bier bleiben auch zu viert 3 Bier.
- Eine Carry-Mission mit Item-Meta-Reward wird nur auf Maps eingesetzt, die einen Item-Drop konfiguriert haben. Für Spieler ohne freigeschaltetes Item-System darf sie nicht die einzige Belohnung sein.
- Eine volle Biermission ist ein starker Reward: nicht auf jeder Map.

---

# 9. Team-Buffs

## 9.1 Referenz-Buff – Regenerationsschub

Ausgelöst bei 3/3 Bier:

- **+10 HP pro Sekunde** (additiv auf die vorhandene HP-Regeneration)
- **+50 % Adrenalin-Regeneration** (multiplikativ auf die effektive Rate – diese wird von der Klasse ersetzt, nicht summiert)
- **30 Sekunden Dauer**

Balancing-Regler, in B11 anpassbar ohne Architekturänderung. Nie in persistente Progressionsdaten geschrieben.

## 9.2 Gemeinsames Zeitfenster

Der Buff besitzt **einen gemeinsamen Endzeitpunkt für das Team** und wirkt für jeden reward-berechtigten Teilnehmer, der innerhalb des Fensters lebt.

```text
3/3 erreicht → buffEndsAt = now + 30 s
jeder lebende berechtigte Spieler profitiert, solange now < buffEndsAt
```

Kein Zustand pro Spieler, kein Respawn-Sonderfall: Wer stirbt, verliert die Wirkung, während er tot ist, und bekommt beim Respawn die Restdauer automatisch.

## 9.3 HUD

Der Buff nutzt den vorhandenen HUD-Buff-Kanal und braucht keine neue Anzeigeinfrastruktur.

---

# 10. Dynamisch erscheinende Missionsstrukturen

**Fachliche Anforderung:** Ein authored Missionsobjekt darf vor seinem Trigger nicht spielerisch existieren und muss nach dem Trigger vollständig als normale Weltstruktur funktionieren.

## 10.1 Vorgabe: vorerzeugt und dormant

Basen werden beim Rundenaufbau deterministisch aus der Map-Konfiguration erzeugt, der Netzwerk-Snapshot ist ein **Delta über bekannte Basis-IDs**, und es existiert kein Pfad, um zur Laufzeit eine Basis auf Clients zu erzeugen.

> **Missionsstrukturen werden zusammen mit allen anderen Basen beim Rundenstart erzeugt und starten `dormant`. Repliziert wird ausschließlich das Aktivierungs-Flag.**

## 10.2 Dormanz-Garantien

Solange dormant:

- **keine Kollision** – nicht Teil der Hindernisgeometrie; bei Aktivierung wird die Hindernis-Generation erhöht,
- **kein Spawn** – nicht in den aktiven Basis-IDs, die die strukturgebundene Spawnquelle als einziges Gate kennt,
- **kein Targeting** – nicht im strategischen Zielkatalog der Gegner,
- **keine Darstellung** – weder Basisgrafik, Türme, Licht noch Marker,
- **kein HP-Delta** – nicht im Basis-Snapshot.

Die Aktivierung ist **monoton und idempotent**. Danach verhält sich die Struktur wie jede andere; der beschädigte Startzustand eines Hold-Ziels wird über das normale HP-Delta repliziert.

---

# 11. Multiplayer und Host-Autorität

Der Host entscheidet über Aktivierung, Fokus, Fortschritt, Zerstörung relevanter Ziele, Hold-Ergebnis, Carry-Aufnahme und -Abgabe, XP-Bonus, vorgemerkte Meta-Rewards, Team-Buff und einmalige Missions-Utilities. Clients stellen den Zustand nur dar.

## 11.1 Replikation

Ein kleiner Präsentationsvertrag, analog zum Encounter-Präsentationszustand. Er beschreibt **alle nicht-dormanten Objectives**, nicht nur das fokussierte – sonst verschwindet der Fortschritt einer Mission, sobald sie in den Hintergrund wechselt.

Pro Eintrag: Objective-ID, Archetyp, Lebenszyklus-Zustand, Fokus-Flag, `progressCurrent` / `progressTotal`, Zeitstempel des letzten Zustandswechsels.

**Statische Ziele werden über IDs referenziert, nicht über Weltkoordinaten.** Der Client kennt die Geometrie einer Basis oder Spawnstruktur bereits aus der Map-Konfiguration – das ist dieselbe Grundlage, auf der die Dormanz funktioniert. Nur bewegliche Carry-Objekte benötigen replizierte Positionen.

Clients dürfen den Fortschritt **nicht** aus lokalen Weltobjekten rekonstruieren.

## 11.2 Reward-Zustellung

| Reward | Weg |
|---|---|
| **Bonus-XP** | Fließt in den host-geführten Runden-XP-Zähler und wird wie normale Coop-XP im Rundenergebnis ausgeschüttet. |
| **Rare-Garantie** | Das Item-Angebot wird pro Spieler lokal gewürfelt. Die garantierte Anzahl muss deshalb als autoritativer Wert **im Rundenergebnis** mitgeliefert werden. |
| **Run-Rewards** | Host löst sie unmittelbar aus und repliziert die Wirkung über die zuständigen Systeme. |

## 11.3 Reward-Ledger

Der Host führt pro Runde einen kleinen autoritativen Reward-Zustand mit: verdiente Bonus-XP, vorgemerkte Meta-Verbesserungen (`rareGuaranteeCount`, 0–3), ausgelöste Run-Rewards.

**Rewards werden pro Ziel gebucht, nicht beim Missionsabschluss.** Jedes zerstörte Nest, jede abgelieferte Flasche bucht genau einmal – die Buchung hängt am Ziel-Zustandswechsel, nicht am mehrfach feuernden Zerstörungs-Callback. Nur der Vollbonus (Team-Buff bei 3/3) hängt am Abschluss.

B führt keine neue persistente Datei und keine neue Währung ein.

## 11.4 Latejoin und Spectator

Ein Latejoiner bleibt Zuschauer: verändert die Mission nicht, erhöht keine Zielmenge, erhält keine Meta-Rewards der laufenden Runde, darf keine Carry-Objekte oder Reward-Pickups aufnehmen – über dasselbe Teilnehmer-Gate, das Spawn und Rewards bereits steuert. Den Objective-Zustand darf er sehen.

## 11.5 Disconnect während Carry

Das getragene Objekt darf nicht verschwinden; es wird an einer sicheren, nachvollziehbaren Position wieder verfügbar.

## 11.6 Reward-Berechtigung

Meta-Rewards verwenden die bestehende eingefrorene Rundenteilnahme.

---

# 12. Reward-Kategorien und Siegkopplung

| Ebene | Beispiele | Kopplung |
|---|---|---|
| **Systemischer Map-Vorteil** | Spawnquelle beseitigt, Außenposten bleibt aktiv | sofort, dauerhaft für die Runde |
| **Sofortiger Run-Reward** | Reparatur, platzierbares Podest, Team-Buff | sofort bei Erreichen |
| **Meta-Reward** | garantierte Rare-Optionen | **nur bei gültigem Mapsieg** |
| **Bonus-XP** | zerstörte Spawner | normale Coop-XP-Regel – auch bei Niederlage |

```text
3 Bier gerettet → Team verliert die Map → keine Rare-Garantie
```

Ein vom Host abgebrochener Match zählt weder als Sieg noch als Niederlage: keine Meta-Rewards, Bonus-XP wie bisher im Rundenergebnis enthalten.

---

# 13. Item-Rarity-Garantie

## 13.1 Anwendungszeitpunkt

Das Item-Angebot wird beim Rundenende **pro Client lokal** gewürfelt und anschließend als ausstehende Belohnung persistiert. Es ist damit grundsätzlich nicht zwischen Spielern reproduzierbar – und muss es auch nicht sein.

> **Die Garantie wird beim Würfeln angewandt, bevor das Angebot persistiert wird.**

Damit gibt es später nichts zu rekonstruieren, und die Auswahl-Reihenfolge muss nicht deterministisch sein.

## 13.2 Regeln

- Angebotsgröße bleibt **3**, Kategorien bleiben verschieden.
- `rareGuaranteeCount` liegt zwischen 0 und 3 und stammt aus dem autoritativen Rundenergebnis.
- Bereits selten oder besser gerollte Optionen **zählen an**. Liegt das Angebot ohnehin über der Garantie, passiert nichts.
- Fehlen Optionen, werden die **niedrigsten Seltenheiten zuerst** angehoben. Da die drei Kategorien ohnehin gleichverteilt gezogen werden, entsteht dabei keine Kategoriebevorzugung.
- **Anhebung erfolgt in place, nicht durch Neuwürfeln.** Slot, Item-Level, Basiswert und bereits gezogene Affixe bleiben erhalten; nur die fehlenden Affixe werden ergänzt, damit die Seltenheit zur Affix-Anzahl passt. Ein Neuwurf würde ein bereits gutes Angebot zufällig verschlechtern.
- Die Garantie darf **nie** eine Option verschlechtern.

## 13.3 Sichtbarkeit

```text
NEBENMISSION: BIER RETTEN
3 / 3

Belohnung:
3 garantierte seltene oder bessere Items
```

Der Spieler soll nicht raten müssen, ob die Nebenmission „irgendwie die Dropchance" erhöht hat.

---

# 14. Telegraphing und Lesbarkeit

Eine Nebenmission funktioniert nur, wenn sofort klar ist: **was**, **wo**, **wie weit**, **wofür**.

## 14.1 Aktivierungsankündigung

```text
NEBENZIEL              NEBENZIEL                 NEBENZIEL
BRUTNESTER ZERSTÖREN   AUSSENPOSTEN HALTEN       BIER RETTEN
0 / 3                                            0 / 3
```

## 14.2 Weltmarkierung

Fokussierte Ziele brauchen eine klare lokale Markierung, einen Offscreen-Indikator und auf großen Maps eine Distanzangabe. Der vorhandene Rand-Indikator für Feindbasen liefert Kameraausschnitts- und Kantenlogik als Referenz.

Hintergrund-Objectives behalten eine reduzierte Weltmarkierung, aber keinen Offscreen-Indikator – sonst konkurriert eine Nebensache dauerhaft mit dem Pflichtziel.

## 14.3 Reward-Vorschau

```text
Jedes Brutnest:            Außenposten überlebt:        Bier:
+ Bonus-XP                 Raketentürme werden          1 Flasche = 1 garantierte Rare-Option
+ weniger Gegnerdruck      repariert                    3 / 3 = zusätzlich Regenerationsschub
```

## 14.4 Fortschritt

Ein eigener kompakter Secondary-Bereich am Coop-HUD, visuell klar vom Pflichtziel-Panel unterschieden. Fokussiert prominent, im Hintergrund auf eine Zeile reduziert. Kein allgemeines Questlog.

---

# 15. Integration mit den Hauptzielen

| Hauptziel | Eignung und Hinweise |
|---|---|
| **`repel-assault`** | Wichtigster Anwendungsfall. Destroy nach einem Clear mit verlängerter Ruhephase; Hold an einen benannten mittleren Encounter (nie den letzten); Carry über mehrere Encounter hinweg. |
| **`survive`** | Möglich, aber vorsichtig: Die Timeline wartet nicht auf schnelle Clears. Geeignet vor allem Carry und Destroy. Hold nur mit eindeutig an einen geplanten Angriff gekoppeltem Fenster. |
| **`destroy-hostile-bases`** | Starke Eignung. Missionsziele dürfen nie als Hauptziel-Basen zählen: `outpost` und `spawn-point` bleiben strikt von `main` getrennt. |
| **`defeat-boss`** | Erlaubt. Bossmechanik bleibt Eigentümer des Boss-Systems, das Objective seines Fortschritts. Keine eigenen Boss-Archetypen. |

## 15.1 Pacing

- Nicht jeder Encounter öffnet eine Nebenmission – **Ruhe darf Ruhe bleiben**.
- Richtwert nach Map-Referenzdauer: kurze Maps keine oder eine kleine Mission, mittlere Maps meist eine, lange Maps mehrere nacheinander.
- Eine laufende Nebenmission hält den Encounterplan nie an.

---

# 16. Map-Konfiguration und Authoring

Secondary Objectives gehören in die datengetriebene Map-Konfiguration und werden wie Encounter über eine Resolve-Funktion normalisiert.

```text
Secondary Objective
├─ ID
├─ Archetyp (destroy | hold | carry)
├─ Startbedingung          (§5.1)
├─ focusUntil?             (nicht für Hold)
├─ holdUntil               (nur Hold)
├─ Zielreferenzen          (stabile Basis-/Struktur-IDs)
├─ targetGoal?             (Standard: Anzahl der Ziele)
└─ Rewards
```

```json
{
  "id": "destroy-brood-front",
  "type": "destroy",
  "start": { "type": "after-encounter", "encounterId": "pressure-2" },
  "focusUntil": { "type": "after-encounter", "encounterId": "pressure-3" },
  "targets": ["brood-a", "brood-b", "brood-c"],
  "rewards": { "xpPerTarget": 25 }
}
```

**Keine duplizierte Weltdefinition.** Verweise auf Basen, Spawnstrukturen, Power-ups oder Encounter laufen über stabile IDs.

## 16.1 Validierung und Runtime-Guard

Zwei Schutzschichten, weil nicht jeder Konflikt statisch entscheidbar ist:

**Validierung** (lehnt ab, was aus authored Daten eindeutig folgt):
- leere oder doppelte Objective-IDs, unbekannte Ziel- oder Encounter-IDs,
- nicht unterstützte Trigger-Varianten (§5.1),
- `focusUntil` vor `start`,
- überschneidende Fokusfenster, **soweit beide Fenster über Zeitpunkte definiert sind**. Fenster, die an Encounter-Clears hängen, sind statisch nicht vergleichbar und werden bewusst nicht abgelehnt,
- Hold gebunden an den letzten Pflicht-Encounter einer `repel-assault`-Map,
- Carry mit Item-Meta-Reward auf einer Map ohne konfigurierten Item-Drop,
- Missionsstrukturen, die kein Objective referenziert – oder umgekehrt.

**Runtime-Guard** (fängt ab, was erst im Spiel entsteht): Beansprucht ein zweites Objective den Fokus, während eines fokussiert ist, bleibt es `dormant` und versucht es später erneut. Der Fokus wird nie überlagert.

---

# 17. Codebase-Anker

| Bedarf | Status |
|---|---|
| Objective-Lebenszyklus, Trigger, Snapshot | **umgesetzt (B1)** |
| Dormanz-Gates und Aktivierung | **in Arbeit (B2)** |
| Trigger „Encounter gecleart" | MapDirector beantwortet Encounter-Clear autoritativ |
| Spawnstruktur mit eigener Quelle | strukturgebundene persistente Spawnquellen, gekoppelt an die aktiven Basis-IDs |
| Zerstörung beendet Quelle | vollständig vorhanden |
| Freundlicher Außenposten mit Raketentürmen | `role: outpost`, Turmwaffen inkl. Rakete |
| Gegner greifen Außenposten an | strategischer Zielkatalog kennt bewaffnete Außenposten |
| Basisheilung | host-autoritatives Heilen lebender Basen |
| Reparaturdrohnen-Optik | vorhandenes Drohnensystem samt Replikation |
| Starkes Podest zur Laufzeit | Laufzeit-Registrierung inkl. sofort verfügbarer erster Ladung; Heilige Handgranate ist gültige Podest-Definition |
| Temporäre Sonder-Utility | temporärer Utility-Override – **wird heute beim Respawn verworfen**, siehe Verlustregel §7.4 |
| Carry-Interaktion | Regeln im PvP-Modus vorhanden; eigener Coop-Zustand nötig (§8.2) |
| Team-XP der Runde | host-geführter Zähler, Ausschüttung im Rundenergebnis |
| Item-Angebot | Dreierauswahl, Seltenheiten, Affix-Ziehung; Kategorien werden gleichverteilt gezogen |
| Teilnehmer-/Reward-Gate | vollständig vorhanden |
| Buff-HUD | HUD-Buff-Kanal mit Restanteil und Intensität |
| HP-/Adrenalin-Regeneration | Laufzeit-Modifikatoren pro Spieler |
| Basen zur Laufzeit erzeugen | **nicht vorhanden** – deshalb dormant statt Runtime-Erzeugung (§10) |
| Marker / Offscreen | Rand-Indikator für Feindbasen als Referenz |

---

# 18. Implementierungsreihenfolge

## 18.1 Praxis-Tests sind Teil jedes Schritts

Ein Archetyp gilt erst als umgesetzt, wenn er **spielbar konfiguriert** ist. Jeder Archetyp-Schritt liefert deshalb Map-Daten mit, nicht nur Systemcode:

- **`00-test.json` ist die Missions-Sandbox.** Jeder neue Archetyp bekommt dort eine minimale, aber vollständige Konfiguration – kurze Wege, wenige Ziele, schnelle Trigger. Damit ist jeder Schritt einzeln im Spiel prüfbar, ohne eine Kampagnenmap zu gefährden.
- **Kampagnenmaps bleiben bis B11 unberührt.** Die Migration ausgewählter Maps ist ein bewusster, eigener Schritt mit eigenem Balancing.
- Ein Schritt ohne sichtbare Wirkung (B2) liefert stattdessen die Datengrundlage, die der **nächste** Schritt spielbar macht.

## B1 – Secondary-Objective-Grundlage ✔ umgesetzt
Datengetriebene Konfiguration, host-autoritativer Lebenszyklus, Trigger, Fortschritts-Snapshot, Trennung von Hauptziel und MapDirector.

## B2 – Dormante Missionsstrukturen · *in Arbeit*
Dormanz-Gates für Kollision, Spawnquelle, Targeting, Darstellung und Snapshot; Aktivierung inkl. Hindernis-Invalidierung; Host-/Client-Konsistenz.
**Map-Daten:** `00-test.json` erhält eine dormante Spawnstruktur samt strukturgebundener Quelle – die Grundlage für B3.

## B3 – Destroy
Destroy-Archetyp, mehrere Zielstrukturen, Teilfortschritt, kleine Team-XP pro Ziel, Ziele bleiben bis Rundenende zerstörbar und zählen im Hintergrund weiter.
**Map-Daten:** vollständige Destroy-Mission in `00-test.json` – drei Spawnstrukturen, Trigger nach dem ersten Encounter, `focusUntil` am zweiten.
**Ergebnis:** erste im Spiel prüfbare Nebenmission.

## B4 – Secondary-HUD und Welt-Telegraphing
Ankündigung, Name, Fortschritt, Reward-Vorschau, World Marker, Offscreen-Indikator, Fokus-/Hintergrunddarstellung, Abschluss- und Fehlschlagsfeedback.
**Ergebnis:** Die B3-Mission ist ohne Vorwissen spielbar.

## B5 – Hold + Außenposten-Reparatur
Hold-Archetyp mit explizitem `holdUntil`; beschädigter Startzustand; Fail bei Zerstörung; missionsgebundene Reparaturdrohnen; Posten bleibt danach aktiv.
**Map-Daten:** `00-test.json` erhält einen beschädigten Außenposten mit zwei Raketentürmen und eine Hold-Mission am zweiten Encounter.

## B6 – Einmalige platzierbare Missions-Rewards
Teamweite Reward-Ladung im Objective-System; Utility-Override als Projektion; genau eine Platzierung; Verlustregel §7.4; starkes Podest über die vorhandene Laufzeit-Registrierung.
**Map-Daten:** zweite Hold-Mission (Versorgungsbasis) in `00-test.json` mit Heilige-Handgranaten-Podest als Reward.

## B7 – Carry
Eigener Coop-Carry-Zustand: mehrere unabhängige Objekte, Pickup, Trägerdarstellung, Drop bei Tod und Disconnect, ein Objekt pro Spieler, definierte Abgabezone.
**Map-Daten:** drei Bierflaschen am Seitenposten, Abgabezone an der Hauptbasis, Trigger nach Encounter-Clear.

## B8 – Meta-Reward-Ledger und Item-Garantie
Teilfortschritt in den Reward-Zustand; `rareGuaranteeCount` im Rundenergebnis; Anhebung in place beim Würfeln; Reward nur bei Mapsieg; Ergebnis-UI erklärt den Bonus.
**Map-Daten:** `00-test.json` erhält einen `itemDrop`, damit die Garantie überhaupt beobachtbar ist.

## B9 – Team-Buffs
Temporärer teamweiter Buff mit gemeinsamem Endzeitpunkt; HP-Regeneration additiv, Adrenalin-Regeneration multiplikativ; 30 s; HUD mit Restdauer.
**Map-Daten:** Vollbonus an die Carry-Mission aus B7 gekoppelt.

## B10 – Multiplayer und technische Stabilisierung
Latejoin und Spectator, Carry bei Disconnect, Reward-Eligibility, keine Doppelbuchung über Snapshot- oder Reconnect-Sonderfälle, Performance, Regressionen.
**Ergebnis:** alle B-Systeme funktionieren konsistent im Coop.

## B11 – Balancing und Kampagnenintegration
XP pro Destroy-Ziel, Spawner-Druck, Hold-Start-HP und Angriffsstärke, Carry-Laufwege und Aktivierungszeitpunkte, Team-Buff-Werte, Item-Garantie im Progressionsverlauf. Danach gezielte Migration ausgewählter Kampagnenmaps – Map 13 als Destroy-Kandidat, eine spätere Map mit Raketen-Außenposten als Hold-Kandidat.
**Ergebnis:** stabile Grundlage für die folgenden Ausbaustufen.

**Reihenfolge-Hinweis:** B2 steht vor B3, weil Destroy ohne verlässliche Dormanz nicht testbar ist. B4 steht vor den weiteren Archetypen, damit jede neue Mission sofort lesbar ist.

---

# 19. Definition of Done

**Grundsystem** – Maps definieren Objectives datengetrieben; vollständige Trennung vom Hauptziel; ein Fehlschlag kann die Map nicht verlieren; maximal ein Objective ist fokussiert; Zeit- und Encounter-Trigger funktionieren; ein Objective bleibt nach Fokusverlust aktiv und zählt weiter; `completed` bedeutet ausschließlich „Zielbedingung erreicht"; Clients stellen den autoritativen Zustand dar.

**Dormanz** – Missionsstrukturen erzeugen vor ihrem Trigger keine Kollision, kein Targeting, keine Spawns und keine Darstellung; nach der Aktivierung verhalten sie sich wie normale Strukturen, inklusive Wegfindung und Client-Sync.

**Destroy** – mehrere Ziele nach Trigger aktivierbar; jedes erzeugt eigenen persistenten Druck; Zerstörung beendet zuverlässig nur die eigene Quelle; Teilfortschritt zählt und wird pro Ziel gebucht; Ziele bleiben bis Rundenende zerstörbar; ein im Hintergrund vervollständigtes Ziel erreicht `completed`; XP ohne Mapsieg.

**Hold** – Ziel definierbar, beschädigter Reveal, Zerstörung lässt nur das Objective scheitern; `holdUntil` funktioniert über Encounter und Zeit; Bindung an den letzten Pflicht-Encounter wird abgelehnt; ein bei Rundenende unvollständiger Hold erzeugt keinen Reward; Reparaturdrohnen stellen den überlebenden Posten wieder her.

**Power-up-Reward** – einmalige platzierbare Utility ohne Loadout-Slot, für jede Klasse; genau eine Platzierung; Tod oder Disconnect vor Platzierung lässt das Pickup an der Missionsbasis erneut erscheinen; danach normaler Pedestal-Lifecycle.

**Carry** – mehrere Objekte gleichzeitig, höchstens eines pro Spieler; Tod droppt, Disconnect verliert nicht; Abgabezone klar erkennbar; gesicherte Objekte verschwinden dauerhaft; 1/3, 2/3, 3/3 replizieren korrekt; Capture the Beer ist unverändert.

**Meta-Rewards** – nur bei gültigem Mapsieg; Dreierauswahl bleibt; 1/2/3 Bier garantieren 1/2/3 Optionen selten oder besser; natürlich epische Rolls bleiben episch und zählen an; die Garantie wird vor dem Persistieren angewandt und verschlechtert nie ein Angebot; Bonus wird im Ergebnisbildschirm erklärt.

**Team-Buff** – 3/3 löst den Referenzbuff aus; gemeinsamer Endzeitpunkt, 30 s; HP- und Adrenalin-Regeneration temporär erhöht; nie persistiert.

**Multiplayer** – Host bleibt Autorität; Latejoiner verändern nichts und erhalten keine B-Rewards; keine doppelte Reward-Vergabe; Rundenteilnahme bestimmt Eligibility.

**Praxis** – jeder Archetyp ist in `00-test.json` spielbar konfiguriert und wurde dort im Spiel geprüft.

**Pacing** – Objectives halten Pflicht-Encounter nicht auf; keine B-Mission benötigt eine Challenge-Wave; Ruhephasen dürfen leer bleiben; das Hauptziel bleibt ohne Nebenmission fair spielbar.

---

# 20. Risiken und Leitplanken

| Risiko | Leitplanke |
|---|---|
| Nebenmission wird faktisch Pflicht | Hauptmap muss auch ohne Reward fair schaffbar bleiben. |
| Jede Pause enthält eine Aufgabe | Objectives gezielt, nicht nach jeder Welle. |
| Destroy ist nur „Objekt kaputtschießen" | Hauptreward ist reduzierter persistenter Druck. |
| Ein Zustand bedeutet „fertig" und „läuft weiter" | Lebenszyklus und Fokus getrennt, §4. |
| Fokusverlust wirkt wie ein Abbruch | Objective bleibt `active`, Ziele bleiben interaktiv, Fortschritt zählt. |
| Hold an den letzten Encounter gebunden | Reward wäre wertlos – Validierungsfehler. |
| Hold wird ohne gehaltene Dauer belohnt | Rundenende vor `holdUntil` erzeugt keinen Reward, §7.2. |
| Hold-Ziel stirbt in Sekunden | beschädigt, aber verteidigbar; Telegraphing und Gegnerweg geben Reaktionszeit. |
| Missionsstruktur spawnt vor ihrem Trigger | Dormanz-Gate in der strukturgebundenen Spawnquelle, §10.2. |
| Runtime-Basiserzeugung fehlt im Netzwerkpfad | Prebuilt-dormant, §10.1. |
| Validierung erkennt nicht jeden Konflikt | Zweite Schicht als Runtime-Guard, §16.1. |
| Reparaturdrohnen werden Inspector-Sonderlogik | Optik wiederverwenden, Fachlogik trennen. |
| One-Shot-Reward stirbt mit dem Träger | Genau eine Verlustregel: Pickup erscheint an der Missionsbasis erneut, §7.4. |
| Carry baut CTB nach oder bricht es um | eigener Coop-Zustand, PvP-System unverändert, §8.2. |
| Client leitet Rewards aus Weltobjekten ab | Fortschritt genau einmal autoritativ; `rareGuaranteeCount` aus dem Rundenergebnis. |
| Rare-Garantie verschlechtert ein Angebot | Anhebung in place, angewandt beim Würfeln, §13. |
| Meta-Reward durch Verlieren farmbar | Item-Rewards nur bei Mapsieg. |
| Team-Buff überschreibt Builds | temporär additiv bzw. multiplikativ auf bestehende Stats. |
| System ist gebaut, aber nie gespielt | Jeder Archetyp-Schritt liefert Map-Daten mit, §18.1. |
| MapDirector wird Quest-God-Object | eigenes Objective-System; Director liefert nur semantischen Zustand. |

---

# 21. Ausblick

**Ausbaustufe C – dynamische Map-Ereignisse.** Vorhandene Setpieces (Luftangriffe, Züge, permanente Gefahrenflächen, Bossphasen) werden zu einem kleinen authored Event-Modell. Der MapDirector darf Events auslösen oder auf sie reagieren; die Fachlogik bleibt im zuständigen System.

**Ausbaustufe D – Kampagnenrework.** Maps auf die Encounter-Grammatik prüfen, Objectives gezielt verteilen, Maplängen staffeln, Schwierigkeit und Reward-Summe neu bewerten. Ziel ist nicht „jede Map bekommt alles", sondern „jede Map bekommt eine erkennbare Identität".

**Zurückgestellt:** Elite-/Champion-Modifikatoren, Challenge-Waves, Encounter-Varianten. B erzeugt Risk-vs.-Reward über Raum, Zeit, Teamaufteilung, Schutzaufgaben und Carry.

---

# 22. Zielbild

> **Angriff → Entscheidung → Konsequenz → neuer Angriff**

```text
Angriff abwehren → Brutfront öffnet sich → Team zerstört 2 von 3 Spawnern
→ späterer Druck sinkt → nächster Angriff → drittes Nest fällt später doch

Außenposten entdeckt → Team hält ihn während der nächsten Welle
→ Reparaturdrohnen stellen die Raketentürme wieder her → Posten unterstützt das Finale

3 Bier am Seitenposten → Transport über mehrere Ruhefenster → 3 / 3
→ 30 s Regenerationsschub → Mapsieg → 3 garantierte seltene oder bessere Item-Optionen
```

Längere Coop-Defense-Maps werden damit nicht einfach länger. Sie bekommen **mehr Entscheidungen, mehr räumliche Bewegung und stärkere Konsequenzen aus dem Verhalten des Teams**.

---

# Anhang A – Authoring-Muster

```text
Map
├─ Geometrie
├─ Basen / Outposts / Spawnstrukturen   (inkl. dormanter Missionsstrukturen)
├─ Hauptziel
├─ persistenter Hintergrunddruck
├─ Encounter
│
└─ Secondary Objectives
   ├─ Objective 1 ─ Trigger · focusUntil · Ziele · Fortschritt · Rewards
   └─ Objective 2 ─ Fokusfenster darf sich nicht mit Objective 1 überschneiden
```

---

# Anhang B – Reward-Matrix

| Mission | Teilfortschritt | Sofortiger Reward | Meta-Reward |
|---|---|---|---|
| **Destroy – Spawner** | pro zerstörtem Spawner | weniger zukünftiger Druck + kleine Team-XP | keiner erforderlich |
| **Hold – Raketenposten** | binär | Reparatur + dauerhafte Turmunterstützung | keiner erforderlich |
| **Hold – Versorgung** | binär | einmalige Utility für starkes Power-up-Podest | keiner erforderlich |
| **Carry – Bier** | 1/3, 2/3, 3/3 | bei 3/3 Team-Regenerationsbuff | 1–3 garantierte Rare-Optionen bei Sieg |

---

# Anhang C – Verantwortungsgrenzen

```text
CoopDefenseRoundStateSystem  → Sieg / Niederlage des Hauptziels
CoopDefenseMapDirector       → verpflichtende Encounter-Dramaturgie, semantischer Encounter-Zustand
SecondaryObjectiveSystem     → Lebenszyklus, Fokus, Fortschritt, Reward-Anforderung, Reward-Ledger
BaseManager / Spawn-Systeme  → Welt- und HP-Mechanik, Dormanz-Gates
PowerUpSystem                → Power-up- und Pedestal-Lifecycle
Coop-Carry-Zustand           → Aufnahme / Tragen / Drop / Abgabe
Progression / Item-System    → XP-Ausschüttung und Item-Angebot
NetworkBridge                → Objective-Snapshot, Runden-XP, rareGuaranteeCount im Rundenergebnis
```

Keines dieser Systeme übernimmt für B die Fachlogik eines anderen.

---

**Ende des GDD – Ausbaustufe B · Version 3**
