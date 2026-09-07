# Fragdachse – Adrenalin-Essenz Implementation Plan

**Status:** P1–P5 durch ausdrücklichen Folgeauftrag vollständig autorisiert und integriert; Sichtprüfung ausdrücklich ausgeschlossen. Der folgende Implementierungsstand trennt automatisierte Nachweise von offenen manuellen Nachweisen.

**Fachliche Grundlage:** [Adrenalin-Essenz GDD](Fragdachse_Adrenalin_Essenz_GDD_v2_1.md), Dokumentversion 2.5 vom 08.09.2026

**Architekturgrundlagen:** Combat Runtime, Gameplay Runtime und Projectile Runtime Architecture Core/Details im Repository

**Analysierter Ausgangspunkt:** Ursprünglich `0670b9a95c6576e3340dc802bda3d71cd711b186`; gezielter Dokumentreview am 07.09.2026 bei lokalem HEAD `505e5af0404e82e7bec2c499aca7344611fcc07a` mit vorhandenen Arbeitsbaumänderungen. Kein vollständiges Cutover-Inventar oder technischer Abnahmenachweis.

**Phasen:** P1–P5

**Ziel nach P5:** vollständig integrierte, multiplayerfähige, performant abgesicherte und optisch ansprechende Adrenalin-Essenz ohne Legacy-Doppelpfade oder Prototyp-Darstellung

> **Die GDD entscheidet Spieler- und Balance-Semantik. Dieser Plan entscheidet technische Verträge, Cutover-Reihenfolge, Phasen und Abnahme-Gates. Architekturgrenzen aus den bestehenden Runtime-Dokumenten bleiben vorrangig.**

---

## 1. Ziel und Arbeitsweise

### Umsetzungsstand vom 08.09.2026

**Dreifachstreuung:** Die [autoritative Runtime](../../../src/adrenalineEssence/AdrenalineEssenceRuntime.ts) erzeugt pro berechtigtem Treffer standardmäßig drei getrennt sammelbare Beiträge. Seed-basierte Richtungen liegen ungefähr 120° auseinander, je Richtung höchstens ±10°, bei 30–45 px Radius. Erst nach der begrenzten Geometrieprüfung wird der vollständige Wert auf unterschiedliche gültige Punkte verteilt; der letzte Beitrag erhält den rechnerischen Rest. Teilweise fehlende Punkte verlieren keinen Wert. Reward-, Basis- und Attributionszähler bleiben einmalig; die vorhandenen Merge-, Ablauf- und Rückgaberegeln gelten für jeden Beitrag.

**Flüssigkeitsmaterial und Licht:** [AdrenalineEssenceLiquidFrames](../../../src/adrenalineEssence/AdrenalineEssenceLiquidFrames.ts) erzeugt drei organische Körpervarianten mit je acht Phasen und einen Flüssigkeitsschwanz im gemeinsamen GPU-Atlas. Zwei gepoolte Body-/Glow-Layer zeigen kleine cyanblaue Perlen mit weichen Reflexen, Landungsimpuls, ruhiger Formbewegung und gestrecktem Magnetflug. [AdrenalineEssenceLighting](../../../src/adrenalineEssence/AdrenalineEssenceLighting.ts) bündelt deren tatsächliche Darstellungspositionen in 64-px-Zellen. High/Medium/Low besitzen einschließlich Ausblenden höchstens 12/8/4 Quellen, 64–80 px Radius und 0,2–0,4 Intensität; der bestehende Lichtpfad übernimmt Tageszeitdämpfung ohne eigene Schattenberechnung. Zugriffswechsel und Teardown entfernen auch ausblendende Quellen sofort. Ruhende Perlen aktualisieren Licht unabhängig von der GPU-Taktung.

**Ressourcen- und Netzwerkvertrag:** Erfolgreiche Resource-Commits verbrauchen den vollständigen zugelassenen Transaktionsbetrag; Subtraktion gerundeter Gesamtsummen erzeugt keine zusätzlichen Resttropfen. Echte unbestätigte Kleinstwerte bleiben erhalten. Fragmente benutzen vorhandene Cluster-/Transferdaten mit unverändertem Essenz-Wire-Codec 2; zusätzliche Pickup-Anfragen oder Lichtdaten werden nicht übertragen. Der aktuelle Repository-Stand verwendet Peer-Protokoll 13. Die Essenz-Erweiterung benötigt selbst keine weitere Protokollanhebung.

**Prüfstand dieses Folgeauftrags:** Gezielte Regressionen für Streuung, genaue Bruchteile, reale Glock-/Lobby-Pfade, Materialdaten und Licht-Lifetime wurden ergänzt. `npm run check` bestand mit 347 Core-Testdateien / 2978 Tests, 6 Architekturdateien / 33 Tests und Produktionsbuild. Zusätzlich bestanden die vollständigen Suiten für Integration (21 Dateien / 292 Tests), Assets (5 / 50), Balance Lab (15 / 96) und seriell ausgeführten Stress (10 / 48). Der abschließende Integrationslauf berücksichtigt auch zwischenzeitlich abgeschlossene parallele Änderungen am Waffenfeedback. Links, referenzierte Symbole und `git diff --check` wurden geprüft. Es wurde kein Browser gestartet und keine Sichtprüfung durchgeführt; die optische Wirkung bleibt bis zum nächsten Spieltest unbestätigt.

**Aktueller Lastvergleich:** `npm run test:stress -- --maxWorkers=1 --no-file-parallelism` vergleicht einen Teilwert mit produktiver Dreifachstreuung bei identischen 6000 Reward-Fakten, zwölf Spielern, 20 simulierten Sekunden und Seeds 17/311/8191. Das synthetische Feld misst 1600 × 800 px, die Netzwerkrate beträgt 20 Hz. Die serielle Ausführung vermeidet konkurrierende Suite-Last; sie ist kein GPU- oder FPS-Nachweis.

| Messgröße | Ein Teilwert | Drei Teilwerte |
|---|---:|---:|
| Domain-Update p95, ohne Rendering/Wire-Encoding | 1,922–2,014 ms | 5,488–6,700 ms |
| Spitzenbestand Cluster | 1663–1721 | 4304–4438 |
| `ae` pro Sekunde und Empfänger, dezimale MB | 0,529–0,570 | 1,383–1,481 |
| Full-Snapshot, dezimale kB | 267,6–275,5 | 706,4–731,2 |

Die Dreifachstreuung benötigt in diesem Extremprofil 2,57–2,61-mal so viele Wire-Bytes. Transport-Overhead ist nicht enthalten; Host-Gesamttraffic wächst zusätzlich mit der Empfängerzahl. Der kompakte Codec spart weiterhin 60,3–61,5 % gegenüber der lesbaren Projektion. Die hohe Bandbreitenanforderung bleibt ausdrücklich sichtbar; Gameplaywert oder Kernperlen werden nicht zur Lastsenkung verworfen.

### Historischer Umsetzungsstand vom 07.09.2026

**Nachbesserung nach Spieltest:** Gültige Glock-Treffer auf Gegner wurden durch einen falschen Scope-Vergleich im neutralen Reward-Guard verworfen. Gegner und Decoys besitzen private Target-Owner-Scopes, die nicht mit der World-Combat-Generation übereinstimmen müssen. Die Reward-Projektion prüft jetzt den eingefrorenen Source-Scope gegen den aktuellen Combat-Owner und die aktuelle Reward-Bindung; die Prüfung des bestätigten Target-Outcomes bleibt beim Target-Owner. Neue [Cutover-Integrationstests](../../../tests/integration/AdrenalineEssenceCombatCutover.test.ts) verwenden die tatsächlich geladene Glock, Player-Aktivierung, Projectile-Collision und reale Enemy-/Decoy-Owner mit abweichenden Kennungen. Der Gegnerfall wurde vor dem Fix mit erfolgreichem Schaden, aber fehlendem Reward reproduziert.

Zusätzlich hat der Nutzer Essenz ausdrücklich für die begehbare Lobby-Testfläche bestätigt. [AdrenalineEssenceBinding](../../../src/adrenalineEssence/AdrenalineEssenceBinding.ts) wird dort nach der World-Gameplay-Komposition als Child der bestehenden Lobby-World eingerichtet, mit `activityRevision: null` und echter `worldRevision`. Das legt keine Activity an und verändert keine Match-/Score-/XP-Regeln. Der jeweilige Modus bestimmt den Zugriff; ein World-/Moduswechsel beendet den gesamten Bestand. Andere Worlds ohne Activity erhalten weiterhin keinen solchen Owner. Wire-Codec 2 und Peer-Protokoll 12 tragen diesen Scope ausdrücklich; alte Clients müssen denselben Build laden.

