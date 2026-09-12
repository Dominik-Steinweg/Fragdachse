# LivingBar GPU Visual-Fidelity & Lifecycle Fix
## Technisches Konzept für Coding-KI

**Projekt:** Fragdachse  
**Repository:** `Dominik-Steinweg/Fragdachse`  
**Geprüfter Stand:** `main` @ `6dcfb63edd7fdd682ee8804767bf1c30cbabbc8b`  
**Status:** Umsetzungsgrundlage, noch keine Implementierung

---

## 1. Auftrag

Die GPU-basierte LivingBar-Architektur bleibt bestehen. Die frühere ParticleEmitter-Implementierung wird **nicht** wieder eingeführt.

Ziele:

1. die verlorene organische Animation kleiner Upgrade-Nodes und Farb-Swatches wiederherstellen,
2. den Layering-Fehler der Lobby-Buttons `UPGRADES` / `ITEMS` beseitigen,
3. harte rechteckige GPU-Kanten an abgerundeten Flächen verhindern,
4. die leichte optische Überstrahlung des alten Effekts weiterhin über einen konturgebundenen Glow vermitteln,
5. den Shared-Shader nur rendern, wenn mindestens ein sichtbarer LivingBar-Consumer tatsächlich Animation benötigt,
6. bestehende klassische Balkenoptik und den `PlayerStatusRing` nicht regressieren.

---

## 2. Verifizierter Ist-Zustand

### 2.1 GPU-Grundarchitektur ist richtig und bleibt unverändert

`src/effects/living/LivingFieldTexture.ts` rendert genau ein prozedurales Blob-Feld pro Scene in eine gemeinsame `1024x128`-Textur. `LivingBarEffect` zeigt daraus nur getintete, gecroppte `Image`-Fenster.

Das ist der gewünschte Performancepfad: zusätzliche Consumer kosten einfache Textur-Quads statt eigener ParticleEmitter.

`src/effects/living/livingFieldShader.ts` bildet weiterhin zwei Blob-Schichten ab:

- Core-Feld: 32er Zellen
- Outer-Feld: 64er Zellen

Die Shader-Zeit läuft korrekt weiter. Die fehlende Node-Animation ist **kein** `uTime`-/Shader-Stillstand.

### 2.2 Die frühere Implementierung war bei kleinen Flächen strukturell dichter

Vor dem GPU-Rework erzeugte jede `LivingBarEffect`-Instanz zwei unabhängige Emitter. Spawnfrequenz und Partikelzahl waren praktisch unabhängig von der Fläche des Consumers.

Dadurch hatten auch kleine 32x32- oder 44x44-Flächen viele gleichzeitig überlappende, weiche Blobs.

Die neue Hash-Grid-Lösung koppelt die Zahl sichtbarer Strukturen dagegen an den gezeigten räumlichen Ausschnitt. Für normale Balken funktioniert das; bei kleinen quadratischen Consumern ist das Feld visuell zu dünn.

**Folgerung:** Nicht den globalen Shader dichter oder heller machen. Die Korrektur gehört in das Sampling kleiner Consumer.

### 2.3 Upgrade-Nodes haben korrektes Z-Ordering, aber falsche Sampling-Dichte

`src/ui/CoopDefenseUpgradesOverlay.ts`:

- Node: `48x48`
- innere Füllfläche: `44x44`
- innerer Rundungsradius: `10`
- statische Aktivfüllung: Alpha `0.62`
- Living-Effekt: `intensity: 0.32`
- Icon: `32x32`

Reihenfolge ist bereits korrekt:

`baseRect -> activeFill -> LivingBarEffect -> icon/text`

Der sichtbare Fehler ist daher nicht das Lobby-Layering, sondern primär die zu geringe Living-Strukturdichte auf der kleinen Fläche.

### 2.4 Wichtig: Node-Clip und aktuelle Fill-Höhe sind zwei verschiedene Geometrien

Die Node-Füllung ist eine **vollständige 44x44 Rounded-Rect-Textur**, die anschließend von unten auf `fillHeight` gecroppt wird.

