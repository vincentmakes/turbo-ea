# Roadmap Studio

Jede EA-Funktion bekommt von ihrem CIO dieselben zwei Fragen gestellt: *Wie
sieht die Landschaft in drei Jahren aus?* und *Was passiert, wenn wir uns anders
entscheiden?* Foliensätze beantworten die erste schlecht und die zweite gar
nicht — sie veralten in der Woche nach dem Lenkungsausschuss, und zwei von ihnen
lassen sich nicht vergleichen.

**Roadmap Studio** beantwortet beide aus dem Inventar, das Sie ohnehin pflegen.
Ein **Szenario** ist ein Plan über Ihrer lebenden Landschaft — dies ablösen,
jenes zu diesem Datum ersetzen, diese drei Dinge ergänzen, die es noch nicht
gibt — gespeichert als Menge von Änderungen und nicht als Kopie Ihres Graphen.
Was Sie erkunden, berührt Ihr Inventar erst, wenn ein Plan genehmigt und
angewendet wurde, und da der Plan gegen den heutigen Stand des Inventars gelesen
wird, entfernt er sich nie unbemerkt von der Realität.

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | Kommerziell — eine signierte Berechtigung ist erforderlich |
| **Mindestversion von Turbo EA** | 2.119.0 |
| **Berechtigungen** | `ext.roadmap-studio.view`, `.manage`, `.apply`, `.admin` |
| **Datenzugriffs-Grants** | Karten (lesen + schreiben), Kartenereignisse, Aufgaben (lesen + schreiben), das Benutzerverzeichnis, Entscheidungsdokumente |
| **Backend-Neustart nötig** | Ja — die Erweiterung liefert Backend-Code |
| **Wo sie erscheint** | **Roadmap** in der Hauptnavigation · ein Chip auf der Kartendetailseite · ein Panel und ein Exportabschnitt auf Entscheidungen |

## Transformationen und Szenarien

Eine **Transformation** ist das Programm, zu dem konkurrierende Pläne gehören —
etwa «ERP-Modernisierung» — und sie benennt die
[Ziele](../guide/reports.md), für die das Programm verantwortlich ist. Darunter
liegen die **Szenarien**: alternative Antworten auf dieselbe Frage. Eines davon
kann als **empfohlen** markiert werden, damit der Raum weiß, was die Architektin
vorschlägt, bevor die Zahlen gelesen werden.

Ein Szenario außerhalb jeder Transformation ist völlig zulässig; es hat
schlicht keine Alternativen, gegenüber denen es gewählt würde.

## Planungsinventar und Roadmap

![Die Roadmap: Swimlanes, Plateaus und das Kostenband](../assets/img/en/73_ext_roadmap_studio_roadmap.png)

Die **Roadmap** zeichnet den Plan als datierte Balken in Swimlanes, mit einem
Kostenband darunter, das die laufenden Kosten Jahr für Jahr zeigt — einschließlich
des Anstiegs während eines Parallelbetriebs, also genau der Zahl, die ein
Migrations-Business-Case sonst gern verschweigt.

![Das Planungsinventar](../assets/img/en/74_ext_roadmap_studio_inventory.png)

Das **Planungsinventar** ist derselbe Plan als Tabelle: Ihre lebenden Karten
plus die geplanten, mit jeder Änderung dazu. Geplante Karten leben im Szenario
und nie in Ihrem Hauptinventar.

Eine Änderung, deren Zielkarte inzwischen archiviert, verschoben oder anderswo
umdatiert wurde, wird als **veraltet markiert** — mit Begründung. So sagt Ihnen
ein vor drei Monaten geschriebener Plan, was sich unter ihm bewegt hat.

## Plateaus und der Architekturschnitt

![Die Architektur an einem Plateau](../assets/img/en/75_ext_roadmap_studio_architecture.png)

Da jede Änderung ein Datum trägt, ist die Architektur zu jedem Zeitpunkt einfach
das zu diesem Datum ausgewertete Szenario. Benennen Sie die wichtigen Zeitpunkte
als **Plateaus** — «T1 · Kernkonsolidierung, Q3 2027» — und gehen Sie sie durch:
Roadmap, Abhängigkeitsansicht und Zahlen bewegen sich gemeinsam.

