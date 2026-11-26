# Benutzerdefinierte Sprachen

Turbo EA wird mit zehn integrierten Sprachen ausgeliefert. Braucht Ihre Organisation eine weitere — Niederländisch, Polnisch, Hebräisch, Hindi, Thai, eine regionale Variante wie brasilianisches Portugiesisch —, kann ein Administrator sie als **benutzerdefinierte Sprache** hinzufügen und ihre Übersetzungen befüllen, ohne auf ein neues Release zu warten.

Eine benutzerdefinierte Sprache liegt in Ihrer Datenbank, nicht im Anwendungscode. Sie fügen sie hinzu, übersetzen sie, prüfen sie und bieten sie Ihren Benutzern an, sobald sie fertig ist. Die integrierten Sprachen bleiben unberührt.

Eine benutzerdefinierte Sprache deckt die gesamte Benutzeroberfläche **und** die Namen ab, die Ihr Metamodell den Dingen gibt: Kartentypen, Subtypen, Abschnitte, Felder und ihre Optionen, Beziehungen, Stakeholder-Rollen, Kategorien, Dashboards, Vorschriften, Ressourcentypen und die Hilfe zu den Lebenszyklusphasen.

Für alles auf dieser Seite benötigen Sie die Berechtigung **admin.settings**.

## Eine benutzerdefinierte Sprache hinzufügen