Ein künftiger Rounded-Clip darf daher **nicht** einfach den aktuellen `fillHeight`-Rechteckbereich mit eigenen gerundeten Ecken versehen.

Korrekt ist:

> sichtbare Living-Fläche = aktuelles Fill-Rechteck ∩ vollständige 44x44 Rounded-Rect

Beispiel für einen halb gefüllten Node:

- obere Fill-Kante bleibt in der Mitte der Node vollständig gerade,
- nur die unteren Node-Ecken werden gerundet.

Diese Trennung ist ein harter Implementierungsvertrag.

### 2.5 Lobby-Buttons besitzen zusätzlich einen echten Layering-Fehler

`UiButton` besteht aktuell intern aus:

`background -> icon -> label`

Der Living-Effekt von `LobbyOverlay` wird jedoch außerhalb des Buttons direkt in `coopBand` eingefügt. Danach wird mit

`bringToTop(this.coopUpgradesBtn.getRoot())`

der **gesamte** Button über den Effekt gehoben.

Der Kommentar behauptet „Effekt über Fläche, aber unter Beschriftung“, die tatsächliche Struktur ist aber:

`LivingBarEffect -> kompletter UiButton`

Dadurch wird fast die gesamte Animation vom nahezu opaken Button verdeckt. Nur an transparenten Rounded-Corners kann das rechteckige Feld besonders auffällig durchscheinen.

### 2.6 Der heutige rechteckige Crop kann Rounded-Corners nicht abbilden

`LivingBarEffect.applyCrop()` verwendet ausschließlich `Image.setCrop(...)`.

Phaser-Crop ist rechteckig. Es gibt deshalb ohne zusätzliche Geometriebehandlung keine abgerundete Begrenzung.

### 2.7 Das alte „Über-die-Kante-Gehen“ war kein Rounded-Mask-Verhalten

Beim alten Effekt lagen die **Partikelzentren** innerhalb der Fill-Fläche. Die großen, weichen `_living_blob`-Sprites durften mit ihren transparenten Rändern darüber hinausreichen.

Zusätzlich lag auf aktiven Nodes ein separater `ExternalGlow`, der der abgerundeten Node-Kontur folgte.

Die GPU-Version soll diese **optische Wirkung** erhalten, aber nicht versuchen, unmaskierte rechteckige Shaderfenster über die Fläche hinaus zu legen.

Zieltrennung:

- Living-Feld: geometrisch sauber innerhalb der Consumer-Form
- Außenwirkung: weicher konturgebundener Glow

### 2.8 Zusätzlicher verifizierter Lifecycle-Fehler

`LivingFieldTexture` kennt aktuell nur `consumers`.

Solange mindestens ein `LivingBarEffect` die Textur retained, rendert der Shared-Shader weiter – auch wenn alle Tiles durch `stop()` unsichtbar sind.

Darüber hinaus existieren mehrere versteckte Consumer, die aktuell gar nicht gestoppt werden:

- `OptionsOverlay`: Slider-Effekte werden beim Build erzeugt, obwohl der Container unsichtbar ist; `hide()` stoppt sie nicht.
- `LeftSidePanel`: Farb-Swatch-Effekte werden für den zunächst versteckten Picker erzeugt; das Schließen des Pickers stoppt die sichtbaren Swatch-Effekte nicht.
- `CoopDefenseUpgradesOverlay`: `build()` ruft bei unsichtbarem Container `refresh()` auf und kann dabei aktive Node-Effekte erzeugen; auch der XP-Effekt entsteht zunächst aktiv.
- `MatchResultsOverlay` macht es bereits korrekt und stoppt seinen XP-Effekt direkt nach dem Build.
- `ArenaHUD` besitzt bereits eine eigene Presentation-Aktivierung und ist kein Ziel für eine strukturelle Änderung.

---

## 3. Harte Architekturentscheidungen

### A. Keine Rückkehr zu ParticleEmittern

`LivingBarEffect` darf weiterhin **keine** ParticleEmitter erzeugen.

