import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/request_auth"
import { Expense, ROLE_SUBMITTER, newId, readDesk, writeDesk } from "@/lib/expense_store"

// List expenses and vendors. Any signed-in user may read.
export async function GET(request: NextRequest): Promise<NextResponse>
{
    const auth = await requireUser(request)
    if (auth.error)
    {
        return auth.error
    }
    return NextResponse.json(readDesk())
}

// Submit a new expense. Needs the submitter role.
export async function POST(request: NextRequest): Promise<NextResponse>
{
    const auth = await requireUser(request, [ROLE_SUBMITTER])
    if (auth.error)
    {
        return auth.error
    }

    const body   = await request.json()
    const amount = Number(body.amount)
    const title  = String(body.title ?? "").trim()
    const desk   = readDesk()

    if (!title || !Number.isFinite(amount) || amount <= 0)
    {
        return NextResponse.json({ error: "Title and a positive amount are required" }, { status: 400 })
    }
    if (!desk.vendors.some(v => v.id === body.vendor_id))
    {
        return NextResponse.json({ error: "Unknown vendor" }, { status: 400 })
    }

    const expense: Expense =
    {
        id: newId("exp"),
        title,
        amount: Math.round(amount * 100) / 100,
        vendor_id: body.vendor_id,
        note: String(body.note ?? ""),
        submitter_vuid: auth.user.vuid,
        submitter_name: auth.user.username,
        created_at: new Date().toISOString(),
        status: "PENDING",
        approvals: [],
        rejected_by: null,
        paid_by: null,
        paid_at: null,
    }
    desk.expenses.unshift(expense)
    writeDesk(desk)
    return NextResponse.json(expense, { status: 201 })
}
