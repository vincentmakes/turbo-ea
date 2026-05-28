# Udnyt referencekataloger

Den klassiske fejl på dette tidspunkt: at bruge tre uger på at workshoppe en skræddersyet forretningskompetencemodel, to uger mere på at afstemme den med ledelsen og derefter opdage, at modellen er 80 % identisk med, hvad enhver anden virksomhed i din branche bruger.

**Modellér ikke fra bunden.** Turbo EA leveres med tre kuraterede kataloger, der giver dig et kampprøvet udgangspunkt, som du kan tilpasse på dage i stedet for måneder:

- **Forretningskompetencekatalog** — flerniveaus kompetencehierarkier pr. branche (bank, detail, produktion, forsikring, offentlig sektor osv.) plus tværindustrielle makrokompetencer.
- **Proceskatalog** — referenceforretningsprocesser pr. branche, klar til at importere som `BusinessProcess`-kort.
- **Værdistrømskatalog** — end-to-end-værdistrømme til at indramme kompetencekortet.

Denne side fokuserer på forretningskompetencekataloget, fordi det er det, der driver kompetenceheatmappet på den sidste side. De to andre fungerer på samme måde.

## Hvorfor starte med kompetencer

En **forretningskompetence** er *hvad forretningen gør*, udtrykt på et stabilt, teknologi-uafhængigt sprog — "Ordrestyring", "Kundeonboarding", "Skadebehandling". Kompetencer ændrer sig næsten ikke gennem årene; applikationer ændrer sig hele tiden. Det er derfor, applikation-til-kompetence-kortlægningen er den enkelt mest nyttige relation i hele metamodellen:

- Den lader dig spørge **"hvor mange applikationer understøtter kundeonboarding?"** — og opdage redundans.
- Den lader dig spørge **"hvilke kompetencer afhænger af en enkelt aldrende applikation?"** — og opdage skrøbelighed.
- Den overlever omorganiseringer, leverandørbytter og cloudmigrationer.

Du har ikke brug for 500 kompetencer for at få værdi. Du har brug for **20–60 kompetencer, to eller tre niveauer dybt**, i dit område.

## Importer et start-kompetencekort

1. Naviger til **Kompetencekatalog** i hovedmenuen (under brugervejledning).
2. Brug filtrene øverst:
    - **Branche** — vælg din (eller "Tværindustriel", hvis intet passer).
    - **Niveau** — start med L1 og L2 synlige. Du kan altid gå dybere senere.
3. Browse træet. Udvid et par grene for at få en fornemmelse af dybden.
4. Sæt flueben ved de kompetencer, du vil importere. **Markering kaskaderer**: at sætte flueben ved en L1 sætter flueben ved dens efterkommere; at sætte flueben ved en L2 sætter også flueben ved dens L1-forfader, så hierarkiet forbliver forbundet.
5. Klik på **Opret kort fra udvalg**.

Turbo EA opretter ét `BusinessCapability`-kort pr. afkrydset node, bevarer forælder-barn-hierarkiet og stempler hvert kort med et stabilt `catalogueId`, så genimport er **idempotent** — at køre importen to gange opretter ikke dubletter.

Fuld reference: [Kompetencekatalog](../guide/capability-catalogue.md).

!!! tip "Bedste praksis"
    Vælg et undertræ, ikke hele kataloget. For en rationalisering af applikationsportefølje i salgsdomænet er det normalt nok at importere L1-kompetencen "Salg & kundestyring" plus dens L2-børn — det er 10–15 kompetencer, ikke 300.

## Hvor dybt skal man gå

Den rigtige dybde afhænger af, hvad du vil gøre med det:

| Dybde | Hvornår skal det bruges | Typisk kortantal |
|-------|------------|--------------------|
| **Kun L1** | Topledersresuméer, meget små områder | 8–12 |
| **L1 + L2** | Det optimale punkt for en første udrulning — læselig på én skærm, nyttig i rapporter | 30–60 |
| **L1 + L2 + L3** | Detaljeret kompetencebaseret planlægning, store virksomheder | 100–250 |
| **L4 og dybere** | Specifikke dybdedyk, ikke til en startbaseline | varierer |

Gå til **L1 + L2** for din første runde. Du kan altid importere yderligere niveauer senere via det samme katalog — den idempotente genimport vil indpasse dem under de eksisterende forældre.

## Et ord om processer og værdistrømme

**Proceskataloget** og **værdistrømskataloget** fungerer på samme måde: filtrér, sæt flueben, masseopret. Hvis din første use case er rationalisering af applikationsportefølje, kan du springe dem over for nu — kompetencekortlægning er nok til at drive analysen på den sidste side.

Du vil have brug for dem, når:

- Du bevæger dig fra "rationaliser applikationer" til "optimer ordre-til-betaling-værdistrømmen".
- Du begynder at bygge BPMN-procesflows på de resulterende `BusinessProcess`-kort (se [BPM](../guide/bpm.md)).

## Hvad hvis min branche ikke er i kataloget?

To muligheder:

1. **Vælg den nærmeste branche** og beskær. "Tværindustriel"-poster (økonomi, HR, IT, indkøb) gælder for stort set alle virksomheder.
2. **Kombiner kataloger** — importer "Tværindustriel" først, og fyld derefter op med et par poster fra et specifikt branchekatalog.

Uanset hvad, **importer først, tilpas efter**. At omdøbe en importeret kompetence eller tilføje et barn er meget hurtigere end at indtaste hele strukturen fra bunden. Og du beholder `catalogueId`, så fremtidige katalogopdateringer flettes pænt.

!!! warning "Lad være"
    Opret ikke brugerdefinerede korttyper for kompetencer eller processer bare for at "gøre dem til dine egne". De indbyggede typer leveres med de rigtige felter, de rigtige relationstyper og de rigtige rapporter — brugerdefinerede ækvivalenter vil ikke gøre det.

## Verificér, før du går videre

Du er færdig med denne side, når:

- Kompetencekortet for dit område findes i lageret (filtrér efter Type = `Business Capability`).
- Hierarkiet er intakt — åbn et par L2-kompetencer, og kontrollér, at forælderbrødkrummestien viser den rigtige L1.
- Kompetenceantallet er mellem 20 og 60.

Du har endnu ikke kortlagt nogen applikationer til kompetencer — det kommer på sidste side. Lad os først tilføje ét brugerdefineret felt til applikationer for at gøre analysen virkelig nyttig.

Næste: [Tilpas metamodellen — let](customise-the-metamodel.md).
