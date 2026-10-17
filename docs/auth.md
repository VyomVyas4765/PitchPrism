# Authentication foundation

The first milestone implements login, expiring/revocable sessions and protected role entry points. It does not implement role-specific business workflows or password reset; staff invitations are described below. All API routes use `/api/v1`.

## Interfaces

| Method/path | Access | Behavior |
| --- | --- | --- |
| `GET /health` | Public | Process health after database startup |
| `POST /auth/login` | Public, rate limited | `{email,password,client?:"web"|"mobile"}`; returns `{user}` and HttpOnly cookie for web, or `{user,accessToken}` for native |
| `POST /auth/register` | Public, rate limited | `{email, password (12–128), client?}` → creates an **entrepreneur** account and signs in; role/organisation fields are rejected; an existing email gets 409 |
| `GET /auth/me` | Session | Current user, role and organisation from database |
| `POST /auth/logout` | Session | Revokes that session and clears cookie; 204 |
| `GET /workspaces/:role` | Same role | Starter workspace and coarse capability keys |
| `GET /admin/overview` | HQ platform permission | Counts of organisations/users |
| `GET /orgs/:id/workspace` | Own organisation or HQ | Minimal organisation metadata |
| `GET /submissions/:id` | Scoped resource access | Read-only starter record with safe projection; missing/inaccessible records return 404 |
| `POST /auth/invites/preview` | Public, rate limited | `{token}` → invited email, role, organisation and expiry; invalid, used, revoked or expired links all return the same 404 |
| `POST /auth/invites/accept` | Public, rate limited | `{token, displayName, password (12–128), client?}` → creates the staff user with the invite's role and organisation and signs them in; single use |
| `GET /access/options` | `manage_org_users` | Organisations in the caller's scope and the roles the caller may assign in each |
| `GET /orgs` | `manage_org_users` | All organisations for HQ; the caller's own organisation otherwise |
| `POST /orgs`, `PATCH /orgs/:id` | HQ (`manage_platform`) | Create centres/partners (implementation partners need a parent centre; funding partners need lender/CSR mode); rename, set region/languages, deactivate/reactivate |
| `POST /invites`, `GET /invites`, `POST /invites/:id/revoke` | `manage_org_users`, scoped | Create a one-time link (returned once, token in the URL fragment), list and revoke |
| `GET /users`, `PATCH /users/:id` | `manage_org_users`, scoped | List staff; change role or disable (disabling also deletes their sessions); never your own account |

**Staff onboarding (W-01).** Staff accounts exist only through invitations. Who may invite whom follows PRD §4: HQ admins invite any staff role into any organisation; centre assessors and cohort leads invite centre assessors, cohort leads and facilitators to their own centre; implementation partners invite their own reviewers and facilitators; sector and funding partners invite their own reviewers. Every role must also fit the organisation type (the same table the session check uses). The invite stores only a sha256 of a 256-bit token; re-inviting an address revokes its earlier pending link; links expire after 72 hours. The accepting person chooses only their name and password; client-supplied role, organisation or status fields are rejected. Links are shown to the inviter rather than emailed, so no mail provider is needed.

Browser requests use the Next.js same-origin proxy; tokens are never put in browser local storage. Native requests send `Authorization: Bearer <accessToken>` from secure device storage. Input schemas reject client-supplied role/org fields; there is no public staff signup. Future administrative invitations must use reviewed, scoped endpoints.

Session lifetime is eight hours. JWT contains the subject and session ID; every request verifies its signature/issuer/audience/expiry, active Mongo session, current user and current organisation. Logout invalidates the token in Mongo immediately; database TTL cleanup is not relied on for expiry. Role changes, account disablement and inactive organisations are checked on every request. Role-to-org-type mismatches are denied.

Cookies are HttpOnly, SameSite=Lax, and Secure in production. Mutation origins must match `WEB_ORIGIN`; cookie-authenticated mutations also require that Origin. Native bearer requests do not require a browser Origin. Sign-in uses salted scrypt password hashes and a per-process IP limiter (10 attempts / 15 minutes, shared across password/phone exchange). A multi-instance deployment needs a shared limiter store and explicit reverse-proxy configuration.

## Resource access

| Role | Starter submission scope |
| --- | --- |
| Entrepreneur | Its own entrepreneur ID |
| Facilitator | Submissions created by that user |
| Centre assessor / cohort lead | Owning centre equals its organisation |
| HQ admin | All submissions |
| Implementation partner | Source organisation equals its organisation |
| Sector partner | Active sector share for its organisation |
| Funding lender | Active funding share, SHORTLISTED status and funding-ready flag |
| Funding CSR | No individual submissions; aggregate reports are future work |

Partners receive an explicit minimal projection. Applicant name/phone appear only after contact acceptance on the current active share. Shares/internal ownership identifiers never appear in that partner response. Revoking the share removes access on the next request. Consent/contact write endpoints remain assigned work; tests change synthetic share state directly to verify the read boundary. The prototype stores no real applicant fixtures, and the seed creates only synthetic orgs/staff.

`backend/src/auth/authorization.ts` is the shared scope/permission integration point. Every future resource route must include its scope and safe projection. The starter capability list is deliberately coarse; implement each full PRD action with its specific permission and scope. Client redirects/navigation are convenience, never the access boundary.

## Configuration and remaining setup

`pnpm setup:env` creates a private `.env` with random secrets and seed password, without overwriting an existing file. `pnpm seed` is development-only and idempotent; it does not reset existing users. Production startup rejects non-HTTPS browser origins and a missing `PII_ENCRYPTION_KEY`.

Sign-in is email and password for every role (D-27); there is no phone, OTP or SMS sign-in and no Firebase dependency. Email addresses are not verified (no mail provider), so a wrong address cannot be recovered without an administrator.