Gehen Sie zu **Admin > Einstellungen > Allgemein**. Der Abschnitt **Benutzerdefinierte Sprachen** befindet sich direkt unter [Aktivierte Sprachen](settings.md#aktivierte-sprachen).

Klicken Sie auf **Sprache hinzufügen** und füllen Sie aus:

| Feld | Beschreibung |
|------|--------------|
| **Sprachcode** | Ein kurzer Sprachcode: zwei oder drei Kleinbuchstaben, optional gefolgt von einer Schrift (`zh-Hant`) und einer zweistelligen Region in Großbuchstaben (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. Er darf nicht der Code einer integrierten Sprache sein. |
| **Muttersprachlicher Name** | Der Name, den Benutzer in ihrem Sprachmenü sehen, in der Sprache selbst geschrieben — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **Englischer Name** | Der Name der Sprache auf Englisch — *Dutch*, *Hebrew*. Der KI-Anbieter erhält die Anweisung, in diese Sprache zu übersetzen. Nur Buchstaben, Leerzeichen, Klammern und Bindestriche. |
| **Schrift von rechts nach links** | Aktivieren Sie sie für eine Sprache, die von rechts nach links geschrieben wird, etwa Hebräisch, Persisch oder Urdu. Sie ist standardmäßig aus; der Dialog weist darauf hin, wenn der Code üblicherweise von rechts nach links geschrieben wird, schaltet sie aber nie für Sie ein. |

Jede Schrift funktioniert: lateinisch, kyrillisch, hebräisch, arabisch, Devanagari, Thai und weitere, einschließlich der Verbindungszeichen und Markierungen, die diese Schriften benötigen. Ist **Schrift von rechts nach links** aktiv, wird die gesamte Anwendung für Benutzer, die die Sprache wählen, von rechts nach links aufgebaut, wie bei Arabisch.

Eine regionale Sprache ist eine eigene Sprache: `pt-BR` übernimmt nichts vom integrierten Portugiesisch, und `zh-Hant` übernimmt nichts vom integrierten Chinesisch. Solange eine Zeichenfolge nicht übersetzt ist, wird sie auf Englisch angezeigt.

Eine neue Sprache startet ausgeschaltet: Benutzer sehen sie erst, wenn Sie sie anbieten. Jede Sprache in der Liste zeigt einen Fortschrittsbalken mit der Anzahl übersetzter Zeichenfolgen und zwei Zählern:

- **Fehlt** — Zeichenfolgen, die noch keine Übersetzung haben.
- **Im Englischen geändert** — Zeichenfolgen, die übersetzt waren, deren englischer Text sich aber seither geändert hat. Bis sie erneut übersetzt werden, sehen Benutzer die alte Übersetzung, was meist besser ist als der Rückfall auf Englisch.

Bieten Sie eine Sprache Ihren Benutzern mit ihrem Schalter an. Benutzer können sie dann wie jede integrierte Sprache im Sprachmenü wählen. Zeichenfolgen, die noch fehlen, erscheinen auf Englisch.

## Eine Sprache aus der Community-Bibliothek installieren

Andere Turbo-EA-Nutzer teilen ihre Übersetzungen in der [Community-Sprachbibliothek](https://github.com/vincentmakes/turbo-ea-translations). Unterhalb Ihrer eigenen Sprachen listet der Block **Community-Sprachen** die enthaltenen Sprachen auf, jeweils mit ihrem muttersprachlichen Namen und Code, dem Anteil der übersetzten Oberfläche und der Turbo-EA-Version, mit der ihr Paket erstellt wurde.

!!! warning "Von der Community bereitgestellt, nicht geprüft"
    Die Pakete werden von Mitgliedern der Community verfasst. **Das Turbo-EA-Projekt prüft sie nicht.** Automatische Prüfungen stellen sicher, dass ein Paket kein Markup, keine Links und keine defekten Platzhalter einschleusen kann, die der englische Text nicht hat, aber niemand prüft, ob die Übersetzungen korrekt oder vollständig sind. Prüfen Sie eine Sprache, bevor Sie sie Ihren Benutzern anbieten.

**Installieren** lädt das Paket der Sprache herunter und importiert es. Dabei geschieht Folgendes:

- Das Paket wird aus der Community-Bibliothek heruntergeladen — genau die Datei, die die Bibliothek auflistet, geprüft anhand ihrer Prüfsumme.
- Jede Zeichenfolge durchläuft dieselben Prüfungen wie eine [importierte Datei](#the-language-pack-file); eine abgelehnte Zeichenfolge steht im Bericht und wird nie gespeichert.
- Eine neue Sprache wird **ausgeschaltet** hinzugefügt. Sehen Sie sie sich unter **Zeichenfolgen prüfen** an und schalten Sie sie dann für Ihre Benutzer ein.
- Der Bericht zeigt, was angewendet wurde, was abgelehnt wurde und warum, und was in Ihrer Version von Turbo EA nicht vorhanden ist.

Die Sprache erscheint dann als **installiert**, und ihre Zeile in Ihrer eigenen Liste trägt die Markierung **Von der Community bereitgestellt, nicht geprüft**. Eine fehlgeschlagene Installation — ein Paket, das nicht heruntergeladen werden kann, nicht zur Prüfsumme der Bibliothek passt oder kein gültiges Paket ist — installiert nichts und wird im [Protokoll Sicherheit & Administration](audit-log.md) festgehalten. Unter **Zeichenfolgen prüfen** zeigt jede Übersetzung ihre Herkunft — *Community-Bibliothek*, *Von Hand korrigiert*, *KI-Übersetzung*, *Importierte Datei* oder *MCP*.

Wenn die Bibliothek ein neueres Paket einer von dort installierten Sprache hat, zeigt die Sprache **Update verfügbar**. **Aktualisieren** führt das neue Paket in Ihre Sprache zusammen. Von Hand korrigierte Zeichenfolgen bleiben erhalten, es sei denn, Sie aktivieren **Auch die von Hand korrigierten Zeichenfolgen ersetzen**. Name, Richtung und Schalter Ihrer Sprache bleiben unverändert.

Wenn Sie eine Sprache selbst hinzugefügt haben und die Bibliothek denselben Code führt, zeigt ihre Zeile **Auf diesem Server hinzugefügt** und bietet **Community-Zeichenfolgen hinzufügen** an: Das Paket wird auf dieselbe Weise in Ihre Sprache zusammengeführt — von Hand korrigierte Zeichenfolgen bleiben erhalten, sofern Sie nichts anderes wählen —, und die Sprache wird danach als von der Community bereitgestellt gekennzeichnet.

Turbo EA kontaktiert die Bibliothek nur auf Ihre Anforderung: Beim ersten Anzeigen des Abschnitts wird die Liste heruntergeladen und gespeichert; danach wird die gespeicherte Liste (mit dem Datum ihres Downloads) angezeigt, bis Sie auf **Aktualisieren** klicken. Im Hintergrund wird nichts geprüft, ein neueres Paket erscheint also erst nach einer Aktualisierung als **Update verfügbar**. Ist die Bibliothek nicht erreichbar, weist der Block darauf hin und zeigt weiterhin die Liste des letzten erfolgreichen Downloads.

### Die Bibliothek ausschalten

Die Adresse der Bibliothek wird über die Umgebungsvariable `LANGUAGE_CATALOGUE_URL` gesetzt (Helm-Wert `customLanguages.catalogueUrl`). Setzen Sie sie auf einen leeren Wert, um die Funktion auszuschalten, zum Beispiel bei einer Installation ohne Internetzugang; der Block meldet dann, dass die Community-Bibliothek ausgeschaltet ist. Sie können sie auch auf eine Kopie der Bibliothek auf Ihrem eigenen Server richten: Die Pakete werden aus den Dateien `packs/<code>/pack.json` neben ihrer `index.json` heruntergeladen.

### Eine Sprache beitragen

Haben Sie eine Sprache übersetzt, die noch nicht in der Bibliothek ist, oder eine verbessert? Exportieren Sie sie mit **Sprachpaket exportieren > Teilen (Community-Paket)** und schlagen Sie sie der Bibliothek vor — siehe ihren [Beitragsleitfaden](https://github.com/vincentmakes/turbo-ea-translations/blob/main/CONTRIBUTING.md).

## Drei Wege zur Übersetzung

Verwenden Sie, was Ihnen passt; die Wege lassen sich kombinieren, und das Ergebnis ist dasselbe.

### 1. Eine Datei exportieren und wieder importieren

**Sprachpaket exportieren** lädt eine Sprachpaket-Datei (JSON) herunter. Wählen Sie, was sie enthält:

- **Neue und geänderte Zeichenfolgen (zu übersetzen)** — der englische Text jeder fehlenden oder geänderten Zeichenfolge. Verwenden Sie dies für die erste Übersetzung und nach jedem Upgrade.
- **Alle Zeichenfolgen auf Englisch (zu übersetzen)** — der englische Text jeder Zeichenfolge, um alles neu zu übersetzen.
- **Aktuelle Übersetzungen (einschließlich der eigenen Bezeichnungen dieser Installation)** — die bereits vorhandenen Übersetzungen, einschließlich der Namen in Ihrem eigenen Metamodell. Nutzen Sie sie als Sicherung oder um die Sprache in eine andere eigene Installation zu übertragen.
- **Teilen (Community-Paket)** — die bereits vorhandenen Übersetzungen, aber nur das, was in jeder Turbo-EA-Installation gleich ist: der Oberflächentext und die Namen des integrierten Metamodells, wie Turbo EA sie ausliefert. Alles, was für Ihre Installation spezifisch ist, bleibt außen vor — von Ihnen angelegte Kartentypen, Felder und Optionen, umbenannte integrierte Namen, Ihre Dashboards und Kategorien. Diese Datei eignet sich zum Teilen mit anderen Turbo-EA-Benutzern.

Übersetzen Sie die Datei wo immer Sie möchten — bei einer Übersetzungsagentur, mit einem Übersetzungswerkzeug oder in einem KI-Chat — und wählen Sie dann **Sprachpaket importieren**. Der Import prüft die Datei, speichert die Zeichenfolgen Abschnitt für Abschnitt und zeigt einen Bericht: wie viele Zeichenfolgen angewendet, unverändert oder geleert wurden, welche abgelehnt wurden und warum, und welche Schlüssel in dieser Version nicht vorkommen.

### 2. Mit Ihrem KI-Anbieter übersetzen

Ist unter [KI-Funktionen](ai.md) ein KI-Anbieter konfiguriert, übersetzt **Mit KI übersetzen** die Sprache im Hintergrund. Wählen Sie:

- **Neue und geänderte Zeichenfolgen** — nur die fehlenden und geänderten. Das ist die übliche Wahl.
- **Alles** — jede Zeichenfolge erneut. Von Hand korrigierte Zeichenfolgen bleiben erhalten, es sei denn, Sie aktivieren zusätzlich **Auch von Hand korrigierte Zeichenfolgen ersetzen**.

Der Dialog zeigt, wie viele Zeichenfolgen gesendet werden, und anschließend den Fortschritt; Sie können ihn schließen und später zurückkehren oder **Übersetzung beenden**. Zuerst werden die Namen Ihrer Kartentypen, Felder und Beziehungen übersetzt, danach der Rest der Oberfläche mit diesen Namen als Referenz, damit dieselbe Sache überall gleich heißt. Eine Zeichenfolge, die die KI in unbrauchbarer Form zurückgibt, wird nicht gespeichert; sie bleibt fehlend und wird beim nächsten Durchlauf erneut versucht.

Diese Option hängt nicht davon ab, dass die KI-Beschreibungsvorschläge für Karten eingeschaltet sind — nur davon, dass ein Anbieter konfiguriert ist.

### 3. Über einen KI-Assistenten (MCP)

Ein über die [MCP-Integration](mcp.md) verbundener KI-Assistent kann die Sprache für Sie übersetzen und nutzt dafür diese Werkzeuge:

- `list_custom_languages` — welche benutzerdefinierten Sprachen es gibt und wie weit jede übersetzt ist.
- `get_untranslated_strings` — die noch zu übersetzenden englischen Zeichenfolgen, Seite für Seite (bis zu 500 auf einmal), mit den Übersetzungsanweisungen. Ein Text, der an vielen Stellen vorkommt, etwa „High“ oder „Description“, wird einmal aufgeführt.
- `submit_translations` — sendet eine Seite mit Übersetzungen zurück und speichert sie sofort, ohne Vorschau: Jede Zeichenfolge wird einzeln geprüft, und nur gültige werden gespeichert. Eine Übersetzung füllt außerdem jede andere unübersetzte Zeichenfolge mit demselben englischen Text; eine bereits übersetzte Zeichenfolge wird nie geändert, und eine falsche Füllung korrigieren Sie in der Prüftabelle.
- `start_ai_translation` und `stop_ai_translation` — starten oder beenden den serverseitigen Job **Mit KI übersetzen**, sodass eine ganze Sprache eine einzige Anfrage ist. Der Job läuft auf dem unter [KI-Funktionen](ai.md) konfigurierten KI-Anbieter, nicht auf dem Assistenten; der Assistent zeigt zuerst in einer Vorschau, wie viele Zeichenfolgen gesendet würden, und gibt bei einem großen Job die Bestätigung der Vorschau beim Start zurück.

Bitten Sie den Assistenten zum Beispiel: *„Übersetze die fehlenden Zeichenfolgen unserer benutzerdefinierten Sprache Niederländisch, beginnend mit den Metamodell-Namen.“* Der Assistent arbeitet mit Ihren eigenen Berechtigungen, und jede seiner Änderungen wird im Audit-Log festgehalten.

## Die Sprachpaket-Datei

Ein Sprachpaket ist eine JSON-Datei wie diese:

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "metamodel": {
      "type.Application.label": "Application",
      "type.Application.field.businessCriticality": "Business Criticality"
    },
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "metamodel": {
      "type.Application.label": "5c1e0a9d7b32",
      "type.Application.field.businessCriticality": "a90d3f17c4e8"
    },
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** enthält den zu übersetzenden Text, gruppiert nach Abschnitt (`metamodel`, `common`, `admin`, `cards`, …). Übersetzen Sie nur die **Werte**; ändern Sie nie die Schlüssel.
- Der Abschnitt **metamodel** enthält die Namen von Kartentypen, Feldern, Optionen, Beziehungen und die übrigen in Ihrer Datenbank gespeicherten Bezeichnungen. Es sind kurze Bezeichnungen, auf die sich der Rest der Oberfläche bezieht: Übersetzen Sie sie zuerst und verwenden Sie überall sonst dieselben Wörter dafür.
- Lassen Sie alles in doppelten geschweiften Klammern, etwa `{{count}}` oder `{{name}}`, genau so, wie es ist: Die Anwendung setzt dort einen Wert ein. Behalten Sie auch Tags wie `<1>` und `</1>` und Verweise wie `$t(common:actions.save)` bei.
- **source_hashes** hält fest, aus welchem englischen Text jede Zeichenfolge entstanden ist. Lassen Sie es in der Datei: Beim Import erkennt Turbo EA daran, ob sich das Englische seit dem Export der Datei geändert hat. Für den Abschnitt **metamodel** ist es Pflicht — ein Eintrag ohne Hash wird abgelehnt —, denn so bleibt eine Übersetzung von einem zwischenzeitlich umbenannten Namen fern.
- **instructions** wiederholt diese Regeln in einfachen Worten, sodass Sie die Datei unverändert an einen Übersetzer oder einen KI-Chat weitergeben können.

Beim Import wird jede Zeichenfolge für sich geprüft. Ein Schlüssel, den diese Version von Turbo EA nicht kennt — aus einem Paket für eine andere Version —, wird als nicht in dieser Version gezählt und im Bericht genannt. Eine Zeichenfolge wird abgelehnt, wenn sie leer oder viel länger als das Englische ist, wenn sie einen Platzhalter oder einen `$t(...)`-Verweis verliert oder hinzufügt oder wenn sie ein Tag oder einen Link enthält, den der englische Text nicht hat. Im Abschnitt **metamodel** wird eine Übersetzung außerdem abgelehnt, wenn sie keinen Hash trägt, und übersprungen, wenn der Name, aus dem sie entstanden ist, seit dem Export der Datei geändert wurde — eine Übersetzung von „Application“ landet nie auf einem Kartentyp, den jemand umbenannt hat. Eine Übersetzung, die der bereits gespeicherten entspricht, wird als unverändert gemeldet. Eine abgelehnte Zeichenfolge verhindert nie, dass die anderen gespeichert werden.

Eine für einen anderen Sprachcode exportierte Datei kann trotzdem importiert werden; zuvor werden Sie um Bestätigung gebeten.

## Zeichenfolgen prüfen und korrigieren

**Zeichenfolgen prüfen** listet die Zeichenfolgen einer Sprache auf, mit dem englischen Text neben jeder Übersetzung. Filtern Sie nach Abschnitt, nach Status (fehlt, im Englischen geändert, übersetzt) oder nach Text und bearbeiten oder löschen Sie jede Übersetzung direkt. Ihre Korrekturen gelten, sobald Sie sie speichern.

## Nach einem Upgrade

Jedes Turbo-EA-Release fügt englischen Text hinzu und ändert einen Teil davon, und Sie benennen möglicherweise Dinge in Ihrem Metamodell um. Danach zeigt die benutzerdefinierte Sprache die neuen Zeichenfolgen als **fehlend** und die geänderten als **im Englischen geändert** — alles andere behält seine Übersetzung. Schließen Sie die Lücke auf einem der drei Wege oben: Exportieren Sie die neuen und geänderten Zeichenfolgen, starten Sie **Mit KI übersetzen** mit **Neue und geänderte Zeichenfolgen**, oder bitten Sie Ihren Assistenten.

Von Hand vorgenommene Korrekturen bleiben erhalten. Ein KI-Durchlauf über **Alles** lässt sie in Ruhe, es sei denn, Sie aktivieren **Auch von Hand korrigierte Zeichenfolgen ersetzen**.

## Grenzen

- **Die Dokumentationsseite ist nicht abgedeckt.** Dieses Handbuch bleibt in den integrierten Sprachen.
- **Umfragen behalten die Bezeichnungen, mit denen sie erstellt wurden.** Eine Umfrage, die erstellt wurde, bevor die Optionen eines Feldes übersetzt waren, behält die Optionsbezeichnungen, mit denen sie erstellt wurde.
- **Pluralformen.** Das Englische hat zwei Pluralformen (*one card*, *2 cards*). Eine Sprache mit mehr — etwa Polnisch, Russisch oder Arabisch — kann ihre zusätzlichen Formen (`_few`, `_many`, …) in einer importierten Datei neben den englischen ergänzen. Eine Form, die das Paket nicht enthält, fällt auf die allgemeine Form der Sprache zurück (die `_other`-Übersetzung), nie auf Englisch. Die KI-Übersetzung und die Prüfansicht arbeiten ebenfalls mit den bereits gespeicherten zusätzlichen Formen, legen aber keine neuen an: Ergänzen Sie diese über eine Datei.
- Das Löschen einer benutzerdefinierten Sprache entfernt alle ihre Übersetzungen, einschließlich der Namen von Kartentypen, Feldern und der übrigen Metamodell-Bezeichnungen. Benutzer, die sie gewählt hatten, werden wieder auf Englisch umgestellt.
