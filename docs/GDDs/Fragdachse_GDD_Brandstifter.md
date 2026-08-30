# FRAGDACHSE – GDD: Brandstifter

**Status:** Implementierungsgrundlage / Work in Progress  
**Gegner-ID (Arbeitstitel):** `firestarter-badger` / „Brandstifter“  
**Spielmodus:** Coop Defense  
**Rolle:** Mobiler Elite-Fernkämpfer / Combo-Spezialist  
**Ziel dieses Dokuments:** Fachliche und technische Grundlage für die Implementierung des Brandstifters sowie der dafür benötigten generisch wiederverwendbaren Systeme.

---

## 1. Designziel

Der Brandstifter soll ein intelligenter, offensiver Elite-Fernkämpfer sein, der sich deutlich von bestehenden Gegnern wie dem Pyro-Dachs unterscheidet.

Seine Identität basiert auf vier Elementen:

1. **Langsame Feuerkugeln**, die selbst Schaden verursachen und gleichzeitig als Combo-Ziele dienen.
2. **Telegraphierte Feuerlanze als Hitscan**, die nach kurzer Verzögerung entlang einer festen Zielrichtung abgefeuert wird.
3. **Feuerkugel + Feuerlanze = Combo-Explosion** mit hohem Flächenschaden, Bodenfeuer und Feuerchunks.
4. **Taktische Dodges/Repositionierung**, um gegnerischen Projektilen auszuweichen oder bessere Schusswinkel zu erzeugen.

Das zentrale Gameplay-Gesetz muss für Spieler jederzeit konsistent bleiben:

> **Trifft eine Feuerlanze eine Feuerkugel, detoniert die Feuerkugel. Immer.**

Es darf keine unsichtbaren Sonderregeln geben, bei denen Feuerlanzen eigene Feuerkugeln teilweise ignorieren oder nur in speziellen KI-Zuständen detonieren.

---

## 2. Abgrenzung zu bestehenden Gegnern

### Pyro-Dachs

Der Pyro-Dachs ist ein vergleichsweise naher, aggressiver und mobiler Projektilkämpfer mit brennenden Schüssen.

Der Brandstifter soll sich davon klar unterscheiden:

- bevorzugt größere Distanz,
- wesentlich bewusstere Positionierung,
- deutlich langsamere Angriffskadenz,
- Feuerkugeln als eigenständige Raum-/Combo-Elemente,
- Feuerlanze als präziser, angekündigter Hitscan,
- taktische Seitwärtsbewegung für bessere Schusslinien,
- stärkere Interaktion zwischen seinen eigenen Angriffen.

### Gauss

Die Feuerlanze darf trotz Telegraphing nicht wie die Gauss wirken:

- deutlich kürzere Aufladung,
- keine lange stationäre Charge-Phase,
- weniger „Superschuss“-Charakter,
- Brandstifter darf sich während des Großteils der Aufladung noch repositionieren,
- die letzten 150 ms dienen als kurzer, klarer Commitment-Moment.

---

## 3. Grundwerte – erster Prototyp

Diese Werte dienen ausdrücklich als Startwerte für den ersten spielbaren Build und müssen in der Balancing-Phase überprüft werden.

| Wert | Startwert / Vorgabe |
|---|---:|
| HP | ca. **300** |
| Primäres Ziel | Spieler |
| Bevorzugter Kampfabstand | ca. **400–700 px** |
| Feuerkugel – Max Charges | **3** |
| Feuerkugel – Schussabstand | ca. **400 ms** |
| Charge-Regeneration | **1 Charge pro 2 s** ohne Feuerkugel-Nutzung |
| Feuerlanze – Cooldown | ca. **600 ms** |
| Mindestabstand zwischen unterschiedlichen Angriffen | ca. **200 ms** |
| Feuerlanze – Telegraph | **500 ms** |
| Freie Bewegung während Telegraph | erste **350 ms** |
| Commitment / Stillstand | letzte **150 ms** |
| Combo-Radius | zunächst **125 px** |
| Dodge | kleiner + großer Dodge, gemeinsamer Cooldown |

Die exakten Schadenswerte, Feuerkugelgeschwindigkeit, Feuerlanzenreichweite, Dodge-Distanzen und Dodge-Cooldowns sind Teil der Balancing-Phase.

---

# 4. Generisches Charge-System

## 4.1 Ziel

Für die Feuerkugeln wird kein Adrenalin-ähnlicher kontinuierlicher Ressourcenbalken verwendet, sondern ein **generisches regenerierendes Charge-System**.

