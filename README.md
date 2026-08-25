# Sino Secure

Production website and underwriting intake console for
[sinosecure.eu](https://sinosecure.eu), built with Next.js App Router,
TypeScript, Netlify Functions, Netlify Database and Netlify Blobs.

## What is included

- Public marketing site and underwriting enquiry form at `/contact#enquiry`
- Customer upload portal at `/secure-upload/[code]`
- Staff sign-in and underwriting console at `/underwriting-desk`
- Customer proposal and access-token creation
- Matter, document and audit views
- Super-admin user table for adding, disabling, resetting and assigning users
- Netlify Forms archive plus optional direct email notifications

The operational hierarchy is `client → many projects → one current upload token per
project`. Documents, expiry, proposal delivery and audit history stay separated by
project even when the client has several projects.

## Roles and permissions

| Role | Create customer tokens and proposals | Review matters and documents | Manage users and email settings |
| --- | --- | --- | --- |
| `super_admin` | Yes | Yes | Yes |
| `admin` | Yes | Yes | No |
| `staff` | Yes | Yes | No |

The one-time bootstrap flow creates the first `super_admin`. A migration promotes
the oldest active administrator on installations created before this role existed.
The last active super administrator cannot be demoted or disabled.

## Production setup

1. Import this repository into Netlify and use the committed `netlify.toml`.
2. Enable Netlify Forms detection. The forms are `sino-underwriting` and
   `sino-document-activity`.
3. Configure the environment variables below and redeploy.
4. Open `/underwriting-desk`. If no users exist, create the first super
   administrator with the one-time setup key.
5. Open **Team & settings** to add users and confirm the displayed notification
   recipient.
6. Create a test customer link, upload a harmless test PDF, confirm the matter and
   audit event, then close the test matter.

Netlify automatically applies the SQL migrations in
`netlify/database/migrations` before publishing a production deploy. A failed
migration blocks publication.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `UNDERWRITING_ADMIN_KEY` | Initial setup | At least 16 characters. Used once to create the first super administrator; it is not a daily login password. |
| `UNDERWRITING_NOTIFY_EMAIL` | Recommended | The explicit mailbox that receives new-enquiry and document-upload alerts. Its address and readiness are shown to the super admin under **Team & settings**. |
| `RESEND_API_KEY` | For direct email | Resend credential used for proposal delivery and direct desk notifications. |
| `PROPOSAL_FROM_EMAIL` | For direct email | Verified sender, for example `Sino Secure <underwriting@sinosecure.eu>`. |
| `PROPOSAL_BCC_EMAIL` | Optional | Blind copy of proposals sent through the site. |
| `URL` | Supplied by Netlify | Canonical site origin used to build secure-upload links. |

Production notification mailbox: `UNDERWRITING_NOTIFY_EMAIL=underwriting@sinosecure.eu`.

### Which email receives the public contact form?

No recipient email is hard-coded in the repository. Public enquiries are always
archived in Netlify Forms as `sino-underwriting`. Before
`UNDERWRITING_NOTIFY_EMAIL` is configured, any email recipient exists only in
**Netlify → Forms → Form notifications** and cannot be determined from source code.

After `UNDERWRITING_NOTIFY_EMAIL`, `RESEND_API_KEY` and `PROPOSAL_FROM_EMAIL` are
configured, the application sends direct alerts to that explicit mailbox and shows
the address in **Team & settings**. The Netlify Forms records remain enabled. Remove
any duplicate Netlify form email notification if both routes deliver the same alert.

## Staff workflow

1. Sign in at `/underwriting-desk`.
2. Open **Client token / proposal**.
3. Select an existing client or create a new one, then name the specific project or
   proposal and set its coverage and token lifetime.
4. Choose **Send proposal** to create the project and token as the message is sent, or
   **Create client token** to hand the token over by phone or chat.
5. Copy the access code only at issuance time. Only its SHA-256 digest is stored.
6. Review uploads in **Matters**. Issuing a replacement token immediately retires the
   previous one.

Every token and proposal is attributed to the signed-in user in the matter and audit
trail. Customer tokens expire after the selected duration and are never staff session
credentials.

## Security model

- Staff passwords use scrypt with a per-account salt.
- Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax` and expire after 12 hours.
- Login and customer-code failures are throttled and audited.
- Only token digests are stored; plaintext customer codes are shown at issuance.
- Uploaded files are private Netlify Blobs, downloaded only through an authenticated
  function, and always served as opaque attachments.
- Uploads are allow-listed by extension, capped at 25 MB per file and 40 files per
  matter, assembled in chunks, and SHA-256 checksummed.
- Private routes use `no-store`, `noindex` and restrictive referrer headers.
- Disabling a user invalidates all of that user's sessions immediately.

## Local development

```bash
npm ci
npm run dev
npm run typecheck
npm run build
```

Plain `next dev` does not emulate Netlify Functions, Database, Blobs or Forms. Use a
linked Netlify CLI environment for an end-to-end local test:

```bash
netlify dev --port 8889
```

Do not run production database migrations manually unless a documented recovery
procedure requires it; deployments apply them automatically.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/components/UnderwritingPortal.tsx` | Public enquiry and handoff to upload |
| `src/components/SecureUploadPanel.tsx` | Customer code validation and chunked upload |
| `src/components/UnderwritingDesk.tsx` | Authenticated console shell |
| `src/components/desk/` | Proposal, matter, team and account UI |
| `netlify/functions/uw-auth.mts` | Login, setup, sessions and super-admin user management |
| `netlify/functions/uw-desk.mts` | Authenticated proposal, matter, token and document actions |
| `netlify/functions/uw-portal.mts` | Public enquiry, code access and upload actions |
| `db/schema.ts` | Database schema |
| `netlify/database/migrations/` | Automatically applied SQL migrations |
| `lib/email.ts` | Outbound email provider boundary and notification status |
| `lib/auth.ts` | Password, session and role enforcement |
| `lib/portal.ts` | Matter/token resolution and audit operations |
| `public/__forms.html` | Static Netlify Forms detection definitions |

## Release verification

Before merging or publishing, verify:

- `npm run typecheck`
- `npm run build`
- Initial or existing super-admin sign-in
- Super admin can add a staff user; ordinary admin and staff receive `403` on user APIs
- New user must change the one-time password
- Token/link issuance is attributed to the signed-in user
- Old token fails after rotation; new token succeeds
- Test PDF uploads and downloads through the authenticated console
- **Team & settings** displays the intended `UNDERWRITING_NOTIFY_EMAIL`
- Enquiry and upload alerts arrive once in that mailbox
- Netlify Forms contains matching archival entries
- `/underwriting-desk` and `/secure-upload/*` are not cached or indexed
