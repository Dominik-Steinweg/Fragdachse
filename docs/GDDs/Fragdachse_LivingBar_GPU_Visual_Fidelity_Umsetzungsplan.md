# LivingBar GPU Visual Fidelity – technischer Abgleich und Umsetzungsplan

**Stand:** 12.09.2026

**Status:** Implementiert und automatisiert geprüft; visuelle Abnahme im Browser noch offen.

**Grundlage:** [Technisches Konzept](Fragdachse_LivingBar_GPU_Visual_Fidelity_Technisches_Konzept.md), Referenz `6dcfb63edd7fdd682ee8804767bf1c30cbabbc8b`.

**Abgeglichen gegen:** lokalen Arbeitsstand auf `4e7465a716caa176418f463089738f5678958ba9` (`Upgrade PNGs`), 146 Commits nach der Konzeptreferenz, einschließlich vorhandener uncommitteter Änderungen. Installiertes Phaser: **4.2.1**.

## 1. Ergebnis des Abgleichs

Die GPU-Architektur und die wesentlichen Fehlerbeschreibungen des Konzepts gelten weiterhin. Die Umsetzung ist auf dieser Grundlage möglich. Einige unvollständige Annahmen müssen jedoch vor der Implementierung präzisiert werden; diese Ergänzungen stehen in Abschnitt 2. Das Originalkonzept bleibt als Referenz erhalten.

| Bereich | Verifizierter aktueller Stand | Konsequenz |
| --- | --- | --- |
| [LivingFieldTexture](../../src/effects/living/LivingFieldTexture.ts) | Ein Scene-Singleton; Shader ab erstem `retain()`, Freigabe mit letztem `release()`. `update()` prüft nur residente Consumer. Auflösung 1024 × 128, High/Medium mit 30/20 Hz. Seit Konzeptreferenz unverändert. | Residenten Besitz und Animationsbedarf trennen. Auflösung, Frequenzen und Shaderrezept beibehalten. |
| [LivingBarEffect](../../src/ui/LivingBarEffect.ts) | Default aktiv; ein Sample mit X-Tiling, rechteckigem Crop und geometriebasiertem Y-Offset. Keine Optionen für Compact, Rounded-Clip oder initiale Inaktivität. Seit Konzeptreferenz unverändert. | Konzept-API und Tile-Metadaten ergänzen. Bestehenden Bar-Pfad erhalten. |
| [UiButton](../../src/ui/UiButton.ts) / [LobbyOverlay](../../src/scenes/LobbyOverlay.ts) | Hintergrund, Icon und Text im gemeinsamen Button-Root. Living-Images liegen außerhalb in `coopBand`; beide `bringToTop(button.getRoot())`-Workarounds sind vorhanden. | Internen Effect-Container einführen und Button-Effekte dorthin verschieben. |
| [CoopDefenseUpgradesOverlay](../../src/ui/CoopDefenseUpgradesOverlay.ts) | Node 48 × 48, volle Innenform 44 × 44 mit Radius 10; statische Füllung wird von unten gecroppt. Living liegt bereits zwischen Füllung und Icon/Text. XP und Node-Effekte können beim versteckten Build aktiv entstehen. | Compact-Sampling und Schnitt mit der vollständigen Innenform; expliziter Aktivitätszustand. |
| [LeftSidePanel](../../src/ui/LeftSidePanel.ts) | Quadratische 32er Swatches. Build startet Effekte; `closeColorPicker()` stoppt sie nicht. `refreshPickerSwatches()` berücksichtigt nur die Farbverfügbarkeit. | Initial inaktiv; Aktivität an Picker-Offenheit und sichtbare Farbe binden. |
| [OptionsOverlay](../../src/ui/OptionsOverlay.ts) | Slider werden aktiv aufgebaut; Show/Hide schalten ihre Living-Effekte nicht. | Initial inaktiv; Show/Hide synchronisieren. |
| [CenterHUD](../../src/ui/CenterHUD.ts) | Train-Effekt wird nach Build gestoppt. Die drei unteren Armor-/Utility-/Ultimate-Sections werden dagegen unsichtbar mit aktiven Effekten erzeugt. `hideLowerSection()` kehrt bei bereits unsichtbarer Section sofort zurück. | Ergänzender, kleiner Lifecycle-Fix erforderlich; die Einstufung als ausschließliches Regressionsziel ist unvollständig. |
| [ArenaHUD](../../src/ui/ArenaHUD.ts), [AimSystem](../../src/ui/AimSystem.ts), [MatchResultsOverlay](../../src/ui/MatchResultsOverlay.ts) | Eigene Aktivierungs-/Stop-Pfade vorhanden: Presentation-Gating, sichtbarer Charge-Preview bzw. XP-Sequenz. | Bestehende Abläufe als Regression prüfen. Kein struktureller Umbau. |

