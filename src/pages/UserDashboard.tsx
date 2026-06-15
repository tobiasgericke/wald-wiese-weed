import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Navbar } from '../components/Navbar'
import type { FestivalConfig, ParticipantPayment, Attendance } from '../lib/database.types'

export function UserDashboard() {
  const { user, profile } = useAuth()
  const [config, setConfig] = useState<FestivalConfig | null>(null)
  const [payment, setPayment] = useState<ParticipantPayment | null>(null)
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    Promise.all([
      supabase.from('festival_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('participant_payments').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('attendance').select('*').eq('user_id', user.id),
    ]).then(([{ data: cfg }, { data: pay }, { data: att }]) => {
      setConfig(cfg)
      setPayment(pay)
      setAttendance(att ?? [])
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

  const numDays = config?.num_days ?? 4
  const dailyRate = config?.daily_rate ?? 25
  const daysPresent = attendance.filter(a => a.present && a.day_index < numDays).length
  const estimatedCost = daysPresent * dailyRate
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
              {config.festival_start && (
                <Info label="Datum" value={formatDateRange(config.festival_start, numDays)} />
              )}
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

        {/* Attendance */}
        {config && (
          <AttendanceSection
            user={user!}
            config={config}
            attendance={attendance}
            onUpdate={setAttendance}
          />
        )}

        {/* Cost Preview */}
        {config && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-indigo-400">Kostenvorschau</h2>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Deine Tage" value={daysPresent.toString()} />
              <StatCard label={`${formatEur(dailyRate)} / Tag`} value="Tagessatz" small />
              <StatCard label="Geschätzte Kosten" value={formatEur(estimatedCost)} color="indigo" />
            </div>
            <p className="text-xs text-gray-500">
              Der endgültige Betrag wird nach dem Festival aus den tatsächlichen Gesamtkosten berechnet.
            </p>
          </section>
        )}

        {/* Payment Status */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-indigo-400">Zahlungsstatus</h2>

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
              {payment.notes && <p className="text-sm text-gray-400">{payment.notes}</p>}
            </>
          ) : (
            <p className="text-sm text-gray-500">Noch keine Zahlungsinfos hinterlegt.</p>
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

// ─── Attendance Section ──────────────────────────────────────────────────────

function AttendanceSection({
  user,
  config,
  attendance,
  onUpdate,
}: {
  user: { id: string }
  config: FestivalConfig
  attendance: Attendance[]
  onUpdate: (att: Attendance[]) => void
}) {
  const [saving, setSaving] = useState<number | null>(null)
  const numDays = config.num_days ?? 4

  const dayLabels = Array.from({ length: numDays }, (_, i) => getDayLabel(config, i))

  const isPresent = (dayIndex: number) =>
    attendance.find(a => a.day_index === dayIndex)?.present ?? false

  const toggle = async (dayIndex: number) => {
    setSaving(dayIndex)
    const existing = attendance.find(a => a.day_index === dayIndex)
    const nowPresent = !isPresent(dayIndex)

    if (existing) {
      await supabase.from('attendance').update({ present: nowPresent }).eq('id', existing.id)
      onUpdate(attendance.map(a => a.day_index === dayIndex ? { ...a, present: nowPresent } : a))
    } else {
      const { data } = await supabase
        .from('attendance')
        .insert({ user_id: user.id, day_index: dayIndex, present: true })
        .select()
        .single()
      if (data) onUpdate([...attendance, data])
    }
    setSaving(null)
  }

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-indigo-400">Meine Anwesenheit</h2>
        <p className="text-xs text-gray-500 mt-1">An welchen Tagen bist du dabei?</p>
      </div>
      <div className="flex gap-3 flex-wrap">
        {dayLabels.map((label, i) => {
          const present = isPresent(i)
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              disabled={saving === i}
              className={`flex flex-col items-center px-5 py-3 rounded-xl border-2 font-medium transition-all ${
                saving === i
                  ? 'opacity-50 cursor-wait border-gray-700 bg-gray-800'
                  : present
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
              }`}
            >
              <span className="text-lg">{present ? '✓' : '+'}</span>
              <span className="text-sm mt-0.5">{label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDayLabel(config: FestivalConfig, dayIndex: number): string {
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  if (config.festival_start) {
    const d = new Date(config.festival_start)
    d.setDate(d.getDate() + dayIndex)
    return weekdays[d.getDay()] + ' ' + d.getDate() + '.'
  }
  return `Tag ${dayIndex + 1}`
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 block text-xs mb-0.5">{label}</span>
      <span className={`text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function StatCard({ label, value, color, small }: {
  label: string; value: string; color?: 'green' | 'red' | 'indigo'; small?: boolean
}) {
  const textColor =
    color === 'green' ? 'text-green-400' :
    color === 'red' ? 'text-red-400' :
    color === 'indigo' ? 'text-indigo-400' :
    'text-white'
  return (
    <div className="bg-gray-800 rounded-lg p-3 text-center">
      <p className={`text-gray-500 mb-1 ${small ? 'text-xs' : 'text-xs'}`}>{label}</p>
      <p className={`font-bold ${small ? 'text-sm' : 'text-lg'} ${textColor}`}>{value}</p>
    </div>
  )
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatDateRange(startStr: string, numDays: number): string {
  const start = new Date(startStr)
  const end = new Date(startStr)
  end.setDate(end.getDate() + numDays - 1)
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long' }
  return `${start.toLocaleDateString('de-DE', opts)} – ${end.toLocaleDateString('de-DE', { ...opts, year: 'numeric' })}`
}
