# Architecture

TwoKeys: a dual-control expense desk for the RMIT × Tide UNLOCKED challenge. A Next.js app (`app/`) uses a
local TideCloak server for login, roles, quorum-governed administration and end-to-end encryption.

## Files

| Path | Role |
|---|---|
| `README.md` | Judging overview (five prompts), how it works, limitations, setup. |
| `app/tidecloak.json` | Adapter config written by `init/tcinit.sh`: realm, client, and the realm's public signing key (`jwk`). |
| `app/init/tcinit.sh`, `app/init/realm.json` | Tide's realm provisioning script and realm template (from `@tidecloak/create-nextjs`). |
| `app/init/tcresume.sh` | Same script starting at the enrollment step, for a realm whose Tide setup already succeeded. |
| `app/app/layout.tsx` | Wraps every page in `TideCloakProvider`; loads `globals.css`. |
| `app/app/page.tsx` | Sign-in page. Redirects to `/home` when authenticated. |
| `app/app/home/page.tsx` | Renders `ExpenseDesk`. |
| `app/components/expense_desk.tsx` | The whole desk UI: submit, approve/reject, pay, vendor bank details (encrypt/decrypt), audit. |
| `app/app/api/expenses/route.ts` | `GET` desk data (any user), `POST` new expense (`expense-submitter`). |
| `app/app/api/expenses/[id]/[action]/route.ts` | `POST approve|reject` (`expense-approver`), `POST pay` (`expense-finance`, re-verifies receipts first). |
| `app/app/api/vendors/[id]/route.ts` | `PUT` vendor bank ciphertext (`expense-finance`). |
| `app/app/api/audit/route.ts` | `GET` receipt verification for every expense (any user). |
| `app/lib/expense_store.ts` | Types, constants (roles, A$10,000 threshold), JSON file store `app/data/db.json` (seeded with 3 vendors). |
| `app/lib/request_auth.ts` | `requireUser`: verifies the bearer token with `verifyTideCloakToken` and an optional role list. |
| `app/lib/receipt_check.ts` | `verifyExpense`: checks each approval token's Tide signature as of its issue time, signer = claimed approver, approver role, not the submitter, issued after the expense; counts distinct proven approvers. |
| `app/scripts/create_roles.sh` | Proposes the desk roles (parked as change requests). |
| `app/scripts/desk_admin.sh` | `pending`, `invite`, `link`, `grant` helpers against the TideCloak admin REST API. |
| `app/scripts/rogue_admin.mjs` | Forges approvals in `db.json` with a self-made Ed25519 key (`--undo` removes them). |
| `app/app/tide_dpop/`, `app/app/auth/redirect/`, `app/app/api/protected/`, `app/app/protected/`, `app/proxy.ts` | Template routes from the TideCloak quickstart (DPoP page, post-login redirect, token check sample). |

## Roles (realm `expdesk3`)

| Role | Grants |
|---|---|
| `expense-submitter` | Submit expenses. |
| `expense-approver` | Approve or reject other people's pending expenses. |
| `expense-finance` | Store vendor bank details, pay approved expenses. Composite of `_tide_payee.selfencrypt` and `_tide_payee.selfdecrypt`. |
| `tide-realm-admin` (client role) | Approve change requests in the tide-console. Quorum = `max(1, floor(0.7 × admins))`. |

## Data flow

```
browser ──login──► TideCloak ◄──threshold signing / decryption──► Tide network (ORKs)
   │  access token (signed by Tide key)
   ├──doEncrypt/doDecrypt (tag "payee")──► Tide network      (bank details never reach the server in plain text)
   └──Bearer token──► Next.js API ──verifyTideCloakToken──► role check
                         │ approve: stores the token as the approval receipt
                         │ pay / audit: receipt_check re-verifies receipts with tidecloak.json jwk
                         ▼
                    app/data/db.json  (expenses, approvals with receipts, vendors with bank ciphertext)
```

## Expense states

`PENDING` → `APPROVED` (1 approval below A$10,000, 2 distinct approvers at or above) → `PAID` (only if receipts verify).
`PENDING` → `REJECTED` (any approver except the submitter).

## Conventions

- Variables and object fields `snake_case`, functions `camelCase`, components and types `PascalCase`, constants `UPPER_SNAKE_CASE`.
- Files `snake_case`, except names fixed by Next.js routing (`page.tsx`, `route.ts`, `layout.tsx`). Component files are `snake_case` too (`expense_desk.tsx`).
- Allman braces in project code; template files from the quickstart keep their original style.
- Comments in simple English; adjacent trailing comments aligned.