Seit der Konzeptreferenz änderten sich im direkten Zielbereich Lobby-Boot/Reveal, Loadout-/Tool-Darstellung, Upgrade-Icon-Auswahl und ein Options-Layoutmaß. Diese Änderungen beheben die LivingBar-Probleme nicht und müssen erhalten bleiben. Die alten Zeilennummern und Partikel-Kommentare eignen sich nicht als Implementierungsanleitung; maßgeblich sind die aktuellen Symbole.

## 2. Verbindliche Präzisierungen gegenüber dem Konzept

### 2.1 Stabile Variation braucht eine Consumer-Identität

Alle Node-Gruppen besitzen eigene lokale Koordinaten. Gleich weit gefüllte Nodes derselben Kategorie übergeben deshalb dieselben Werte für Effekt-X/Y und Farbe. Ein Hash nur dieser Werte plus Sample-Index erzeugt für diese Nodes identische Samples. Auch die beiden Lobby-Buttons erhalten nach dem Verschieben in ihre Roots dieselben lokalen Koordinaten und dieselbe Palette.

Die Options-API erhält zusätzlich einen optionalen **`variantKey?: string`**. Nodes übergeben ihre vorhandene `node.id`, Lobby-Buttons unterschiedliche stabile Schlüssel, Swatches ihre Farbe. Ein deterministischer Hash kombiniert diesen Schlüssel mit Geometrie/Farbe und Sample-Index. Ohne Schlüssel bleibt die bisherige Variation des normalen Bar-Pfads erhalten. Keine globalen Zufallszähler und keine Zufallswerte pro Frame. Refresh und Quality-Rebuild erhalten dieselbe Variation für denselben Consumer-Zustand.

### 2.2 Button-Clipping muss die tatsächlich gezeichnete Fläche verwenden

Das Konzept schlägt für den 190 × 44-Button die vollständige Texture-Ausdehnung mit Radius 12 vor. [ensureRoundedTexture](../../src/ui/uiTextures.ts) zeichnet seine Füllform jedoch mit `inset = max(1, strokeWidth)`. `UiButton` verwendet `strokeWidth: 2`.

Die aktuelle Füllform liegt damit lokal bei **x = −93, y = −20, Breite = 186, Höhe = 40, Radius = 12**. Ein Clip auf die äußeren 190 × 44 kann weiterhin in transparente Randbereiche zeichnen. Die Konturlinie wird zusätzlich um den Füllpfad gestrichen; das Living-Feld soll innerhalb der Füllform bleiben.

`UiButton` stellt neben `getEffectLayer()` generische lokale Effect-Bounds mit Radius bereit. Die Geometrieberechnung wird mit dem Rounded-Texture-Helper geteilt, sodass Inset und Radius nicht unabhängig im Lobby-Aufrufer nachgebaut werden. `UiButton` importiert dafür keine LivingBar-Klasse oder LivingBar-spezifischen Typen. Das ursprüngliche Effekt-Rechteck darf 190 × 44 bleiben; die Clipform begrenzt es auf die gezeichnete Füllung.