Die frühere hohe Zahl bestandener Tests war kein ausreichender End-to-End-Nachweis: Einige Tests hatten fertige Reward-Intents oder künstlich gleiche Target-/Combat-Scopes eingesetzt. Ergänzt wurden deshalb Prüfungen über die Produktionsübergänge, das tatsächliche Lobby-Coordinator-Binding, echte Map-1-/DM-Geometrie und den installierten Phaser-Member-Encoder. Eine Sichtprüfung ist weiterhin nicht beauftragt.

Der Implementierungsdurchlauf begann mit sauberem Arbeitsbaum bei `8b9b637202b58b34c854c0d47f8e8ef55f232ee1` (`HitFeedback V3`). Der ausdrückliche Folgeauftrag umfasst alle Phasen und untersagt die Sichtprüfung. Damit sind die ursprüngliche Beschränkung auf eine Phase und die Wartebedingung auf das manuelle Combat-Gate `M` für diesen Durchlauf aufgehoben. Die weiter unten beschriebenen fachlichen Invarianten und technischen Gates bleiben maßgeblich.

| Phase | Implementierung |
|---|---|
| P1 | Neutraler [PrimaryHitReward-Vertrag](../../../src/combat/PrimaryHitReward.ts), getrennte Resolve-/Commit-Resource-Ports, Activity-Child-Lifetime in allen Modi und sichere Bodenpunktsuche. |
| P2 | [Autoritative Runtime](../../../src/adrenalineEssence/AdrenalineEssenceRuntime.ts) mit räumlichen Indizes, festen Merge-Ankern, Ablauf pro Beitrag, Fraktionen, Reservierungen, parallelen Transfers, erneuter Arrival-Validierung und werttreuen Rückgaben. Alle bisherigen berechtigten Primärtrefferpfade sind umgestellt. |
| P3 | Activity-/World-gebundene Snapshots, versionierter kompakter Wire-Codec, Delta-Revisionskette mit periodischen Full-Snapshots, passive Client-Replica und vom Resource-State unabhängige Receipts. Die damalige Peer-Protokollversion 12 verhinderte Mischbetrieb mit älteren Clients. |
| P4 | Zwei gepoolte GPU-Layer aus dem vorhandenen Atlas; Ausstoß, Bodenperlen, Merge, beschleunigter Magnetflug, Rückgabe, Ablauf, Quality-/Dichteanpassung sowie explizites HUD-Feedback für Fraktionen und gebündelte Ankünfte. |
| P5 | Lifecycle-/Reentranz-Härtung, Paketverlust-/Resync-Tests, Brutto-Reward-Messung im Balance Lab, Gameplay-/Netzwerk-/GPU-Diagnosen und reproduzierbare Headless-Stressmessung. |

Der Activity-Slot besitzt im Match das [AdrenalineEssenceBinding](../../../src/adrenalineEssence/AdrenalineEssenceBinding.ts), im Testgelände besitzt es die Lobby-World; Scene und Coordinators verdrahten ausschließlich Ports und Taktung. Gameplay-Tuning liegt in [AdrenalineEssenceConfig](../../../src/adrenalineEssence/AdrenalineEssenceConfig.ts), visuelles Tuning in [AdrenalineEssencePresentation](../../../src/adrenalineEssence/AdrenalineEssencePresentation.ts). Ein Cluster besitzt auch bei reduzierter Qualität eine sichtbare Kernperle. Die Darstellung verwendet keine eigenen Physikkörper oder pro Tropfen angelegten GameObjects.

**Netzwerkvertrag:** Deltas führen Upserts und Tombstones; eine fehlende Basisrevision wartet auf das nächste Full. Full-Snapshots erscheinen mindestens jede Sekunde und bei Bootstrap-Anforderung. Kurzlebige Receipts werden zur Verlusttoleranz wiederholt und dedupliziert. Ein neuer Empfänger setzt beim ersten Full eine historische Grenze; ein bereits aktiver Empfänger darf nach einem periodischen Full noch einen ungesehenen aktuellen Receipt empfangen. Resource-Revisionen werden sofort übernommen, kosmetische Bestätigungen warten höchstens innerhalb ihres kurzen Darstellungsfensters. Beträge werden nicht gerundet.

**Cutover-Inventar:** Bisheriger Empfänger war der erzeugende Spieler (einzelne Projektilpfade verwendeten abweichend Allegiance); neu gilt die vollständige Reward-Attribution einschließlich Reflection. Keine Auszahlung wird aus einem bloß akzeptierten, aber wirkungslosen Treffer abgeleitet.

| Pfad | Ziel / Komponenten | Behandlung |
|---|---|---|
| Projectile-Direkttreffer | Player, Enemy, Decoy; authored Primärtreffer-Gain | Essenz nach positivem HP-/Rüstungsschaden. |
| Hitscan und authored Hitscan-Kette | Player, Enemy, Decoy; jeweiliger Primärtreffer-Gain pro gültigem Ziel | Essenz; Ketten tragen die Aktivierungsbasis weiter. |
| Melee | Player, Enemy, Decoy; Basisreward, zusätzliche `hitAdrenaline`-Komponente nur in den dafür bisher berechtigten Player-/Enemy-Zweigen | Komponenten werden einmal zusammen aufgelöst und materialisiert. |
| Hydra-Kinder / Reflection | Ererbter Reward-Anteil beziehungsweise neue zugerechnete Erzeugerbasis | Kein zweiter Parent-Reward; Reflection ersetzt die Gain-Basis. |
| Utility-/sekundäre Chains, Plasma-Swarm und nicht berechtigte Support-Effekte | Kein expliziter berechtigter Primärtreffer-Intent | Keine neue Essenz durch Heuristiken zu Typ, Slot oder Farbe. |
| Damage-taken-, Kill-, Weapon-Kill- und Detonation-Combo-Rewards | Unabhängige Ressourcenquellen | Weiterhin direkt über den Resource-Owner. |
| Refunds und Kostenrückgaben | Rückzahlung einer Ausgabe | Bestehende Refund-Semantik; keine Essenz. |
| Balance-/Headless-Modelle | Deterministische Waffen-Bruttobalance | Gross-Reward ausdrücklich von beobachtetem Resource-Gain getrennt; kein Produktionsbypass. |

**Historischer Prüflauf der Erstimplementierung:** `npm run check` bestand mit 338 Testdateien / 2886 Tests, 6 Architekturdateien / 33 Tests und Produktionsbuild. Zusätzlich bestanden Integration 19 / 274, Assets 4 / 44, Stress 9 / 47 und Balance Lab 15 / 96. Diese Zahlen belegen nicht den damals übersehenen Gegnerpfad; maßgeblich für die Nachbesserung sind die oben genannten reproduzierenden Produktionsketten und der erneute Abschlusslauf. Die Netzwerk-Integration prüft Full, Auslassung, Delta-Tombstones und explizites Leeren durch die echte `NetworkBridge` mit dem vorhandenen Fake-Peer-Transport.

**Historischer Abschlusslauf der Nachbesserung vom 07.09.2026:** `npm run check` einschließlich Produktionsbuild, `npm run test:integration`, `npm run test:stress` und `npm run test:balance-lab` bestanden erneut. Der [Lobby-Composition-Test](../../../tests/integration/CoopMissionCombatStartup.test.ts) führt die echte Coordinator-Anbindung mit Glock-Aktivierung, Projektilkollision, Essenzmaterialisierung, Sammlung, Ressourcengutschrift, HUD-Signal und World-Teardown aus; die Einhängung dieses Bindings in `buildWorld` wurde zusätzlich im Code geprüft. [Produktive Map-Geometrie](../../../tests/integration/AdrenalineEssenceWorldGeometry.test.ts) und der [installierte Phaser-GPU-Encoder](../../../tests/AdrenalineEssencePhaserGpuContract.test.ts) sichern Platzierung und technische Renderdaten ab. Zusätzliche fokussierte Tests sichern alte World-/Runtime-Intents sowie die [Lobby-Netzwerkstrecke](../../../tests/WorldChannelContracts.test.ts) mit echten Full-/Delta-Paketen, Paketverlust und Late Join ab. Diese Prüfungen erzeugen keine Bildabnahme.