## Szenarien vergleichen

![Szenarien im Vergleich zum Nichtstun](../assets/img/en/76_ext_roadmap_studio_compare.png)

**Vergleich** stellt jedes Szenario neben die Nichtstun-Basislinie: laufende
Kosten am Horizont, Transformationsausgaben, Kartenanzahl und
End-of-Life-Exposition, mit den **Pro und Contra** jedes Plans neben seinen
Zahlen. Ein optionaler Diskontsatz wirkt auf künftige Jahre.

## Wo der Plan auf die Karte trifft

![Der Platz einer Karte in den Plänen](../assets/img/en/77_ext_roadmap_studio_card_panel.png)

Öffnen Sie eine beliebige Karte in Ihrem Inventar, und ein Chip sagt Ihnen,
welche Pläne sie erwähnen und wie — als etwas, das abgelöst wird, als Nachfolger
in einer Ersetzung oder als Karte, die ein Plan unter ein neues übergeordnetes
Element hängt.

## Prüfung, Entscheidung und Anwendung

Das ist der Governance-Pfad, und er trennt drei wirklich verschiedene Dinge:
**Beratung**, **die Entscheidung** und **das Schreiben**.

### 1 · Um Prüfung bitten

**Prüfung anfordern** benennt die Personen, deren Meinung Sie wollen, und legt
für jede eine echte Aufgabe an, die ihre Aufgabenseite und ihre
Benachrichtigungsglocke erreicht. Die Auswahl umfasst das gesamte
Benutzerverzeichnis — Prüferin ist, wer bei *diesem* Plan helfen kann: die
Sicherheitsarchitektin beim einen, die Finanzpartnerin beim anderen.

Jede Prüferin antwortet in der App mit **Befürworten**, **Änderungen erbitten**
oder **Kommentieren**, dazu eine Notiz. Diese Antworten sind Beratung. Sie
entscheiden nichts — deshalb verwenden sie nicht mehr die Wörter «zustimmen» und
«ablehnen».

### 2 · Darüber sprechen

Alle, die den Plan lesen können, können in seiner **Diskussion** schreiben. Der
Verlauf trägt die ganze Geschichte in der Reihenfolge, in der sie geschah:
Kommentare, jede Prüfantwort (nicht nur die letzte) und später die Einreichungen
und Stimmen. Das Gremium liest dieselbe Diskussion wie die Prüfer, statt ein
Urteil ohne die Argumente dahinter zu erhalten.

### 3 · Beim Prüfgremium einreichen

Ein **Prüfgremium** ist eine benannte Gruppe von Personen, die einer
Transformation zugeordnet ist (siehe unten). Hat ein Plan eines, sendet ihn
**Zur Entscheidung einreichen** dorthin:

- der Status wird **Entscheidung ausstehend** und der Inhalt des Plans wird
  **gesperrt**, damit alle über dasselbe Dokument abstimmen;
- jedes Mitglied erhält eine Aufgabe *Entscheiden über …* mit der üblichen
  Zuweisungsbenachrichtigung;
- Sie wählen hier, ob die Genehmigung ein **Entscheidungsdokument** ablegen und
  die **Initiativen** anlegen soll — entschieden bei der Einreichung, damit die
  Abstimmenden sehen, was ihr Ja erzeugen wird.

Das **Genehmigungs-Gate** (Admin → Einstellungen, siehe unten) kann einen Plan
vor seinem Gremium zurückhalten, bis Prüfer geantwortet haben.

### 4 · Das Gremium stimmt ab

Jedes Mitglied stimmt mit **Zustimmen**, **Ablehnen** oder **Enthalten**, mit
optionaler Notiz, und kann seine Stimme ändern, solange die Runde offen ist. Der
Dialog zeigt den Stand, wie viele Zustimmungen noch fehlen und was jedes Mitglied
gesagt hat.