### 2.3 Sichtbarkeit muss an allen Owner-Übergängen synchronisiert werden

Ein aktiver Zähler erkennt versteckte Parent-Container nicht automatisch. Die konkreten UI-Owner bleiben für Start/Stop verantwortlich; eine Abfrage sämtlicher Parent-Ketten pro Frame wird nicht eingeführt.

Zusätzlich zu den im Konzept genannten Anpassungen:

- `CenterHUD.createLowerSection()` erzeugt Living-Effekte inaktiv. Der Wechsel zur Lobby stoppt sie sofort, auch wenn eine Section bereits unsichtbar ist oder ein Fade läuft. Im Spiel bleibt der normale Section-Fade erhalten. Spätere Status-/Energieaktualisierungen dürfen unter einem versteckten HUD-Root keine Animation reaktivieren.
- `LobbyOverlay.setCoopDefenseProgress(null)` stoppt derzeit Upgrade und XP, aber nicht Items. Die Items-Aktivierung berücksichtigt nur `this.visible`, nicht `coopBand.visible`. Eine kleine gemeinsame Aktivitätssynchronisation im bestehenden Overlay verknüpft gespeicherte Attention-Zustände mit sichtbarer Lobby und sichtbarem Coop-Band. Beide Setter und Sichtbarkeitswechsel nutzen sie. Die Signatur-Caches dürfen ein Wiederanzeigen bei unveränderten Daten nicht blockieren.
- `closeColorPicker()` muss die Stop-Synchronisation tatsächlich aufrufen. Nur eine zusätzliche Bedingung in `refreshPickerSwatches()` würde den Schließpfad noch nicht korrigieren.
- `ensureGlowVisual()` muss neben Quality und Fill auch die Effektaktivität beachten. Heute kann `createTiles()` bereits einen Glow anlegen. `startActive: false` darf deshalb weder Shared-Field-Aktivierung noch Aura-/Breath-Anmeldung auslösen, auch nicht nach `low → high`.

### 2.4 Geometrie und Source-Sampling bleiben getrennte Größen

Die Geometrie berechnet **volle Clipform ∩ aktuelles Fill-Rechteck**. Die Source-Koordinaten eines Samples bilden dieses Ergebnis durchgehend ab. Jedes Band darf weder einen neuen Feldursprung noch einen neu beginnenden Farbverlauf erhalten. Damit entstehen zwischen Bändern keine Muster- oder Helligkeitssprünge.

Für die zunächst fünf horizontalen Bänder wird zuerst die vertikale Schnittmenge mit dem Fill ermittelt. Der konservative X-Inset ergibt sich aus der engsten Stelle des Kreisbogens innerhalb dieses tatsächlich sichtbaren Bandes. Danach folgt der horizontale Schnitt. Leere oder nicht endliche Flächen erzeugen keine sichtbaren Tiles. Radius wird auf gültige halbe Abmessungen begrenzt.

**Halber Node:** Die obere Fill-Kante liegt gerade und in voller Innenbreite in der Node-Mitte; nur die unteren äußeren Bänder sind eingerückt. Die Clipform bleibt immer die volle 44 × 44-Innenform.

Fünf Bänder sind eine Startkalibrierung. Sie garantieren geometrische Einschließung, aber keine mathematisch glatte Rundung. Sichtbare Stufen oder Nähte müssen bei der späteren Sichtprüfung durch angepasste Bandgrenzen bzw. eine begrenzte höhere Bandzahl behoben werden. Ein zusätzlicher Masken-/Filterpass ist dafür nicht vorgesehen.

### 2.5 Sehr flache Füllungen brauchen einen definierten Sampling-Pfad

Die bisherige Skalierung hängt an der übergebenen Effekthöhe, beim Node also an `fillHeight`. Ein 44 × 1-Effekt benötigt damit 2816 Source-Pixel in X und passt nicht in ein einzelnes 1024er Fenster. Die Konzeptannahme „Compact benötigt immer wenig Source-Breite“ gilt daher nicht allgemein. Die aktuell geprüften Upgrade-Daten haben maximal fünf Level, der öffentliche Effektvertrag sollte trotzdem kleine Flächen korrekt behandeln.