Dieses System darf nicht speziell für den Brandstifter implementiert werden.

Es soll später auch für Spieler-Inhalte nutzbar sein, z. B.:

- HE-Granate mit zwei Charges,
- Molotov mit mehreren Charges,
- andere Utility-Upgrades,
- mögliche zukünftige Gegnerfähigkeiten.

## 4.2 Fachliches Verhalten

Beispielkonfiguration:

```ts
maxCharges: 3
rechargeIntervalMs: 2000
```

Bei voller Ladung:

```text
3 Charges
Feuerkugel -> 2
Feuerkugel -> 1
Feuerkugel -> 0
```

Nach der letzten Feuerkugel beginnt die Regeneration erneut ab diesem Zeitpunkt:

```text
+2 s -> 1 Charge
+4 s -> 2 Charges
+6 s -> 3 Charges
```

Wird während der Regeneration erneut eine Feuerkugel benutzt, wird der Regenerationszeitpunkt auf Basis dieser Nutzung neu bestimmt.

Das gewünschte Modell ist bewusst einfach:

> **Pro vollständig verstrichenem Recharge-Intervall seit der letzten relevanten Nutzung wird eine Charge wiederhergestellt.**

Keine individuellen Timer pro verbrauchter Charge und keine kontinuierliche Fließkomma-Ressource.

## 4.3 Trennung von Charge und Cooldown

Charges und Cooldown erfüllen unterschiedliche Aufgaben:

- **Charge:** Wie viele Nutzungen können kurzfristig bevorratet werden?
- **Cooldown:** Wie schnell dürfen diese Nutzungen hintereinander erfolgen?

Für den Brandstifter bedeutet dies:

- maximal drei Feuerkugeln bevorratet,
- trotzdem mindestens ca. 400 ms zwischen zwei Feuerkugeln.

## 4.4 Architekturvorgabe

Das System soll als allgemeine Runtime-Komponente entstehen, z. B. sinngemäß:

```ts
interface RechargeableChargeConfig {
  maxCharges: number;
  rechargeIntervalMs: number;
  startCharges?: number;
}
```

Mögliche Runtime-API:

```ts
getAvailableCharges(now: number): number
canConsume(now: number): boolean
consume(now: number): boolean
reset(now?: number): void
```

Die konkrete Namensgebung bleibt der Implementierung überlassen.

Wichtig:

- kein Brandstifter-spezifischer Typ,
- keine Abhängigkeit von Enemy-Klassen,
- später in Player-Utilities integrierbar,
- autoritative Zustandsführung auf dem Host.

---

# 5. Feuerkugel

## 5.1 Funktion

Die Feuerkugel ist:

- ein relativ langsames Projektil,
- direkt auf bzw. in Richtung eines Spielers abgefeuert,
- selbst bereits gefährlich,
- gleichzeitig der zentrale Combo-Träger.

Sie soll sich optisch klar von normalen Projektilen unterscheiden und kann auf dem bereits vorhandenen Fireball-Rendering aufbauen.

## 5.2 Nutzung

Der Brandstifter kann maximal drei Charges bevorraten.

Bei verfügbaren Charges kann er mehrere Feuerkugeln in kurzer Folge verschießen:

```text
Kugel -> 400 ms -> Kugel -> 400 ms -> Kugel
```

Danach begrenzt das Charge-System weitere Kugeln.

Es gibt **keine zusätzliche maximale Anzahl aktiver Feuerkugeln in der Welt**.

Das natürliche Limit entsteht durch:

- maximal drei bevorratete Charges,
- Charge-Regeneration,
- Projektil-Lifetime,
- Terrainkollisionen,
- direkte Treffer,
- Combos.

## 5.3 Direkter Treffer / normales Ende

Die Feuerkugel soll bereits ohne Combo eine **kleine Explosion ähnlich dem ASMD-Ball** erzeugen.

Sie soll damit nicht zu einem harmlosen „Combo-Marker“ werden.

Die normale Explosion ist jedoch deutlich schwächer als die Combo-Explosion.

Erster Designrahmen:

- kleiner AoE-Radius,
- moderater Direktschaden / AoE-Schaden,
- Burn möglich,
- deutlich weniger Feuerchunks bzw. keine starken Combo-Folgeeffekte.

Exakte Werte werden gebalanced.

---

# 6. Feuerlanze

## 6.1 Grundprinzip