Das Balance Lab misst lokale Brutto-Reward-Fakten, Resource-Gains und Verbrauch getrennt. Seine zusätzliche, ausdrücklich Activity-weite Messfenster-Bilanz führt Materialisierung, tatsächliche Sammlung, Verfall, Platzierungsfehler und Lifecycle-Verluste mit. Ein Activity-Wechsel verwirft die Vergleichsbasis; Warmup und Settle werden nicht als neue Messfenster-Erträge gezählt.

**Nachweisgrenze:** Es wurde kein Browser, Dev-Server oder Screenshot gestartet. Manuelles Combat-`M`, visuelle P4-/P5-Abnahme, tatsächliche GPU-/Framezeiten und ein optischer Vergleich bleiben ungeprüft. Headless-CPU-/Wire-Messungen ersetzen diese Nachweise nicht. Es wird keine nachträglich passend gewählte FPS- oder Netzwerkbudgetfreigabe behauptet.

**Historische Lastmessung vor Dreifachstreuung:** [AdrenalineEssenceStress.test.ts](../../../tests/stress/AdrenalineEssenceStress.test.ts) verwendete zwölf Spieler, 300 verteilte Reward-Fakten/s, je 20 simulierte Sekunden für Seeds 17/311/8191 und die produktive Netzwerkrate von 20 Hz. Das synthetische Feld ist 1600 × 800 px groß und enthält streifenförmige Sichtbarrieren; es ist keine vermessene Gameplay-Map. Umgebung: Windows x64, Node 24.14.0, Ryzen 7 5800X, 16 logische CPUs, 32 GiB RAM. Im damaligen Stresslauf lagen Update-Median/p95 bei 1,16–1,53 / 2,15–2,87 ms, Spitzenbestand bei 1650–1737 Clustern und 79–101 Transfers. Dies misst den Domain-Update einschließlich Kandidatenwahl, ohne Rendering und Wire-Encoding; die Phasen-CPU-Zähler weisen Materialisierung separat aus.

Der damalige `ae`-Slice benötigte in diesem Extremprofil 10,42–11,34 MB je 20 Sekunden und Empfänger (etwa 521–567 kB/s), ein Full 256–267 kB. Das kompakte Format sparte bei identischer Sendefolge 61,8–63,1 % gegenüber den lesbaren Domain-Objekten. Neue Receipts erscheinen weiterhin sofort beim nächsten Net-Tick, Wiederholungen höchstens alle 200 ms. Diese historischen Werte beschreiben nicht die Kosten der Dreifachstreuung. Host-Gesamttraffic wächst mit der Empfängerzahl; Werte, Kernperlen oder Fraktionen dürfen dafür nicht verworfen werden.

### Ursprünglicher Phasenschnitt

Die Adrenalin-Essenz wird nicht als kleiner Pickup-Patch umgesetzt, sondern als neue Activity-gebundene Gameplay-Domain zwischen bestätigtem Combat-Outcome und bestehender Player-Ressource.

Die Umsetzung erfolgt in fünf aufeinander aufbauenden Phasen:

1. **P1 – Contracts & Runtime Foundation**
2. **P2 – Host Gameplay & Reward Cutover**
3. **P3 – Replication & Functional Presentation**
4. **P4 – Visual Polish & Juice**
5. **P5 – Hardening, Performance & Final Acceptance**

P1–P3 dürfen kontrolliert unvollständige Zwischenstände erzeugen. Spätestens nach P3 muss die Mechanik funktional auf Host und Client darstellbar sein. **P4 hebt die Darstellung ausdrücklich auf Zielqualität. P5 ist kein Ersatz für fehlendes Visual Polish.**

Ein Coding-Agent bearbeitet ohne weitergehenden Auftrag standardmäßig genau eine Phase. Für den dokumentierten vollständigen Folgeauftrag gilt die Freigabe aller Phasen oben. Vor einer Folgephase wird der Diff gegen GDD, diesen Plan und das Phasen-Gate geprüft. Architekturentscheidungen werden nicht während späterer Phasen still neu erfunden.

Die Phasen sind Arbeitsschnitte, keine unabhängig veröffentlichbaren Releases. P2 ohne P3 entfernt den sofortigen Gain, besitzt aber noch keine vollständige sichtbare Belohnungskette. Ein solcher Zwischenstand darf nicht als spielbares fertiges Feature veröffentlicht werden. Eine phasenweise Implementierung beginnt erst nach dem ausdrücklichen Folgeauftrag.

---

## 2. Verbindliche Ausgangsregeln

Diese Regeln gelten in jeder Phase:

- Nur der Host materialisiert Essenz, wählt Sammler, reserviert Wert und bestätigt Ankunft.
- Player-Adrenalin bleibt ausschließlich beim bestehenden Resource-Owner kanonisch.
- `WorldCombatCore` besitzt keinen Essenz-State.
- Der fachliche Essenz-State besitzt im Match **Activity-Lifetime**; ausschließlich im ausdrücklich unterstützten Lobby-Testgelände besitzt er die Lifetime der Lobby-World. Eine fehlende Activity allein aktiviert keine Essenz.
- `activityRevision` und `worldRevision` sind Bestandteil jeder langlebigen oder replizierten Essenz-Identität.
- Kein sichtbarer Tropfen besitzt ein eigenes Netzwerkobjekt oder einen Physikkörper.
- Kein Renderer, HUD oder Client darf Gameplaywert mutieren.
- Primärtreffer werden nach dem Cutover entweder direkt oder über Essenz belohnt – **niemals beides**.
- Unabhängige Adrenalinquellen bleiben direkt.
- Combat-Attribution, Allegiance und Zugriffsgruppe bleiben getrennte Konzepte.
- Gain-Multiplikatoren werden genau einmal erzeugerseitig aufgelöst.
- Arrival committed einen bereits aufgelösten Wert atomar gegen das aktuelle Cap.
- Merge, Transfer, Rückgabe und Resync dürfen niemals Wert erzeugen, duplizieren oder Lebensdauer erneuern.
- Capacity-/Quality-Degradation darf nur Darstellung reduzieren, nie Gameplaywert.

---

## 3. Pflicht-Preflight vor P1

Der Preflight ist kein eigener Implementierungsabschnitt und zählt nicht als Phase.

Nach dem gesonderten Implementierungsauftrag und vor produktiven Änderungen:

1. GDD § 22.1 abschließen; verwendeten Checkout einschließlich Arbeitsbaum gegen den dokumentierten Reviewstand vergleichen, vorhandene Änderungen fremder Aufgaben erhalten;
2. Status der manuellen Combat-Abnahme `M` prüfen und dokumentieren; Abschluss spätestens vor produktivem Reward-Cutover in P2, kein Hindernis für isolierte P1-Grundlagen;
3. **alle** direkten `addAdrenaline`-/Trefferreward-Pfade inventarisieren und klassifizieren:
   - materialisieren;
   - bewusst direkt lassen;
   - Refund/Kostenrückgabe;
   - Test-/Headless-Sonderfall;
4. Baseline für Weapon Balance Lab sichern;
5. vorhandene CPU-/GPU-/Netzwerkbaseline für repräsentative Kampfszene sichern;
6. aktuelle Activity-/World-Composition für alle vier Modi verifizieren;
7. aktuellen GPU-VFX-Stand inklusive Atlas/Lanes nach `DeathMorph V2` als Ausgangspunkt verwenden.

Der Agent hält das Inventar im Implementierungsdiff oder in Tests nachvollziehbar; es wird kein zweites umfangreiches Planungsdokument benötigt.

Das Inventar nennt je Pfad Quelle, Zielart, Reward-Komponenten, bisherigen Empfänger, Auslösebedingung und neue Behandlung. Besonders Chain und Melee besitzen im geprüften `WorldCombatCore` Direktzahlungen ohne durchgängige Auswertung des tatsächlichen Outcomes. „Bruttomenge erhalten“ ersetzt deshalb keine Entscheidung über wirkungslose Treffer (D4). Reflection-Attribution und volle Erzeuger sind ebenfalls bewusste Semantikänderungen, keine Zusage identischer Nettoauszahlungen.

Prüfungen folgen [docs/ai/testing.md](../../ai/testing.md): P1–P3 betreffen mehrere Module und Lifecycle/Netzwerk und benötigen `npm run check` sowie passende Integrationstests. P4 benötigt `npm run build` und betroffene Presentation-/Asset-Tests. P5 führt `npm run check` und die betroffenen Integration-, Asset-, Stress- und Balance-Lab-Suites aus. Kein zusätzliches Typecheck vor einem Build, keine neue Testinfrastruktur.

