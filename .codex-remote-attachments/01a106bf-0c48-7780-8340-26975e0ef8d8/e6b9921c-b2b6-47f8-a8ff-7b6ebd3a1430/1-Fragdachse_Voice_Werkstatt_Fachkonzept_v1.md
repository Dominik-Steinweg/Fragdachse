# Fragdachse – Voice-Werkstatt
## Fachkonzept für persönliche Spielerstimmen und ereignisgesteuerte Sprachpakete

**Version:** 1.0 – fachlicher Entwurf  
**Stand:** 4. Oktober 2026  
**Ziel:** Entscheidungs- und Umsetzungsgrundlage; noch keine Implementierung  
**Geprüftes Repository:** `Dominik-Steinweg/Fragdachse`, Branch `main`  
**Geprüfter Stand:** `b1e3c698f160c62cc3d10847ac1f09648b8a1458`

> Spieler erhalten eine persönliche Stimme für kurze, passende Reaktionen ihres Dachses. Eine eigenständige Voice-Werkstatt übernimmt Aufnahme, Sprachgenerierung, Prüfung und Paketfreigabe. Das Spiel verwendet ausschließlich fertig erzeugte Audiodateien und eine kleine, hostgesteuerte Auswahl- und Abspiellogik.

---

## 1. Entscheidungsübersicht

Die Voice-Werkstatt wird eine **eigene Anwendung mit eigener Oberfläche, eigenem Start und eigenem Arbeitsbereich**. Sie ist weder ein zusätzlicher Reiter des Audio-Studios noch ein Produktionseditor innerhalb des Spiels. Ein eigener Repository-Pfad wie `tools/voice-workshop/` ist dafür der vorgeschlagene organisatorische Ort, nicht eine bereits vorhandene Komponente.

VoxCPM2 in der bestehenden lokalen ComfyUI-Installation bleibt der vorgesehene Generator. Nur der Produktionsrechner benötigt Modellgewichte und geeignete Hardware. Das Spiel und die übrigen Spieler benötigen weder Python noch ComfyUI noch ein Sprachmodell.

Vier Dinge werden fachlich getrennt: **Stimmprofil**, **Satzkatalog**, **Generierungskandidat** und **freigegebenes Sprachpaket**. Dadurch lassen sich dieselben Texte mit unterschiedlichen Stimmen produzieren, schlechte Takes ersetzen und bereits verwendete Pakete unverändert weiterverwenden.

Die ursprünglichen Ereignisse bleiben Bestandteil des Konzepts: Ready, Deathmatch-Kill mit der Stimme des Killers, Führungswechsel, Ultimate beziehungsweise ausdrücklich geeignete Spezialaktion, außergewöhnlicher Schadens-Burst und Rundenende/Sieg. Der Burst bewertet ausgeteilten Schaden relativ zur aktuellen normalen Leistung; er ist keine Killserie und keine Schmerzreaktion.

Die Umsetzung erfolgt in drei klar getrennten Ausbaustufen: zuerst lokale Produktion und vorbereitete Pakete, danach automatische Verteilung fertiger Pakete in der Lobby und erst anschließend Aufnahme und Bedienung von den Client-Rechnern aus. Die Aufnahme bleibt auch dann eine separate Oberfläche.

## 2. Quellenlage und Aussagegrenzen

### 2.1 Frühere Konzeptideen

Aus dem vorherigen Gespräch wurden diese beiden Dateinamen wiedergefunden:

- `fragdachs_lan_voice_konzept.md`
- `fragdachs_zusaetzliche_ideen.md`

**Die vollständigen Originaldateien aus der Bibliothek konnten in dieser Sitzung nicht abgerufen werden. Ein vollständiger, dateigenauer Abgleich wird daher nicht behauptet.** Verwendet wurden die wiedergefundenen Gesprächsabsprachen und direkt gelesene Repository-Dateien. Der abschließende Abgleich mit den beiden Originaldateien bleibt ein Quellenprüfpunkt; die nachstehenden neuen Festlegungen sind als Konzeptentscheidungen zu verstehen.

Aus den früheren Absprachen werden insbesondere erhalten: eigenständiges Extra-Tool, zentrale Vorabgenerierung, einfache Browseraufnahme, natürlicher neutraler Referenzsatz von ungefähr 10–20 Sekunden, emotionale Gestaltung je Satz, schlanke Spielclients und später die Verteilung fertiger Pakete. Andere zusätzliche Spielideen wie Umweltobjekte, Nebel oder Bossinszenierungen gehören nicht zum Umfang dieses Voice-Konzepts.

### 2.2 Was am Repository tatsächlich geprüft wurde

| Bereich | Feststellung am geprüften Stand | Konsequenz für das Konzept |
|---|---|---|
| Audio-Studio | Eigenständiges lokales Unterprojekt mit Katalog, Generierung, Bearbeitung und ausdrücklicher Übernahmefreigabe. [R1] | Bewährte Produktionsprinzipien übernehmen, nicht die Oberfläche und den kompletten Katalog. |
| Studio-Zugriff | `server.py` akzeptiert nur Loopback-Hosts, prüft Origin und Sitzungstoken und lehnt fremde Zugriffe ab. [R2] | Keinen LAN-Zugang durch Abschalten der bisherigen Schutzmaßnahmen schaffen. |
| Generatoren | Der vorhandene Generatorvertrag ist auf Prompt, Dauer, Seed und Parameter ausgerichtet; die konkreten Provider bedienen Stable Audio beziehungsweise ComfyUI. [R3] | Voice benötigt einen eigenen fachlichen Auftrag mit Referenzaufnahme, Zieltext und Sprechstil. |
| Spielaudio | `GameAudioSystem` bündelt Musik und SFX, räumliche und lokale Wiedergabe sowie Audio-Unlock und One-Shot-Begrenzung. Ein eigener Sprachkanal ist im gelesenen Abschnitt nicht vorhanden; `oneShotVoices` bezeichnet Abspielinstanzen, nicht persönliche Stimmprofile. [R4] | Audioausgabe an bestehende Infrastruktur anschließen, aber Sprachregeln separat halten. |
| Spielerprofil | `PlayerProfile` enthält ID, Name, Farbe und optional Team; keine Stimmprofil-Zuordnung. [R5] | Eine neue, optionale Präsentationszuordnung ist erforderlich. |
| Kampfereignisse | `WorldCombatGameplayBinding` definiert Kill-Informationen und Schnittstellen für Spieler-Schadensstatistik; die Arena-Komposition bindet diese an die Netzwerkbrücke. [R6, R7] | Fachliche Ereignisse an bestehenden autoritativen Grenzen beobachten, nicht aus Animationen oder UI-Texten ableiten. |
| Netzwerk | `PeerLink` hat zuverlässigen und schnellen Kanal, Größenbehandlung, Paketassembler und Sendewarteschlangen. Das Protokoll definiert Handshake, Zustandsübertragung und RPC. [R8, R9] | Kleine Voice-Ereignisse lassen sich dort anbinden. Ein vollständiger Sprachpakettransfer ist dadurch noch nicht vorhanden. |
| Laden | `DeferredAssets` unterscheidet optionale Assets und prüft den tatsächlich gefüllten Audiocache. [R10] | Sprachdateien optional und vor ihrer Nutzung laden; Voice darf den Spieleinstieg nicht blockieren. |
| Asset-Veröffentlichung | Der Studio-Export ist auf bestehende SFX-/Musikziele und `SHIPPED_AUDIO_FILES` zugeschnitten. [R1, R11] | Persönliche Sprachpakete nicht still in diesen Export und nicht automatisch in ein öffentliches Deployment einbauen. |

Die Prüfung war eine gezielte Quellcode- und Dokumentationsprüfung. Es wurden weder das Spiel gestartet noch Tests ausgeführt, Audiodateien angehört oder die lokal installierten VoxCPM2-Nodes angesprochen. Die konkreten Node-Versionen und der lokale Voice-Cloning-Workflow sind deshalb vor Implementierung gesondert zu verifizieren.