Die bisherige Höhenkalibrierung bleibt erhalten. Für normale Compact-Flächen werden auseinanderliegende, vollständig passende Source-Fenster gewählt. Wenn die Source-Breite nicht in die Textur passt, wird das vorhandene periodische X-Tiling auf jedes Sample angewendet; ein versetzter Übergang am Texture-Ende wird in gültige Crop-Fragmente zerlegt. Keine Streckung oder globale Änderung der Blobgröße. Eine konstante Grenze von 15 Images pro Node wäre für solche Sondergeometrien eine falsche Zusage.

### 2.6 „Pausiert“ bezeichnet ausbleibende Animations-Updates

Das lokale Phaser 4.2.1 führt in `Shader.setRenderToTexture()` bereits einen initialen Renderdurchlauf aus (`node_modules/phaser/src/gameobjects/shader/Shader.js`). Ein erster inaktiver, residenter Consumer kann daher bei der Texture-Erzeugung einen Initialframe verursachen.

Der überprüfbare Vertrag lautet: **Nach der Initialisierung rendert kein Scene-Tick neue Shared-Field-Frames, solange kein Consumer Animation benötigt.** Die Textur bleibt für residente Images gültig. Das vermeidet einen unnötigen Eingriff in Phaser-Interna. Bei erneuter Aktivierung wird der nächste Tick sofort renderfähig; die Animationszeit läuft aus der pausierten Phase ohne Nachholschleife weiter.

Die Aktivitätsbedingung verwendet neben Enabled/Active und der bestehenden Fill-Schwelle mindestens ein tatsächlich nicht leeres, sichtbares Feld-Tile. `tiles.length > 0` allein genügt bei einem vollständig weggeclippten Effekt nicht. Eine Effektinstanz meldet sich genau einmal aktiv, unabhängig von Samples, Bändern und Tiling.

### 2.7 Shader- und Testvorgaben präzisieren

`CORE_CELL`, `OUTER_CELL`, `FIELD_GAIN` und das konkrete Bar-Shaderrezept liegen aktuell in **LivingFieldTexture.ts**, nicht in `livingFieldShader.ts`. Beide Shader-Bestandteile bleiben visuell unverändert; nur der Lifecycle der Texture-Klasse ändert sich. [PlayerStatusRing](../../src/ui/PlayerStatusRing.ts) nutzt das gemeinsame GLSL über seinen eigenen Shader und bleibt außerhalb des Änderungsumfangs.

Die aktuelle [Testpolicy](../ai/testing.md) bevorzugt Verhaltenstests gegenüber Source-Text-Prüfungen. Deshalb keine Tests, die lediglich `getEffectLayer()` oder `sampling: 'compact'` als String suchen. Die Layer-Reihenfolge, Consumer-Aktivität und Clip-Geometrie werden über tatsächliche Objekte bzw. öffentliche UI-Übergänge mit kleinen Phaser-Fakes geprüft. Ästhetische Sample-Gewichte und die genaue Bandzahl werden nicht als dauerhafte Literal-Snapshots eingefroren.

## 3. Umsetzungsphasen

### Phase 1 – Shared-Field-Lifecycle

**Dateien:** `src/effects/living/LivingFieldTexture.ts`, `tests/LivingFieldTexture.test.ts`.

- `consumers` und `activeConsumers` trennen; `activate()` / `deactivate()` ergänzen.
- Erster Resident erzeugt die Textur, letzter Resident gibt sie frei. Null aktive Consumer pausieren ausschließlich die Animation.
- Beim Übergang 0 → 1 `nextRenderAt` zurücksetzen. 30/20-Hz-Takt und Texture-Identität bei High/Medium-Wechsel erhalten.
- Shutdown/Destroy lösen Listener, Zähler und Ressourcen. Consumer-Teardown bleibt auch bei anderer Shutdown-Reihenfolge ungefährlich.
- Bestehenden Test-Fake so ergänzen, dass Texture-Existenz, initialer Render, Ticks und Shutdown tatsächlich beobachtbar sind.