### B. Kein zusätzlicher Shader pro Node / Button / Swatch

Es bleibt bei **einer `LivingFieldTexture` pro Scene**.

### C. `livingFieldShader.ts` zunächst nicht verändern

Keine Änderung von:

- Cell-Größen
- Blob-Durchmessern
- globalem `FIELD_GAIN`
- Lebensdauern
- Drift

Eine globale Shaderänderung würde alle normalen Balken beeinflussen und das Problem an der falschen Stelle lösen.

### D. Compact-Sampling wird Consumer-seitig gelöst

Kleine quadratische Flächen zeigen mehrere unterschiedliche Ausschnitte derselben Shared Texture.

### E. Keine Geometry-/Filter-Mask pro Upgrade-Node

Die Rounded-Geometrie wird mit einfachen rechteckigen Sample-Bändern approximiert. Damit bleiben die Living-Teile normale, batchbare Images und benötigen keinen Stencil-/Filterpfad pro Node.

### F. Außenwirkung kommt vom bestehenden Glow

Kein unkontrollierter rechteckiger Overscan des Living-Felds. Die weiche Wirkung außerhalb des Nodes/Button kommt über den vorhandenen konturgebundenen Glow.

---

## 4. Ziel-API von `LivingBarEffect`

`src/ui/LivingBarEffect.ts`

Die vorhandenen Optionen werden erweitert, ohne bestehende Aufrufer zu brechen.

Empfohlene Form:

```ts
export type LivingBarSampling = 'bar' | 'compact';

export interface LivingBarRoundedClip {
  kind: 'roundedRect';
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface LivingBarEffectOpts {
  glowTarget?: Phaser.GameObjects.Image;
  scrollFactor?: number;
  intensity?: number;

  /** Default: 'bar'. */
  sampling?: LivingBarSampling;

  /**
   * Shape in denselben lokalen Container-Koordinaten wie x/y des Effekts.
   * Die Shape ist bewusst unabhängig vom aktuellen Effect-/Fill-Rechteck.
   */
  clipShape?: LivingBarRoundedClip;

  /** Default true, für bereits sichtbare bestehende Consumer. */
  startActive?: boolean;
}
```

Keine Consumer-spezifischen Sonderfälle über Dateinamen oder Größenheuristiken in `LivingBarEffect` einbauen. Der Aufrufer wählt den Modus explizit.

---

## 5. Sampling-Modi

### 5.1 `bar` – bestehender Pfad

Default und nahezu unverändert für:

- ArenaHUD
- CenterHUD
- AimSystem
- XP-Balken
- Options-Slider
- Lobby-Fortschrittsbalken
- MatchResults-XP

Eigenschaften:

- ein Feld-Sample
- bestehende Höhenkalibrierung
- bestehendes X-Tiling für breite Balken
- bestehende `setFilledWidth()`-Semantik

Keine visuelle Rekalibrierung im Rahmen dieses Fixes.

### 5.2 `compact` – kleine Flächen

Verwendung:

- aktive Upgrade-Nodes
- Farb-Swatches im Lobby-Picker

Initiale Zielkonfiguration:

- **3 Samples** derselben `LivingFieldTexture`
- gleiche `imageScale` wie bisher; Blobgröße wird also nicht global verändert
- pro Sample stabiler, unterschiedlicher Source-X-/Source-Y-Offset
- Offsets deterministisch aus Geometrie/Farbe + Sample-Index ableiten
- keine Random-Werte pro Frame und keine CPU-Animation

Wichtig: Bei Compact-Flächen ist die benötigte Source-Breite klein gegenüber 1024 px. Daher können die drei Samples ohne Wrap-Komplexität aus weit auseinanderliegenden X-Bereichen der bestehenden Texture genommen werden.

Die Sample-Gewichte in **einer** lokalen Konstante halten, z. B.:

```ts
const COMPACT_SAMPLE_WEIGHTS = [1.0, 0.75, 0.55] as const;
```

Diese Werte sind Kalibrierwerte, kein Architekturvertrag. Sie dürfen nach manueller Sichtprüfung angepasst werden.

