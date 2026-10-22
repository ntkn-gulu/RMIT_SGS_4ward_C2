import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/request_auth"
import { readDesk } from "@/lib/expense_store"
import { verifyExpense } from "@/lib/receipt_check"

// Re-verify every approval receipt against the Tide realm's public key.
export async function GET(request: NextRequest): Promise<NextResponse>
{
    const auth = await requireUser(request)
    if (auth.error)
    {
        return auth.error
    }

    const desk     = readDesk()
    const verdicts = await Promise.all(desk.expenses.map(verifyExpense))
    return NextResponse.json({ checked_at: new Date().toISOString(), verdicts })
}