## 3. Ziel, Umfang und Nicht-Ziele

### 3.1 Spielerlebnis

Der Wiedererkennungswert entsteht durch die persönliche Stimme, situationsbezogene kurze Texte und den trockenen Humor der Dachse. Sprache soll besondere Momente verstärken, nicht das gesamte Match kommentieren. Verständlichkeit und Zurückhaltung sind wichtiger als die Zahl ausgelöster Sprüche.

Die Funktion ist rein präsentierend. Sie verändert weder Schaden noch Trefferwertung, Fortschritt, Siegbedingungen oder Netzwerkautorität. Das Spiel bleibt vollständig nutzbar, wenn Voice ausgeschaltet ist, ein Paket fehlt oder der Produktionsrechner nicht läuft.

### 3.2 Umfang der ersten vollständigen Version

Die erste Version umfasst lokale Aufnahme oder Referenzimport am Produktionsrechner, Stimmprofile, einen deutschen Satzkatalog, Style-Vorgaben pro Satz, Einzel- und Stapelgenerierung, Hörprüfung, Freigabe und Export. Im Spiel kommen Profilauswahl, Paketbereitstellung, getrennte Sprachlautstärke und die definierten Ereignisse hinzu.

Nicht enthalten sind Live-Voice-Chat, Sprachsteuerung des Spiels, Echtzeit-TTS während des Matches, automatisches Schreiben neuer Sprüche während des Spiels, clientseitiger Modelldownload, Training eigener Modelle, ein öffentlicher Stimmenmarktplatz und eine allgemeine Mehrspur-Audiobearbeitung. Das Konzept löst auch keine Rückholung bereits von anderen Personen kopierter Dateien.

## 4. Fachliche Objekte und Verantwortlichkeiten

| Objekt | Bedeutung und wesentliche Inhalte |
|---|---|
| **Stimmprofil** | Dauerhafte Identität einer Stimme: stabile ID, Anzeigename, Sprache, Referenzaufnahme mit Revision, gegebenenfalls Referenztranskript, Freigabestatus der sprechenden Person. Kein Spielerslot und kein einzelner Sprechstil. |
| **Satzkatalog** | Versionierter Bestand von Sätzen: stabile Satz-ID, Ereignis-ID, Zieltext, Stilbeschreibung, erlaubter Kontext, Varianten und Aktivstatus. Derselbe Katalog kann für mehrere Stimmprofile verwendet werden. |
| **Generierungskandidat** | Ein konkreter Take eines Satzes: verwendete Referenzrevision, Textrevision, Stil, Workflow-/Modellstand, Parameter, Rohdatei, bearbeitete Fassung und Prüfstatus. |
| **Sprachpaket** | Unveränderliche, freigegebene Laufzeitfassung einer Stimme: Paket-ID, Version, Inhaltsprüfsumme, Ereigniszuordnung und fertige Audiodateien. Keine Referenzaufnahme. |
| **LAN-Bundle** | Zusammenstellung mehrerer freigegebener Sprachpakete zur gemeinsamen Bereitstellung. Praktisch für einen Test mit mehreren persönlichen Stimmen. |
| **Spielerzuordnung** | Verbindung zwischen einem Spieler und einem konkreten freigegebenen Paket. Der Spielername ist kein technischer Schlüssel. |

**Sprechstil ist keine neue Stimme.** „Trocken“, „gelangweilt“, „energisch“ oder „panisch“ beschreiben die Darbietung eines Satzes. Dafür sollen nicht vier voneinander unabhängige Identitäten oder Referenzaufnahmen nötig sein.

Der Produktionsverantwortliche bedient die Werkstatt und verwaltet Warteschlange und Pakete. Die sprechende Person stellt ihre Stimme bereit und gibt deren vorgesehene Verwendung frei. Der Spielhost entscheidet über gültige Spielereignisse und die gemeinsame Sprechreihenfolge. Diese Rollen können auf demselben Rechner liegen, müssen es aber nicht: **Produktionsrechner und Spielhost sind unterschiedliche Rollen.**

## 5. Eigenständige Oberfläche

### 5.1 Grundaufbau

Die Anwendung trägt den Arbeitstitel **Fragdachse Voice-Werkstatt**. Der normale Nutzer soll keine ComfyUI-Nodes, SFX-Keys, Musikrezepte oder technischen Modellparameter bedienen müssen.

Eine kompakte Hauptnavigation enthält **Stimmen**, **Sätze**, **Produktion** und **Pakete**. Innerhalb einer ausgewählten Stimme führt eine sichtbare Schrittfolge durch **Aufnehmen → Testen → Sätze erzeugen → Prüfen → Paket freigeben**. Die Produktionswarteschlange bleibt als schmale Statusanzeige erreichbar.

Die Trennung der Hauptbereiche und des geführten Ablaufs verhindert doppelte Datenpflege: „Sätze“ verwaltet den gemeinsamen Katalog, während „Sätze erzeugen“ dessen Anwendung auf die ausgewählte Stimme zeigt.

### 5.2 Stimmenübersicht

Jede Stimme zeigt Anzeigename, eine kurze abspielbare Probe, Referenzstatus, Fortschritt des aktuellen Pakets und die zuletzt freigegebene Paketversion. Sinnvolle Aktionen sind „Neue Stimme“, „Bearbeiten“, „Paket öffnen“ und „Archivieren“.

Eine Stimme mit vorhandenem Paket bleibt verwendbar, auch wenn ComfyUI ausgeschaltet ist. „Generator nicht verfügbar“ ist ein Produktionsstatus und darf nicht fälschlich bedeuten, dass fertige Pakete unbrauchbar wären.

### 5.3 Aufnahme

Die Aufnahmeansicht zeigt Mikrofonwahl, Pegelanzeige, Referenztext, Aufnahme-/Stopptaste, Dauer, Wiedergabe und „Neu aufnehmen“. Alternativ lässt sich eine vorhandene Referenzdatei importieren. Die Aufnahme beginnt nur nach ausdrücklicher Betätigung; nach Aufnahmeende wird der Mikrofonzugriff beendet.

Die Anleitung lautet sinngemäß: „Sprich natürlich und deutlich, ohne Schauspiel, Musik oder starke Hintergrundgeräusche. Lies ungefähr 10–20 Sekunden.“ Das ist eine Aufnahmeempfehlung aus den bisherigen Absprachen, keine behauptete technische Modellgrenze.

Vorgeschlagener Referenztext:

> Heute ist ein guter Tag für einen kurzen Ausflug. Ich packe meine Sachen, schließe die Tür und gehe nach draußen. Unterwegs höre ich den Wind in den Bäumen. Später treffen wir uns wieder und erzählen, was passiert ist.

Angezeigt werden Hinweise auf zu leise Aufnahme, Übersteuerung, lange Stille oder offensichtlich ungeeignete Dauer. Solche Prüfungen unterstützen die Hörkontrolle; sie behaupten keine automatische Bewertung der Stimmähnlichkeit. Ein einfaches Kürzen von Anfang und Ende genügt. Ein Audiostudio mit Filtern und Mehrspuransicht ist nicht vorgesehen.

### 5.4 Stimmtest vor der Stapelproduktion

Vor der ersten größeren Generierung werden drei kurze Tests angeboten: neutral, trocken-humorvoll und energisch. Der Nutzer hört sie an und bestätigt, dass Stimme, Verständlichkeit und Aussprache grundsätzlich passen. Erst danach ist „Gesamten Katalog erzeugen“ der empfohlene nächste Schritt.

VoxCPM2 dokumentiert referenzgestütztes Cloning und Stilsteuerung; die Ergebnisse können jedoch zwischen Generierungen variieren. Ob die installierten ComfyUI-Nodes diese Kombination unterstützen, ist lokal zu prüfen. Eine Stilvorgabe ist daher eine Anweisung an den Generator, keine garantierte akustische Eigenschaft. [W1]