**Nicht** `FIELD_GAIN` erhöhen.

---

## 6. Interne Tile-Struktur anpassen

Die aktuelle Speicherung als

```ts
private tiles: Phaser.GameObjects.Image[] = [];
```

reicht nach Compact-Sampling und Clip-Bändern nicht mehr aus.

Auf eine interne Struktur umstellen, z. B.:

```ts
interface LivingFieldTile {
  image: Phaser.GameObjects.Image;
  sampleWeight: number;
  sampleIndex: number;
  // weitere statische Crop-/Band-Metadaten nach Bedarf
}
```

Grund:

`applyEnergyVisuals()` setzt heute auf jedem Tile direkt dieselbe Alpha und würde sonst Sample-Gewichte überschreiben.

Neue Regel:

```ts
tile.image.setAlpha(baseAlpha * tile.sampleWeight);
```

Alle Pfade (`hide`, `destroy`, Quality-Wechsel, Energy-Intensity) müssen mit derselben Tile-Metastruktur arbeiten.

---

## 7. Rounded-Clip ohne Mask-Renderpass

### 7.1 Prinzip

Ein Rounded Rectangle wird für den Living-Effekt in wenige horizontale Rechteckbänder zerlegt.

Empfohlen: **5 Bänder**:

1. äußerer oberer Corner-Bereich
2. innerer oberer Corner-Bereich
3. voller Mittelbereich
4. innerer unterer Corner-Bereich
5. äußerer unterer Corner-Bereich

Für jedes Band wird ein konservativer X-Inset aus dem Radius bestimmt.

Es entstehen nur normale Images/Crops derselben Living-Texture.

### 7.2 Geometrische Quelle

Pure Helper-Funktion vorsehen, z. B.:

```ts
interface ClipBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildRoundedRectClipBands(
  shape: LivingBarRoundedClip,
  effectRect: Phaser.Geom.Rectangle,
): ClipBand[]
```

Die Funktion bildet:

```text
rounded shape ∩ effectRect
```

ab.

Sie darf keine Phaser-GameObjects erzeugen und muss separat unit-testbar sein.

### 7.3 Teilgefüllte Upgrade-Nodes

Für Node-Level-Füllung muss `clipShape` immer die vollständige Innenform sein:

```ts
{
  kind: 'roundedRect',
  x: -innerW / 2,
  y: -innerH / 2,
  width: innerW,
  height: innerH,
  radius: NODE_TEX_RADIUS - NODE_INNER_PADDING, // 10
}
```

Der eigentliche Living-Effekt bleibt:

```ts
x = -innerW / 2
y = fillTopY
w = innerW
h = fillHeight
```

Dadurch wird automatisch die korrekte Schnittmenge erzeugt.

**Nicht** `radius: 10` auf ein `44 x fillHeight` Rounded Rectangle anwenden.

---

## 8. Shared-Field-Lifecycle

`src/effects/living/LivingFieldTexture.ts`

Zwei Zustände getrennt verwalten:

```ts
private consumers = 0;       // besitzt Texture/Images
private activeConsumers = 0; // benötigt animierte neue Frames
```

Neue Methoden, Namen dürfen äquivalent sein:

```ts
retain(): void
release(): void
activate(): void
deactivate(): void
```

### Regeln

- `retain()`:
  - erhöht `consumers`
  - erzeugt beim ersten residenten Consumer Shader/Texture
- `release()`:
  - reduziert `consumers`
  - bei `0` Shader + Texture vollständig freigeben
- `activate()`:
  - erhöht `activeConsumers`
  - bei Übergang `0 -> 1`: `nextRenderAt = 0`, damit zeitnah ein frischer Frame entsteht
- `deactivate()`:
  - reduziert `activeConsumers`, nie unter `0`
- `update()` rendert nur wenn:

```ts
shader !== null
&& consumers > 0
&& activeConsumers > 0
```

### Wichtig

Bei `activeConsumers === 0`, aber `consumers > 0`:

- Shader/RenderTexture **nicht zerstören**
- nur den Renderloop pausieren

Bestehende Phaser-Images halten Frames dieser Textur. Ein Entfernen der Texture bei bloßer Inaktivität würde residente Consumer invalidieren.

---

## 9. `LivingBarEffect`-Aktivitätszustand

Jede Effektinstanz meldet sich höchstens **einmal** als aktiver Shared-Field-Consumer an – unabhängig von Zahl der Sample-Layer oder Clip-Bänder.

Interner Zustand, z. B.:

```ts
private fieldActive = false;
```

Eine zentrale Methode synchronisiert:

```ts
shouldBeActive =
  enabled
  && active
  && filledWidth > 4
  && tiles.length > 0;
```

Bei Zustandswechsel:

- `false -> true`: `field.activate()`
- `true -> false`: `field.deactivate()`

Diese Synchronisation muss aufgerufen werden nach:

- Konstruktion
- `start()`
- `stop()`
- `setFilledWidth()`
- Quality-Wechsel
- Tile-Erzeugung
- Tile-Zerstörung
- `destroy()`

`destroyTiles()` muss zuerst ggf. deaktivieren und danach `release()` durchführen.

---

## 10. `UiButton`: echter Effect-Layer

`src/ui/UiButton.ts`

Interne Reihenfolge ändern zu:

```text
root
├─ background
├─ effectLayer
├─ icon
├─ label
└─ badge
```

Neue API:

```ts
getEffectLayer(): Phaser.GameObjects.Container
```

Der Layer liegt lokal auf `(0, 0)` im Button-Root und skaliert deshalb automatisch mit Hover-/Press-Animationen des Buttons.

`badge` bleibt wie heute zuletzt hinzugefügt und damit über dem Effect-Layer.

Keine LivingBar-Abhängigkeit in `UiButton` einbauen. `UiButton` stellt nur den Layer bereit.

---

## 11. Consumer-Anpassungen

### 11.1 `src/scenes/LobbyOverlay.ts`

Für `UPGRADES` und `ITEMS`:

- Effekt in `button.getEffectLayer()` erzeugen
- lokale Koordinaten:

```ts
x = -COOP_BTN_W / 2
y = -COOP_BTN_H / 2
```

- `clipShape` = vollständiger Button mit Radius `RADIUS.md` (= 12), sofern kein eigener Button-Radius gesetzt wird
- Sampling: `bar`
- bestehende Intensität `0.34` zunächst beibehalten
- `glowTarget` bleibt `button.getBackground()`
- `startActive: false`
- die beiden `bringToTop(button.getRoot())`-Workarounds vollständig entfernen

Zielreihenfolge:

```text
button background
living field
icon / label / badge
```

Der konturgebundene `glowTarget` darf weiterhin weich außerhalb des Buttons wirken.

### 11.2 `src/ui/CoopDefenseUpgradesOverlay.ts`

#### XP-Bar

- Sampling `bar`
- `startActive: false`
- `show()` startet, `hide()` stoppt weiterhin

#### Upgrade-Nodes

Für nicht-statische aktive Nodes:

```ts
sampling: 'compact'
clipShape: full 44x44 inner rounded rect
startActive: this.visible
```

Bestehende statische `activeFill` und bestehender Node-Glow bleiben erhalten.

Der separate Node-Glow ist weiterhin für die weiche Außenwirkung zuständig.

Keine Änderung an Base-Unlocks: sie bleiben absichtlich ohne Living-Effekt.

### 11.3 `src/ui/LeftSidePanel.ts`

Farb-Swatches:

- `sampling: 'compact'`
- keine Rounded-Clip-Shape nötig; die Swatches sind aktuell quadratisch
- `startActive: false`

`refreshPickerSwatches()` muss zusätzlich `pickerOpen` berücksichtigen:

```ts
if (this.pickerOpen && visible) effect.start();
else effect.stop();
```

`closeColorPicker()` muss dadurch zuverlässig alle Swatch-Effekte inaktiv machen.

### 11.4 `src/ui/OptionsOverlay.ts`

