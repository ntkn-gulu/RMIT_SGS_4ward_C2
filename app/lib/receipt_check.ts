// Re-checks every approval against the Tide realm's public key. A database admin
// can edit db.json, but cannot produce a receipt the Tide network did not sign.
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose"
import tc_config from "../tidecloak.json"
import { Expense, ROLE_APPROVER, requiredApprovals } from "./expense_store"
import { rolesFromPayload } from "./request_auth"

export type ReceiptVerdict =
{
    username: string
    valid: boolean
    problems: string[]
}

export type ExpenseVerdict =
{
    expense_id: string
    trusted: boolean
    approvals_needed: number
    approvals_proven: number
    receipts: ReceiptVerdict[]
    problems: string[]
}

const config_any = tc_config as Record<string, any>
const ISSUER     = `${String(config_any["auth-server-url"]).replace(/\/$/, "")}/realms/${config_any.realm}`
const JWK_SET    = createLocalJWKSet(config_any.jwk)

async function checkReceipt(expense: Expense, receipt: string, claimed_vuid: string): Promise<{ problems: string[]; vuid: string | null }>
{
    const problems: string[] = []
    let issued_at = 0
    try
    {
        issued_at = Number(decodeJwt(receipt).iat ?? 0)
    }
    catch
    {
        return { problems: ["Receipt is not a JWT"], vuid: null }
    }

    try
    {
        // Check the signature as of issue time, so old receipts stay verifiable.
        const { payload } = await jwtVerify(receipt, JWK_SET,
        {
            issuer: ISSUER,
            algorithms: ["EdDSA", "ES256", "ES384", "ES512"],
            currentDate: new Date(issued_at * 1000),
        })
        const signed_vuid = String(payload.vuid ?? payload.sub)
        if (signed_vuid !== claimed_vuid)
        {
            problems.push("Receipt belongs to a different person")
        }
        if (!rolesFromPayload(payload as Record<string, any>).includes(ROLE_APPROVER))
        {
            problems.push("Signer did not hold the approver role")
        }
        if (signed_vuid === expense.submitter_vuid)
        {
            problems.push("Submitter approved their own expense")
        }
        if (issued_at * 1000 < Date.parse(expense.created_at) - 60_000)
        {
            problems.push("Receipt was issued before the expense existed")
        }
        return { problems, vuid: signed_vuid }
    }
    catch (err: any)
    {
        return { problems: [`Signature not from Tide (${err?.code ?? "invalid"})`], vuid: null }
    }
}

export async function verifyExpense(expense: Expense): Promise<ExpenseVerdict>
{
    const receipts: ReceiptVerdict[] = []
    const proven_signers = new Set<string>()

    for (const approval of expense.approvals)
    {
        const result = await checkReceipt(expense, approval.receipt, approval.vuid)
        const valid  = result.problems.length === 0
        if (valid && result.vuid)
        {
            proven_signers.add(result.vuid)
        }
        receipts.push({ username: approval.username, valid, problems: result.problems })
    }

    const approvals_needed = requiredApprovals(expense.amount)
    const approvals_proven = proven_signers.size
    const problems: string[] = []
    const claims_approved  = expense.status === "APPROVED" || expense.status === "PAID"

    if (claims_approved && approvals_proven < approvals_needed)
    {
        problems.push(`Marked ${expense.status} with only ${approvals_proven} of ${approvals_needed} proven approvals`)
    }
    if (proven_signers.size < expense.approvals.filter((a, i) => receipts[i].valid).length)
    {
        problems.push("Same approver counted twice")
    }

    return {
        expense_id: expense.id,
        trusted: problems.length === 0 && receipts.every(r => r.valid),
        approvals_needed,
        approvals_proven,
        receipts,
        problems,
    }
}
