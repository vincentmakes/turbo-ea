# Notifications

Turbo EA keeps you informed about changes to cards, tasks, and documents that matter to you. Notifications are delivered **in-app** (via the notification bell) and optionally **by email** if SMTP is configured.

## Notification Bell

The **bell icon** in the top navigation bar shows a badge with the count of unread notifications. Click it to open a dropdown with your 20 most recent notifications.

Each notification shows:

- **Icon** indicating the notification type
- **Summary** of what happened (e.g., "A todo was assigned to you on SAP S/4HANA")
- **Time** since the notification was created (e.g., "5 minutes ago")

Click any notification to navigate directly to the relevant card or document. Notifications are automatically marked as read when you view them.

## Notification Types

| Type | Trigger |
|------|---------|
| **Todo assigned** | A todo is assigned to you |
| **Card updated** | A card you are a stakeholder on is updated |
| **Comment added** | A new comment is posted on a card you are a stakeholder on |
| **Approval status changed** | A card's approval status changes (approved, rejected, broken) |
| **SoAW sign requested** | You are asked to sign a Statement of Architecture Work |
| **SoAW signed** | A SoAW you are tracking receives a signature |
| **Survey request** | A survey is sent that requires your response |

## Real-Time Delivery

Notifications are delivered in real time using Server-Sent Events (SSE). You do not need to refresh the page — new notifications appear automatically and the badge count updates instantly.

## Notification Preferences

Click the **gear icon** in the notification dropdown (or go to your profile menu) to configure your notification preferences.

For each notification type, you can independently toggle:

- **In-app** — Whether it appears in the notification bell
- **Email** — Whether an email is also sent (requires SMTP to be configured by an admin)

Some notification types (e.g., survey requests) may have email delivery enforced by the system and cannot be disabled.