### 5.5 Sätze und Prüfung

Die Satzansicht zeigt Ereignis, Text, Stil, Bearbeitungsstand, abspielbaren Kandidaten und Freigabe. Im Vordergrund stehen „Erzeugen“, „Noch einen Take“, „Übernehmen“ und „Verwerfen“. Seeds und Workflowdetails liegen in einem geschlossenen Expertenbereich.

„Noch einen Take“ verändert nicht unbemerkt den Text. Eine Textänderung ist eine separate Bearbeitung mit neuer Textrevision. Emotionstags werden nicht ungeprüft als Teil des zu sprechenden Satzes übergeben; Zieltext und Style-Anweisung bleiben getrennte Felder.

Bei der Prüfung werden Rohfassung und fertige Exportfassung vergleichbar angeboten. Geprüft werden tatsächlich gesprochener Text, erkennbare Stimme, passende Darbietung, keine abgeschnittenen Silben, keine Nebengeräusche und eine zum Spiel passende Länge. Eine technische Erfolgsanzeige ersetzt keine Hörfreigabe.

### 5.6 Ereignis-Vorschau ohne laufendes Spiel

Ein kleiner Prüfbereich spielt die freigegebenen Kandidaten für ausgewählte Ereignisse ab. Zusätzlich simuliert er Situationen wie „Kill und Führungswechsel gleichzeitig“ oder „mehrere Burst-Kandidaten“. Die Oberfläche erklärt, welcher Spruch zugelassen und welcher wegen Priorität, Wiederholung oder Sprechpause unterdrückt wurde.

Die Vorschau nutzt dieselben fachlichen Regeln wie das Spiel. Sie ist kein zweites, abweichendes Regelsystem und verändert keine laufende Lobby.

## 6. Produktionsablauf, Status und Freigabe

Ein vollständiger Ablauf besteht aus dem Anlegen einer Stimme, Aufnahme oder Import, Stimmtest, Auswahl eines Satzkatalogs, Generierung fehlender Kandidaten, Hörprüfung und anschließender Paketfreigabe. Die Werkstatt bietet dabei gezielte Teilaktionen statt ständig alles neu zu erzeugen.

Ein Generierungsauftrag hat die Zustände **wartend**, **Voraussetzungen prüfen**, **Generierung läuft**, **Audio aufbereiten**, **prüfbereit**, **fehlgeschlagen** oder **abgebrochen**. Eine gesonderte fachliche Entscheidung lautet **angenommen** oder **verworfen**. „Prüfbereit“ und „freigegeben“ sind ausdrücklich verschiedene Zustände.

Fortschritt wird als „12 von 24 Sätzen prüfbereit“ und mit dem Zustand des aktuellen Auftrags angezeigt. Prozentwerte für Modellschritte erscheinen nur, wenn das Backend sie tatsächlich liefert. Nach einem Neustart werden unvollständige Aufträge als unterbrochen erkannt; fertige Ergebnisse gehen nicht verloren.

Ein Abbruch entfernt keine bereits fertigen Kandidaten. Er stoppt zunächst weitere eigene Aufträge. Ein aktuell laufender ComfyUI-Auftrag darf nur dann aktiv abgebrochen werden, wenn eindeutig feststeht, dass er der Voice-Werkstatt gehört. Fremde Studio- oder ComfyUI-Aufträge dürfen nicht durch einen globalen Interrupt beendet werden. Diese Eigentumsgrenze entspricht auch dem vorhandenen Generatorrouter. [R3]

Text-, Stil- oder Referenzänderungen markieren davon abhängige Entwurfsergebnisse als überholt. Sie ersetzen keine freigegebenen Audiodateien. Die alte Paketversion bleibt weiterhin unverändert verfügbar, bis eine neue Version ausdrücklich veröffentlicht wird.

**Paketfreigabe** umfasst eine Zusammenfassung von enthaltenen Ereignissen, angenommenen Clips, offenen Lücken, Dateigröße und vorgesehenem Verwendungsbereich. Sie erzeugt eine neue unveränderliche Paketversion. Ein Export in eine Datei ist noch kein Git-Commit und keine öffentliche Veröffentlichung.

## 7. Satzkatalog und Ereignisse

### 7.1 Startumfang

Vorgeschlagen werden zunächst **24 unterschiedliche Sätze pro Stimme**. Pro Satz genügt zunächst ein Kandidat; weitere Takes werden nur bei Bedarf erzeugt. Der Zielbereich liegt überwiegend bei etwa ein bis drei Sekunden gesprochener Länge. Die tatsächliche Länge wird gemessen und geprüft, nicht aus der Zeichenzahl garantiert.

| Ereignis | Fachlicher Auslöser | Sprechende Figur | Startumfang |
|---|---|---|---:|
| `ready` | Ein Spieler ist erstmals in der aktuellen Lobby-Sitzung vollständig beigetreten und spielbereit. Kein erneutes Auslösen durch Menüöffnung, Profilauswahl oder kurze Wiederverbindung. | Der beigetretene Spieler | 3 |
| `kill` | Bestätigter gegnerischer Spieler-Kill im Deathmatch beziehungsweise dafür freigegebenen PvP-Modus. Kein gewöhnlicher PvE-Kill, Suizid oder bloßer Assist. | **Der Killer**, nicht das Opfer | 6 |
| `leader` | Ein anderer Spieler übernimmt eine eindeutige Führung nach der maßgeblichen Wertung des Modus. | Der neue Führende | 3 |
| `ultimate` | Erfolgreiche Auslösung einer ausdrücklich als Voice-relevant markierten Spezialaktion. | Der ausführende Spieler | 3 |
| `damage_burst` | Außergewöhnlicher ausgeteilter Schaden nach Abschnitt 8. | Der verursachende Spieler | 6 |
| `victory` | Bestätigter Rundensieg beziehungsweise erfolgreicher kooperativer Abschluss. | Sieger oder ausgewählter erfolgreicher Teilnehmer | 3 |

Die genaue technische „spielbereit“-Stelle für `ready` muss beim Einbau an den vorhandenen Lobby-Lebenszyklus angeschlossen werden. Dieses Ereignis führt keinen zusätzlichen Ready-Knopf und kein neues Matchstart-Erfordernis ein. Nachrückende Spieler während eines laufenden Matches erzeugen keinen verspäteten Lobby-Spruch.

### 7.2 Kontextregeln

Führungswechsel werden nicht aus einer sichtbaren Sortierung der Raumstatistik abgeleitet. Der Modus muss eine autoritative Führungsdefinition liefern. Bei Gleichstand, erstmaliger Initialisierung oder einer dafür nicht definierten Koop-Wertung bleibt `leader` aus. Als vorläufige Entprellung wird eine zwei Sekunden anhaltende neue Führung vorgeschlagen.

Nicht jeder Rechtsklick ist eine Ultimate. Die Zuordnung geeigneter Fähigkeiten wird ausdrücklich gepflegt. Fehlgeschlagene Auslösung, abgebrochene Vorschau und wiederholte Eingabesamples erzeugen keinen Spruch. Eine Aktivierungskennung verhindert Mehrfachauslösung bei anhaltenden Effekten.

Beim kooperativen Sieg spricht nicht das gesamte Team gleichzeitig. Unter den berechtigten Teilnehmern mit einem freigegebenen Paket wird ein Sprecher ausgewählt; die Fairnessregel bevorzugt jemanden, der zuletzt seltener gesprochen hat. Bei Niederlage gibt es in Version 1 keinen fälschlichen Siegesspruch. Ein eigener Niederlagenkatalog wäre eine spätere Ergänzung.

### 7.3 Inhaltliche Leitlinie

