# Users & Roles

![User and Role Management](../assets/img/en/21_admin_users.png)

The **Users & Roles** page has two tabs: **Users** (manage accounts) and **Roles** (manage permissions).

#### User Table

The user list displays all registered accounts with the following columns:

| Column | Description |
|--------|-------------|
| **Name** | User's display name |
| **Email** | Email address (used for login) |
| **Role** | Assigned role (selectable inline via dropdown) |
| **Auth** | Authentication method: "Local", "SSO", "SSO + Password", or "Pending Setup" |
| **Status** | Active or Disabled |
| **Actions** | Edit, activate/deactivate, or delete the user |

#### Inviting a New User

1. Click the **Invite User** button (top right)
2. Fill in the form:
   - **Display Name** (required): The user's full name
   - **Email** (required): The email address they will use to log in
   - **Password** (optional): If left blank and SSO is disabled, the user receives an email with a password setup link. If SSO is enabled, the user can sign in via their SSO provider without a password
   - **Role**: Select the role to assign (Admin, Member, Viewer, or any custom role)
   - **Send invitation email**: Check this to send an email notification to the user with login instructions
3. Click **Invite User** to create the account

**What happens behind the scenes:**
- A user account is created in the system
- An SSO invitation record is also created, so if the user logs in via SSO, they automatically receive the pre-assigned role
- If no password is set and SSO is disabled, a password setup token is generated. The user can set their password by following the link in the invitation email

#### Editing a User

Click the **edit icon** on any user row to open the Edit User dialog. You can change:

- **Display Name** and **Email**
- **Authentication Method** (visible only when SSO is enabled): Switch between "Local" and "SSO". This allows administrators to convert an existing local account to SSO, or vice versa. When switching to SSO, the account will be automatically linked when the user next logs in via their SSO provider
- **Password** (only for Local users): Set a new password. Leave blank to keep the current password
- **Role**: Change the user's application-level role

#### Linking an Existing Local Account to SSO

If a user already has a local account and your organization enables SSO, the user will see the error "A local account with this email already exists" when they try to log in via SSO. To resolve this:

1. Go to **Admin > Users**
2. Click the **edit icon** next to the user
3. Change the **Authentication Method** from "Local" to "SSO"
4. Click **Save Changes**
5. The user can now log in via SSO. Their account will be automatically linked on first SSO login

#### Pending Invitations

Below the user table, a **Pending Invitations** section shows all invitations that have not yet been accepted. Each invitation shows the email, pre-assigned role, and invitation date. You can revoke an invitation by clicking the delete icon.

#### Roles

The **Roles** tab allows managing application-level roles. Each role defines a set of permissions that control what users with that role can do. Default roles:

| Role | Description |
|------|-------------|
| **Admin** | Full access to all features and administration |
| **BPM Admin** | Full BPM permissions plus inventory access, no admin settings |
| **Member** | Create, edit, and manage cards, relations, and comments. No admin access |
| **Viewer** | Read-only access across all areas |

Custom roles can be created with granular permission control over inventory, relations, stakeholders, comments, documents, diagrams, BPM, reports, and more.

#### Deactivating a User

Click the **toggle icon** in the Actions column to activate or deactivate a user. Deactivated users:

- Cannot log in
- Retain their data (cards, comments, history) for audit purposes
- Can be reactivated at any time
