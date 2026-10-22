[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

_TwoKeys is a spending desk where no single admin, server or AI can approve a payment, appoint an approver, or redirect money alone._

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

Every finance policy says "big spends need two approvers". In software, that rule is only a promise kept by whoever has admin rights. TwoKeys makes dual control self-enforcing. The Tide network, not the app operator, holds the rules for who may approve, what counts as an approval, and who may read where the money goes.

### 2. Trust constraint insight

Today an IT admin can quietly make themselves an approver, a database admin can flip "pending" to "approved", and anyone with server access can swap a supplier's bank account (payment-redirection fraud). Companies either trust admins completely or add slow manual call-backs. Without unilateral control, small teams get real separation of duties on hosting they don't trust.

### 3. Value & impact

Finance teams in SMEs and NGOs, and their auditors. Alice submits a A$48,000 freight invoice; Bob and the CFO must both approve. Forged database approvals are refused at payment and flagged by the audit.

### 4. Why TideCloak matters

- **Who can approve:** role grants are change requests that need an admin quorum (Quorum-Enforced Administration).
- **What counts as an approval:** each approval keeps the approver's token, signed by Tide's threshold key. Our server can verify it but can never mint one, and payment re-verifies every receipt.
- **Where money goes:** payee bank details are encrypted in the browser (`doEncrypt`, tag `payee`). Only the Finance role can decrypt them, through Tide. The database holds ciphertext.

### 5. Prototype & storytelling

Watch for: two people approving a A$48,000 expense; a forged database approval blocked at payment; a role grant waiting for the admin quorum.

---

## Demo video

[`demo.mp4`](demo.mp4) (2 minutes)

## How it works

| Piece | Where | What it does |
|---|---|---|
| Expense rules | `app/app/api/expenses/` | Submitters submit. A$10,000+ needs two different approvers. Nobody approves their own expense. |
| Approval receipts | `app/lib/receipt_check.ts` | Re-verifies each stored token against the realm's Tide public key (Ed25519), and checks the role, the person and the timing. |
| Payment gate | `app/app/api/expenses/[id]/[action]/route.ts` | `pay` refuses unless the receipts prove the required approvals. A status field alone is never enough. |
| Payee vault | `app/components/expense_desk.tsx` | Bank details are encrypted and decrypted in the browser with TideCloak E2EE. |
| Rogue admin | `app/scripts/rogue_admin.mjs` | Forges approvals straight into the database, to show they fail. |

## Limitations and next step

- A receipt proves that a person holding the approver role was signed in and approved recently. It is not yet bound to one specific expense. The next step is a Forseti policy, so the Tide network co-signs each approval for an exact expense ID and amount (`createTideRequest` → `executeSignRequest`).
- The data store is a JSON file. All data is synthetic, and payments are mocked.
- The free development licence limits the number of enrolled users, so the demo uses three people.

## Setup

Requirements: Docker, Node.js 20+, `bash`, `curl`, `jq`.

```bash
# 1. TideCloak dev server
docker run --name mytidecloak -d -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  tideorg/tidecloak-dev:latest

# 2. Provision the realm (opens a Tide enrollment link for the first admin)
cd app
npm install
NEW_REALM_NAME=twokeys CLIENT_NAME=twokeys-app bash init/tcinit.sh

# 3. Create the desk roles and demo users (each is a change request:
#    approve them in http://localhost:8080/realms/<realm>/tide-console/ → QEA Approvals)
bash scripts/create_roles.sh
bash scripts/desk_admin.sh invite alice bob
bash scripts/desk_admin.sh link alice        # enrollment link for alice
bash scripts/desk_admin.sh grant alice expense-submitter
bash scripts/desk_admin.sh grant bob expense-approver
bash scripts/desk_admin.sh grant admin expense-finance
bash scripts/desk_admin.sh pending           # what still waits for the quorum

# 4. Run
npm run dev                                  # http://localhost:3000

# Rogue admin demo
node scripts/rogue_admin.mjs                 # forge approvals in data/db.json
node scripts/rogue_admin.mjs --undo
```

`expense-finance` must include the `_tide_payee.selfencrypt` and `_tide_payee.selfdecrypt` roles, either as composites or as direct grants.