Browser- und Sichtprüfungen bleiben opt-in gemäß Repository-Anweisung. Der Plan selbst ist kein Auftrag zum Browserstart. Bei ausdrücklichem Sichtprüfungsauftrag `npm run dev:browser` verwenden und HTTP 200 auf `http://127.0.0.1:8090/` abwarten. Ohne Sichtnachweis bleibt die betreffende manuelle Abnahme offen; automatisierte Tests ersetzen sie nicht.

---

## 4. Zielverträge und technische Grundentscheidungen

Die Namen unten sind die bevorzugten Arbeitsnamen. Eine kleine Umbenennung zur besseren Repository-Konsistenz ist zulässig; **Semantik und Ownership sind verbindlich**.

### 4.1 Primärtreffer-Reward-Intent

Ein expliziter typed Intent begleitet nur Trefferzweige, die bei erfolgreichem Primärwaffentreffer Adrenalin erzeugen dürfen.

Bevorzugtes Konzept:

```ts
interface PrimaryHitAdrenalineRewardIntent {
  readonly components: readonly RewardComponent[];
  readonly branchId: string;
}
```

Der Intent wird an der Execution-/Projectile-/Immediate-Attack-Grenze mitgeführt. Er darf **nicht** später aus `sourceSlot === 'weapon1'`, Damage-Kind, Projektilfarbe oder Allegiance rekonstruiert werden.

`RewardComponent` ist hier ein zu spezifizierender Arbeitsvertrag, kein vorhandener Repository-Type. Die Komponenten bilden die einzige Wertbasis; ein zusätzlicher Gesamtbetrag dürfte nur daraus abgeleitet werden und wird niemals nochmals addiert. Jede Komponente benennt ihren Betrag und bereits angewandte Modifikatorstufen. Gemäß D5 begleitet eine unveränderliche, resource-seitig erfasste allgemeine Gain-Basis die Aktivierung einschließlich Salven, Ketten und Kindprojektilen. Reflection/Deflection ersetzt sie bei Übernahme durch die Basis des neuen zugerechneten Erzeugers; keine Multiplikation beider Basen, kein Nachschlagen im Respawn-Build.

### 4.2 Bestätigtes Reward-Faktum

Nach kanonischer Target-Mutation entsteht nur bei einem tatsächlich belohnungsberechtigten Outcome ein unveränderliches Faktum.

Es trägt mindestens:

- eindeutige Reward-/Outcome-ID;
- `worldRevision`, `activityRevision` und relevanten Runtime-/Life-Scope;
- vollständige `CombatSource`-Provenance;
- zugerechneten Player;
- Reward-Intent/Komponenten;
- kanonische Trefferposition;
- Target-Referenz;
- Host-Zeit;
- stabilen Seed bzw. stabil ableitbare Identität.

Bevorzugte Naht ist eine **schmale post-commit Reaction-/Reward-Grenze**. `CombatReactionPort.onAcceptedHit` darf gezielt erweitert werden, wenn dadurch keine Essenz-Abhängigkeit in den Combat-Core gelangt. Alternativ ist ein kleiner neutraler Reward-Sink zulässig. Ein globaler Event-Bus ist nicht vorgesehen.

### 4.3 Resource-Port

`ResourceSystem` erhält explizite Semantik für zwei unterschiedliche Operationen:

1. **theoretischen Gain auflösen** – Gain-Basis bei Aktivierung/Übernahme erfassen und bei bestätigtem Treffer genau einmal anwenden, aber weder Cap prüfen noch Ressource mutieren;
2. **bereits aufgelösten Gain committen** – aktuellen Cap atomar anwenden, Revision/Observer korrekt auslösen und tatsächlich gutgeschriebenen Wert zurückgeben.

Bevorzugte Capability:

```ts
captureAdrenalineGainBasis(playerId): AdrenalineGainBasis
resolveAdrenalineGain(gainBasis, authoredAmount): number
commitResolvedAdrenalineGain(playerId, resolvedAmount): number
```

Für Kandidatenwahl darf ein Read-Port aktuelle Ressource/Maximum liefern. Diese Vorprüfung ist nur eine Reservierungsprognose; der Arrival-Commit prüft atomar erneut.

Dies sind semantische Signaturskizzen, keine vorhandenen APIs. `AdrenalineGainBasis` enthält die unveränderliche vom Resource-/Modifier-Owner gelieferte Basis und ihre Erzeugerzuordnung. Der erste Aufruf braucht eine gültige Player-Zuordnung; die spätere Auflösung benötigt keinen lebenden oder noch verbundenen Erzeuger. Die Basis darf im neutralen Waffenwirkungsvertrag transportiert werden, ohne Combat mit dem Resource-Service zu koppeln.

`refundAdrenaline` bleibt ausschließlich Refund-Semantik.

### 4.4 Activity- beziehungsweise Lobby-World-owned Essence Runtime

Bevorzugter fachlicher Owner:

```text
AdrenalineEssenceRuntime
```

Er besitzt innerhalb genau eines berechtigten Owners (Match-Activity oder ausdrücklich unterstützte Lobby-World):

- Reward-Beiträge / Expiry-Buckets;
- Cluster;
- reservierten Wert;
- Transfers;
- Deduplizierung;
- Magnet-/Merge-Spatial-Index;
- Zustandsrevision für Replikation;
- Diagnosezähler.

Er konsumiert schmale Capabilities für:

- Resource;
- World-Geometrie;
- Player-Life/Participation/Burrow;
- Relationship/Mode-Policy;
- Replikationsprojektion.

Er wird an diesen Owner gebunden und bei dessen Detach **idempotent vollständig zerstört**. `HostUpdateCoordinator` und `ArenaLifecycleCoordinator` dürfen verdrahten/ticken, aber keinen fachlichen Essenz-State übernehmen.

### 4.5 World-Geometrie

`WorldGeometryQueries` wird um eine schmale sichere Bodenplatzierungs-Capability ergänzt, statt private Obstacle-/Combat-Daten zu lesen.

Semantische Anforderungen:

- innerhalb World-Bounds;
- Blocker beachten;
- bereits vom Domain-Owner deterministisch gestreute Kandidaten;
- nächster zulässiger Fallback;
- kein Wertverlust im regulären Ablauf; bei unerwartet erfolgloser begrenzter Fallbacksuche Diagnose und bilanzierten Platzierungsfehler gemäß GDD § 7.3, keine Retry-Runtime;
- kein Renderer-/Sprite-Zugriff.

### 4.6 Gameplay-Datenmodell

Empfohlene Trennung:

- **RewardContribution** – exakter Wert, Attribution/Diagnose, Origin, Landung, Expiry;
- **EssenceCluster** – kompatible räumliche Aggregation mit Expiry-Buckets;
- **EssenceTransfer** – reservierter Teilwert, Ursprung, Ziel-Player/Life, Start/Arrival, Terminalstatus;
- **AccessGroup** – Coop / Team-ID / persönliche Player-ID;
- **Replica DTOs** – nur replizierbare Projektion, nie Host-Owner-Strukturen direkt serialisieren.

Ein Cluster darf mehrere Expiry-Buckets halten. Merge darf keine Ablaufzeiten vereinheitlichen.

Zusätzlich festzulegen und in P1/P2 zu prüfen:

- `materialized → ejecting → grounded → reserved → committed/grounded/expired`; Activity-Ende verwirft jeden noch aktiven Zustand bilanziert. Ein Platzierungsfehler ist ein einmaliger bilanzierter Fehlerausgang vor dem Ausstoß, kein zusätzlicher langlebiger Zustand.
- Merge nur mit freier geometrischer Verbindung zum festen Clusteranker; jeder Beitrag liegt selbst innerhalb des Merge-Radius. Keine transitive Kettenwanderung. Das Zeitfenster bezieht sich auf die Landungszeit des ersten Beitrags am Anker und wird durch neue Beiträge nicht verlängert.
- Reservierungen entnehmen zuerst den am frühesten ablaufenden Wert, bei Gleichstand nach stabiler Contribution-ID. Teil-Commits verwenden dieselbe Ordnung. Ablauf, Diagnoseattribution und Herkunft bleiben dadurch eindeutig.
- Jede Reservierung behält die feste Bodenposition ihres Quellclusters. Späteres Merge ändert sie nicht; Rückgaben verteilter Ursprünge werden nicht am Sammler zusammengelegt.
- Rückgabe macht den gültigen Rest atomar wieder zu Bodenbestand; die Rückflussanimation verzögert keine erneute Sammelbarkeit und wird bei erneuter Reservierung entsprechend beendet.
- Zahlenpräzision und Vergleichstoleranz werden vor dem Cutover explizit festgelegt. Kein Runden bei jedem Merge/Transfer, kein heimliches Löschen kleiner Reste. Tests verwenden auch wiederholte Teilungen und nicht binär exakt darstellbare Bruchteile.