Die Texte sind kurz, trocken, selbstironisch und passen zu erfahrenen Dachs-Söldnern kurz vor dem Ruhestand. Kein Echtzeit-LLM erfindet während des Matches neue Texte. Individuelle Texte werden in der Werkstatt bearbeitet, neu erzeugt und freigegeben.

Konkrete Spielernamen und dynamische Zahlen sind zunächst nicht Teil der Sätze. So erfordert ein anderer Lobbyname keine Neugenerierung. Ein möglicher Startkatalog steht in Anhang A; er ist ein neuer redaktioneller Vorschlag, keine rekonstruierte Originaldatei.

## 8. Außergewöhnlicher Schadens-Burst

### 8.1 Fachliche Definition

Der Burst soll bedeuten: **„Dieser Spieler hat gerade ungewöhnlich viel Schaden für seinen aktuellen Leistungsstand verursacht.“** Entscheidend ist weder eine feste absolute Schadenszahl noch eine bestimmte Anzahl Kills. Damit bleibt die Idee auch bei steigenden Waffenwerten und später Spielprogression sinnvoll.

Bewertet wird ausschließlich auf dem Host bestätigter, wirksamer Schaden an zulässigen gegnerischen Zielen während aktiver Spielteilnahme. Training, Lobby-Schießstand, Selbstschaden, Verbündetenschaden, reine Umweltzerstörung und nicht zuordenbare Quellen zählen nicht. Überzähliger Schaden an einem bereits erledigten Ziel darf keinen künstlichen Burst erzeugen.

Eigene Türme, Drohnen und Schaden-über-Zeit-Effekte dürfen dem Besitzer zugerechnet werden, sofern dies der bestehenden eindeutigen Schadenszuordnung entspricht. Jeder Schadensanteil zählt genau einmal. Voice ändert nicht nachträglich die allgemeinen Spielstatistiken.

### 8.2 Dynamische Referenz

Als Startentwurf wird die Schadensmenge der letzten **zwei Sekunden** mit der typischen eigenen Schadensmenge gleich langer, vorheriger aktiver Schadensfenster verglichen. Der aktuelle mögliche Burst fließt nicht in seine eigene Referenz ein. Leerlaufzeiten ohne Kampf dürfen die Referenz nicht künstlich gegen null drücken.

Die Referenz wird aus abgeschlossenen Fenstern des jüngeren Kampfverlaufs gebildet. Als erster algorithmischer Vorschlag dient der Median der letzten bis zu 15 geeigneten Zwei-Sekunden-Fenster. Mindestens vier geeignete Fenster sind erforderlich. Solange diese fehlen oder keine positive belastbare Referenz existiert, wird kein Burst-Spruch erzeugt.

Größere Wechsel von Loadout, Klasse oder relevanten Schadens-Upgrades erzeugen eine neue Vergleichsphase. Die Referenz wird dann neu aufgebaut, statt alte niedrige Werte als Maßstab für eine dauerhaft stärkere Waffe zu verwenden. Welche Änderungen dafür relevant sind, wird beim Einbau an die vorhandenen Revisionen beziehungsweise bestätigten Upgrade-Ereignisse gebunden.

### 8.3 Auslösung und Wiederfreigabe

Ein vorläufiger Auslösefaktor ist **2,5-mal die aktuelle Referenz**. Ein Spieler kann also bei typischen 200 Schaden pro Zwei-Sekunden-Fenster mit 600 Schaden auffallen und später bei typischen 2.000 mit 6.000: Beide Situationen entsprechen dem Dreifachen der jeweiligen Referenz. Diese Zahlen sind Rechenbeispiele, keine Balancevorgaben.

Ein dauerhaft hoher Wert darf nicht bei jeder Prüfung erneut einen Spruch erzeugen. Nach einer Auslösung muss der Wert zunächst für eine kurze Zeit deutlich unter die Auslöseschwelle fallen. Als Startwerte gelten Faktor 1,5 für die Wiederfreigabe, mindestens zwei Sekunden darunter und zusätzlich 20 Sekunden Sperrzeit je Spieler. Die globale Sprachbegrenzung gilt zusätzlich.

Diese Parameter sind **prüfbare Tuningvorschläge**, keine Messergebnisse. Vor Freigabe sind Einzelzielwaffen, Flächenschaden, Dauerfeuer, Schaden-über-Zeit, Konstruktionen und Progressionssprünge zu vergleichen. Unterstützungsklassen sollen nicht nach einem pauschalen klassenübergreifenden Schadensmaßstab bewertet werden.

### 8.4 Abgrenzung zum vorhandenen Audiofeedback

Die in `GameAudioSystem` vorhandenen 30-Millisekunden-Fenster bündeln kurzfristiges Treffer- beziehungsweise Schadensfeedback. Sie erfüllen eine andere Aufgabe und sind nicht die fachliche Burst-Erkennung. [R4] Die neue Erkennung benötigt einen eigenen kleinen, zeitbezogenen Beobachter an der autoritativen Schadensgrenze; das periodische Ablesen einer kumulierten Raumstatistik allein genügt nicht für die beschriebenen Filter.

## 9. Gemeinsame Sprechregeln im Spiel

### 9.1 Eine Auswahlentscheidung für den Raum

Der Host entscheidet, welches Voice-Ereignis zugelassen wird, wer spricht und welcher konkrete freigegebene Clip verwendet wird. Clients würfeln nicht unabhängig voneinander unterschiedliche Sätze aus. Sie erhalten ein kleines Abspielereignis und spielen die bereits vorhandene Datei ab.

Der fachliche Ereignisinhalt umfasst Sprecher, Ereigniskennung, Paketversion beziehungsweise Inhaltsprüfsumme, Clip-ID, eindeutige Ereignisnummer, Runden-/Weltzuordnung und Gültigkeitszeit. Audiodaten, Referenzaufnahmen und Generierungsparameter gehören nicht in dieses Ereignis.

### 9.2 Vorläufige Sprechbudgets

| Regel | Vorgeschlagene Festlegung |
|---|---|
| Gleichzeitige Sprache | Höchstens ein regulärer Charakterspruch pro Zuhörer. |
| Globale Frequenz | Zwischen dem Beginn zweier regulärer Sprüche liegen mindestens zehn Sekunden. |
| Pause nach einem Clip | Zusätzlich mindestens 0,5 Sekunden hörbare Pause, falls ein Clip ungewöhnlich lang ist. |
| Wiederholung | Derselbe Satz nicht unmittelbar wiederholen; bei ausreichender Auswahl die letzten zwei Sätze pro Stimme/Ereignis ausschließen. |
| Sprecher-Fairness | Bei gleichwertigen gleichzeitigen Kandidaten den zuletzt seltener gehörten Sprecher bevorzugen. |
| Normale Ereignisgültigkeit | Höchstens zwei Sekunden; ein wegen Sprechpause verpasstes Kill- oder Burst-Ereignis wird danach verworfen. |
| Sieg | Einmalige Ausnahme pro Runde: alte Kandidaten verwerfen, laufenden kurzen Clip beenden lassen und danach den Siegesspruch zulassen. |

Die Zehn-Sekunden-Regel ist hier als **globales Startintervall** präzisiert, nicht als erlaubte Satzlänge. Sie ist eine bewusst zurückhaltende Startkonfiguration.

Als Priorität gilt **Sieg → Führungswechsel → Spezialaktion → Burst → Kill → Ready**. Innerhalb eines kurzen Auswahlintervalls können zusammengehörige Kandidaten gesammelt werden. Ein Kill, der gleichzeitig die Führung ändert, soll vorzugsweise den Führungswechsel kommentieren. Ein bereits laufender Spruch wird nicht mitten im Wort durch einen gewöhnlichen anderen Spruch ersetzt.

Es gibt keine lange Wiedergabeschlange. Fehlende, verspätete, doppelte oder zu einer alten Runde gehörende Ereignisse werden verworfen. Nach Tab-Wechsel, Reconnect oder Rundenwechsel wird nichts nacherzählt.