**Fertig, wenn:** Zwei residente Effekte teilen einen Shader; Stop des letzten aktiven Effekts verhindert neue Tick-Frames ohne Texture-Zerstörung; Restart liefert wieder Frames; letzter Release räumt auf.

### Phase 2 – Effektzustand und gewichtetes Compact-Sampling

**Dateien:** `src/ui/LivingBarEffect.ts`, `tests/LivingBarEffectQuality.test.ts`.

- Optionen um `sampling`, `clipShape`, `startActive` und `variantKey` erweitern. Defaults: `bar`, kein Clip, aktiv, bisherige Variation.
- Tiles durch Metadaten für Image, Sample, Gewicht und Source-/Zielgeometrie ersetzen. Eine zentrale Synchronisation verwaltet sichtbare Tiles, Field-Aktivierung und Glow/Breath-Lifetime.
- Compact mit zunächst drei Samples und einer gemeinsamen lokalen Gewichtskonstante beginnen. Offsets einmal pro Aufbau deterministisch berechnen; normales Bar-Tiling erhalten.
- Energieänderungen multiplizieren die Sample-Gewichte und erhalten den vorhandenen Energiezustand über Quality-Rebuilds.
- Stop, Start, Fill-Wechsel, Quality-Wechsel und Destroy sind idempotent bezüglich aktiver Anmeldung. Tile-Abbau deaktiviert zuerst, zerstört Images und released danach die Texture.
- Gestoppte Effekte speichern Fill-Änderungen. Beim Start werden auch Aura-Position und -Größe aus dem neuesten Fill synchronisiert.

**Fertig, wenn:** Standardbalken behalten ihren bisherigen Sampling-Pfad; Compact zeigt unterschiedliche stabile Samples; wiederholtes Start/Stop und Quality-Wechsel erzeugen weder Zählerlecks noch versteckte Glows.

### Phase 3 – Rounded-Clip-Geometrie und Tile-Abbildung

**Dateien:** neuer reiner Helper `src/effects/living/livingClipGeometry.ts`, neuer Test `tests/LivingClipGeometry.test.ts`, Integration in `LivingBarEffect` und dessen vorhandenen Test.

- Helper verwendet einfache Rechteckdaten ohne Phaser-GameObjects oder Runtime-Phaser-Abhängigkeit.
- Volle Form, aktuelles Fill, Kreisbogeneinrückung und positive Schnittflächen nach Abschnitt 2.4 berechnen.
- Bands mit Sample-Fenstern und gegebenenfalls X-Tiles schneiden. Source-Offset, Scale und Crop zusammen so abbilden, dass die Zielposition und Musterkontinuität erhalten bleiben.
- Gleichbleibende Fill-Breite verursacht keinen Neuaufbau. Bei tatsächlichen Änderungen vorhandene Tiles aktualisieren; keine neue CPU-Animationsschleife.

**Fertig, wenn:** Volle, halbe, sehr flache und leere Füllungen geometrisch korrekt sind; kein Crop verlässt die Texture und kein Zielband die erlaubte Form. Leere Geometrie hält den Shared-Shader nicht aktiv.

### Phase 4 – Button-Layer und Lobby-Consumer

**Dateien:** `src/ui/UiButton.ts`, `src/ui/uiTextures.ts`, `src/scenes/LobbyOverlay.ts`; kleine Verhaltenstests im bestehenden Vitest-Runner.