Slider bleiben Sampling `bar`.

Beim Build:

```ts
startActive: false
```

In `show()` alle Slider-Effekte starten.

In `hide()` alle Slider-Effekte stoppen.

`setFilledWidth()` darf im gestoppten Zustand weiterhin den gespeicherten Fill-Wert aktualisieren; beim nächsten `start()` erscheint sofort der korrekte Zustand.

### 11.5 Bereits korrekte / nicht strukturell zu ändernde Consumer

Nur Regression prüfen:

- `ArenaHUD`
- `CenterHUD`
- `AimSystem`
- `MatchResultsOverlay`
- Lobby-Coop-XP-Bar
- normale Upgrade-XP-Bar

`PlayerStatusRing` nicht anfassen.

---

## 12. Tests

### 12.1 `tests/LivingFieldTexture.test.ts`

Erweitern:

1. mehrere residente Consumer erzeugen weiterhin nur einen Shader,
2. `activeConsumers === 0` -> Ticks rendern keine neuen Shaderframes,
3. Aktivierung `0 -> 1` -> nächster Tick rendert wieder,
4. Deaktivierung zerstört Shader/Texture **nicht**, solange residente Consumer existieren,
5. letzter `release()` zerstört weiterhin korrekt,
6. High/Medium-Auflösung bleibt unverändert `1024x128`.

### 12.2 `tests/LivingBarEffectQuality.test.ts`

Fake-Images um Crop-/Positions-/Alpha-Metadaten erweitern.

Prüfen:

1. Default-`bar` behält bisherigen Ein-Sample-Pfad,
2. breiter Balken behält bestehendes Tiling-Verhalten,
3. `compact` erzeugt mehrere Sample-Layer, aber **keinen** ParticleEmitter,
4. Sample-Layer verwenden unterschiedliche stabile Source-Offets,
5. Sample-Gewichte bleiben nach `setEnergyIntensity()` erhalten,
6. `startActive: false` meldet den Effekt nicht als aktiv,
7. `start()/stop()/setFilledWidth()` halten Active-State korrekt synchron,
8. `low` bleibt vollständig inert.

### 12.3 Pure Geometrie-Tests für Rounded-Clip

Neue Tests für `buildRoundedRectClipBands()`:

- Full 44x44 / r10 bleibt vollständig innerhalb der Rounded-Rect-Approximation.
- Halb gefüllter Node besitzt am Fill-Start in der Mitte volle Breite; nur die unteren Corner-Bänder sind eingerückt.
- Sehr kleine Fill-Höhen erzeugen keine negativen/ungültigen Crop-Rechtecke.
- Button 190x44 / r12 erzeugt keine Rechteckfläche in den transparenten Eckbereichen.
- Radius wird auf halbe Breite/Höhe begrenzt.

### 12.4 Consumer-Wiring

Mindestens leichte Regressionstests für:

- `LobbyOverlay` verwendet `getEffectLayer()` und enthält keine `bringToTop(...getRoot())`-Korrektur mehr.
- `CoopDefenseUpgradesOverlay` nutzt `sampling: 'compact'` + vollständige Node-Clip-Shape.
- `OptionsOverlay.hide()` stoppt Slider-Effekte.
- geschlossener Farb-Picker stoppt Swatch-Effekte.

Wenn direkte UI-Unit-Tests im bestehenden Test-Harness unverhältnismäßig teuer sind, sind hierfür Source-Contract-Tests akzeptabel; Kernlogik (`LivingFieldTexture`, Sampling, Clip-Bands) muss dagegen als Verhaltenstest abgedeckt sein.

---

## 13. Performance-Guardrails

Die Umsetzung ist nur akzeptabel, wenn alle folgenden Bedingungen erhalten bleiben:

- keine neuen `ParticleEmitter` in `LivingBarEffect`
- kein Shader pro Node/Button/Swatch
- keine DynamicTexture pro Node
- keine Geometry-/Filter-Mask pro Node
- keine per-frame CPU-Positionsanimation der Compact-Samples
- keine Änderung der Shared-Texture-Auflösung
- keine Erhöhung der globalen Shader-Renderfrequenz
- keine globale Erhöhung von `FIELD_GAIN`
- Sample-Offets werden einmalig/deterministisch berechnet
- Clip-Bänder sind statische GameObject-Geometrie; pro Frame wird nur das normale Phaser-Rendering ausgeführt
- der Shared-Field-Renderloop pausiert, wenn kein aktiver Consumer existiert

Bei ca. 20 aktiven Upgrade-Nodes sind mehrere kleine, batchbare Living-Quads ausdrücklich zulässig. Das ist weiterhin fundamental günstiger als die frühere Architektur mit zwei Emittern und vielen CPU-simulierten Partikeln pro Node.

---

## 14. Visuelle Abnahmekriterien

### Upgrade-Nodes

- aktive, nicht-statische Nodes zeigen wieder klar erkennbare langsame Blob-Bewegung,
- Animation ist auch bei `intensity: 0.32` wahrnehmbar,
- unterschiedliche Nodes zeigen nicht erkennbar exakt denselben Ausschnitt,
- statische Level-Füllung bleibt erhalten,
- Icon/Leveltext liegen über dem Living-Effekt,
- keine harten rechteckigen Ecken,
- der Außen-Glow darf weich über die Node-Kontur hinausgehen,
- Base-Unlocks bleiben ruhig.

### Lobby

- `UPGRADES` / `ITEMS` animieren sichtbar auf der Buttonfläche,
- Text/Icon/Badge bleiben klar darüber,
- kein rechteckiges Flackern an Rounded-Corners,
- Glow darf weich außerhalb der Button-Kontur liegen.

### Andere Consumer

- normale HUD-/XP-/Adrenalin-/Charge-Balken sehen gegenüber vorher nicht erkennbar anders aus,
- `PlayerStatusRing` unverändert,
- Quality `low`: Living-Effekt weiterhin aus,
- Quality `medium/high`: bestehende 20/30-Hz-Logik erhalten.

---

## 15. Nicht-Ziele

Nicht Bestandteil dieses Fixes:

- allgemeiner Shader-Art-Style-Rework
- neue Farben oder neue UI-Designsprache
- Änderung des PlayerStatusRing
- Änderung der Upgrade-Progressionslogik
- Umbau des SharedGlowSystem
- erneute Performanceoptimierung anderer Partikelsysteme
- exakte physikalische Rekonstruktion jedes alten Partikel-Blobs außerhalb der Node

Ziel ist visuelle Parität im Eindruck, nicht die Wiederherstellung der alten CPU-Simulation.

---

## 16. Empfohlene Umsetzungsreihenfolge

1. `LivingFieldTexture`: resident/active Lifecycle trennen + Tests.
2. `LivingBarEffect`: `startActive`, Tile-Metadaten, `compact` Sampling + Tests.
3. Pure Rounded-Clip-Band-Geometrie + Tests.
4. `UiButton`: Effect-Layer.
5. Lobby-Buttons auf internen Effect-Layer umstellen.
6. Upgrade-Nodes auf `compact` + vollständige Clip-Shape umstellen.
7. Farb-Swatches und Options-Slider korrekt an Sichtbarkeit koppeln.
8. komplette Test-Suite, Typecheck und Build ausführen.
9. abschließende manuelle Sichtprüfung der Abnahmeszenarien.

---

## 17. Definition of Done

Die Änderung ist fertig, wenn:

- `npm test` erfolgreich ist,
- `npm run build` erfolgreich ist,
- keine ParticleEmitter in `LivingBarEffect` zurückgekehrt sind,
- `LivingFieldTexture` bei null aktiven Consumern keine neuen Frames rendert,
- normale Balken nicht regressieren,
- aktive Upgrade-Nodes wieder sichtbar leben,
- Lobby-Buttons korrekt geschichtet sind,
- keine harten rechteckigen GPU-Kanten an Rounded-Flächen sichtbar sind,
- die Außenwirkung weiterhin weich über konturgebundenen Glow erfolgt.