### 9.3 Hörverhalten und Einstellungen

Für Version 1 sind diese seltenen Charaktersprüche innerhalb des Raums gemeinsam und nicht entfernungsabhängig hörbar. Sie sind stilisierte Spielkommentare, keine Simulation von Zurufen und kein zusätzlicher taktischer Ortungskanal. Eine spätere räumliche Kategorie müsste ausdrücklich getrennt definiert werden.

Sprache erhält einen eigenen Lautstärkeregler und einen globalen Aus-Schalter. Die Masterlautstärke gilt weiterhin. „Sprache aus“ verändert weder Musik noch notwendige Spielgeräusche. Als spätere Komfortfunktion kann ein Zuhörer einzelne persönliche Stimmen lokal stummschalten.

Fehlt der exakte Clip oder ist das Paket nicht freigegeben, bleibt dieser Spruch aus. Es wird nicht stillschweigend die Stimme einer anderen realen Person verwendet. Ein lokales Stummschalten führt nicht dazu, dass der Host einen weiteren Spruch für alle anderen auslöst.

## 10. Sprachpakete, Versionen und Bereitstellung

### 10.1 Laufzeitpaket

Ein Paket enthält ein Manifest und ausschließlich freigegebene Audiodateien. Im Manifest stehen Schema- und Katalogversion, Paket-ID und -Version, Stimmprofil-ID, Anzeigename, Sprache, Ereignis-/Clip-Zuordnung, Dateiprüfsummen, tatsächliche Dauer, Codec und Dateigröße.

Ein Paket enthält **keine** Referenzaufnahme, Referenztranskripte, Rohkandidaten, lokalen Dateipfade, ComfyUI-Workflows, Sitzungstoken oder Modellgewichte. Produktionsprotokolle verbleiben im privaten Werkstatt-Arbeitsbereich. Sprechstile werden nicht erst im Spiel auf ein neutrales Audio angewendet; die gewünschte Darbietung ist Bestandteil der fertigen Datei.

Als erste Exportvariante ist **OGG/Vorbis** vorgesehen, angelehnt an den bereits dokumentierten Studio-Export. [R12] Opus ist eine spätere Optimierung nach Hör- und Browserprüfung, kein zwingender Bestandteil der ersten Version. Dateiendung und Codec dürfen nicht verwechselt werden; der tatsächliche Codec wird dokumentiert und das Decodieren auf den unterstützten Browsern geprüft.

Vorgeschlagene Schutzgrenzen für Version 1 sind höchstens 40 Clips, sechs Sekunden je Clip, 120 Sekunden Gesamtdauer und 20 MiB komprimierte Audiodaten pro Paket. Der Startkatalog mit 24 kurzen Sätzen soll deutlich darunter bleiben. Diese Obergrenzen sind technische Aufnahmegrenzen, keine Aufforderung, lange oder große Pakete zu produzieren.

### 10.2 Vollständigkeit

Die Werkstatt unterscheidet „vollständig für Katalogversion X“ und „bewusst unvollständig“. Für ein regulär vollständiges Paket braucht jedes für den gewählten Umfang aktivierte Ereignis mindestens einen angenommenen Clip. Varianten darüber hinaus verbessern die Abwechslung, sind aber keine Startblockade.

Ein Teilpaket darf nur nach ausdrücklicher Bestätigung exportiert werden; die fehlenden Kategorien werden dokumentiert. Das Spiel behandelt sie als stumm. Neue Katalogeinträge machen ein bereits veröffentlichtes Paket nicht rückwirkend kaputt.

### 10.3 Bereitstellung in Version 1

Die Werkstatt exportiert einzelne Pakete oder ein gemeinsames **LAN-Bundle** mit allen vorgesehenen Stimmen. Für den ersten Test wird dieses Bundle einmal außerhalb des Spiels an die Teilnehmer weitergegeben. In der Profilauswahl kann ein bereitgestelltes Paket beziehungsweise Bundle über „Sprachpaket laden“ ausgewählt werden. Dieser Dateizugang dient nur der Bereitstellung fertiger Inhalte, nicht der Produktion.

Der einmalige Import gehört fachlich zur Profilauswahl: Anschließend wählt der Spieler seine Stimme aus der vorhandenen Liste. Alle enthaltenen Stimmen werden für die Wiedergabe anderer Spieler verfügbar. Es reicht nicht, dass jeder Client ausschließlich seine eigene Stimme besitzt.

Das Spiel validiert den Import und verwaltet seinen eigenen lokalen Paketbestand. Ein Werkstatt-Tab auf einem anderen Port oder Origin stellt dem Spiel nicht automatisch seinen Browserspeicher zur Verfügung. Dieser Übergang wird deshalb ausdrücklich über den Paketexport und -import gelöst.

Persönliche Stimmen werden nicht automatisch nach `public/` kopiert, committed oder auf GitHub Pages veröffentlicht. Ein solcher öffentlicher Vertriebsweg wäre eine gesonderte Freigabeentscheidung, nicht der Standard für eine private LAN.

### 10.4 Aktivierung und Austausch

Die Spielerzuordnung enthält eine konkrete Paketversion beziehungsweise deren Inhaltsprüfsumme, nicht nur einen Anzeigenamen. Ein neuer Paketstand wird atomar installiert. Eine laufende Runde verwendet ihren festgelegten Stand; neue Versionen werden erst in der nächsten Lobby-/Rundenphase aktiviert.

Der Import prüft Dateitypen, Manifeststruktur, Prüfsummen, Clipzahl, Dauer- und Größenlimits sowie sichere relative Pfade. Archive dürfen keine ausführbaren Inhalte oder Pfade außerhalb ihres Paketbereichs einschleusen. Größenlimits gelten auch nach dem Entpacken und für den möglichen Decodierbedarf, nicht nur für die ZIP-Datei.

## 11. Minimale Spielintegration

Die sichtbare Spieländerung bleibt auf eine Stimmeinstellung mit Paketbereitstellung, Hörprobe, „Aus“ und Sprachlautstärke begrenzt. Es gibt keine Mikrofonaufnahme, keinen Texteditor, keine Generierung und keine ComfyUI-Konfiguration im Spiel.

Im Hintergrund sind dennoch echte Ergänzungen erforderlich: Paketregister und Loader, Spielerzuordnung, Ereignisbeobachtung, hostseitige Sprechentscheidung und Wiedergabe. „Das Spiel spielt nur Dateien ab“ bedeutet nicht, dass diese Integrationslogik bereits vorhanden wäre.

Die Sprachlogik sollte als eigene Präsentationskomponente an das vorhandene Audiosystem angeschlossen werden. Sie nutzt dessen Audio-Unlock und Lebenszyklus, erhält aber eigene Prioritäten und Lautstärke. SFX-One-Shot-Limits dürfen nicht unbemerkt dazu führen, dass wichtige Sprache durch eine Schussserie verdrängt wird. Umgekehrt darf Voice keine notwendigen Kampfsounds blockieren. [R4]

Fertige Pakete werden in der Lobby geprüft und benötigte Dateien vorbereitet. Fehlt ein Paket zum Matchstart, bleibt der Spieler spielbereit und Voice für die fehlenden Inhalte stumm. Ein optionaler Voice-Status darf kein neues Pflicht-Ready-Gate erzeugen. Ohne installierte oder aktivierte Voice-Pakete soll kein zusätzlicher Sprachdownload starten.

Der Audiospeicher ist begrenzt zu verwalten. Komprimierte Dateigröße und decodierter Speicherbedarf sind getrennt zu messen. Nicht benötigte Paketversionen und Audioressourcen werden nach einem geeigneten Lebenszyklus wieder freigegeben. Eine konkrete Speicher- und Ladezeitabnahme erfolgt mit dem tatsächlichen Zehn-Spieler-Paketsatz, nicht anhand einer unbelegten Größenannahme.