### 4.7 Netzwerkprojektion

Eigene Essenz-Snapshots analog zum bewährten Delta+Full-Prinzip der Boden-Power-ups, aber als eigene Domain.

Erforderlich:

- `full`;
- monotoner Essence-State-Revision;
- `worldRevision`;
- `activityRevision`;
- Cluster-Upserts;
- Cluster-Tombstones/Removals;
- Transfer-Upserts/-Removals;
- periodischer Full-Resync;
- Join-in-progress;
- stale-sichere Anwendung.

Keine sichtbaren Einzeltropfen im Wire-Schema.

P1 spezifiziert vor P3 außerdem die Delta-Basis und Lückenerkennung, monotone Full-Anwendung, begrenzte Tombstone-/Deduplikationshaltung und den terminalen Transferbeleg mit tatsächlich gutgeschriebenem Wert und Resource-Revision. Nur aktive Transfers gehören in JIP/Full; historische Abschlussereignisse werden nicht als neue Ankünfte abgespielt. Ein verlorenes Delta darf durch einen neueren Full ersetzt werden; ein verspäteter älterer Full überschreibt keinen neueren Stand.

Host-Zeit wird auf die vorhandene Client-Zeitbasis abgebildet. Verspätete Flüge dürfen verkürzt oder ausgelassen werden (GDD § 13.9). Der bestätigte Resource-State wartet niemals auf Presentation oder ein kosmetisches Ereignis.

### 4.8 Presentation-Strategie

**Lang lebende Bodenperlen und laufende Transfers:** dedizierter, zentral gepoolter `AdrenalineEssenceGpuRenderer` bzw. gleichwertige Komponente mit wenigen festen `SpriteGPULayer`-Instanzen und stabilen Slots. Keine Layer pro Cluster/Tropfen.

**Kurzlebige Akzente:** vorhandenes `GpuVfxSystem` für Ausstoß-Sekundärpartikel, Merge-Akzente, Arrival-Burst, Rückgabe-/Expiry-Details, soweit Lifetime/Blend/Admission dazu passen.

Bevorzugt:

- Body-Layer für lesbare Perlen;
- additive Glow/Halo-Lane nur soweit nötig;
- stabile Slot-Zuordnung nach Cluster-/Transfer-ID;
- adaptive sichtbare Tropfenzahl aus Wert, Dichte und Quality;
- gemeinsame Atlas-/Texture-Infrastruktur statt parallelem Ad-hoc-Atlas.

Die Körper verwenden drei eigene prozedurale Flüssigkeitsvarianten mit je acht Phasen im gemeinsamen Atlas. Kleine Teilwerte erhalten etwa 4–6 px Körperdurchmesser; höhere Qualität ergänzt weiche Formbewegung, Reflexe und wenige Nebentropfen.

Der Renderer liefert seine tatsächlich dargestellten, bereits zugriffsgefilterten Boden-/Flugpositionen in jedem Frame an den lokalen Licht-Helper. Dieser bündelt in 64-px-Zellen, bevorzugt sichtbare nahe Quellen und verwaltet einschließlich Ausblenden höchstens 12/8/4 Lichtslots. Radius 64–80 px und Intensität 0,2–0,4 bleiben zentral in `LightingConfig`; `LightingSystem` übernimmt die Tageszeit ohne eigenen Schattenpfad. `releaseLight(key, { immediate: true })` entfernt bei Zugriffsverlust, Unterdrückung oder Owner-Ende auch ausblendende Quellen. Der Renderer besitzt keine Gameplayentscheidung.

### 4.9 HUD-Signale

Explizite lokale Presentation-Signale:

- Incoming begonnen;
- Incoming beendet/abgebrochen;
- tatsächlich gutgeschriebene Essenz angekommen.

Der Player-Resource-Snapshot bleibt Quelle des Balken-/Ringwerts. Signale steuern nur Glow, Sparks und Burst.

---

## 5. Phasen

## P1 – Contracts & Runtime Foundation

### Ziel

Alle neuen Grenzen stehen sauber, sind testbar und Activity-sicher, ohne bereits den kompletten produktiven Reward-Cutover zu erzwingen.

### Umsetzung

#### P1.1 Delta-Review und Reward-Inventar

- Preflight abschließen.
- Projectile, Hitscan, Melee, Chain, Split/Child, Reflection/Deflection und `hitAdrenaline` prüfen.
- direkte Treffer-Gains von Kill-Rewards, Damage-Taken, Power-ups, Refunds und sonstigen unabhängigen Quellen trennen.
- bestehende Tests identifizieren, die bisher unmittelbaren Gain als Erwartung haben.

#### P1.2 Reward-Verträge

- typed Primärtreffer-Reward-Intent einführen;
- post-commit Reward-Faktum definieren;
- Combat-Provenance verlustfrei erhalten;
- kanonische Trefferposition festlegen;
- deduplizierbare Reward-ID definieren;
- noch **keinen** Essenz-State in `WorldCombatCore` legen.

#### P1.3 Resource-Capability

- theoretische Gain-Auflösung ohne Mutation;
- atomaren Commit eines bereits aufgelösten Werts;
- tatsächlich gutgeschriebenen Wert zurückgeben;
- bestehende Revision-/Observer-Semantik absichern;
- Tests für Multiplikator exakt einmal, Cap, Bruchteile und `0`/invalid input.

#### P1.4 Activity Runtime Skeleton

- Essenz-Owner an die Match-Activity beziehungsweise die explizite Lobby-World binden;
- Scope-Identity und idempotenten Teardown festlegen;
- Kernmodelle für Contribution/Cluster/Transfer/AccessGroup;
- deterministische IDs/Seeds;
- keine produktive Netzwerk-/GPU-Abhängigkeit im Core.

#### P1.5 Geometry Capability

- sichere Bodenpunktsuche als World-Capability ergänzen;
- deterministische Tests für Bounds, Blocker und Fallback;
- Zug nur bei Initialplatzierung gemäß GDD berücksichtigen.

#### P1.6 Lifecycle-Fan-out vorbereiten

- Tod, Burrow-Wind-up, Untergrund/Transit, Participation und Disconnect als konsumierbare Lifecycle-Fakten anbinden;
- bestehende Beer-/sonstige Reaktionen nicht überschreiben.

### Wahrscheinliche Integrationsanker

- `src/combat/CombatCapabilities.ts`
- `src/combat/WorldCombatCore.ts`
- `src/world/WorldCombatReactions.ts`
- `src/systems/ResourceSystem.ts`
- `src/world/WorldGeometryQueries.ts`
- `src/loadout/WeaponFireExecutor.ts`
- Projectile-Provenance-/Spawn-/Combat-Adapter
- Activity-/World-Lifecycle-Composition

Neue Dateien bevorzugt unter einem klaren Domain-Ordner wie `src/adrenalineEssence/`.

### P1 Gate

P1 ist abgeschlossen, wenn:

- Reward-Intent und Reward-Faktum unabhängig von Essenz-Rendering testbar sind;
- `ResourceSystem` beide neuen Semantiken korrekt besitzt;
- Essenz-State nachweislich an die Match-Activity beziehungsweise Lobby-World gebunden und teardown-sicher ist;
- sichere Bodenplatzierung ohne Rendererzugriff existiert;
- keine bestehende Lifecycle-Reaktion überschrieben wurde;
- keine neue globale God Class / Service-Locator-Abhängigkeit entstanden ist;
- `npm run check` und passende Lifecycle-/Integrationstests für den geschlossenen P1-Scope grün sind.

---

## P2 – Host Gameplay & Reward Cutover

### Ziel

Die komplette GDD-Mechanik läuft host-autoritativ und werttreu. Nach P2 soll der Host die Essenz vollständig simulieren können, auch wenn Client-Replikation und finale Darstellung noch fehlen.

### Umsetzung

#### P2.1 Reward-Materialisierung

- bestätigtes Faktum in materialisierten exakten Wert projizieren;
- Gain-Multiplikator genau einmal über Resource-Capability auflösen;
- volle Erzeuger nicht cappen;
- AccessGroup aus Mode/Attribution/Team bestimmen und einfrieren;
- Reward-ID deduplizieren.

