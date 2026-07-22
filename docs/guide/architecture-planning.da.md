# Arkitekturplanlægning

Arkitekturplanlægning er et manuelt planlægningsværktøj i **EA Delivery** til at modellere ændringer i jeres landskab — udskifte én applikation med en anden for en bestemt organisation, udfase et ældre system eller indføre en ny platform — og formidle dem som **ét samlet før/efter-diagram**. Det giver et resultat, der ligner TurboLens Architect, men helt uden AI: I bevarer fuld kontrol over hver foreslået ændring.

Resultatet er en Layered Dependency View, der viser den nuværende og den planlagte tilstand i ét billede, med ændringsindikatorer:

- **Rødt kryds** — et kort eller en relation markeret til fjernelse
- **Grønt plus** — et nytilføjet kort eller en nytilføjet relation
- **Blå skiftepile** — en udskiftning: efterfølgerkortet og de forbindelser, det arver

## Opret en plan

Åbn **EA Delivery** og brug **Tilføj → Ny arkitekturplan** på et initiativ (eller opret en fritstående plan og tilknyt den senere). En plan bygges i fire trin:

1. **Forretningsmål** *(valgfrit)* — angiv de målkort, som denne ændring understøtter. De vises i diagrammets strategilag, så alle interessenter ser *hvorfor* ved siden af *hvad*, og de forudfylder initiativets links, når planen overføres.
2. **Omfang og baseline** — vælg et eller flere omfangskort (en organisation, en forretningskapabilitet, enkelte applikationer, …) og en afhængighedsdybde (1–3). **Tag baseline** tager et øjebliksbillede af det omgivende landskab som før-billedet. Øjebliksbilledet holder diagrammet stabilt, selv når beholdningen ændrer sig; brug **Opdater baseline** for at tage det igen senere — planlagte ændringer, hvis mål er forsvundet, markeres.
3. **Planlagte ændringer** — anvend ændringsoperationer fra værktøjskassen:
    - **Tilføj kort** — hent et eksisterende kort ind i billedet, eller foreslå et helt nyt (navn + type).
    - **Fjern kort** — markér et kort til udfasning. Dets forbindelser bliver røde.
    - **Erstat kort** — vælg kortet, der skal erstattes, og dets efterfølger (eksisterende eller foreslået). Efterfølgeren arver forgængerens relationer, vist som blå skiftekanter; afbryd enkelte arvede relationer med **Fjern relation**.
    - **Tilføj / fjern relation** — tegn nye forbindelser eller afbryd eksisterende. Relationstyper valideres mod metamodellen.
4. **Live-forhåndsvisning** — det sammenflettede før/efter-diagram opdateres, mens I planlægger. Gem planen når som helst; den vises i initiativets sektion **Leverancer**.

## Overfør en plan

Et planudkast kan **overføres** (kræver tilladelsen *Overfør arkitekturplaner*). Overførslen:

- opretter et **initiativkort** (med det valgte navn og start-/slutdato) knyttet til de understøttede mål,
- opretter de valgte **foreslåede kort** og **relationer** og knytter hvert nyt kort til initiativet,
- stempler en **udløbsdato** (initiativets slutdato) på fjernede og erstattede kort, så livscyklusrapporter og køreplaner afspejler planen,
- opretter valgfrit en **kladde til et Architecture Decision Record**, der dokumenterer hver ændring — inklusive afbrudte relationer, som kun dokumenteres og aldrig slettes.

!!! note
    Overførslen arkiverer eller sletter aldrig noget. Fjernede kort får en udløbsdato; den faktiske udfasning forbliver et bevidst, menneskeligt skridt gennem de normale beholdningsarbejdsgange.

Efter overførslen bliver planen skrivebeskyttet og linker til det oprettede initiativ.

## Tilladelser

| Tilladelse | Giver |
|------------|-------|
| `arch_plans.view` | Se arkitekturplaner |
| `arch_plans.manage` | Oprette, redigere og slette planer |
| `arch_plans.commit` | Overføre en plan (oprette initiativ, kort, relationer, ADR-kladde, stemple udløbsdatoer) |

Medlemmer kan som standard se, administrere og overføre planer; læsere kan kun se dem.