Die Feuerlanze ist eine **telegraphierte Hitscan-Waffe**.

Sie verwendet eine feste maximale Waffenreichweite.

Der beim Angriff gespeicherte Target-Point bestimmt **nur die Richtung**, nicht das Ende des Strahls.

Beispiel:

```text
Brandstifter -------- Spieler -------------------->
                    Target-Point

Der Spieler steht nur 300 px entfernt.
Der Hitscan läuft trotzdem bis zur vollen Waffenreichweite.
```

Die Feuerlanze stoppt am ersten gültigen blockierenden Treffer.

## 6.2 Blocker

Die Feuerlanze stoppt an:

- Spieler,
- Feuerkugel,
- Felsen,
- Basen.

Weitere relevante World-Objekte sollen konsistent mit den bestehenden Hitscan-/Combat-Regeln behandelt werden.

Kein Durchschlagen durch Spieler oder Feuerkugeln.

## 6.3 Ziel-Fixierung

Beim Start der Feuerlanze wird eine **Weltposition** gespeichert:

```ts
targetX
targetY
```

Es wird ausdrücklich **nicht** der Spieler als nachverfolgtes Ziel gespeichert.

Bewegt sich der Spieler während der 500 ms Telegraph-Zeit, bleibt der Target-Point unverändert.

Damit kann der Spieler dem späteren Hitscan aktiv ausweichen.

## 6.4 Bewegung während des Telegraphs

Ablauf:

```text
0 ms
- Target-Point wird fixiert
- Telegraph startet

0–350 ms
- Brandstifter darf sich bewegen
- offensiver oder defensiver Dodge möglich
- sichtbare Schussachse verändert sich mit seiner Position
- Target-Point bleibt unverändert

350 ms
- Commitment beginnt

350–500 ms
- Brandstifter steht vollständig still
- kein Dodge
- keine Repositionierung
- finale Schusslinie bleibt stabil sichtbar

500 ms
- Hitscan wird ausgelöst
```

Während der letzten **150 ms** ist der Brandstifter vollständig committed.

Auch ein defensiver Dodge darf dann nicht mehr starten.

## 6.5 Feuerlanzen-Cooldown

Startwert:

- ca. **600 ms** zwischen zwei Feuerlanzen.

Zusätzlich soll zwischen unterschiedlichen offensiven Angriffen ein kurzer globaler Mindestabstand bestehen, zunächst ca. **200 ms**.

Beispiel:

```text
Feuerkugel
200 ms
Feuerlanze darf vorbereitet werden
```

Die genauen Zeitpunkte sollen so umgesetzt werden, dass keine ungewollten Doppelaktionen im selben Tick entstehen.

---

# 7. Combo-System

## 7.1 Grundregel

Jede Feuerlanze besitzt dieselbe Wirkung.

Es gibt keine getrennte „Combo-Lanze“.

Trifft die tatsächliche Hitscan-Linie eine Feuerkugel:

> **Feuerkugel detoniert als Combo.**

Die KI-Absicht verändert niemals die physikalische Regel.

## 7.2 Combo-Zielwahl

Eine Combo gilt als sinnvoll, wenn die Explosion mindestens einen Spieler treffen kann.

Startwert:

```text
Combo-Radius: 125 px
```

Die KI muss keine komplexe Multi-Target-Optimierung durchführen.

Wenn mehrere Feuerkugeln für eine Combo infrage kommen:

1. berücksichtige nur Kugeln, deren Explosion einen Spieler treffen kann,
2. bevorzuge die Kugel, deren Explosionszentrum am nächsten an einem gültigen Spieler liegt.

Kein aufwendiges Scoring nach erwarteter Gesamtzahl getroffener Spieler.

## 7.3 Zukunftsprognose

Da zwischen Zielentscheidung und Hitscan 500 ms liegen, muss die KI die erwartete Feuerkugelposition beim Abschuss berücksichtigen.

Bei geradliniger Bewegung genügt eine einfache Prognose:

```text
futurePosition =
currentPosition +
velocity * remainingTelegraphTime
```

Die Prognose dient nur der KI-Entscheidung.

Der eigentliche Schuss verwendet weiterhin:

- den fixierten Target-Point,
- die reale Position des Brandstifters beim Abschuss,
- die reale Position der Feuerkugel beim Hitscan.

Die KI darf sich daher verschätzen.

## 7.4 Combo-Explosion

Die Combo soll deutlich spektakulärer als die normale Feuerkugel-Explosion sein.