- Reihenfolge: Background → Effect-Container → Icon → Label → Badge. Effect-Container lokal bei (0, 0), gleicher Scroll-Faktor; Root-Transformationen gelten für alle Kinder.
- Generische Effect-Bounds aus der gemeinsamen Rounded-Texture-Geometrie bereitstellen.
- Beide Lobby-Effekte in den internen Layer verschieben, korrekte Clipform und stabile Schlüssel übergeben, `bar` und zunächst Intensität 0.34 erhalten, initial inaktiv.
- Die zwei Button-`bringToTop`-Workarounds entfernen. Vorhandene Tooltip-/sonstige Layer-Anordnungen beibehalten.
- Aufmerksamkeit und effektive Coop-Band-Sichtbarkeit gemeinsam synchronisieren, einschließlich `progress = null` und Wiederanzeigen mit gleichen Daten.
- Die bereits richtige Teardown-Reihenfolge beibehalten: Living-Effekte vor Buttons und Parent-Containern zerstören.

**Fertig, wenn:** Feld liegt über der Fläche und unter Text/Icon/Badge; Hover/Press bewegen alles gemeinsam; unsichtbares Coop-Band hat keine aktiven Button-Effekte.

### Phase 5 – Nodes, Picker, Options und CenterHUD

**Dateien:** `src/ui/CoopDefenseUpgradesOverlay.ts`, `src/ui/LeftSidePanel.ts`, `src/ui/OptionsOverlay.ts`, `src/ui/CenterHUD.ts`.

- Nodes: Compact, volle Innenclipform, `variantKey: node.id`, `startActive: this.visible`. Statische Füllung, bestehender separater Kontur-Glow, Boss-Rahmen, aktuelle PNG-/Loadout-Icon-Auswahl und Base-Unlock-Regeln erhalten.
- Upgrade-XP: initial inaktiv; bestehendes Show/Hide verwenden. Unsichtbarer Refresh darf keine aktive Shared-Field-Anmeldung zurücklassen.
- Swatches: Compact ohne Rounded-Clip, initial inaktiv; Open, Close, Verfügbarkeitsänderung, Farbauswahl und Destroy synchronisieren.
- Options: Bar-Modus, initial inaktiv; Show startet, Hide stoppt sofort. Sprachbedingten Rebuild und Quality-Wechsel im offenen bzw. geschlossenen Overlay prüfen.
- CenterHUD: untere Sections initial inaktiv; Root-Hide stoppt zuverlässig; Wiederanzeigen verwendet aktuellen Fill und Energiezustand. Normalen sichtbaren Section-Fade beibehalten.
- Überholte Partikel-Kommentare an den bearbeiteten Stellen korrigieren.

**Fertig, wenn:** Kein versteckt aufgebauter oder geschlossener Ziel-Consumer hält die Shared-Field-Animation aktiv. Nach Wiederöffnen ist der gespeicherte Zustand sofort korrekt.

### Phase 6 – Regression und Abnahme

Die Phasen 1–5 werden als zusammenhängende Änderung abgeschlossen. Nach Phase 1 allein sind die bestehenden Aufrufer noch nicht an den neuen Aktivitätsvertrag angebunden.

**Automatisierte Prüfung:**

1. Während der Umsetzung die vorhandenen LivingField-/LivingBar-Tests gezielt erweitern und ausführen; Geometrie separat testen.
2. Kleine Runtime-Tests für Button-Schichtung sowie Build/Show/Hide/Refresh/Quality/Destroy der betroffenen UI-Owner ergänzen. UI-Composition-Verträge gehören nach `tests/integration/`, reine Geometrie und Effektzustand in Core. Kein neuer Runner oder allgemeines Browser-Harness.
3. Mehrere gleichzeitig residente/aktive Effekte, vollständiges Stoppen, erneutes Starten und Scene-Shutdown gemeinsam prüfen. Sample- und Bandzahl dürfen keine zusätzlichen Shader erzeugen. Keine Partikel-, Node-Texture- oder Masken-Erzeugung.
4. Vorhandene [SharedGlowSystem-Tests](../../tests/SharedGlowSystem.test.ts) und [Quality-Tests](../../tests/GraphicsQualityAndPerformance.test.ts) berücksichtigen. Neue verschachtelte Button-Targets müssen weiterhin die bestehende Glow-/Clarity-Zuordnung verwenden.
5. Abschließend **`npm run check`**, zusätzlich gezielt die neu betroffenen Integrationstests und **`git diff --check`**. `check` enthält Core, Architecture und Build; kein separates Typecheck vor dem Build. Assets-, Stress- oder Balance-Suites sind für diesen Umfang nicht erforderlich.