Die Runde endet, sobald die **Entscheidungsregel** des Gremiums erfüllt ist:

| Regel | Genehmigt, wenn | Lehnt ab, wenn |
|---|---|---|
| **Mehrheit** (Standard) | Mehr als die Hälfte zustimmt | So viele abgelehnt haben, dass eine Mehrheit unmöglich ist |
| **Einstimmig** | Alle Mitglieder zustimmen | Ein Mitglied ablehnt **oder** sich enthält |
| **Ein beliebiges Mitglied** | Ein Mitglied zustimmt | Alle abgestimmt haben, ohne Zustimmung |

Eine Ablehnung erfolgt, sobald eine Genehmigung rechnerisch unmöglich geworden
ist — und nicht erst, wenn alle über eine bereits entschiedene Frage abgestimmt
haben.

**Mitglied des Gremiums** zu sein berechtigt zur Stimme —
`ext.roadmap-studio.apply` ist dafür nicht nötig. Die **Autorin des Plans darf
mitstimmen**; der Dialog sagt das ausdrücklich, und das Dokument nennt, wer wie
gestimmt hat.

**Zurückziehen** nimmt einen Plan aus der Hand des Gremiums, bevor es entschieden
hat. Die Autorin, wer ihn eingereicht hat, und jedes Mitglied können das tun —
ein Gremium, das eine Überarbeitung möchte, soll den Plan dafür nicht ablehnen
müssen. Die Aufgaben der Mitglieder werden entfernt, nicht als erledigt markiert,
und der Plan kehrt in die Prüfung zurück.

### 5 · Was die Genehmigung bewirkt

Die entscheidende Stimme tut alles auf einmal: konkurrierende Szenarien
derselben Transformation werden **abgelehnt**, der Plan wird **gesperrt**, offene
Anfragen werden erledigt, die **Initiativen** werden angelegt (ein Programm für
die Transformation, ein Projekt je Plateau), und ein
**Entscheidungsdokument** wird als Entwurf in
[EA-Lieferung → Entscheidungen](../guide/delivery.md) abgelegt: mit dem Gremium,
seiner Regel, dem Stimmenstand, jeder Stimme samt Notiz, den Zielen, den
Plateaus, den Kennzahlen gegenüber dem Nichtstun und jeder abgelehnten
Alternative. Anschließend werden Unterschriften von den Mitgliedern angefordert,
die zugestimmt haben.

Ein genehmigter Plan ist schreibgeschützt, bis eine Person mit
`ext.roadmap-studio.apply` ihn **wieder öffnet**, was die Genehmigung aufhebt.

### 6 · Anwenden

**Anwenden** schreibt den Plan in Ihr lebendes Inventar, unter
`ext.roadmap-studio.apply`. Das ist ein eigener Schritt, oft Monate nach der
Entscheidung. Jeder Schreibvorgang läuft über die auditierte Batch-Mechanik,
erscheint also im **Admin → Audit-Log** und kann zurückgerollt werden. Eine
`.manage`-Benutzerin kann denselben Plan schreibgeschützt öffnen, um zu prüfen,
dass er sauber landen würde.

### Szenarien ohne Prüfgremium

Ein Szenario außerhalb einer Transformation oder eines, dessen Transformation
kein Gremium hat, behält den einfacheren Weg: eine Person mit
`ext.roadmap-studio.apply` genehmigt es direkt. Ein kleines Team ohne
Governance-Gremium muss keines erfinden.

## Prüfgremien

Gremien werden an einer Stelle verwaltet: **Einstellungen → Governance →
Prüfgremien verwalten** auf der Roadmap-Seite (erfordert
`ext.roadmap-studio.admin`). Ein Gremium hat einen Namen, eine Beschreibung, bis
zu 25 Mitglieder und eine **Entscheidungsregel**. Ordnen Sie es von beiden Seiten
einer oder mehreren Transformationen zu.

Das Löschen eines Gremiums löst die Zuordnung der geprüften Transformationen; es
löscht sie nie, und es rührt nie an den Nachweis dessen, was es früher
entschieden hat.