Pflichteffekte:

- direkter Flächenschaden,
- Combo-Radius zunächst **125 px**,
- Burn,
- Boden im Explosionsbereich wird in Brand gesetzt,
- mehrere Feuerchunks / Flammenbrocken werden radial verteilt.

Die Feuerchunks sind ein zentrales visuelles Merkmal der Combo.

Das Verhalten soll möglichst auf bestehenden generischen Explosions-, Ground-Fire- und Fire-Chunk-Systemen aufbauen.

### Generische Architektur

Falls das bestehende `DetonableConfig` die benötigten Payloads noch nicht vollständig unterstützt, soll es **generisch** erweitert werden.

Zielrichtung:

```ts
DetonableConfig {
  ...
  burnOnHit?: ...
  groundFire?: ...
  fireChunkBurst?: ...
}
```

Keine Brandstifter-spezifische Explosion außerhalb des allgemeinen Detonations-/Explosionspfades.

---

# 8. KI-Grundverhalten

## 8.1 Kampfabstand

Der Brandstifter bevorzugt einen relativ breiten Distanzbereich:

> **ca. 400–700 px**

Innerhalb dieses Bereiches muss er nicht permanent auf eine exakte Wunschdistanz korrigieren.

Unterhalb des Bereiches versucht er eher, Distanz zu gewinnen.

Oberhalb des Bereiches darf er sich wieder annähern.

Die vorhandene Combat-Positioning-Logik soll möglichst genutzt bzw. nur minimal erweitert werden.

## 8.2 Prioritäten

Grundlegende Prioritätsreihenfolge:

```text
1. Defensive Gefahr prüfen
2. Falls nötig defensiv dodgen
3. Laufenden committed Feuerlanzenzustand fortsetzen
4. Sinnvolle Combo prüfen
5. Sinnvollen direkten Feuerlanzen-Schuss prüfen
6. Feuerkugel verwenden, wenn Charge verfügbar
7. Normales Repositionieren / Distanz halten
```

Wichtig:

- defensiver Dodge hat Vorrang vor offensiven Entscheidungen,
- während der letzten 150 ms der Feuerlanze ist jedoch kein Dodge mehr erlaubt,
- eine laufende offensive Entscheidung wird nicht mehrfach komplett umgeplant.

---

# 9. Offensive Schussentscheidung

## 9.1 Combo oder Direktschuss

Vor einer Feuerlanze entscheidet die KI:

- ist eine sinnvolle Combo möglich?
- ist ein direkter Schuss sinnvoller?
- ist dafür zuerst eine lokale Repositionierung notwendig?

Die Entscheidung soll bewusst einfach und robust bleiben.

## 9.2 Einheitliches Feuerlanzen-Verhalten

Auch bei einem geplanten Direktschuss gilt:

> Schneidet der reale Hitscan beim Abschuss eine Feuerkugel, detoniert diese.

Die KI versucht unerwünschte Combos nur durch Positionierung zu vermeiden.

Damit bleiben Fehler und emergente Situationen möglich.

---

# 10. Offensive Repositionierung

## 10.1 Ziel

Der Brandstifter darf seine Position aktiv verändern, um:

- eine durch Feuerkugeln blockierte direkte Schusslinie freizubekommen,
- eine bessere Combo-Linie zu erhalten,
- eine durch Felsen/Basen blockierte Sichtlinie zu umgehen,
- innerhalb seines bevorzugten Kampfabstands einen besseren Winkel zu bekommen.

## 10.2 Keine komplexe Pfadplanung

Es soll **kein taktischer Voll-Pathfinder** gebaut werden.

Stattdessen wird lokal eine kleine Menge möglicher Repositionsziele bewertet.

Beispiel:

```text
- aktuelle Position
- kleiner Dodge links
- kleiner Dodge rechts
- großer Dodge links
- großer Dodge rechts
```

Optional können Kandidaten relativ zur Zielrichtung berechnet werden.

## 10.3 Bewertung

Für einen Kandidaten wird mindestens geprüft:

- gültiger/freier Landepunkt,
- Bewegungsweg möglich,
- gewünschte Sichtlinie nach dem Dodge vorhanden,
- bei Direktschuss: keine unerwünschte Feuerkugel auf der prognostizierten Linie,
- bei Combo: gewünschte Feuerkugel auf sinnvoller Linie,
- bevorzugter Kampfabstand nicht unnötig verlassen.

