---
title: "An AI suggestion only asks for values the card type accepts, saves the description even when another value is refused, and is written in the user's language"
author: Claude
date: 2026-11-23
branch: claude/elegant-bardeen-tf71l1
cost: { minutes: 1, tokens: 3193 }
id: l-066149cd
scope: repo
status: active
src: agent
touches:
  - backend/app/services/ai_service.py
  - backend/app/api/v1/ai_suggest.py
  - frontend/src/features/cards/applyAiSuggestion.ts
  - frontend/src/components/AiSuggestPanel.tsx
  - frontend/src/features/cards/CardDetail.tsx
---

## Decided
Discussion 1422: Apply on an AI suggestion did nothing. The cause was on our side. For Application cards the model is also asked for Commercial Application and Hosting Type, and the Hosting Type choices were a list kept in the prompt code. Once an admin removed or renamed an option, the suggestion carried a value the card type refuses, the whole save was refused (description included), and the handler showed nothing.

The owner asked for two things: ignore such values so the description still applies, and pass the user's language to the model.

- The extra fields are resolved against the card type each time. A field that is gone, has another type, is calculated, is hidden by the card's subtype or has no options left is neither asked for nor accepted. The choices are the field's current options, shown to the model as `key (Label)` because an admin's key such as `opt6` says nothing on its own.
- If the save is still refused, the description is saved alone and a warning gives the server's reason. A save that fails entirely is shown in the panel, which stays open.
- The description is written in the user's language: the live UI language first, then the saved one, then English. Only a language name from a fixed list of the ten locales reaches the prompt, never the text the client sent.
- Portfolio Insights and TurboLens keep their language behaviour; the owner asked for suggestions only.

## Tried and ruled out
- Retrying with only the refused value removed: left out. With the choices read from the card type a refusal is rare, and it would add a third request. The owner was told and may still ask for it.
- Detecting a card switch on the card page by comparing the route id with the card's id: the server accepts an id written in upper case or without hyphens and answers with the canonical one, so on such a link the comparison is never true and the suggestion never appears. A counter bumped whenever the route id changes is used instead.
- Reading the language from the saved locale alone: the catalogue endpoints already take the live UI language first because the saved one can lag behind, so the same order is used.

## Watch out
- The user's language never reached the model before this change. German answers the reporter saw were the model's own choice, driven by the card name and the language of the search results, not by their language setting.
- A response with nothing usable used to render no panel while every host hides its suggest button as long as a response is held, so the user could neither read anything nor ask again. The panel now says there is nothing to suggest and offers Dismiss; keep that state if the panel is reworked.
- The panel filters suggested values against the card type too, so a browser with an older metamodel does not send a value the server would refuse.
- This cloud container has no Docker, so the API suite cannot run through the usual script. One API test file was run against the container's own PostgreSQL 16 with a `turboea` role and a `turboea_test` database; the rest waits for CI.

In the code:
- backend/app/services/ai_service.py: `_resolve_extra_field`, `_get_extra_fields`, `_option_choice`, `subtype_hidden_fields`, `LOCALE_LANGUAGE_NAMES`, `language_for_locale`
- backend/app/api/v1/ai_suggest.py: `_effective_locale`
- frontend/src/features/cards/applyAiSuggestion.ts
- frontend/src/components/AiSuggestPanel.tsx: `fitsField`, the `hiddenFields` prop, the nothing-to-suggest state
- frontend/src/features/cards/CardDetail.tsx: `aiEpochRef`