## 12. Spätere automatische Lobby-Verteilung

Ausbaustufe 2 automatisiert ausschließlich die Verteilung **fertiger, freigegebener Pakete**. Sie setzt keine Aufnahme und keinen Generator beim Spielhost voraus.

Beim Betreten der Lobby werden benötigte Paket-IDs und Prüfsummen mit dem lokalen Bestand abgeglichen. Nur fehlende Versionen werden angefordert. Ein Spieler bietet dem Host ein bereits freigegebenes Paket an; nach Validierung und gegebenenfalls Hostfreigabe stellt dieser es den übrigen Teilnehmern bereit. Ein vorhandener identischer Inhalt wird nicht erneut übertragen.

Für den Austausch sind begrenzte Blöcke, Transferkennungen, Prüfsummen, Wiederaufnahme und ein Abbruchzustand vorgesehen. Die Übertragung wird separat gedrosselt und bei aktivem Gameplay standardmäßig pausiert. Ein großer Base64-Block in regulären Spielzuständen ist ausdrücklich nicht vorgesehen.

Der vorhandene Transport hat bereits Warteschlangen und Paketaufteilung. Ein neuer dritter Kanal lässt sich aber nicht bedenkenlos anhängen: `PeerLink` dokumentiert Besonderheiten der PeerJS-Kanalannahme und verwendet für den zweiten Kanal eine feste ausgehandelte Stream-ID. Die konkrete Lösung muss daran anschließen. [R8] Auch ein separater Datenkanal garantiert keine vollständige Unabhängigkeit von übrigen Übertragungen; kleine Nachrichten und Rückstaukontrolle bleiben erforderlich. [W3]

Ein abgebrochener Transfer beschädigt kein bereits installiertes Paket. Teilstände werden nie als einsatzbereit gemeldet. Clients können Paketannahme ablehnen und trotzdem am Spiel teilnehmen. Späte Beitritte und Reconnects erhalten keine alten Sprachereignisse.

## 13. Spätere Aufnahme auf Client-Rechnern

Ausbaustufe 3 ergänzt eine vereinfachte Aufnahmeansicht derselben Voice-Anwendung. Der Spieler öffnet sie als eigene Seite, nimmt seinen Referenzsatz auf, hört ihn an und übermittelt ihn ausdrücklich an den autorisierten Produktionsrechner. Dort werden freigegebene Satzvorlagen erzeugt. Anschließend werden Ergebnisse geprüft und als normales Paket bereitgestellt.

Der Client lädt dabei kein mehrgigabytegroßes Modell und installiert keine Python-Laufzeit. Er überträgt eine kurze Referenzaufnahme und empfängt später fertige Ergebnisse. Der Spielprozess selbst benötigt weiterhin keinen Mikrofonzugriff.

**Browserzugriff ist eine eigene Voraussetzung:** Mikrofonaufnahme benötigt einen sicheren Kontext und Nutzerberechtigung. `localhost` auf dem jeweiligen Gerät ist ein Sonderfall; eine gewöhnliche HTTP-Adresse eines anderen LAN-Rechners ist nicht gleichwertig. [W2] Deshalb ist „Server auf LAN-IP stellen“ kein ausreichendes Aufnahmekonzept.

Als Zielvariante ist eine HTTPS-Aufnahmeseite mit explizit gekoppelter WebRTC-Verbindung zu einer Werkstatt-Oberfläche auf dem Produktionsrechner vorgesehen. Diese lokale Oberfläche vermittelt zum lokalen Voice-Dienst. Die Client-Seite greift nicht direkt auf einen offenen ComfyUI-Port zu. Signalisierung, Verbindungsaufbau und die Kopplung sind vor dieser Ausbaustufe prototypisch zu prüfen; ein vollständig offline funktionierender LAN-Verbindungsaufbau wird nicht vorausgesetzt.

Eine Sitzung begrenzt, wer aufnehmen, Aufträge anlegen und Ergebnisse sehen darf. Spieler bearbeiten ausschließlich die ihnen zugewiesene Stimme. Neue Jobanfragen sind in Zahl und Umfang begrenzt und verwenden nur zugelassene Vorlagen. Die Teilnehmer erhalten keine Möglichkeit, beliebige ComfyUI-Workflows oder lokale Dateipfade auszuführen.

## 14. Verhältnis zum Audio-Studio und zur Generierung

### 14.1 Eigenständig bleiben

Voice besitzt einen eigenen Katalog, Arbeitsbereich, Paketexport und Sitzungszugang. Die Voice-Werkstatt muss ohne laufenden Audio-Studio-Server starten und fertige Inhalte verwalten können. Die bestehende SFX-/Musikproduktion bleibt unverändert nutzbar.

Wiederverwendung ist auf schmale technische Bausteine beschränkt: sichere Dateiverarbeitung, grundlegende Audioprüfung, Encoderzugriff und gegebenenfalls transportneutrale ComfyUI-Kommunikation. Ob sich einzelne vorhandene Module dafür sauber herauslösen lassen, ist im technischen Entwurf zu entscheiden. Das gesamte Studio-Datenmodell oder dessen komplette Oberfläche zu importieren ist kein Ziel.

Ein Generatorauftrag für Voice enthält Stimmreferenz, gegebenenfalls Transkript, exakten Zieltext, Style-Anweisung und einen festgelegten Workflowstand. Er wird nicht künstlich als SFX-Rezept mit einer frei gewählten Solldauer modelliert. Die Satzlänge entsteht durch die Sprachgenerierung und wird anschließend geprüft.

### 14.2 Verifizierungsgrenze zum lokalen Workflow

Vor dem Einbau muss ein tatsächlich funktionierender VoxCPM2-Workflow als API-fähige Vorlage gesichert werden. Geprüft werden referenzgestütztes Cloning, Stilsteuerung, Text-/Transkriptzuordnung, Referenzübergabe, Ausgabedatei, Modell- und Node-Versionen sowie Verhalten bei fehlenden Voraussetzungen.

ComfyUI stellt dokumentierte Schnittstellen für Workflowaufträge, Knoteninformationen, Warteschlange, Historie und Fortschritt bereit. [W4] Die konkreten Voice-Nodes sind damit jedoch nicht automatisch bekannt. Das Konzept erfindet deshalb keine Node-Namen oder vermeintlich fertige Drag-and-drop-JSON.

### 14.3 Ressourcen und Audioaufbereitung

Auf einem Produktionsrechner laufen Voice-Aufträge zunächst seriell. Eine parallele zweite GPU-Warteschlange neben dem Audio-Studio wird nicht still gestartet. Die Werkstatt zeigt einen belegten Generator als solchen an und schützt fremde Aufträge vor Abbruch oder Modellfreigabe.

Für den ersten LAN-Betrieb wird vor dem Match produziert und die Produktion anschließend pausiert. Eine automatische Erkennung laufender Spiele wird für diese Version nicht vorausgesetzt. Das Schließen der Werkstattoberfläche und das Beenden des zugehörigen Dienstes müssen klar unterscheidbar sein.

Die Aufbereitung erhält die Rohdatei, kürzt nur unnötige Ränder, schützt Anfangs- und Endlaute und gleicht die Sprachlautheit nachvollziehbar an. Sie verwendet eigene Sprachvorgaben statt ungeprüft die SFX-Profile. Sehr leise oder fehlerhafte Clips werden nicht durch extremes Verstärken scheinbar „repariert“. Freigegeben wird die tatsächlich exportierte Fassung.

## 15. Datenschutz, Verwendung und Ausfallsicherheit

Referenzaufnahmen sind privat und liegen außerhalb öffentlich ausgelieferter Assets sowie außerhalb des versionierten Repository-Bestands. Neue Arbeitsverzeichnisse erhalten von Anfang an passende Ausschlussregeln. Auch temporäre Kopien in ComfyUI-Eingabe-, Ausgabe- oder Arbeitsverzeichnissen müssen in ein ausdrückliches Löschkonzept einbezogen werden.