Wenn kleiner und großer Dodge dasselbe Problem lösen:

> **kleinen Dodge bevorzugen.**

## 10.4 Felsen und Basen

Wenn die Sichtlinie zum Ziel durch Felsen oder Basen blockiert wird, soll der Brandstifter versuchen, durch einen kleinen oder großen seitlichen Dodge einen freien Winkel zu erzeugen.

Findet er keinen sinnvollen lokalen Kandidaten:

- kein erzwungenes Herumlaufen,
- normale Navigation/Positionierung übernimmt wieder,
- Angriff wird später erneut bewertet.

---

# 11. Dodge-System

## 11.1 Zwei Dodge-Distanzen

Der Brandstifter erhält:

- **kleinen Dodge**
- **großen Dodge**

Beide sollen möglichst über dasselbe generische Dodge-/Dash-System laufen.

Die KI entscheidet situationsabhängig über die benötigte Distanz.

## 11.2 Gemeinsamer Zustand und Cooldown

Kleiner und großer Dodge teilen:

- denselben Dodge-Zustand,
- denselben Cooldown,
- dieselbe Regel „kein zweiter Dodge während eines laufenden Dodges“.

Ein neuer Dodge darf erst starten, wenn:

1. der vorherige Dodge vollständig abgeschlossen ist,
2. der gemeinsame Dodge-Cooldown abgelaufen ist.

## 11.3 Defensive Nutzung

Defensive Dodges reagieren auf anfliegende Spielerprojektile.

Beispiele:

- kleine Korrektur reicht -> kleiner Dodge,
- größere Verschiebung nötig -> großer Dodge.

Defensive Dodge-Entscheidungen haben grundsätzlich Vorrang vor offensiver Repositionierung.

Ausnahme:

> Während der letzten **150 ms Commitment** einer Feuerlanze darf kein Dodge mehr ausgelöst werden.

## 11.4 Offensive Nutzung

Offensive Dodges dienen ausschließlich einer besseren Kampfposition bzw. Schussgeometrie.

Sie dürfen insbesondere für folgende Fälle eingesetzt werden:

- Feuerkugel liegt unerwünscht zwischen Brandstifter und direktem Ziel,
- Feuerkugel soll gezielt in die Combo-Linie gebracht werden,
- Felsen/Basis blockiert die LoS,
- besserer Winkel innerhalb des bevorzugten 400–700-px-Bereichs.

## 11.5 Generische Erweiterung

Falls das bisherige Dodge-System nur eine feste Dash-Distanz unterstützt, soll es so erweitert werden, dass der aufrufende Kontext zwischen mindestens zwei Distanzen wählen kann.

Keine Brandstifter-spezifische Kopie des Dodge-Systems.

Mögliche generische Form:

```ts
requestEnemyDodge({
  enemyId,
  direction,
  distanceMode: 'short' | 'long'
})
```

oder äquivalent über einen Distanzfaktor.

---

# 12. Feuerlanzen-Telegraph / Rendering

## 12.1 Ziel

Die Feuerlanze muss trotz Hitscan fair ausweichbar sein.

Der Telegraph soll klar, aber deutlich schneller und leichter als die Gauss wirken.

## 12.2 Ablauf

Während der 500-ms-Vorbereitung:

- Waffe/Mündung glüht sichtbar auf,
- Funken/Hitze nehmen zu,
- aktuelle Schussachse wird sichtbar,
- Linie folgt der aktuellen Brandstifterposition zum fixierten Target-Point.

Während der letzten 150 ms:

- Brandstifter steht still,
- Linie bleibt stabil,
- Intensität steigt,
- Spieler erkennt die endgültige Gefahrenachse.

Beim Abschuss:

- sehr kurzer, heller Feuerstrahl,
- unmittelbarer Hitscan-Impact,
- Treffer auf Feuerkugel löst Combo aus.

## 12.3 Renderer

Für die Feuerlanze ist ein eigener Renderer bzw. ein klar abgegrenztes Preset vorgesehen.

Er soll nicht einfach nur eine umgefärbte ASMD- oder Gauss-Darstellung sein.

Die genaue technische Form kann nach Prüfung der bestehenden Hitscan-Renderer entschieden werden.

---

# 13. Line of Sight

LoS ist ein zentraler Bestandteil der KI.

Sie muss mindestens berücksichtigt werden bei:

- Auswahl eines direkten Feuerlanzen-Schusses,
- Auswahl einer Combo,
- Feuerkugel-Abschuss,
- Bewertung offensiver Repositionierungen,
- Bewertung möglicher Positionen hinter Felsen/Basen.

Ein Angriff darf nicht durch Terrain „geplant“ werden, wenn die reale Feuerlanze dort ohnehin blockiert würde.

---

# 14. Host Authority / Multiplayer

Alle gameplayrelevanten Entscheidungen bleiben host-autoritativ:

- Charge-Zustand,
- Fireball-Nutzung,
- Angriffsauswahl,
- Target-Point,
- Dodge-Entscheidung,
- Combo-Auflösung,
- Hitscan-Treffer,
- Schaden,
- Ground Fire,
- Fire Chunks.

Clients erhalten nur die für Darstellung und Synchronisation erforderlichen Zustände/Ereignisse.

Besonders wichtig für die Feuerlanze:

Der Client muss ausreichend Informationen erhalten, um während der 500-ms-Phase konsistent darzustellen:

- Start der Charge,
- fixierter Target-Point,
- aktueller bzw. replizierter Brandstifterstand,
- Zeitpunkt des Commitments / Abschusses.

Es soll keine clientseitige eigene Zielentscheidung geben.

---

# 15. Nicht-Ziele

Für die erste Umsetzung ausdrücklich nicht vorgesehen:

- komplexe Mehrspieler-Optimierung für Combos,
- taktische globale Pfadsuche zu perfekten Schusspositionen,
- Homing für Feuerkugeln,
- Flammenwerfer,
- separate „Combo-Lanze“,
- unterschiedliche mechanische Regeln für direkte und Combo-Feuerlanzen,
- individuelle Charge-Timer pro verbrauchter Charge,
- eigener Brandstifter-only Dodge-Code,
- eigener Brandstifter-only Explosions-/Fire-Chunk-Pfad.

---

# 16. Implementierungsphasen

Die Phasen sind bewusst so getrennt, dass jede Phase einen klar testbaren Stand erzeugt und generische Infrastruktur vor Brandstifter-Speziallogik entsteht.

---

## Phase 1 – Generische Charge-Infrastruktur

### Ziel

Ein allgemein verwendbares regenerierendes Charge-System schaffen.

### Umfang

- generischer Charge-Runtime-State,
- `maxCharges`,
- `rechargeIntervalMs`,
- Consume-/Query-/Reset-API,
- Host-Autorität,
- Unit Tests für Zeitverhalten,
- noch keine UI-Pflicht für Spieler-Utilities,
- noch keine HE-Upgrade-Umsetzung notwendig.

### Pflicht-Testfälle

- startet mit voller Charge-Anzahl,
- mehrere Charges können schnell verbraucht werden,
- 1 Charge nach 2 s,
- 2 Charges nach 4 s,
- Regeneration stoppt am Maximum,
- erneute Nutzung verschiebt den Regenerationsbezug korrekt,
- kein negativer Charge-Zustand.

### Abnahmekriterium

Das Charge-System kann ohne Bezug zum Brandstifter instanziiert und getestet werden.

---

## Phase 2 – Generische Kampfgrundlagen

### Ziel

Alle allgemein verwendbaren Erweiterungen schaffen, die der Brandstifter später benötigt.

### Umfang

1. Dodge-System so erweitern, dass kleiner und großer Dodge über denselben generischen Pfad möglich sind.
2. Gemeinsamen Dodge-Cooldown und „nur ein aktiver Dodge“ beibehalten.
3. Falls erforderlich `DetonableConfig` generisch um folgende Payloads erweitern:
   - Burn,
   - Ground Fire,
   - Fire Chunk Burst.
4. Sicherstellen, dass Hitscan gegen detonierbare Projektile sauber mit Terrain-/Target-Stop arbeitet.
5. Tests für Detonation und Dodge-Erweiterungen.

### Abnahmekriterium

Die neuen Fähigkeiten sind nicht an einen konkreten Enemy-Type gekoppelt und könnten von weiteren Gegnern oder Spieler-Systemen wiederverwendet werden.

---

## Phase 3 – Brandstifter Basisgegner und Waffen

### Ziel

Einen spielbaren Brandstifter ohne komplexe taktische Repositionierung erhalten.

### Umfang

