import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Navbar } from '../components/Navbar'
import type { FestivalConfig, ParticipantPayment } from '../lib/database.types'

export function UserDashboard() {
  const { user, profile } = useAuth()
  const [config, setConfig] = useState<FestivalConfig | null>(null)
  const [payment, setPayment] = useState<ParticipantPayment | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    Promise.all([
      supabase.from('festival_config').select('*').eq('id', 1).single(),
      supabase.from('participant_payments').select('*').eq('user_id', user.id).single(),
    ]).then(([{ data: cfg }, { data: pay }]) => {
      setConfig(cfg)
      setPayment(pay)
      setLoading(false)
    })
  }, [user])

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500" />
        </div>
      </>
    )
  }

  const remaining = payment ? payment.amount_due - payment.amount_paid : 0

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Hey, {profile?.name} 👋</h1>

        {/* Festival Info */}
        {config && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-indigo-400">Festival-Infos</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Name" value={config.festival_name} />
              <Info label="Datum" value={config.festival_date ? formatDate(config.festival_date) : '—'} />
              <Info label="Ort" value={config.location ?? '—'} />
              {config.payment_deadline && (
                <Info label="Zahlungsdeadline" value={formatDate(config.payment_deadline)} />
              )}
            </div>
            {config.notes && (
              <p className="text-sm text-gray-400 border-t border-gray-800 pt-3 mt-3">
                {config.notes}
              </p>
            )}
          </section>
        )}

        {/* Payment Status */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-indigo-400">Dein Zahlungsstatus</h2>

          {payment ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Zu zahlen" value={formatEur(payment.amount_due)} />
                <StatCard label="Bezahlt" value={formatEur(payment.amount_paid)} color="green" />
                <StatCard
                  label="Offen"
                  value={formatEur(remaining)}
                  color={remaining > 0 ? 'red' : 'green'}
                />
              </div>

              <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
                payment.paid
                  ? 'bg-green-900/40 text-green-400 border border-green-800'
                  : 'bg-yellow-900/40 text-yellow-400 border border-yellow-800'
              }`}>
                {payment.paid ? '✅ Vollständig bezahlt' : '⏳ Zahlung ausstehend'}
              </div>

              {payment.notes && (
                <p className="text-sm text-gray-400">{payment.notes}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">Noch keine Zahlungsinfos vorhanden. Wende dich an den Admin.</p>
          )}
        </section>

        {/* Bank Details */}
        {config?.bank_iban && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-indigo-400">Bankverbindung</h2>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <Info label="Empfänger" value={config.bank_recipient ?? '—'} />
              <Info label="Bank" value={config.bank_name ?? '—'} />
              <Info label="IBAN" value={config.bank_iban} mono />
            </div>
            {payment && remaining > 0 && (
              <p className="text-xs text-gray-500 pt-2">
                Verwendungszweck: <span className="font-mono text-gray-300">Festival {profile?.name}</span>
              </p>
            )}
          </section>
        )}
      </main>
    </>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 block text-xs mb-0.5">{label}</span>
      <span className={`text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  const textColor = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white'
  return (
    <div className="bg-gray-800 rounded-lg p-3 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${textColor}`}>{value}</p>
    </div>
  )
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
}
