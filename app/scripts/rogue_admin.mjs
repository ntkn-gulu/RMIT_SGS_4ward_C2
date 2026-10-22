// Plays a rogue database/server admin: forges an approval straight into db.json.
// It signs a look-alike token with its own key, because it has no access to the
// Tide network key. The audit and the payment check should both reject it.
//
// Usage: node scripts/rogue_admin.mjs          (forges the newest PENDING expense)
//        node scripts/rogue_admin.mjs --undo   (removes forged approvals)
import fs from "fs"
import path from "path"
import { SignJWT, generateKeyPair } from "jose"

const DATA_FILE   = path.join(process.cwd(), "data", "db.json")
const CONFIG      = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tidecloak.json"), "utf8"))
const ISSUER      = `${CONFIG["auth-server-url"].replace(/\/$/, "")}/realms/${CONFIG.realm}`
const FORGED_NAME = "it-admin (forged)"

const desk = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))

if (process.argv.includes("--undo"))
{
    for (const expense of desk.expenses)
    {
        const before = expense.approvals.length
        expense.approvals = expense.approvals.filter(a => a.username !== FORGED_NAME)
        if (before !== expense.approvals.length && expense.status === "APPROVED")
        {
            expense.status = "PENDING"
        }
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(desk, null, 2))
    console.log("Forged approvals removed.")
    process.exit(0)
}

const target = desk.expenses.find(e => e.status === "PENDING")
if (!target)
{
    console.log("No PENDING expense to tamper with. Submit one first.")
    process.exit(1)
}

const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" })
const forged_token = await new SignJWT(
{
    vuid: "forged-it-admin",
    preferred_username: FORGED_NAME,
    realm_access: { roles: ["expense-approver"] },
    azp: CONFIG.resource,
})
    .setProtectedHeader({ alg: "EdDSA", kid: CONFIG.jwk.keys[0].kid })   // copy the real key id to look genuine
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey)

while (target.approvals.length < (target.amount >= 10000 ? 2 : 1))
{
    target.approvals.push({ vuid: `forged-${target.approvals.length}`, username: FORGED_NAME, at: new Date().toISOString(), receipt: forged_token })
}
target.status = "APPROVED"
fs.writeFileSync(DATA_FILE, JSON.stringify(desk, null, 2))
console.log(`Forged approval(s) written into "${target.title}" and status set to APPROVED.`)