**Visuelle Abnahme nach ausdrücklichem Auftrag zur Sichtprüfung:**

- Upgrade-Nodes bei kleiner, halber und voller Füllung; mehrere gleichfarbige Nodes nebeneinander; Kategorie-Wechsel und schnelle Leveländerung.
- Wahrnehmbare ruhige Bewegung bei der vorhandenen Node-Intensität; saubere Fill-Kante; keine Stufen/Nähte oder rechteckigen Überstände; Icon und Leveltext lesbar; weicher Kontur-Glow; statische Base-Unlocks.
- UPGRADES/ITEMS mit und ohne Aufmerksamkeit, Badge, Hover und Press; Clip folgt Fläche und Transformation.
- Picker und Options öffnen/schließen; währenddessen Quality wechseln; Upgrade-Overlay verborgen refreshen.
- HUD-/XP-/Charge-/Train-/untere Status-Balken und PlayerStatusRing im Vergleich prüfen. Low bleibt ohne Living-Feld, Medium/High behalten das bisherige Rezept.

Für eine beauftragte Browserprüfung gilt der vorhandene Ablauf: `npm run dev:browser`, HTTP 200 auf `http://127.0.0.1:8090/` abwarten, sichtbares Browser-Pane verwenden. Ohne diesen Auftrag wird kein Browser gestartet und die visuelle Abnahme bleibt ausdrücklich offen. Build und Mocks können die wahrgenommene Bewegungsdichte und Rundungsqualität nicht bestätigen.

## 4. Grenzen und Risiken

- **Architektur:** Ein Shared-Field pro Scene; keine neuen Consumer-Shader, ParticleEmitter, DynamicTextures oder Masken pro Node; keine per-frame Sample-Positionsanimation. Bar-Shader, Renderauflösung und Frequenz bleiben unverändert.
- **Performance:** Drei Samples × fünf Bänder ergeben bei einer voll gefüllten, nicht X-geteilten Node zunächst bis zu 15 Feld-Images, bei 20 solchen Nodes bis zu 300. Dies sind Quad-/Objektzahlen, keine Draw-Call- oder FPS-Zusagen. Blendmode-, Container- und Glow-Grenzen können Batches teilen. Kleine Sonderfüllungen können zusätzliche X-Fragmente benötigen.
- **Visuelles Risiko:** Additive Überlagerung kann zu hell wirken; Gewichte werden lokal angepasst. Fünf Bänder können sichtbare Stufen hinterlassen. Beides benötigt die spätere Abnahme bei tatsächlicher Anzeigegröße.
- **Lifecycle-Risiko:** Quality-Rebuilds und Parent-Destroy können dieselben Ressourcen über mehrere Pfade erreichen. Tests müssen balancierten Besitz und idempotentes Stop/Destroy schützen, nicht nur den Happy Path.
- **Geltungsbereich:** Gameplay, Progression, Netzwerk und die vorhandenen anderen Arbeitskopieänderungen werden durch dieses Vorhaben nicht geändert. Das aktuelle Boot-Rendering hinter dem DOM-Ladescreen bleibt erhalten; die neue Aktivitätssteuerung folgt den UI-Ownern und führt keine DOM-Verdeckungsanalyse ein.

## 5. Vorabprüfung für den Plan