- Enemy-Config / Registry,
- ca. 300 HP,
- MovementTarget Spieler,
- Combat Positioning 400–700 px,
- Feuerkugel-Waffe,
- drei Fireball-Charges,
- 400-ms-Fireball-Kadenz,
- Charge-Regeneration 1 / 2 s,
- normale kleine Feuerkugel-Explosion,
- Feuerlanzen-Hitscan,
- feste maximale Reichweite,
- 600-ms-Lance-Cooldown,
- 200-ms Cross-Weapon-Gap,
- 500-ms Telegraph,
- 350 ms beweglich + 150 ms committed,
- Target-Point als feste Weltposition,
- LoS-Prüfung,
- Basis-Telegraph/VFX.

Noch keine intelligente Winkeloptimierung erforderlich.

### Abnahmekriterium

Der Brandstifter kann:

- auf 400–700 px kämpfen,
- Feuerkugeln bursten,
- nachladen,
- eine sichtbare, ausweichbare Feuerlanze abfeuern,
- während der letzten 150 ms sicher stillstehen.

---

## Phase 4 – Combo

### Ziel

Die vollständige Signature-Mechanik implementieren.

### Umfang

- Feuerlanze detoniert jede Feuerkugel auf ihrer realen Hitscan-Linie,
- normale Kugel-Explosion bleibt schwächer,
- Combo-Radius zunächst 125 px,
- direkter Combo-AoE-Schaden,
- Burn,
- Ground Fire,
- Fire Chunk Burst,
- einfache Combo-Zielsuche,
- zukünftige Kugelposition für 500-ms-Telegraph prognostizieren,
- bei mehreren Kandidaten: Kugel mit geringstem Abstand zu einem gefährdeten Spieler bevorzugen.

### Abnahmekriterium

Das Gameplay-Gesetz ist vollständig konsistent:

> Jede reale Lance/Kugel-Intersection erzeugt die Combo, unabhängig von der ursprünglichen KI-Absicht.

---

## Phase 5 – Taktische Repositionierung und Dodge-KI

### Ziel

Dem Gegner seine charakteristische intelligente Bewegung geben.

### Umfang

- defensiver Dodge mit höchster Priorität,
- kleiner/großer Dodge situationsabhängig,
- offensive lokale Kandidatensuche,
- Positionen:
  - current,
  - short left/right,
  - long left/right,
- LoS-Bewertung,
- Fels-/Basis-Blocker berücksichtigen,
- unerwünschte Feuerkugel auf Direktschusslinie berücksichtigen,
- gewünschte Feuerkugel für Combo berücksichtigen,
- kleinen Dodge bevorzugen, wenn ausreichend,
- während 0–350 ms Lance-Telegraph Repositionierung erlauben,
- während 350–500 ms keinerlei Dodge oder Bewegung,
- keine zweite vollständige Angriffsentscheidung während einer bereits gestarteten Feuerlanze.

### Abnahmekriterium

Der Brandstifter kann sichtbar:

- einer Rakete ausweichen,
- einen Felsen seitlich umgehen, um eine Schusslinie zu erhalten,
- eine eigene Feuerkugel für einen Direktschuss umgehen,
- einen besseren Winkel für eine Combo erzeugen,
- dabei ohne hektisches Links/Rechts-Flattern stabil wirken.

---

## Phase 6 – Präsentation, Balancing und Stabilisierung

### Ziel

Den Gegner spielerisch lesbar, fair und performant machen.

### Umfang

- finaler Feuerlanzen-Renderer,
- finaler Fireball-/Combo-Look,
- Audio,
- Telegraph-Lesbarkeit,
- Dodge-Lesbarkeit,
- Schadenswerte,
- Feuerkugelgeschwindigkeit,
- Feuerlanzenreichweite,
- Fireball-/Lance-Cooldowns,
- Charge-Intervall,
- Dodge-Distanzen,
- Dodge-Cooldown,
- Combo-Schaden,
- Fire-Chunk-Anzahl und Verteilung,
- Ground-Fire-Dauer,
- Burn,
- HP/XP,
- Multiplayer-Tests Host + Client,
- Performance mit mehreren Brandstiftern,
- Tests auf engen Maps und bei vielen Felsen.

### Besonderer Balancing-Fokus

Prüfen:

- ist 500 ms Telegraph ausreichend fair?
- reichen 150 ms stabile finale Linie?
- ist der Brandstifter auf Distanz zu schwer mit Projektilwaffen zu treffen?
- dodgt er zu häufig?
- erzeugen mehrere Brandstifter zu viele Feuerchunks?
- entstehen zu viele aktive Feuerkugeln durch lange Lifetimes?
- ist die normale Fireball-Explosion bereits zu stark?
- ist die Combo mit 125 px gut lesbar und gefährlich genug?
- wirkt das Repositionieren intelligent statt nervös?