Die Werkstatt unterscheidet Zustimmung zur Generierung, zur Nutzung im vorgesehenen Teilnehmerkreis und zur möglichen öffentlichen Weitergabe. Eine Stimme wird nicht allein dadurch öffentlich, dass ihr Besitzer einen Stimmtest startet. Diese Festlegungen sind Produktanforderungen und ersetzen keine gesonderte rechtliche Prüfung einer späteren öffentlichen Veröffentlichung.

Es muss möglich sein, Referenzen zu löschen, neue Generierungen für eine Stimme zu sperren und lokale Pakete zu entfernen. Bereits exportierte oder von anderen kopierte Dateien lassen sich dadurch nicht zuverlässig zurückrufen. Diese Grenze wird vor Weitergabe verständlich angezeigt.

| Störung | Erwartetes Verhalten |
|---|---|
| Mikrofon verweigert oder nicht verfügbar | Verständliche Meldung; erneuter Versuch oder Referenzimport. Keine automatische Aufnahme. |
| Aufnahme ungeeignet | Warnung und erneute Aufnahme; bestehendes freigegebenes Paket bleibt erhalten. |
| ComfyUI nicht gestartet, Node fehlt oder GPU-Speicher reicht nicht | Produktionsfehler mit konkretem Hinweis. Keine unsichtbare Cloud-Ausweichlösung. |
| Einzelner Take misslingt | Nur diesen Satz erneut erzeugen; andere Kandidaten bleiben erhalten. |
| Dienst oder Browser wird geschlossen | Fertige Ergebnisse bleiben gespeichert; laufende Aufträge werden korrekt wiedergefunden oder als unterbrochen markiert. |
| Paket ist fehlerhaft oder zu groß | Import ablehnen, ohne bestehendes Paket zu überschreiben. |
| Paket fehlt bei einem Zuhörer | Betroffenen Spruch auslassen; Match läuft weiter. |
| Stimme oder Paket wechselt während einer Runde | Änderung vormerken und erst zur vorgesehenen Lobby-/Rundengrenze aktivieren. |
| Doppelte oder verspätete Netzwerknachricht | Kein zweites oder nachträgliches Abspielen. |
| Persönliches Paket wird zurückgezogen | Weitere Nutzung im verwalteten Bestand sperren; Grenzen bereits exportierter Kopien offen benennen. |

## 16. Umsetzungsschnitte und Abnahmekriterien

### 16.1 Empfohlene Reihenfolge

**Schnitt A – Produktionsnachweis und Paketvertrag.** Den realen lokalen Workflow prüfen; eine neutrale Referenz, drei Style-Tests und ein kleines Paket mit wenigen Sätzen erzeugen. Dateiformat, Stimmenqualität und Browser-Decodierung praktisch verifizieren. Noch kein Umbau des Audio-Studios.

**Schnitt B – Eigenständige Werkstatt.** Stimmenverwaltung, Aufnahme/Import, Stimmtest, Satzkatalog, Warteschlange, Kandidatenprüfung, Revisionen und Paket-/Bundle-Export implementieren. Die Werkstatt muss allein sinnvoll benutzbar sein.

**Schnitt C – Schlanke Spielintegration.** Paketbereitstellung, Auswahl und Wiedergabe zuerst mit Ready, Deathmatch-Kill und Sieg durchgängig erproben. Anschließend Führungswechsel, geeignete Spezialaktionen und die dynamische Burst-Erkennung ergänzen. Schnitt C ist erst mit den sechs vorgesehenen Ereigniskategorien vollständig; die Reihenfolge ist ein Integrationsvorgehen, keine Streichung von Anforderungen.

**Schnitt D – Automatische Lobby-Verteilung.** Versionierten, gedrosselten Transfer fertiger Pakete ergänzen; zehn Teilnehmer, Verbindungsabbruch, fehlende Pakete und Start während eines Transfers testen.

**Schnitt E – Client-Aufnahme.** Sicheren separaten Aufnahmezugang, autorisierte Kopplung zum Produktionsrechner, Besitz-/Freigaberegeln und Auftragseinschränkungen ergänzen. Keine neue Aufnahmeoberfläche innerhalb der Arena.

### 16.2 Prüffälle für die erste vollständige Version

| ID | Abnahmekriterium |
|---|---|
| AC-01 | Voice-Werkstatt startet und verwaltet fertige Pakete ohne laufendes Audio-Studio und ohne gestarteten Generator. |
| AC-02 | Ein neues Stimmprofil lässt sich aufnehmen oder importieren, testen und ohne Bedienung von ComfyUI-Nodes verwenden. |
| AC-03 | Jeder angenommene Clip lässt sich auf Text-, Referenz-, Stil- und Workflowstand zurückführen. |
| AC-04 | Eine Neugenerierung oder Referenzänderung überschreibt kein freigegebenes Paket. |
| AC-05 | Exportierte Pakete enthalten nur Manifest und freigegebene Audiodateien; keine privaten Produktionsdaten. |
| AC-06 | Derselbe Spieler kann sein Paket wählen; alle Teilnehmer mit installiertem LAN-Bundle hören die jeweils richtige Sprecherstimme. |
| AC-07 | Deathmatch-Kill verwendet die Stimme des Killers; PvE-Kills und Suizide lösen diese Kategorie nicht aus. |
| AC-08 | Führungswechsel reagiert nur auf die autoritative Moduswertung; Gleichstand und Initialisierung bleiben stumm. |
| AC-09 | Eine Spezialaktion erzeugt höchstens einen Kandidaten pro erfolgreicher Aktivierung. |
| AC-10 | Burst reagiert auf außergewöhnlichen ausgeteilten Schaden relativ zur aktuellen Referenz, nicht auf feste Schadenswerte oder Killzahl. |
| AC-11 | Leerlauf, Aufwärmphase, Upgrades, Overkill, Training, DoT und Konstruktionsschaden erzeugen keine systematischen Fehl-Bursts oder Doppelzählung. |
| AC-12 | Gleichzeitige Ereignisse beachten Priorität und globale Sprechpause; zehn Spieler erzeugen keine Sprachkaskade. |
| AC-13 | Doppelte Ereignisse, Reconnect, alte Runde und Tab-Rückkehr lösen keine nachgeholten Sprüche aus. |
| AC-14 | Fehlende, unvollständige oder nicht decodierbare Pakete verhindern weder Lobbybeitritt noch Matchstart. |
| AC-15 | Sprache lässt sich unabhängig von Musik und SFX regeln und vollständig abschalten. |
| AC-16 | Die Unterstützungsplattformen decodieren die tatsächlich exportierten Dateien; Dateiendung allein gilt nicht als Nachweis. |
| AC-17 | Ladezeit, decodierter Speicher und Framezeiten werden mit dem vorgesehenen Mehrspieler-Paketsatz gegen Voice-aus verglichen; keine ungeprüfte FPS-Zusage. |
| AC-18 | Ein misslungener Import und ein abgebrochener Produktionsauftrag beschädigen keine zuvor freigegebenen Inhalte. |
| AC-19 | Keine Modellgewichte oder Generierungsabhängigkeiten gelangen in den Spielclient oder werden dort automatisch nachgeladen. |
| AC-20 | Weder Paketexport noch sonstige Werkstattaktion erzeugen ohne gesonderten Auftrag einen Git-Commit oder ein öffentliches Deployment. |

Für die späteren Schnitte kommen Wiederaufnahme und Drosselung des Transfers, sichere Mikrofonaufnahme, Zugriffsbeschränkung je Stimme sowie korrekte Behandlung eines getrennten Produktionsrechners hinzu.

## 17. Festgelegte Entscheidungen und verbleibende Prüfungen

