# Custom Languages

Turbo EA ships with ten built-in languages. When your organisation needs another one — Dutch, Polish, Japanese, a regional variant such as Brazilian Portuguese — an administrator can add it as a **custom language** and fill its translations without waiting for a new release.

A custom language lives in your database, not in the application code. You add it, translate it, review it, and enable it for your users when it is ready. The built-in languages are not affected.

You need the **admin.settings** permission for everything on this page.

## Adding a custom language

Go to **Admin > Settings > General**. The **Custom languages** section sits just below [Enabled Languages](settings.md#enabled-languages).

Click **Add language** and fill in:

| Field | Description |
|-------|-------------|
| **Code** | A short language code: two or three lowercase letters, optionally followed by a dash and a two-letter region in capitals — `nl`, `pl`, `pt-BR`. It cannot be the code of a built-in language. |
| **Native name** | The name users see in their language menu, written in the language itself — *Nederlands*, *Polski*. |
| **English name** | The name of the language in English — *Dutch*, *Polish*. It is what the AI provider is told to translate into. Letters, spaces, brackets and dashes only. |
| **Right-to-left** | Tick it for a language written from right to left, such as Hebrew or Persian. |

A new language starts **disabled**: users do not see it until you switch it on. Each language in the list shows a progress bar with how many strings are translated, and two counts:

- **Missing** — strings that have no translation yet.
- **Stale** — strings that were translated, but whose English text has changed since. Until they are translated again, users see the old translation, which is usually better than falling back to English.

Switch a language on with its **Enabled** toggle. Users can then pick it from the language menu in their user profile, like any built-in language. Strings that are still missing appear in English.

## Three ways to translate

Use whichever suits you; they can be combined, and the result is the same.

### 1. Export a file and import it back

**Export** downloads a language-pack file (JSON). Choose what goes in it:

- **Missing** — the English text of every string that is missing or stale. Use this for the first translation and after each upgrade.
- **All** — the English text of every string, to translate everything again.
- **Current** — the translations you already have. This is the file to share with another Turbo EA installation, or to keep as a backup.

Translate the file anywhere — a translation agency, a translation tool, or an AI chat — then **Import** it. The import checks the file, saves the strings one area of the application at a time, and shows a report: how many strings were applied, how many were unchanged, and which were rejected and why.

### 2. Translate with your AI provider

If an AI provider is configured under [AI Capabilities](ai.md), **Translate with AI** translates the language in the background. Choose:

- **New and changed strings** — only the missing and stale ones. This is the usual choice.
- **Everything** — every string again. Strings you corrected by hand are kept unless you ask for them to be translated too.

The dialog shows how many strings will be sent, then the progress while it runs; you can close it and come back, or cancel the run. The AI is given the translations you already have as a reference, so new strings use the same words for the same things. A string the AI returns in an unusable form is not saved; it stays missing and is tried again on the next run.

This option does not depend on the AI description suggestions for cards being switched on — only on a provider being configured.

### 3. Through an AI assistant (MCP)

An AI assistant connected through the [MCP integration](mcp.md) can translate the language for you, using three tools:

- `list_custom_languages` — which custom languages exist and how far each one is translated.
- `get_untranslated_strings` — the English strings still to translate, page by page, with the translation instructions.
- `submit_translations` — sends the translations back. It previews first and saves on confirmation, like every MCP write tool.

Ask the assistant, for example: *"Translate the missing strings of our Dutch custom language."* The assistant works with your own permissions, and every call it makes is recorded in the audit log.

## The language-pack file

A language pack is a JSON file like this:

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** holds the text to translate, grouped by area of the application (`common`, `admin`, `cards`, …). Translate the **values** only; never change the keys.
- Keep everything in double curly braces, such as `{{count}}` or `{{name}}`, exactly as it is: the application fills in a value there. Keep tags such as `<1>` and `</1>` and references such as `$t(common:actions.save)` too.
- **source_hashes** records which English text each string was made from. Leave it in the file: on import it tells Turbo EA whether the English has changed since the file was exported.
- **instructions** repeats these rules in plain words, so you can hand the file to a translator or an AI chat as it is.

When you import, each string is checked on its own. A string is rejected when its key is unknown, when it is empty or much longer than the English, when it loses or adds a placeholder or a `$t(...)` reference, or when it brings in a tag or a link that the English text does not have. A rejected string never stops the others from being saved.

A file exported for another language code can still be imported; you are asked to confirm first.

## Reviewing and correcting strings

**Review strings** lists the strings of a language with the English text beside each translation. Filter by area, by status (missing, stale, translated) or by text, and edit or clear any translation in place. Your corrections take effect as soon as you save them.

## After an upgrade

Each Turbo EA release adds and changes some English text. After an upgrade, the custom language shows the new strings as **missing** and the changed ones as **stale** — everything else keeps its translation. Fill the gap with any of the three ways above: export with **Missing**, run **Translate with AI** with **New and changed strings**, or ask your assistant.

Corrections you made by hand are kept. An AI run over **Everything** leaves them alone unless you ask for them to be translated again.

## Limits

- **Only the application's own text is covered.** The names of card types, fields, relations and other metamodel labels are translated separately, in the [metamodel](metamodel.md) dialogs, and only into the built-in languages for now. The same goes for this documentation site.
- **Plural forms.** English has two plural forms (*one card*, *2 cards*). A language with more — such as Polish, Russian or Arabic — can add its extra forms (`_few`, `_many`, …) beside the English ones in an imported file; the AI translation and the review screen work on the English forms only.
- Deleting a custom language removes all its translations. Users who had chosen it are switched back to English.