---

# 17. Test-Szenarien

Mindestens folgende Situationen sollen gezielt getestet werden:

### A. Charge-Burst

Brandstifter startet mit drei Charges und kann drei Kugeln mit ca. 400 ms Abstand abfeuern. Danach ist keine vierte Kugel sofort möglich.

### B. Charge-Regeneration

Nach vollständigem Verbrauch:

- nach 2 s genau eine Kugel verfügbar,
- nach 4 s zwei,
- nach 6 s drei.

### C. Direktschuss ohne Kugel

500-ms-Telegraph, Spieler weicht aus, Hitscan trifft nur die ursprünglich bestimmte Richtung.

### D. Spieler bewegt sich während Telegraph

Target-Point folgt dem Spieler nicht.

### E. Feuerkugel kreuzt Direktschuss

Auch wenn die KI ursprünglich einen Spieler treffen wollte, detoniert die Kugel.

### F. Combo

Kugel wird bei erwarteter Position in Spielnähe anvisiert und durch die Lanze detoniert.

### G. Felsen blockiert LoS

Brandstifter versucht lokalen kleinen/großen Seitendodge. Wenn kein sinnvoller Kandidat existiert, kein hektisches Oszillieren.

### H. Rakete während offensiver Planung

Defensiver Dodge übernimmt Vorrang.

### I. Rakete in letzten 150 ms

Kein Dodge. Brandstifter bleibt committed.

### J. Blocker hinter Target-Point

Target-Point bestimmt nur Richtung; Hitscan läuft weiter bis zur Maximalreichweite und kann dahinter ein Ziel treffen.

### K. Mehrere Feuerkugeln

Lanze stoppt an der ersten getroffenen Kugel. Nur diese wird durch den konkreten Strahl getroffen/detoniert.

### L. Multiplayer

Telegraph, Dodge, Hitscan und Combo müssen auf Host und Client visuell und gameplayseitig konsistent sein.

---

# 18. Offene Balancing-Werte

Folgende Werte sind bewusst noch nicht final festgelegt:

- Feuerkugelgeschwindigkeit,
- Feuerkugelreichweite / Lifetime,
- Feuerkugel-Normalschaden,
- Feuerkugel-Normalexplosionsradius,
- Feuerkugel-Burn,
- Feuerlanzenreichweite,
- Feuerlanzen-Direktschaden,
- Combo-Schaden,
- Combo-Knockback,
- Burn-Dauer und Schaden,
- Ground-Fire-Dauer und DPS,
- Fire-Chunk-Anzahl,
- Fire-Chunk-Verteilradius,
- Fire-Chunk-Bodendauer,
- kleiner Dodge – Distanz,
- großer Dodge – Distanz,
- Dodge-Cooldown,
- XP-Wert,
- Spawn-Häufigkeit / erste Map.

Diese Werte sollen nach einem funktionsfähigen Prototyp anhand realer Spielsituationen bestimmt werden.

---

# 19. Definition of Done

Der Brandstifter gilt als vollständig umgesetzt, wenn:

- der Gegner mit ca. 300 HP und 400–700 px bevorzugter Distanz funktioniert,
- Fireball-Charges über ein generisches Charge-System laufen,
- drei Feuerkugeln geburstet und anschließend im 2-s-Rhythmus regeneriert werden können,
- Feuerkugeln selbst kleine Explosionen verursachen,
- Feuerlanze 500 ms telegraphiert wird,
- Target-Point eine feste Weltposition ist,
- der Strahl immer die vollständige Waffenreichweite nutzt,
- die letzten 150 ms vollständig committed sind,
- Lance/Kugel-Intersection immer dieselbe Combo auslöst,
- Combo AoE + Burn + Ground Fire + Fire Chunks erzeugt,
- die KI einfache Combo- und Direktschussentscheidungen trifft,
- LoS berücksichtigt wird,
- kleiner und großer Dodge generisch umgesetzt sind,
- defensive Dodges Vorrang besitzen,
- offensive Dodges für lokale Winkelverbesserung genutzt werden,
- alle relevanten Gameplay-Entscheidungen host-autoritativ sind,
- Host und Clients Telegraph, Dodge und Combo konsistent darstellen,
- das Verhalten durch Tests und Playtests stabilisiert wurde.

