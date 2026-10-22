// File-backed store for the prototype. Everything here is readable and editable
// by whoever runs the server; that is the point of the demo. Approvals are only
// trusted when their Tide-signed receipts verify (see receipt_check.ts).
import fs from "fs"
import path from "path"

export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID"

export type Approval =
{
    vuid: string
    username: string
    at: string
    receipt: string        // approver's Tide-signed access token at approval time
}

export type Expense =
{
    id: string
    title: string
    amount: number
    vendor_id: string
    note: string
    submitter_vuid: string
    submitter_name: string
    created_at: string
    status: ExpenseStatus
    approvals: Approval[]
    rejected_by: string | null
    paid_by: string | null
    paid_at: string | null
}

export type Vendor =
{
    id: string
    name: string
    bank_cipher: string | null   // Tide-encrypted bank details, tag "payee"
    bank_set_by: string | null
    bank_set_at: string | null
}

export type DeskData =
{
    expenses: Expense[]
    vendors: Vendor[]
}

export const HIGH_VALUE_THRESHOLD = 10000
export const ROLE_SUBMITTER       = "expense-submitter"
export const ROLE_APPROVER        = "expense-approver"
export const ROLE_FINANCE         = "expense-finance"

const DATA_FILE = path.join(process.cwd(), "data", "db.json")

const SEED_VENDORS: Vendor[] =
[
    { id: "v-northwind", name: "Northwind Logistics",   bank_cipher: null, bank_set_by: null, bank_set_at: null },
    { id: "v-acme",      name: "Acme Office Supplies",  bank_cipher: null, bank_set_by: null, bank_set_at: null },
    { id: "v-saigon",    name: "Saigon Cloud Hosting",  bank_cipher: null, bank_set_by: null, bank_set_at: null },
]

export function requiredApprovals(amount: number): number
{
    return amount >= HIGH_VALUE_THRESHOLD ? 2 : 1
}

export function readDesk(): DeskData
{
    if (!fs.existsSync(DATA_FILE))
    {
        const seed: DeskData = { expenses: [], vendors: SEED_VENDORS }
        writeDesk(seed)
        return seed
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as DeskData
}

export function writeDesk(desk: DeskData): void
{
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
    fs.writeFileSync(DATA_FILE, JSON.stringify(desk, null, 2))
}

export function newId(prefix: string): string
{
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