## Einstellungen und Historie

![Einstellungen und die Aktivitätshistorie](../assets/img/en/79_ext_roadmap_studio_settings.png)

Der Reiter **Einstellungen** der Roadmap-Seite (erfordert
`ext.roadmap-studio.admin`) enthält:

| Einstellung | Wirkung |
|---|---|
| **Kostenmodell** | Welches Attribut die jährlichen Betriebskosten einer Karte hält, welche Kartentypen die Kennzahl zählt, wie weit die End-of-Life-Exposition vorausschaut, und ein optionaler Diskontsatz |
| **Genehmigungs-Gate** | Ob Prüferantworten einen Plan vor seinem Gremium zurückhalten: nie, solange Änderungen erbeten sind, oder bis alle Prüfer geantwortet haben |
| **Prüfgremien** | Öffnet den Gremien-Dialog |

Die Karte **Historie** ist ein vollständiges Aktivitätsjournal — jeder Plan,
jede Karte, Änderung, jedes Plateau, jede Prüfanfrage, Antwort, Einreichung,
Stimme, jeder Kommentar und jede Entscheidung, mit Urheber und Änderung.

## Präsentationsmodus und Foliensatz

![Präsentationsmodus](../assets/img/en/78_ext_roadmap_studio_present.png)

Der **Präsentationsmodus** führt einen Raum Plateau für Plateau durch den Plan,
und der PowerPoint-Export folgt genau der Reihenfolge, die Sie eben gegangen sind.

## Demodaten

Ein Klick in den Einstellungen lädt eine vollständige Beispiel-Landschaft mit
zwei konkurrierenden Szenarien, sodass Sie alles ausprobieren können, bevor Sie
eigene Daten eingeben. Ein weiterer Klick entfernt jede Spur davon.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `ext.roadmap-studio.view` | Szenarien, Vergleiche, Plateaus, Diskussion und Entscheidung sehen |
| `ext.roadmap-studio.manage` | Pläne erstellen und bearbeiten, Prüfung anfordern, zur Entscheidung einreichen, zurückziehen |
| `ext.roadmap-studio.apply` | Einen genehmigten Plan auf das lebende Inventar anwenden, ihn wieder öffnen und einen Plan ohne Prüfgremium genehmigen |
| `ext.roadmap-studio.admin` | Einstellungen, Prüfgremien und Demodaten |

Abstimmen ist keine Berechtigung: Es ergibt sich aus der **Mitgliedschaft im
Gremium**, das über den Plan entscheidet, plus `ext.roadmap-studio.view` zum
Öffnen. Alle mit `.view` dürfen in der Diskussion schreiben.

## Wenn die Lizenz abläuft oder die Erweiterung deaktiviert wird

Die Roadmap-Seite und ihre API verschwinden, aber **nichts wird gelöscht** —
Szenarien, Pläne, Stimmen und die Diskussion bleiben in den eigenen Tabellen der
Erweiterung. Karten, die die Erweiterung in Ihrem Inventar angelegt hat, sind
gewöhnliche Karten und bleiben unberührt. Eine erneuerte Lizenz bringt alles
zurück.

## Hinweise und Grenzen

- **Ein Plan zugleich** geht innerhalb derselben Transformation an ein Gremium.
- **Kein Vorsitz und keine Stimmgewichte.** Jede Stimme zählt einmal, und es gibt
  keine Stichentscheidung.
- **Keine Erinnerungen.** Eine Runde bleibt offen, bis die Regel sie entscheidet
  oder jemand zurückzieht.
- **Die Autorin darf über ihren eigenen Plan mitstimmen.** Das ist Absicht: Ein
  kleines Gremium, dessen Architektin nicht mitstimmen darf, könnte nichts
  entscheiden, und jede Stimme wird im Dokument benannt.
- Die Erweiterung liefert Backend-Code; Installation oder Aktualisierung
  erfordern daher einen einmaligen Backend-Neustart. Turbo EA zeigt dann einen
  Hinweis an.