Nach der gemeinsamen Wertauflösung standardmäßig drei Cluster anlegen; weder Gain-Basis noch Treffer-/Attributionszähler pro Fragment erneut auswerten.

#### P2.2 Vollständiger Cutover

Alle inventarisierten materialisierten Primärtrefferpfade umstellen:

- Projectile direct hit;
- Hitscan;
- Melee;
- `hitAdrenaline`;
- Ketten-/Folgeziele;
- Split-/Kindprojektile;
- separat belohnte Salventreffer;
- Reflection/Deflection mit aktueller Attribution;
- weitere heute wirklich belohnte Target-Arten.

Danach darf kein dieser Treffer zusätzlich direkt `addAdrenaline` schreiben.

Unabhängige Quellen bleiben unverändert direkt.

#### P2.3 Ausstoß und Landung

Der Host erzeugt pro Reward drei Kandidaten mit gemeinsamem kanonischem Ursprung: ungefähr 120° Abstand, deterministische Variation höchstens ±10° je Richtung und 30–45 px Radius. Die World-Geometrie prüft diese gestreuten Punkte einschließlich begrenztem Fallback. Der vollständige Wert wird erst danach auf unterschiedliche gültige Punkte verteilt; der letzte Teilwert erhält den Rest. Nur vollständiges Platzierungsversagen zählt einmalig als Fehler. Jeder Beitrag besitzt eigene Landing-Zeit und Expiry ab Landung; vorhandene Merge-Regeln bleiben wirksam.

Vor Landung nicht sammelbar.

#### P2.4 Cluster, Bucketing und Merge

- spatial index / Grid für lokale Kandidaten;
- AccessGroup-kompatibler Merge;
- Expiry-Buckets erhalten;
- Wert exakt erhalten;
- bounded work bei hoher Trefferfrequenz;
- keine Gameplay-Entität pro visuellem Tropfen.

#### P2.5 Magnetwahl und Reservierung

- host-getriebene Kandidatenwahl;
- Participation/Life/Burrow/Capacity prüfen;
- nächster Spieler mit stabilem Tie-Break;
- LoS genau einmal beim Start;
- eingehende Reservierungen berücksichtigen;
- atomare Teilreservierung;
- mehrere parallele Transfers zulassen.

#### P2.6 Arrival, Return und Terminal Order

- distanzabhängige Arrival-Zeit;
- aktuelle Capacity beim Arrival atomar erneut prüfen;
- `commitResolvedAdrenalineGain`;
- Rest werttreu zurückgeben, falls nicht abgelaufen;
- Tod/Burrow/Untergrund/Participation/Disconnect/Teardown abbrechen;
- Original-Expiry erhalten;
- stabile Reihenfolge konkurrierender terminaler Ereignisse;
- Arrival/Cancel idempotent.

Die Essence-Auswertung verarbeitet bereits autoritativ wirksame Lifecycle-/Access-Invalidierungen vor fälligen Arrivals. Danach: Arrivals nach `(arrivalAt, transferId)`, Ablauf freier Bodenbeiträge, fällige Landungen/Merges und neue Reservierungen. Bereits abgelaufene freie Beiträge werden nie neu reserviert (`startAt < expiresAt`); reservierter Wert bleibt bis Arrival/Cancel gemäß GDD gültig. Ein Arrival vor einer erst später wirksamen Invalidierung wird nicht zurückgerollt. Die Composition ordnet diesen Schritt nach den für denselben Host-Schritt bekannten Combat-/Player-Mutationen ein.

#### P2.7 Diagnose

Mindestens:

- materialisiert;
- im Ausstoß;
- am Boden;
- reserviert;
- committed;
- returned;
- expired;
- placementFailedValue und bei Teardown verworfener Wert getrennt;
- stale/dedup rejected;
- aktive Cluster/Transfers;
- Merge-Zahl.

Werterhaltung einschließlich Ausstoß, Teil-Commit, Platzierungsfehler und Teardown nach GDD § 16.4 automatisiert prüfen. `returned` ist ein Bewegungszähler und kein weiterer Bestand.

### P2 Gate

- alle GDD-Referenzszenarien 20.1–20.12 sind hostseitig automatisierbar oder gezielt getestet;
- kein materialisierter Primärtreffer besitzt noch direkten Parallel-Gain;
- unabhängige Quellen bleiben funktional;
- Bruchteile und volle Erzeuger korrekt;
- Multi-Hit wird nicht durch Correlation unterdrückt;
- Reflection nutzt Attribution statt `allegiance.ownerId`;
- Value-Conservation stimmt;
- Activity-/World-/Life-Stale-Daten können keinen Commit auslösen.
- `npm run check` und passende Integrationstests bestanden; manuelle Combat-Abnahme `M` vor Cutover nachgewiesen.

---

## P3 – Replication & Functional Presentation

### Ziel

Host und Clients besitzen dieselbe funktionale Spielerfahrung. Alle vier Modi sind multiplayerfähig; Darstellung und HUD sind vollständig vorhanden, aber noch nicht final gepolished.

### Umsetzung

#### P3.1 Wire-Schema

Eigene Snapshot-/Delta-Typen:

- Activity-/World-Identity;
- Essence-State-Revision;
- Cluster-Projektion;
- Transfer-Projektion;
- Upserts;
- Removals/Tombstones;
- Full-Snapshot.

Nur Daten übertragen, die Gameplayzustand oder reproduzierbare Darstellung bestimmen.

#### P3.2 Host-Replikation

- Delta-Erzeugung;
- periodischer Full-Resync;
- JIP;
- stale-sichere Revisionen;
- Transferterminalzustände ohne Doppelarrival;
- Netzwerkdiagnose für Bytes/Upserts/Full-Größe.

#### P3.3 Client-Replica

- passive Replica ohne Authority;
- Full ersetzt sauber den projizierten Bestand;
- alte Tombstones können keine neue Revision löschen;
- alte Activity/World vollständig inert;
- lokale Sichtbarkeit nur für berechtigte AccessGroup;
- Tropfenanzahl/Größen aus Wert + Seed lokal rekonstruieren.

#### P3.4 Funktionale GPU-Darstellung

Mindestens vollständig erkennbar:

- Ausstoß;
- Landing;
- Bodencluster;
- Merge;
- Magnettransfer;
- Return;
- Expiry.

Bereits GPU-/poolbasiert und ohne schwere GameObjects pro Tropfen. P3 darf noch konservative Art-/Timingwerte verwenden, aber **keine technisch falsche Architektur**, die in P4 ersetzt werden müsste.

#### P3.5 HUD

- Incoming-Glow;
- Arrival-Burst;
- Burst-Bündelung;
- Cancel beendet Incoming ohne positiven Burst;
- Ressource selbst nur aus kanonischem Resource-State.

#### P3.6 Vier Modi

- Coop;
- Team Deathmatch;
- Capture the Beer;
- Deathmatch.

Sichtbarkeit und Sammelrechte explizit testen.

### P3 Gate

- Host und Client stimmen bei aktivem Bestand, Transfers und tatsächlicher Ressource überein;
- JIP und Full-Resync funktionieren während aktiver Transfers;
- alle vier Modi sind funktional spielbar;
- keine unberechtigte Essenz wird lokal als sammelbar dargestellt;
- keine Netzwerkentität pro sichtbarem Tropfen;
- keine per-frame Positionsreplikation;
- Spieler kann die vollständige Kette Treffer → Boden → Magnet → HUD bereits verstehen.
- verspätete/fehlende Transferereignisse, vertauschte Resource-/Arrival-Zustellung und JIP erzeugen weder Ressourcendelay noch historische Doppelbursts;
- `npm run check` und passende Netzwerk-/Integrationstests bestanden.

---

## P4 – Visual Polish & Juice

### Ziel

Die Essenz erhält ihre **finale Zieloptik**. Nach P4 soll sie nicht mehr wie ein technischer Prototyp wirken, sondern wie ein bewusst gestalteter Bestandteil von Fragdachse.

P4 optimiert ausschließlich Presentation/Tuning innerhalb der GDD-Semantik. Gameplaywerte, Authority und Netzwerkmodell werden nicht für optische Bequemlichkeit verändert.

### P4.1 Visuelle Leitidee

Ziel:

> **kleine blau-cyan leuchtende Tropfen flüssiger Energie, die sichtbar aus Treffern herausplatzen, sich zu wertigen Perlen sammeln und magnetisch in den Adrenalinring gezogen werden.**

Vermeiden:

