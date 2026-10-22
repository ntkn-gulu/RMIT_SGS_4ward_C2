'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'

type Approval = { vuid: string; username: string; at: string }
type Expense =
{
    id: string
    title: string
    amount: number
    vendor_id: string
    note: string
    submitter_vuid: string
    submitter_name: string
    created_at: string
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID'
    approvals: Approval[]
    rejected_by: string | null
    paid_by: string | null
}
type Vendor = { id: string; name: string; bank_cipher: string | null; bank_set_by: string | null }
type Verdict =
{
    expense_id: string
    trusted: boolean
    approvals_needed: number
    approvals_proven: number
    receipts: { username: string; valid: boolean; problems: string[] }[]
    problems: string[]
}

const HIGH_VALUE_THRESHOLD = 10000
const PAYEE_TAG            = 'payee'
const ROLE_LABELS: [string, string][] =
[
    ['expense-submitter', 'Submitter'],
    ['expense-approver', 'Approver'],
    ['expense-finance', 'Finance'],
    ['tide-realm-admin', 'Realm admin'],
]

function formatMoney(amount: number): string
{
    return amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function shortCipher(cipher: string): string
{
    return `${cipher.slice(0, 18)}…${cipher.slice(-8)}`
}

export default function ExpenseDesk()
{
    const { token, logout, getValueFromIdToken, hasRealmRole, doEncrypt, doDecrypt } = useTideCloak()

    const [expenses, setExpenses]   = useState<Expense[]>([])
    const [vendors, setVendors]     = useState<Vendor[]>([])
    const [message, setMessage]     = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
    const [busy_id, setBusyId]      = useState<string | null>(null)
    const [verdicts, setVerdicts]   = useState<Verdict[] | null>(null)
    const [revealed, setRevealed]   = useState<Record<string, string>>({})   // vendor id -> decrypted bank details
    const [bank_draft, setBankDraft] = useState<Record<string, string>>({})  // vendor id -> typed bank details
    const [form, setForm]           = useState({ title: '', amount: '', vendor_id: '', note: '' })

    const my_vuid     = token ? String(getValueFromIdToken('vuid') ?? '') : ''
    const username    = token ? String(getValueFromIdToken('preferred_username') ?? '') : ''
    const is_submitter = token ? hasRealmRole('expense-submitter') : false
    const is_approver  = token ? hasRealmRole('expense-approver') : false
    const is_finance   = token ? hasRealmRole('expense-finance') : false
    const my_roles     = useMemo(() => ROLE_LABELS.filter(([role]) => token && hasRealmRole(role)).map(([, label]) => label), [token])

    const callApi = useCallback(async (path: string, method = 'GET', body?: unknown) =>
    {
        const response = await fetch(path,
        {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok)
        {
            throw Object.assign(new Error(data.error ?? response.statusText), { data })
        }
        return data
    }, [token])

    const loadDesk = useCallback(async () =>
    {
        try
        {
            const data = await callApi('/api/expenses')
            setExpenses(data.expenses)
            setVendors(data.vendors)
        }
        catch (err: any)
        {
            setMessage({ kind: 'error', text: err.message })
        }
    }, [callApi])

    useEffect(() =>
    {
        if (token)
        {
            loadDesk()
        }
    }, [token])

    const vendorName = (vendor_id: string) => vendors.find(v => v.id === vendor_id)?.name ?? vendor_id

    async function runAction(label: string, work: () => Promise<string>)
    {
        setBusyId(label)
        setMessage(null)
        try
        {
            const text = await work()
            setMessage({ kind: 'ok', text })
            await loadDesk()
        }
        catch (err: any)
        {
            const detail = err?.data?.verdict ? ` · ${[...err.data.verdict.problems, ...err.data.verdict.receipts.flatMap((r: any) => r.problems)].join(' · ')}` : ''
            setMessage({ kind: 'error', text: `${err.message}${detail}` })
        }
        finally
        {
            setBusyId(null)
        }
    }

    function submitExpense()
    {
        runAction('submit', async () =>
        {
            await callApi('/api/expenses', 'POST', { ...form, amount: Number(form.amount) })
            setForm({ title: '', amount: '', vendor_id: '', note: '' })
            return 'Expense submitted. It now waits for approval.'
        })
    }

    function decideExpense(expense: Expense, action: 'approve' | 'reject')
    {
        runAction(`${action}-${expense.id}`, async () =>
        {
            const updated = await callApi(`/api/expenses/${expense.id}/${action}`, 'POST')
            return action === 'reject' ? 'Expense rejected.' : `Approval recorded with your Tide-signed receipt (${updated.approvals.length} so far).`
        })
    }

    function payExpense(expense: Expense)
    {
        const vendor = vendors.find(v => v.id === expense.vendor_id)
        runAction(`pay-${expense.id}`, async () =>
        {
            if (!vendor?.bank_cipher)
            {
                throw new Error('Vendor has no bank details yet. Add them in the Vendors panel.')
            }
            const [bank_details] = await doDecrypt([{ encrypted: vendor.bank_cipher, tags: [PAYEE_TAG] }])
            setRevealed(prev => ({ ...prev, [vendor.id]: String(bank_details) }))
            await callApi(`/api/expenses/${expense.id}/pay`, 'POST')
            return `Paid ${formatMoney(expense.amount)} to ${vendor.name} → ${bank_details} (mock bank transfer).`
        })
    }

    function saveBankDetails(vendor: Vendor)
    {
        runAction(`bank-${vendor.id}`, async () =>
        {
            const plain_text = (bank_draft[vendor.id] ?? '').trim()
            if (!plain_text)
            {
                throw new Error('Type the bank details first.')
            }
            const [bank_cipher] = await doEncrypt([{ data: plain_text, tags: [PAYEE_TAG] }])
            await callApi(`/api/vendors/${vendor.id}`, 'PUT', { bank_cipher })
            setBankDraft(prev => ({ ...prev, [vendor.id]: '' }))
            return `Bank details for ${vendor.name} encrypted in your browser. The server stored ciphertext only.`
        })
    }

    function revealBank(vendor: Vendor)
    {
        runAction(`reveal-${vendor.id}`, async () =>
        {
            const [bank_details] = await doDecrypt([{ encrypted: vendor.bank_cipher!, tags: [PAYEE_TAG] }])
            setRevealed(prev => ({ ...prev, [vendor.id]: String(bank_details) }))
            return `Decrypted through the Tide network for ${username}.`
        })
    }

    function runAudit()
    {
        runAction('audit', async () =>
        {
            const data = await callApi('/api/audit')
            setVerdicts(data.verdicts)
            const bad = data.verdicts.filter((v: Verdict) => !v.trusted).length
            return bad === 0 ? 'Every approval verifies against the Tide network key.' : `${bad} expense(s) failed verification.`
        })
    }

    const pending_for_me = expenses.filter(e => e.status === 'PENDING' && is_approver && e.submitter_vuid !== my_vuid && !e.approvals.some(a => a.vuid === my_vuid))

    return (
        <>
            <header className="topbar">
                <div className="brand">TwoKeys<small>Dual-control expense desk</small></div>
                <div className="who">
                    <span>{username}</span>
                    {my_roles.length > 0
                        ? my_roles.map(role => <span key={role} className="chip">{role}</span>)
                        : <span className="chip none">no desk roles yet</span>}
                    <button className="ghost" style={{ color: '#fff' }} onClick={() => logout()}>Log out</button>
                </div>
            </header>

            <main className="page">
                <section className="card">
                    <div className="guarantees">
                        <div className="guarantee"><b>No one makes themselves an approver</b>Granting the approver role needs a quorum of admins, enforced by the Tide network.</div>
                        <div className="guarantee"><b>No one fakes an approval</b>Every approval carries a receipt signed by Tide's threshold key. This server cannot sign one.</div>
                        <div className="guarantee"><b>No one quietly swaps the bank account</b>Payee details are encrypted in the browser. Only Finance can decrypt them, through Tide.</div>
                    </div>
                </section>

                {message && <div className={`notice ${message.kind}`}>{message.text}</div>}

                {my_roles.length === 0 && (
                    <div className="notice warn">
                        You have no desk roles. Ask the realm admins to grant one. Role grants are change requests that need an admin quorum, then log out and in again.
                    </div>
                )}

                {is_submitter && (
                    <section className="card">
                        <h2>Submit an expense</h2>
                        <p className="hint">Expenses of {formatMoney(HIGH_VALUE_THRESHOLD)} or more need two different approvers. You can never approve your own.</p>
                        <div className="row">
                            <div>
                                <label>What is it for?</label>
                                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Q4 freight, Melbourne → Ho Chi Minh City" />
                            </div>
                            <div>
                                <label>Amount (AUD)</label>
                                <input type="number" min="1" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="48000" />
                            </div>
                            <div>
                                <label>Vendor</label>
                                <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                                    <option value="">Choose…</option>
                                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                            </div>
                            <button disabled={busy_id === 'submit' || !form.title || !form.amount || !form.vendor_id} onClick={submitExpense}>Submit</button>
                        </div>
                    </section>
                )}

                <section className="card">
                    <h2>Expenses</h2>
                    <p className="hint">
                        {is_approver ? `${pending_for_me.length} waiting for your approval. ` : ''}
                        Status is just a field in a database. Payment only happens when the approvals behind it verify against Tide.
                    </p>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr><th>Expense</th><th>Amount</th><th>Status</th><th>Approvals</th><th></th></tr>
                            </thead>
                            <tbody>
                                {expenses.length === 0 && <tr><td colSpan={5} className="sub">No expenses yet.</td></tr>}
                                {expenses.map(expense =>
                                {
                                    const needed      = expense.amount >= HIGH_VALUE_THRESHOLD ? 2 : 1
                                    const is_mine     = expense.submitter_vuid === my_vuid
                                    const approved_me = expense.approvals.some(a => a.vuid === my_vuid)
                                    const can_decide  = is_approver && expense.status === 'PENDING' && !is_mine && !approved_me
                                    return (
                                        <tr key={expense.id}>
                                            <td>
                                                <b>{expense.title}</b>
                                                <div className="sub">{vendorName(expense.vendor_id)} · by {expense.submitter_name} · {new Date(expense.created_at).toLocaleString()}</div>
                                            </td>
                                            <td className="amount">{formatMoney(expense.amount)}</td>
                                            <td>
                                                <span className={`badge ${expense.status}`}>{expense.status}</span>
                                                {expense.paid_by && <div className="sub">by {expense.paid_by}</div>}
                                                {expense.rejected_by && <div className="sub">by {expense.rejected_by}</div>}
                                            </td>
                                            <td>
                                                <b>{expense.approvals.length} / {needed}</b>
                                                <div className="sub">{expense.approvals.map(a => a.username).join(', ') || '—'}</div>
                                            </td>
                                            <td>
                                                <div className="actions">
                                                    {can_decide && <button disabled={!!busy_id} onClick={() => decideExpense(expense, 'approve')}>Approve</button>}
                                                    {can_decide && <button className="ghost" disabled={!!busy_id} onClick={() => decideExpense(expense, 'reject')}>Reject</button>}
                                                    {is_approver && expense.status === 'PENDING' && is_mine && <span className="sub">Your own: someone else must approve</span>}
                                                    {is_finance && expense.status === 'APPROVED' && <button disabled={!!busy_id} onClick={() => payExpense(expense)}>Decrypt payee & pay</button>}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <div className="split">
                    <section className="card">
                        <h2>Vendors &amp; payee bank details</h2>
                        <p className="hint">This is what the database holds. Without the Finance role, nobody (including the server admin) can read or replace these details.</p>
                        {vendors.map(vendor => (
                            <div key={vendor.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--line)' }}>
                                <b>{vendor.name}</b>
                                <div style={{ margin: '0.3rem 0' }}>
                                    {revealed[vendor.id]
                                        ? <span className="plain">{revealed[vendor.id]}</span>
                                        : vendor.bank_cipher
                                            ? <span className="cipher">🔒 {shortCipher(vendor.bank_cipher)}</span>
                                            : <span className="sub">No bank details yet</span>}
                                    {vendor.bank_set_by && <span className="sub"> · set by {vendor.bank_set_by}</span>}
                                </div>
                                {is_finance && (
                                    <div className="actions">
                                        {vendor.bank_cipher && !revealed[vendor.id] && <button className="ghost" disabled={!!busy_id} onClick={() => revealBank(vendor)}>Decrypt</button>}
                                        <input style={{ flex: 1, minWidth: 180 }} value={bank_draft[vendor.id] ?? ''} placeholder="BSB 063-000 · Acc 1234 5678"
                                            onChange={e => setBankDraft(prev => ({ ...prev, [vendor.id]: e.target.value }))} />
                                        <button className="ghost" disabled={!!busy_id} onClick={() => saveBankDetails(vendor)}>Encrypt & save</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </section>

                    <section className="card">
                        <h2>Independent audit</h2>
                        <p className="hint">Re-checks every approval receipt against the Tide realm public key. Anyone can run it; nobody has to trust this server.</p>
                        <button disabled={busy_id === 'audit'} onClick={runAudit}>Verify all approvals</button>
                        {verdicts && verdicts.length === 0 && <p className="sub">Nothing to verify yet.</p>}
                        {verdicts && verdicts.map(verdict =>
                        {
                            const expense = expenses.find(e => e.id === verdict.expense_id)
                            const problems = [...verdict.problems, ...verdict.receipts.flatMap(r => r.problems.map(p => `${r.username}: ${p}`))]
                            return (
                                <div key={verdict.expense_id} className="verdict">
                                    <span className="mark">{verdict.trusted ? '✅' : '❌'}</span>
                                    <div>
                                        <b>{expense?.title ?? verdict.expense_id}</b> <span className="sub">{expense?.status} · {verdict.approvals_proven}/{verdict.approvals_needed} proven</span>
                                        {problems.map(p => <div key={p} style={{ color: 'var(--bad)' }}>{p}</div>)}
                                    </div>
                                </div>
                            )
                        })}
                    </section>
                </div>
            </main>
        </>
    )
}
