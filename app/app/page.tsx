'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTideCloak } from '@tidecloak/nextjs'

export default function LoginPage()
{
    const { login, authenticated } = useTideCloak()
    const router = useRouter()

    useEffect(() =>
    {
        if (authenticated)
        {
            router.push('/home')
        }
    }, [authenticated])

    return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1rem' }}>
            <div className="card" style={{ maxWidth: 520, width: '100%' }}>
                <div className="brand" style={{ fontSize: '1.6rem' }}>TwoKeys</div>
                <p style={{ fontSize: '1.1rem', margin: '0.5rem 0 1rem' }}>
                    A spending desk where <b>no single admin, server or AI</b> can approve a payment,
                    promote an approver, or redirect money alone.
                </p>
                <div className="guarantees" style={{ marginBottom: '1.25rem' }}>
                    <div className="guarantee"><b>Two keys for big spends</b>Two different approvers for anything over A$10,000.</div>
                    <div className="guarantee"><b>Rules held by the Tide network</b>Not by whoever runs this server.</div>
                </div>
                <button onClick={() => login()} style={{ width: '100%', padding: '0.7rem' }}>Sign in with Tide</button>
            </div>
        </main>
    )
}