- klassische runde Loot-Orbs;
- Münzen/Kristalle;
- große Power-up-Symbole;
- starre Kreise;
- weiße überstrahlte Blobs;
- zu große Partikel;
- hektische Partikelwolken ohne klare Wertquelle.

### P4.2 Ausstoß

Optimieren:

- drei radiale Flugrichtungen vom tatsächlichen Treffer;
- leichte Bogenbewegung statt linearer Explosion;
- rundlicher Kopf und kurzer weicher Flüssigkeitsschwanz;
- Anfangsimpuls passend zur Trefferenergie, aber nicht fälschlich projektilphysikalisch;
- klare cyan/blaue Identität;
- Größenmix statt identischer Punkte;
- ausreichend sichtbar bei schnellen Waffen, ohne jeden Treffer mit großem Feuerwerk zu überladen.

Mehrfachtreffer derselben kurzen Salve dürfen visuell kohärent wirken, ohne Rewards zusammenzufassen.

### P4.3 Landung und Bodenperlen

Zielbild:

- kleine kompakte Perlen;
- breite weiche Reflexe mit kleinen hellen Akzenten;
- gesättigte Cyan-/Blautöne;
- dunklerer blauer Rand/Nachhall;
- weicher aggregierter Halo;
- kurzes Abflachen und gedämpftes Zurückfedern bei Landung, danach ruhige Formbewegung und wandernde Reflexe;
- große Werte über Dichte, Größenmix, Satelliten und Halo statt über riesige Einzelkugeln.

Die größten sichtbaren Perlen bleiben deutlich kleiner als eine Spielfigur.

### P4.4 Merge

Merge soll visuell **Zusammenfließen** kommunizieren:

- kleinere Perlen ziehen leicht zur Zielperle;
- Quellperlen schrumpfen;
- Zielperle wächst weich;
- optional kurzer Liquid-Streak;
- kein hartes Delete/Respawn-Flackern;
- keine sichtbaren Positionssprünge bei häufigem Merge.

### P4.5 Magnetflug

- deutlich zunehmende Beschleunigung;
- Transfer folgt visuell der aktuellen Spielerposition;
- Tropfen leicht gestreckt;
- kurzer cyanfarbener Schweif;
- Flug klar von normalen Projektilen unterscheidbar;
- geringe Distanz trotzdem sichtbar;
- große Transferwerte wirken kräftiger, aber nicht langsamer oder klobig.

### P4.6 Return und Expiry

Return:

- schneller, zurückhaltender Rückfluss;
- Herkunft räumlich nachvollziehbar;
- keine positive Arrival-Sprache.

Expiry:

- letzte 1–1,5 s sichtbar ankündigen;
- Glow sinkt;
- weiches Verdunsten ohne harte Blinksignale;
- weiches Verschwinden;
- keine abrupte Pop-Entfernung.

### P4.7 HUD-Kohärenz

- Incoming-Schimmer farblich exakt mit Weltessenz verwandt;
- Arrival-Burst synchron zum tatsächlichen Commit;
- kleine Werte erhalten sichtbares, aber dezentes Feedback;
- mehrere schnelle Arrivals sauber bündeln;
- Intensität mit tatsächlich gutgeschriebenem Wert skalieren;
- Weltankunft und Ring-Burst fühlen sich wie ein Ereignis an.

### P4.8 Dichte und Lesbarkeit

Mindestens drei Situationen tunen:

1. einzelne kleine Treffer;
2. normale Gefechtsdichte;
3. Stressfall mit mehreren hundert rekonstruierten Tropfen.

Bei hoher Dichte zuerst reduzieren:

- Satelliten;
- Mikrotröpfchen;
- sekundären Glow;
- Wabern;
- lange Schweife.

Immer erhalten:

- Kernperle;
- grobe Mengenwirkung;
- Clusterposition;
- Transferlesbarkeit;
- Arrival/Return/Expiry.

### P4.9 Quality-Stufen

Quality-Degradation ist Teil der Gestaltung, kein späterer Notfallpfad.

Für jede unterstützte Grafikqualität:

- sinnvolle Tropfendichte;
- Halo-/Satellitenbudget;
- stabile Kernlesbarkeit;
- keine völlig andere visuelle Sprache;
- keine Gameplayinformation nur in High Quality.

### P4.10 Visuelles Phasen-Gate

P4 gilt erst als abgeschlossen, wenn eine **manuelle Sichtprüfung** für repräsentative Spielszenen erfolgt ist.

Prüfen:

- kleiner Einzelreward;
- großer Reward;
- schnelle Automatikwaffe;
- Melee/Bite;
- Chain/Split;
- mehrere Cluster;
- Merge;
- Magnetflug nah/fern;
- Return;
- Expiry;
- Host und Client;
- normale und reduzierte Grafikqualität.

Abnahmekriterien:

- kein Platzhalter-/Debug-Look;
- keine deutlich zu großen „Orbs“;
- Cyan-/Blau-Identität passt zum Adrenalinring;
- Effekte sind in Bewegung und Standbild ansprechend;
- Gegner, Projektile und Gefahren bleiben visuell priorisiert;
- keine auffälligen Pops, Slot-Flashes oder harte Merge-Sprünge;
- Juice ist klar besser als unmittelbarer unsichtbarer Resource-Gain;
- Darstellung ist gut genug, dass P5 nur noch stabilisiert.

Falls diese Kriterien nicht erfüllt sind, bleibt P4 offen.

---

## P5 – Hardening, Performance & Final Acceptance

### Ziel

Alle fünf Phasen werden zu einem produktionsreifen Feature geschlossen. Nach P5 ist die Mechanik vollständig spielbar, visuell ausgereift, getestet und ohne bekannte Architektur-/Legacy-Restschuld.

### P5.1 Performance

Reproduzierbarer Stressfall:

- mehrere hundert sichtbare Tropfen;
- hohe Reward-Fakten/s;
- maximal realistische Spielerzahl;
- wiederholte Merges;
- parallele Transfers;
- Tod/Burrow-Abbrüche;
- Full-Resync während Transfers;
- reduzierte Grafikqualität.

Messen:

- Host-CPU für Spawn/Merge/Magnet/Transfer;
- Anzahl Cluster/Expiry-Buckets/Transfers;
- GPU-Instanzen je Lane/Renderer;
- Admission-/Capacity-Drops;
- Netzwerkbytes pro Tick/Sekunde;
- Full-Snapshot-Größe.

Budgets vor der Optimierung aus aktueller Baseline ableiten. Der Nachweis benennt Hardware, Auflösung/Qualität, Map/Seed, Spielerzahl, Reward-Fakten/s, Messdauer und Wiederholungen; er vergleicht identische Last mit und ohne Essenz. Mindestens Host-CPU und Framezeit als Median/p95 sowie Netzwerkbytes/s und Spitzenbestand ausweisen. Numerische Grenzwerte werden mit dem Preflight-Messprofil im Implementierungsdiff festgehalten und nicht erst nachträglich passend zum Ergebnis gewählt. Fehlende Messung bleibt offen; „kein großer FPS-Einbruch“ allein ist kein Abschlussnachweis.

### P5.2 Balance-Lab und Headless

Begriffe trennen:

- authored Reward;
- materialisiert;
- eingesammelt;
- verfallen;
- verbraucht.

Weapon Balance Lab darf für Bruttobalance:

- Reward-Faktum direkt messen oder
- deterministisch Auto-Collect nutzen.

Produktionssemantik wird dadurch nicht verändert.

Bestehende Headless-Modelle dürfen unmittelbaren Gain nur behalten, wenn sie ausdrücklich als Brutto-Reward-Modell dokumentiert sind.

### P5.3 Architektur-Hardening

Prüfen:

- kein Essenz-State in `WorldCombatCore`;
- kein State in `HostUpdateCoordinator`/`ArenaLifecycleCoordinator`;
- keine zweite Resource-Authority;
- keine `allegiance.ownerId`-Fallback-Attribution;
- keine Renderer-/Network-Rekonstruktion fachlicher Rewards;
- keine überschriebenen Single-Callbacks;
- kein `refundAdrenaline` als Arrival;
- kein alter materialisierter Direkt-Gain;
- keine Activity-/World-/Life-Leaks;
- keine pro-Tropfen-GameObjects/Network-Entities;
- keine unbounded per-frame Allokation.

### P5.4 Vollständige Testmatrix

Automatisiert soweit sinnvoll:

