import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/request_auth"
import { ROLE_FINANCE, readDesk, writeDesk } from "@/lib/expense_store"

type RouteContext = { params: Promise<{ id: string }> }

// Store a vendor's bank details. The browser encrypts them with Tide first,
// so this server only ever sees ciphertext.
export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse>
{
    const auth = await requireUser(request, [ROLE_FINANCE])
    if (auth.error)
    {
        return auth.error
    }

    const { id }  = await context.params
    const body    = await request.json()
    const desk    = readDesk()
    const vendor  = desk.vendors.find(v => v.id === id)
    if (!vendor)
    {
        return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }
    if (typeof body.bank_cipher !== "string" || body.bank_cipher.length < 20)
    {
        return NextResponse.json({ error: "Expected Tide ciphertext" }, { status: 400 })
    }

    vendor.bank_cipher = body.bank_cipher
    vendor.bank_set_by = auth.user.username
    vendor.bank_set_at = new Date().toISOString()
    writeDesk(desk)
    return NextResponse.json(vendor)
}
