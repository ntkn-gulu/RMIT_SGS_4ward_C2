import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/request_auth"
import { ROLE_APPROVER, ROLE_FINANCE, readDesk, requiredApprovals, writeDesk } from "@/lib/expense_store"
import { verifyExpense } from "@/lib/receipt_check"

type RouteContext = { params: Promise<{ id: string; action: string }> }

function fail(message: string, status = 409): NextResponse
{
    return NextResponse.json({ error: message }, { status })
}

// approve | reject | pay one expense.
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse>
{
    const { id, action } = await context.params
    const needed_role    = action === "pay" ? ROLE_FINANCE : ROLE_APPROVER
    if (!["approve", "reject", "pay"].includes(action))
    {
        return fail("Unknown action", 404)
    }

    const auth = await requireUser(request, [needed_role])
    if (auth.error)
    {
        return auth.error
    }
    const user    = auth.user
    const desk    = readDesk()
    const expense = desk.expenses.find(e => e.id === id)
    if (!expense)
    {
        return fail("Expense not found", 404)
    }

    if (action === "approve" || action === "reject")
    {
        if (expense.status !== "PENDING")
        {
            return fail(`Expense is already ${expense.status}`)
        }
        if (expense.submitter_vuid === user.vuid)
        {
            return fail("You cannot approve or reject your own expense", 403)
        }
        if (expense.approvals.some(a => a.vuid === user.vuid))
        {
            return fail("You already approved this expense", 403)
        }

        if (action === "reject")
        {
            expense.status      = "REJECTED"
            expense.rejected_by = user.username
        }
        else
        {
            // The bearer token itself is the receipt: Tide signed it, we only keep it.
            expense.approvals.push({ vuid: user.vuid, username: user.username, at: new Date().toISOString(), receipt: user.token })
            if (expense.approvals.length >= requiredApprovals(expense.amount))
            {
                expense.status = "APPROVED"
            }
        }
        writeDesk(desk)
        return NextResponse.json(expense)
    }

    // pay: never trust the status field alone; re-prove the approvals first.
    if (expense.status !== "APPROVED")
    {
        return fail(`Only APPROVED expenses can be paid (this one is ${expense.status})`)
    }
    const verdict = await verifyExpense(expense)
    if (!verdict.trusted)
    {
        return NextResponse.json({ error: "Payment blocked: approvals do not verify against Tide", verdict }, { status: 403 })
    }
    expense.status  = "PAID"
    expense.paid_by = user.username
    expense.paid_at = new Date().toISOString()
    writeDesk(desk)
    return NextResponse.json(expense)
}