- Konzept vollständig gelesen; Referenzcommit gegen aktuellen Arbeitsstand in den betroffenen Dateien verglichen.
- Sämtliche `new LivingBarEffect`-Aufrufstellen gesucht; Konstruktion, Sichtbarkeit, Quality und Teardown in den relevanten Ownern abgeglichen.
- Phaser-4.2.1-Implementierung von Crop und Shader-Texture-Initialisierung lokal geprüft.
- `npm test -- tests/LivingFieldTexture.test.ts tests/LivingBarEffectQuality.test.ts`: **2 Dateien, 11 Tests bestanden**. Die bisherigen Tests schützen Grundpfad und Quality, aber noch nicht die hier geplanten neuen Verträge.
- Keine Laufzeitimplementierung geändert. Kein Build, Dev-Server oder Browser für diesen Plan gestartet; visuelle Aussagen sind konzeptuelle Abnahmekriterien, keine bereits bestätigten Ergebnisse.

## 6. Umsetzungsstand vom 12.09.2026

Die Implementierung erfolgte auf Basis von `e21ebfb2` und umfasst die Phasen 1–5 sowie die automatisierte Prüfung aus Phase 6.

- Shared-Field-Besitz und Aktivität sind getrennt. Stop pausiert die Shader-Updates; residente Images behalten ihre Texture. Quality-Wechsel, letzter Release und Shutdown sind abgesichert.
- Compact-Samples verwenden stabile Consumer-Schlüssel und gewichtete Alpha-Werte. [livingClipGeometry.ts](../../src/effects/living/livingClipGeometry.ts) begrenzt das Feld durch konservative Bänder der vollständigen Rundform. Sehr flache Füllungen behalten X-Tiling und gültige Source-Crops.
- Die Lobby-Buttons besitzen den internen Effect-Layer und teilen die tatsächliche Flächengeometrie mit dem Texture-Helper. Ihre Aktivität folgt auch bei identischen Snapshots der Sichtbarkeit des Coop-Bands.
- Upgrade-Nodes, Farb-Picker, Options-Slider und untere CenterHUD-Balken sind an ihre Owner-Sichtbarkeit gebunden. Versteckte Konstruktion und Refresh starten keine Living-Animation.
- Ergänzend werden laufende Sichtbarkeits-Tweens in Options und Upgrades beim Richtungswechsel abgebrochen. Ein alter Fade kann dadurch ein neu geöffnetes Overlay nicht nachträglich verstecken.
- Die ursprüngliche Einfügeposition des Felds bleibt auch nach `low → high` erhalten. Der Effekt merkt sich die vor ihm liegenden Objekte und fügt neue Images hinter dem letzten noch vorhandenen Vorgänger ein. Das schützt Icons, Texte und Rahmen auch bei anfänglich niedriger Qualität.
- Shaderrezept, Texture-Auflösung, 20/30-Hz-Kadenz, normale Bar-Kalibrierung und PlayerStatusRing sind unverändert.

**Abschließende Prüfung:**

- `npm run check`: **391 Core-Testdateien / 3.457 Tests**, **6 Architecture-Testdateien / 33 Tests** und TypeScript-/Vite-Produktionsbuild erfolgreich.
- [LivingBarConsumers.test.ts](../../tests/integration/LivingBarConsumers.test.ts): **7 Integrationstests erfolgreich**. Der vorherige Integration-Suite-Lauf bestand außerdem mit allen 422 Tests der 45 bestehenden Dateien; die neue Datei wurde nach Fertigstellung gezielt geprüft.
- Die fokussierten Core-Dateien enthalten zusammen **27 Tests** für Texture-Lifecycle, Sampling, Quality, Schichtung und reine Clip-Geometrie.
- Diff-Whitespace und Dokumentverweise geprüft. Kein Dev-Server oder Browser gestartet.

**Offen:** Die visuelle Abnahme aus Phase 6, insbesondere wahrgenommene Bewegungsdichte und Sichtbarkeit der Bandstufen bei tatsächlicher Anzeigegröße. Dafür ist weiterhin ein ausdrücklicher Auftrag zur Sichtprüfung erforderlich.

Knowledge writeback: No durable project knowledge discovered.
