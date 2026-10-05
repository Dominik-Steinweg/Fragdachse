# Persönliche Stimmen

## Produktions- und Laufzeitgrenze

Die eigenständige [Voice-Werkstatt](../../tools/voice-workshop/README.md) besitzt
Referenzen, Transkripte, Zustimmungen, Satzrevisionen, Generierungsaufträge und
Hörentscheidungen. Produktions-/Effektversion, vollständige Sprechregie und Eingaben
werden beim Einreihen eingefroren. Änderungen an Satz, Zusatzregie, Referenz oder
Produktionsrezept entwerten Entwürfe, nicht veröffentlichte Pakete.
Das Spiel kennt weder Generator noch private Produktionsdaten.

Die Announcer-Effekte gehören ausschließlich der Werkstatt. Referenzen und Roh-Takes
bleiben ohne diese Effekte; jeder Schnitt verarbeitet erneut den Roh-Take. Vorschau
und Paket verwenden dieselbe fertig gerenderte Datei. Die Paketdauer umfasst auch
den Hallausklang. Veraltete Produktionen können durch Nachschneiden nicht wieder
für neue Pakete gültig werden; Produktionsnachweise bleiben privat.

Der [Workshop](../../tools/voice-workshop/workshop.mjs) löst den Standardkatalog
mit den Satzanpassungen des jeweiligen Stimmprofils auf. Produktion, Gültigkeitsprüfung
und Export verwenden diesen aufgelösten Katalog. Standardänderungen betreffen nur
geerbte Sätze; Profilanpassungen bleiben eigenständig. Auch das Zurücksetzen auf den
Standard entwertet frühere Takes dieses Profils, statt alte Freigaben wiederzubeleben.

[VoicePackage](../../src/voice/VoicePackage.ts) ist der gemeinsame strikte
Laufzeitvertrag für Export und Import: versioniertes Manifest, Hash-Identität und
OGG/Vorbis-Clips. Zusätzliche Felder werden zurückgewiesen. Referenz-/Workflowdaten
gehören nicht in das Manifest. [VoiceLibrary](../../src/voice/VoiceLibrary.ts)
validiert Pakete vor der IndexedDB-Ablage. Die Profilzuordnung ist die exakte
Paketprüfsumme; fehlende Pakete erzeugen keine Ersatzstimme. Audio wird mit dem
Spiel ausgeliefert oder optional manuell importiert, nicht über Spiel-RPCs verteilt.

Die Werkstatt schreibt bei „Ins Spiel übernehmen“ ausschließlich validierte
Laufzeitpakete nach `src/voice/bundled/<voiceId>.fdvoice`; pro Stimme ersetzt eine
neue Version die Build-Quelle. [BundledVoices](../../src/voice/BundledVoices.ts)
lädt diese von Vite erfassten Datenmodule in die VoiceLibrary, unabhängig von
IndexedDB. Mitgelieferte Pakete gehören dem Build und sind nicht über die lokale
Import-Löschfunktion entfernbar. Versionswechsel ändern gespeicherte
Profilprüfsummen nicht automatisch.

Die endgültige Profil-Löschung gehört der Werkstatt: Sie sperrt das Profil zuerst,
bereinigt seine eigenen Produktions-/Paketdateien und ComfyUI-Kopien und entfernt
den Profilzustand erst nach erfolgreicher Bereinigung. Teilfehler behalten den
Löschauftrag für Wiederaufnahme; andere Stimmen bleiben erhalten. Spielquellen und
eigene generierte Stimmmodule werden dabei ebenfalls entfernt.
`public/voice-deletions.json` transportiert ausschließlich gelöschte Stimm-IDs und
Paketprüfsummen in aktuelle und bestehende lokale Builds. Beim nächsten Laden sperrt
die VoiceLibrary passende mitgelieferte/importierte Pakete, löscht ihre IndexedDB-
Einträge und bereinigt die Profilauswahl. Bekannte Löschungen bleiben lokal erhalten
und verhindern erneuten Import. Das Register ändert den `.fdvoice`-Vertrag nicht;
externe Dateikopien, alte Veröffentlichungen und Browser-HTTP-Caches gehören nicht
zum Löschzugriff der Werkstatt.

## Autorität und Lebensdauer

[VoiceRuntime](../../src/voice/VoiceRuntime.ts) lebt mit der Scene; Rundenzuordnungen
und Beobachter wechseln an Scope-Grenzen. Die
[Arena-Komposition](../../src/scenes/arena/ArenaVoiceComposition.ts) verbindet sie
mit dem NetworkBridge. Laufende Runden frieren bestehende Profilzuordnungen ein.
Der Host erzeugt fachliche Kandidaten und entscheidet über
[VoiceDirector](../../src/voice/VoiceDirector.ts) Sprecher und konkreten Clip.
Die Werkstatt-Vorschau verwendet dieselbe Regie. Effektive Schadensmeldungen kommen
erst nach den Gegner-/Trainings-/Eigenbeschussfiltern des World-Combat-Bindings.

Voice-RPCs müssen vom tatsächlichen Host stammen und zur World gehören; die
Audiowiedergabe prüft zusätzlich Rundenscope, Sequenz und Ablaufzeit. Es gibt keinen
Historien-Replay für Late Join oder gesperrtes Browseraudio. Ein bereits im gültigen
Scope angenommener Siegspruch darf den Wechsel in Ergebnis/Lobby zu Ende führen;
ein eingehendes altes World-Ereignis wird dadurch nicht gültig.

[VoiceAudioChannel](../../src/voice/VoiceAudioChannel.ts) nutzt den bestehenden
AudioContext mit eigener Lautstärke und begrenztem Decode-Speicher. Stummschalten,
versteckte Tabs und Scene-Teardown stoppen die Ausgabe. Sprache konkurriert nicht
mit dem Effekt-Voice-Pool und beeinflusst keine Gameplay-Entscheidungen.

Vertragstests: [Regie/Runtime](../../tests/VoiceDirector.test.ts),
[Audio](../../tests/VoiceAudioChannel.test.ts),
[Netzwerk](../../tests/integration/GameplayAudioNetwork.test.ts),
[Werkstatt](../../tools/voice-workshop/tests/workshop.test.mjs).