**Fachlich festgelegt:** eigene Voice-Anwendung; Trennung von Identität, Text, Take und Paket; zentrale Vorabproduktion; sechs Ereigniskategorien; Killerstimme im Deathmatch; dynamischer ausgeteilter Schadens-Burst; hostseitige gemeinsame Auswahl; zurückhaltende Sprachfrequenz; explizite Freigabe; keine privaten Referenzen im Spielpaket; manuelles LAN-Bundle vor automatischer Verteilung; Client-Aufnahme erst als späterer separater Zugang.

**Vor Implementierung zu verifizieren:** vollständiger Wortlaut der beiden Ausgangsdateien; tatsächlich installierter VoxCPM2-Workflow und dessen Style-Cloning-Kombination; genaue autoritative Hooks für Ready, Wertungswechsel, Spezialaktionen und effektiven Schaden; unterstützte Browser; tatsächliche Audioqualität und Ressourcenbedarf.

**Im Test zu justieren:** globale Sprachfrequenz, Satzlängen, Ereignisprioritäten bei Grenzfällen, Burst-Referenz und Auslösefaktoren, Anzahl Varianten und freigegebene Paketgrenzen. Diese Justierungen ändern nicht die grundsätzliche Architektur und erfordern keine Integration der Voice-Produktion ins Audio-Studio.

---

## Anhang A – Vorgeschlagener Startkatalog mit 24 Sätzen

Die folgenden Texte sind neue Vorschläge. Sie müssen mit der jeweiligen Stimme angehört und gegebenenfalls gekürzt werden. Die Darbietung bleibt ein eigenes Feld.

| ID | Ereignis | Zieltext | Darbietung |
|---|---|---|---|
| ready_01 | Ready | Na gut. Noch eine Runde. | Trocken, leicht widerwillig |
| ready_02 | Ready | Munition da. Motivation wird nachgeliefert. | Sachlich, trocken |
| ready_03 | Ready | Eigentlich hatte ich heute frei. | Gelangweilt, beiläufig |
| kill_01 | Deathmatch-Kill | Den Feierabend hast du dir verdient. | Ruhig, selbstzufrieden |
| kill_02 | Deathmatch-Kill | Das war die freundliche Variante. | Trocken |
| kill_03 | Deathmatch-Kill | Beschwerden bitte schriftlich. | Amtlich, beiläufig |
| kill_04 | Deathmatch-Kill | Du lagst mir gerade im Weg. | Knapp, unbeeindruckt |
| kill_05 | Deathmatch-Kill | Fachgerecht aus dem Verkehr gezogen. | Sachlich, stolz |
| kill_06 | Deathmatch-Kill | Bitte hinten wieder anstellen. | Gelassen |
| leader_01 | Führungswechsel | Erfahrung schlägt Restjugend. | Selbstzufrieden |
| leader_02 | Führungswechsel | Ich führe. Das war so geplant. | Trocken, leicht triumphierend |
| leader_03 | Führungswechsel | Ganz ruhig. Ich mach das beruflich. | Souverän |
| ultimate_01 | Spezialaktion | Jetzt wird’s unvernünftig. | Energisch |
| ultimate_02 | Spezialaktion | Das steht nicht mehr im Handbuch. | Warnend, trocken |
| ultimate_03 | Spezialaktion | Alle mal kurz die Ohren anlegen. | Deutlicher Zuruf |
| burst_01 | Schadens-Burst | Das war mehr als bestellt. | Überrascht, zufrieden |
| burst_02 | Schadens-Burst | Mengenrabatt. | Knapp, trocken |
| burst_03 | Schadens-Burst | Ich glaube, das war die große Taste. | Gespielte Unsicherheit |
| burst_04 | Schadens-Burst | Da hat sich was angestaut. | Erleichtert |
| burst_05 | Schadens-Burst | So. Jetzt ist hier wieder Platz. | Zufrieden |
| burst_06 | Schadens-Burst | Die Rechnung geht an die Natur. | Trocken |
| victory_01 | Sieg | Auftrag erledigt. Wo ist die Rente? | Erschöpft, zufrieden |
| victory_02 | Sieg | Gut. Dann jetzt Feierabend. | Erleichtert |
| victory_03 | Sieg | War doch ein entspannter Ausflug. | Trocken, selbstironisch |

## Anhang B – Quellen und geprüfte Stellen

### Repository-Quellen

Alle Repository-Angaben beziehen sich auf `Dominik-Steinweg/Fragdachse` am Commit `b1e3c698f160c62cc3d10847ac1f09648b8a1458`. Teilweise wurden gezielt die genannten Abschnitte und ergänzende Suchtreffer gelesen; daraus wird keine vollständige Prüfung jeder Datei oder des gesamten Repositories abgeleitet.

| Kennung | Datei / geprüfter Inhalt |
|---|---|
| R1 | `tools/audio-studio/README.md` – Eigenständigkeit, Produktion, Hörvergleich, Freigabe und Veröffentlichungsgrenze. |
| R2 | `tools/audio-studio/audio_studio/server.py`, Zeilen 1–240 – Loopback-/Origin-/Token-Prüfung, API und Medienzugriff. |
| R3 | `tools/audio-studio/audio_studio/generators.py`, Zeilen 1–210 – Generatorvertrag, Provider, Vorprüfung und Schutz fremder ComfyUI-Aufträge. |
| R4 | `src/audio/GameAudioSystem.ts`, Zeilen 1–230 – Musik/SFX, Lautstärke, One-Shot-Budgets, Unlock, Treffer- und Schadensfeedback. |
| R5 | `src/types.ts`, Zeilen 1–220 – PlayerProfile und Runden-/Weltzuordnungen. |
| R6 | `src/world/WorldCombatGameplayBinding.ts`, Zeilen 1–260 sowie Suchtreffer zu `addPlayerRoomDamage` – Kill- und Schadensschnittstellen. |
| R7 | `src/scenes/arena/ArenaWorldCombatComposition.ts` und `src/network/NetworkBridge.ts` – Suchtreffer zur Bindung von `addPlayerRoomDamage`. |
| R8 | `src/network/peer/PeerLink.ts`, Zeilen 1–280 – Zwei-Kanal-Vertrag, Sendewarteschlangen, Größenbehandlung und PeerJS-Besonderheit. |
| R9 | `src/network/peer/protocol.ts`, Zeilen 1–240 – Protokollversion 22, Handshake, Spielerzustand, RPC und Kanaldefinition. |
| R10 | `src/assets/DeferredAssets.ts`, Zeilen 1–180 – optionales Laden, Cacheprüfung, Retry und Lebenszyklus. |
| R11 | `src/audio/AudioCatalog.ts` und `docs/audio-sounds.md` – Suchtreffer zu `SHIPPED_AUDIO_FILES` und kontrollierter Übernahme. |
| R12 | `tools/audio-studio/docs/music.md` – Suchtreffer zum vorhandenen OGG/Vorbis-Export. |

### Externe Primärdokumentation

Abgerufen am 4. Oktober 2026. Diese Quellen belegen allgemeine Schnittstellen und Modellfähigkeiten, nicht die konkrete Funktionsfähigkeit der lokalen Installation.

**W1 – OpenBMB/VoxCPM:** Referenzgestütztes Cloning, Stilsteuerung und Hinweis auf variable Generierungsergebnisse.  
`https://github.com/OpenBMB/VoxCPM/`

**W2 – MDN, MediaDevices.getUserMedia:** Sichere Kontexte und ausdrückliche Mikrofonberechtigung.  
`https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia`

**W3 – MDN, Using WebRTC data channels:** Nachrichtengrößen, Pufferung und mögliche Auswirkungen großer Nachrichten auf andere Kanäle.  
`https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels`

**W4 – ComfyUI, Server API Routes:** Aufträge, Knoteninformationen, Warteschlange, Historie und Fortschritt.  
`https://docs.comfy.org/development/comfyui-server/comms_routes`
