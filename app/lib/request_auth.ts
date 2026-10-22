// Server-side identity check for API routes. The token is signed by the Tide
// network's threshold key, so this server can check it but can never mint one.
import { NextRequest, NextResponse } from "next/server"
import { verifyTideCloakToken } from "@tidecloak/nextjs/server"
import tc_config from "../tidecloak.json"

export type DeskUser =
{
    vuid: string
    username: string
    roles: string[]
    token: string
}

type AuthResult = { user: DeskUser; error: null } | { user: null; error: NextResponse }

export function rolesFromPayload(payload: Record<string, any>): string[]
{
    return payload?.realm_access?.roles ?? []
}

export async function requireUser(request: NextRequest, allowed_roles: string[] = []): Promise<AuthResult>
{
    const auth_header = request.headers.get("authorization")
    if (!auth_header?.startsWith("Bearer "))
    {
        return { user: null, error: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }) }
    }

    const token   = auth_header.slice("Bearer ".length)
    const payload = await verifyTideCloakToken(tc_config, token, allowed_roles) as Record<string, any> | null
    if (!payload)
    {
        const reason = allowed_roles.length > 0 ? `Requires role: ${allowed_roles.join(" or ")}` : "Invalid token"
        return { user: null, error: NextResponse.json({ error: reason }, { status: 403 }) }
    }

    const user: DeskUser =
    {
        vuid: String(payload.vuid ?? payload.sub),
        username: String(payload.preferred_username ?? "unknown"),
        roles: rolesFromPayload(payload),
        token,
    }
    return { user, error: null }
}