- Projectile;
- Hitscan;
- Melee;
- Chain;
- Split/Child;
- Reflection/Deflection;
- volle Ressource;
- Bruchteile;
- Multi-Hit;
- parallele Sammler;
- Arrival-Cap-Race;
- Tod im Flug;
- Burrow-Wind-up;
- Disconnect;
- Activity-/World-Wechsel;
- Delta-Verlust + Full-Resync;
- Join-in-progress;
- AccessGroup je Modus;
- Value-Conservation.

### P5.5 Manuelle Endabnahme

Mindestens:

- Host und echter Client;
- Coop;
- Team Deathmatch;
- Capture the Beer;
- Deathmatch;
- Nah-/Mittel-/Fernkampf;
- volle Ressource;
- Tod/Burrow/Respawn;
- dichte Gefechte;
- reduzierte Grafikqualität;
- Activity-/Map-Wechsel;
- P4-Visuals noch einmal auf Regression prüfen.

### P5.6 Cleanup

- tote alte Reward-Pfade entfernen;
- unnötige Adapter/Fallbacks entfernen;
- Debug-Instrumentierung nur behalten, wenn bewusst nützlich;
- neue zentrale Tuningwerte dokumentieren;
- Tests auf öffentliche Contracts statt private Implementierungsdetails ausrichten;
- Dokumentreferenzen aktualisieren, falls technische Namen final anders gewählt wurden.

### P5 Final Gate

P5 ist nur abgeschlossen, wenn:

1. vollständige GDD-Funktionalität vorhanden ist;
2. alle vier Modi spielbar sind;
3. Host/Client konsistent sind;
4. kein materialisierter Treffer doppelt belohnt;
5. Werterhaltung stimmt;
6. Activity-/World-/Life-Stale-Fälle inert bleiben;
7. Performance im Stressfall akzeptabel ist;
8. Netzwerk ohne Tropfen-/Frame-Spam arbeitet;
9. Balance-Lab-Begriffe korrekt getrennt sind;
10. P4-Zieloptik weiterhin erreicht wird;
11. keine bekannte relevante Legacy-/Architekturrestschuld offen ist;
12. `npm run check` und die betroffenen Integration-, Asset-, Stress- und Balance-Lab-Suites grün sind; manuelle Nachweise gesondert vorliegen.

---

## 6. Phasenabhängigkeiten

```text
Preflight
  ↓
P1 Contracts & Foundation
  ↓
P2 Host Gameplay & Cutover
  ↓
P3 Replication & Functional Presentation
  ↓
P4 Visual Polish & Juice
  ↓
P5 Hardening & Final Acceptance
```

Nicht vorziehen:

- P2 darf keine provisorische Resource-Bypass-Semantik erfinden, weil P1 noch fehlt.
- P3 darf keinen Client-Pickup-RPC einführen, um Hostlogik abzukürzen.
- P4 darf Gameplay-/Netzwerksemantik nicht für einen schöneren Effekt verändern.
- P5 darf keine grundlegende Visual-Neuentwicklung aufschieben; dafür ist P4 zuständig.

---

## 7. Empfohlene Datei-/Modulstruktur

Keine Pflicht zu exakt diesen Namen, aber die Verantwortungen sollen sichtbar getrennt sein.

```text
src/adrenalineEssence/
  AdrenalineEssenceTypes.ts
  AdrenalineEssenceRuntime.ts
  AdrenalineEssenceAccessPolicy.ts
  AdrenalineEssenceSpatialIndex.ts
  AdrenalineEssenceReplication.ts
  AdrenalineEssenceClientReplica.ts
  AdrenalineEssenceGpuRenderer.ts
  AdrenalineEssencePresentation.ts
  AdrenalineEssenceDiagnostics.ts
```

Nicht erwünscht:

- eine einzelne riesige `AdrenalineEssenceSystem.ts`, die Combat, Network, GPU und HUD zugleich besitzt;
- State in Scene-Coordinatoren;
- Essence-spezifische Regeln im generischen `ResourceSystem`;
- Essence-Gameplay im `GpuVfxSystem`;
- Kopieren des gesamten PowerUp-Systems.

---

## 8. Zentrale Tests und Ratchets

Neue oder angepasste Tests sollen bevorzugt **Semantik** schützen.

### Contract-/Core-Tests

- Reward-Faktum nur nach bestätigtem positiven Outcome;
- korrekte Attribution;
- Gain-Multiplikator genau einmal;
- resolved Arrival-Commit;
- Bruchteile;
- volle Erzeuger;
- deterministic safe landing;
- AccessGroup;
- Merge/Expiry;
- Reservation/Arrival/Return;
- Value-Conservation.

### Lifecycle-/Integrationstests

- Activity detach;
- World teardown;
- Respawn/Life revision;
- Burrow callback fan-out;
- Disconnect;
- stale snapshot/delta;
- JIP.

### Networktests

- Delta + Full;
- Tombstone ordering;
- Revision monotonicity;
- Transfer terminal idempotence;
- keine sichtbaren Tropfen im Wire-Schema.

### Presentationtests

- stabile GPU-Slots;
- Cleanup bei Activity-Ende;
- Quality reduziert Details statt Kern;
- HUD Arrival nur bei bestätigtem Commit;
- Cancel erzeugt keinen positiven Burst.

Keine Tests, die genaue dekorative Partikelzahlen oder fragile Tuning-Literals als Architekturvertrag einfrieren.

---

## 9. Tuning nach Implementierung

Die zentralen GDD-Tuningwerte bleiben leicht veränderbar:

- Landing-Zeit;
- Streuradius;
- Bodenlebensdauer;
- Expiry-Warnzeit;
- Merge-Fenster;
- Merge-Radius;
- Magnetradius;
- Min-/Max-Flugzeit;
- Beschleunigung;
- Arrival-Bündelung;
- sichtbare Tropfendichte;
- Größenklassen;
- Halo-/Glow-Stärke;
- Quality-/LOD-Schwellen.

Gameplay-Tuning und Visual-Tuning getrennt halten. Ein schöneres Ergebnis darf nicht versehentlich Sammelradius, Wert, Authority oder Expiry verändern.

---

## 10. Arbeitsanweisung für Coding-KIs

Für jede Phase genügt nach Ablage von GDD und Plan ein kurzer Auftrag nach diesem Muster:

> Implementiere **P<n>** aus `Fragdachse_Adrenalin_Essenz_Implementation_Plan.md` auf Basis der aktuellen `Fragdachse_Adrenalin_Essenz_GDD_v2_1.md` und der relevanten bestehenden Runtime-Architekturdokumente. Prüfe zuerst den verwendeten Checkout einschließlich Arbeitsbaum gegen den im Plan dokumentierten Reviewstand und passe reine Integrationsdetails an aktuelle Repository-Realität an. Fachliche GDD-Semantik und Architekturgrenzen nicht still verändern. Implementiere die Phase vollständig einschließlich Tests und führe ihr Gate aus. Änderungen außerhalb des notwendigen Scopes vermeiden. Bei einer echten besseren technischen Lösung darfst du vom vorgeschlagenen Dateinamen/Schnitt abweichen, aber nicht von Ownership, Authority, Lifetime oder Invarianten. Browser-/Sichtprüfung nur bei ausdrücklichem Auftrag; fehlende manuelle Nachweise als offen ausweisen.

Für P4 zusätzlich:

> Behandle die Phase ausdrücklich als visuelle Qualitätsphase, nicht als Minimal-Prototyp. Nutze die bestehende GPU-Infrastruktur effizient und tune die Darstellung auf ein attraktives, lesbares Endergebnis. Halte Gameplay und Network unverändert.

---

## 11. Definition of Done nach P5

Das Feature ist fertig, wenn der Spieler die folgende Kette in allen unterstützten Modi zuverlässig erlebt:

> **Treffer → sichtbarer cyanfarbener Essenz-Ausstoß → gültige Landung → wertige Bodenperle / Merge → räumliche Risk/Reward-Entscheidung → magnetischer Transfer → synchroner HUD-Burst → tatsächliche Adrenalingutschrift**

und gleichzeitig gilt:

- host-autoritativ;
- werttreu;
- stale-sicher;
- multiplayerfähig;
- activity-sauber;
- performant;
- bei hoher Dichte lesbar;
- visuell bewusst gestaltet und nicht prototypisch;
- ohne doppelte Legacy-Rewards;
- ohne per-Tropfen-Gameplay-/Netzwerkobjekte.

**Nach P5 soll keine weitere „eigentliche Implementierungsphase“ nötig sein. Danach folgen nur noch normales Balancing, optionale Audio-/VFX-Erweiterungen und spätere Gameplay-Upgrades.**
