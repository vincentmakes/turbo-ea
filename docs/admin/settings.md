# General Settings

The **Settings** page (**Admin > Settings**) provides centralized configuration for the platform's appearance, email, and module toggles.

## Appearance

### Logo

Upload a custom logo that appears in the top navigation bar. Supported formats: PNG, JPEG, SVG, WebP, GIF. Click **Reset** to revert to the default Turbo EA logo.

### Favicon

Upload a custom browser icon (favicon). The change takes effect on the next page load. Click **Reset** to revert to the default icon.

### Currency

Select the currency used for cost fields across the platform. This affects how cost values are formatted in card detail pages, reports, and exports. Over 20 currencies are supported, including USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, and more.

### Enabled Languages

Toggle which languages are available to users in their language selector. All eight supported locales can be individually enabled or disabled:

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

At least one language must remain enabled at all times.

### Fiscal Year Start

Select the month that begins your organization's fiscal year (January through December). This setting affects how **budget lines** in the PPM module are grouped by fiscal year. For example, if the fiscal year starts in April, a budget line dated June 2026 belongs to FY 2026–2027.

The default is **January** (calendar year = fiscal year).

## Email (SMTP)

Configure email delivery for invitation emails, survey notifications, and other system messages.

| Field | Description |
|-------|-------------|
| **SMTP Host** | Your mail server hostname (e.g., `smtp.gmail.com`) |
| **SMTP Port** | Server port (typically 587 for TLS) |
| **SMTP User** | Authentication username |
| **SMTP Password** | Authentication password (stored encrypted) |
| **Use TLS** | Enable TLS encryption (recommended) |
| **From Address** | The sender email address for outgoing messages |
| **App Base URL** | The public URL of your Turbo EA instance (used in email links) |

After configuring, click **Send Test Email** to verify the settings work correctly.

!!! note
    Email is optional. If SMTP is not configured, features that send emails (invitations, survey notifications) will gracefully skip email delivery.

## BPM Module

Toggle the **Business Process Management** module on or off. When disabled:

- The **BPM** navigation item is hidden from all users
- Business Process cards remain in the database but BPM-specific features (process flow editor, BPM dashboard, BPM reports) are not accessible

This is useful for organizations that do not use BPM and want a cleaner navigation experience.

## PPM Module

Toggle the **Project Portfolio Management** module on or off. When disabled:

- The **PPM** navigation item is hidden from all users
- Initiative cards remain in the database but PPM-specific features (status reports, budget & cost tracking, risk register, task board, Gantt chart) are not accessible

When enabled, Initiative cards gain a **PPM** tab in their detail view and the PPM portfolio dashboard becomes available in the main navigation. See [Project Portfolio Management](../guide/ppm.md) for the full feature guide.
