import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import type { Profile, FestivalConfig, CostItem, ParticipantPayment, Attendance, LegacyCredit, LegacyCreditRequest, LegacyCreditDecision } from '../lib/database.types'

function fullName(profile: Profile): string {
  const fn = profile.first_name?.trim()
  const ln = profile.last_name?.trim()
  if (fn || ln) return [fn, ln].filter(Boolean).join(' ')
  return profile.name
}

type ParticipantWithPayment = Profile & {
  payment: ParticipantPayment | null
  attendance: Attendance[]
}

type Tab = 'participants' | 'attendance' | 'costs' | 'config' | 'legacy'

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('participants')
  const [participants, setParticipants] = useState<ParticipantWithPayment[]>([])
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [config, setConfig] = useState<FestivalConfig | null>(null)
  const [legacyCredits, setLegacyCredits] = useState<LegacyCredit[]>([])
  const [legacyRequests, setLegacyRequests] = useState<LegacyCreditRequest[]>([])
  const [legacyDecisions, setLegacyDecisions] = useState<LegacyCreditDecision[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = async () => {
    const [
      { data: profiles }, { data: costs }, { data: cfg }, { data: payments }, { data: att },
      { data: credits }, { data: requests }, { data: decisions },
    ] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('cost_items').select('*').order('created_at'),
      supabase.from('festival_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('participant_payments').select('*'),
      supabase.from('attendance').select('*'),
      supabase.from('legacy_credits').select('*').order('display_name'),
      supabase.from('legacy_credit_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('legacy_credit_decisions').select('*'),
    ])

    const merged: ParticipantWithPayment[] = (profiles ?? []).map(p => ({
      ...p,
      payment: (payments ?? []).find(pay => pay.user_id === p.id) ?? null,
      attendance: (att ?? []).filter(a => a.user_id === p.id),
    }))

    setParticipants(merged)
    setCostItems(costs ?? [])
    setConfig(cfg)
    setLegacyCredits(credits ?? [])
    setLegacyRequests(requests ?? [])
    setLegacyDecisions(decisions ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const numDays = config?.num_days ?? 4
  const totalCosts = costItems.reduce((s, i) => s + i.amount, 0)
  const totalPersonDays = participants.reduce((s, p) => s + daysPresent(p.attendance, numDays), 0)
  const actualDailyRate = totalPersonDays > 0 ? totalCosts / totalPersonDays : 0
  const totalPaid = participants.reduce((s, p) => s + (p.payment?.amount_paid ?? 0), 0)
  const surplus = totalPaid - totalCosts

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-green-500" />
        </div>
      </>
    )
  }

  const pendingRequests = legacyRequests.filter(r => r.status === 'pending')

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'participants', label: 'Teilnehmer' },
    { key: 'attendance', label: 'Anwesenheit' },
    { key: 'costs', label: 'Kosten' },
    { key: 'config', label: 'Festival-Infos' },
    { key: 'legacy', label: 'Altguthaben', badge: pendingRequests.length },
  ]

  return (
    <>
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link to="/dashboard" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent leading-tight mt-1">
            Admin
          </h1>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Teilnehmer" value={participants.length.toString()} />
          <SummaryCard label="Personentage" value={totalPersonDays.toString()} />
          <SummaryCard label="Gesamtkosten" value={formatEur(totalCosts)} />
          <SummaryCard label="Echt. Tagessatz" value={formatEur(actualDailyRate)} />
          <SummaryCard
            label={surplus >= 0 ? 'Überschuss' : 'Fehlbetrag'}
            value={formatEur(Math.abs(surplus))}
            color={surplus >= 0 ? 'green' : 'red'}
          />
        </div>

        {/* Tabs */}
        <div className="tab-bar">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`tab-btn ${tab === t.key ? 'tab-active' : 'tab-inactive'} relative`}
            >
              {t.label}
              {t.badge ? (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-yellow-400 text-forest-950">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === 'participants' && (
          <ParticipantsTab
            participants={participants}
            config={config}
            actualDailyRate={actualDailyRate}
            legacyCredits={legacyCredits}
            legacyDecisions={legacyDecisions}
            onRefresh={fetchAll}
          />
        )}
        {tab === 'attendance' && (
          <AttendanceTab
            participants={participants}
            config={config}
            onRefresh={fetchAll}
          />
        )}
        {tab === 'costs' && (
          <CostsTab costItems={costItems} totalCosts={totalCosts} onRefresh={fetchAll} />
        )}
        {tab === 'config' && (
          <ConfigTab config={config} onRefresh={fetchAll} />
        )}
        {tab === 'legacy' && (
          <LegacyTab
            credits={legacyCredits}
            requests={legacyRequests}
            decisions={legacyDecisions}
            participants={participants}
            onRefresh={fetchAll}
          />
        )}
      </main>
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysPresent(attendance: Attendance[], numDays: number): number {
  if (attendance.length === 0) return 0
  return attendance.filter(a => a.present && a.day_index < numDays).length
}

function getDayLabel(config: FestivalConfig | null, dayIndex: number): string {
  const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  if (config?.festival_start) {
    const d = new Date(config.festival_start)
    d.setDate(d.getDate() + dayIndex)
    return weekdays[d.getDay()] + ' ' + d.getDate() + '.'
  }
  return `Tag ${dayIndex + 1}`
}

// ─── Participants Tab ────────────────────────────────────────────────────────

function ParticipantsTab({
  participants,
  config,
  actualDailyRate,
  legacyCredits,
  legacyDecisions,
  onRefresh,
}: {
  participants: ParticipantWithPayment[]
  config: FestivalConfig | null
  actualDailyRate: number
  legacyCredits: LegacyCredit[]
  legacyDecisions: LegacyCreditDecision[]
  onRefresh: () => void
}) {
  const numDays = config?.num_days ?? 4
  const advanceRate = config?.daily_rate ?? 25

  const getLegacyDiscount = (userId: string) => {
    const decision = legacyDecisions.find(d => d.user_id === userId && d.decision === 'apply_www7')
    if (!decision) return 0
    const credit = legacyCredits.find(c => c.id === decision.legacy_credit_id)
    return credit ? Number(credit.amount_owed) : 0
  }

  const togglePaid = async (p: ParticipantWithPayment) => {
    const days = daysPresent(p.attendance, numDays)
    const amountDue = Math.max(0, days * advanceRate - getLegacyDiscount(p.id))
    if (!p.payment) {
      await supabase.from('participant_payments').insert({
        user_id: p.id,
        amount_due: amountDue,
        amount_paid: amountDue,
        paid: true,
        paid_at: new Date().toISOString(),
      })
    } else {
      await supabase
        .from('participant_payments')
        .update({
          paid: !p.payment.paid,
          paid_at: !p.payment.paid ? new Date().toISOString() : null,
          amount_paid: !p.payment.paid ? p.payment.amount_due : 0,
        })
        .eq('id', p.payment.id)
    }
    onRefresh()
  }

  const syncAmountDue = async (p: ParticipantWithPayment) => {
    const days = daysPresent(p.attendance, numDays)
    const amountDue = Math.max(0, days * advanceRate - getLegacyDiscount(p.id))
    if (!p.payment) {
      await supabase.from('participant_payments').insert({
        user_id: p.id, amount_due: amountDue, amount_paid: 0, paid: false,
      })
    } else {
      await supabase.from('participant_payments').update({ amount_due: amountDue }).eq('id', p.payment.id)
    }
    onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <p className="text-sm text-gray-400">
          Vorauszahlung: <span className="text-white">{formatEur(advanceRate)}/Tag</span>
          {' · '}
          Echter Tagessatz: <span className="text-green-400">{formatEur(actualDailyRate)}/Tag</span>
        </p>
        <button
          onClick={async () => {
            for (const p of participants) await syncAmountDue(p)
            onRefresh()
          }}
          className="btn-ghost"
        >
          Alle Beträge aktualisieren
        </button>
      </div>

      <div className="table-wrapper">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-forest-700 text-left">
              <th className="th">Name</th>
              <th className="th text-center">Tage</th>
              <th className="th text-right">Vorauszahlung</th>
              <th className="th text-right">Echter Anteil</th>
              <th className="th text-right text-green-500">Rückzahlung</th>
              <th className="th text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {participants.map(p => {
              const days = daysPresent(p.attendance, numDays)
              const advance = Math.max(0, days * advanceRate - getLegacyDiscount(p.id))
              const actual = days * actualDailyRate
              const refund = advance - actual
              return (
                <tr key={p.id} className="tr-row">
                  <td className="td font-medium">{fullName(p)}</td>
                  <td className="td text-center text-gray-300">{days}</td>
                  <td className="td text-right">{formatEur(advance)}</td>
                  <td className="td text-right text-gray-400">{formatEur(actual)}</td>
                  <td className={`td text-right font-medium ${refund > 0 ? 'text-green-400' : refund < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {refund !== 0 ? formatEur(refund) : '—'}
                  </td>
                  <td className="td text-center">
                    <button
                      onClick={() => togglePaid(p)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        p.payment?.paid
                          ? 'bg-green-900/50 text-green-400 hover:bg-green-900'
                          : 'bg-yellow-900/50 text-yellow-400 hover:bg-yellow-900'
                      }`}
                    >
                      {p.payment?.paid ? 'Bezahlt' : 'Ausstehend'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Attendance Tab ──────────────────────────────────────────────────────────

function AttendanceTab({
  participants,
  config,
  onRefresh,
}: {
  participants: ParticipantWithPayment[]
  config: FestivalConfig | null
  onRefresh: () => void
}) {
  const numDays = config?.num_days ?? 4
  const dayLabels = Array.from({ length: numDays }, (_, i) => getDayLabel(config, i))
  const [saving, setSaving] = useState<string | null>(null)

  const toggle = async (p: ParticipantWithPayment, dayIndex: number) => {
    const key = `${p.id}-${dayIndex}`
    setSaving(key)
    const existing = p.attendance.find(a => a.day_index === dayIndex)
    if (existing) {
      await supabase.from('attendance').update({ present: !existing.present }).eq('id', existing.id)
    } else {
      await supabase.from('attendance').insert({ user_id: p.id, day_index: dayIndex, present: true })
    }
    await onRefresh()
    setSaving(null)
  }

  const isPresent = (p: ParticipantWithPayment, dayIndex: number) =>
    p.attendance.find(a => a.day_index === dayIndex)?.present ?? false

  const dayTotals = dayLabels.map((_, i) =>
    participants.filter(p => isPresent(p, i)).length
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">Klick auf ein Feld um die Anwesenheit zu togglen.</p>
      <div className="table-wrapper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-forest-700 text-left">
              <th className="th min-w-[160px]">Name</th>
              {dayLabels.map((label, i) => (
                <th key={i} className="th text-center min-w-[70px]">{label}</th>
              ))}
              <th className="th text-center">Tage</th>
            </tr>
          </thead>
          <tbody>
            {participants.map(p => (
              <tr key={p.id} className="tr-row">
                <td className="td font-medium">{fullName(p)}</td>
                {dayLabels.map((_, i) => {
                  const present = isPresent(p, i)
                  const key = `${p.id}-${i}`
                  return (
                    <td key={i} className="td text-center">
                      <button
                        onClick={() => toggle(p, i)}
                        disabled={saving === key}
                        className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors ${
                          saving === key
                            ? 'bg-forest-700 text-gray-500'
                            : present
                              ? 'bg-green-700 hover:bg-green-600 text-white'
                              : 'bg-forest-700 hover:bg-forest-600 text-gray-600'
                        }`}
                      >
                        {present ? '✓' : '·'}
                      </button>
                    </td>
                  )
                })}
                <td className="td text-center font-bold text-green-400">
                  {daysPresent(p.attendance, numDays)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-forest-800/60 text-xs text-gray-400">
              <td className="td font-semibold">Gesamt</td>
              {dayTotals.map((total, i) => (
                <td key={i} className="td text-center font-semibold text-white">{total}</td>
              ))}
              <td className="td text-center font-bold text-white">
                {participants.reduce((s, p) => s + daysPresent(p.attendance, numDays), 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Costs Tab ───────────────────────────────────────────────────────────────

function CostsTab({
  costItems,
  totalCosts,
  onRefresh,
}: {
  costItems: CostItem[]
  totalCosts: number
  onRefresh: () => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState(false)

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    await supabase.from('cost_items').insert({
      name, amount: parseFloat(amount), description: description || null,
    })
    setName(''); setAmount(''); setDescription('')
    setAdding(false)
    onRefresh()
  }

  const deleteItem = async (id: string) => {
    await supabase.from('cost_items').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addItem} className="card">
        <div className="card-body">
          <div className="flex flex-col md:flex-row gap-3">
            <input
              placeholder="Kostenposition"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="input-sm flex-1"
            />
            <input
              placeholder="Beschreibung (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="input-sm flex-1"
            />
            <input
              type="number"
              placeholder="Betrag €"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
              min="0"
              step="0.01"
              className="input-sm w-32"
            />
            <button type="submit" disabled={adding} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">
              + Hinzufügen
            </button>
          </div>
        </div>
      </form>

      <div className="table-wrapper">
        {costItems.length === 0 ? (
          <p className="text-center text-gray-500 py-10 text-sm">Noch keine Kostenpositionen</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-forest-700 text-left">
                <th className="th">Position</th>
                <th className="th hidden md:table-cell">Beschreibung</th>
                <th className="th text-right">Betrag</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {costItems.map(item => (
                <tr key={item.id} className="tr-row">
                  <td className="td font-medium">{item.name}</td>
                  <td className="td text-gray-400 hidden md:table-cell">{item.description ?? '—'}</td>
                  <td className="td text-right">{formatEur(item.amount)}</td>
                  <td className="td text-right">
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-xs"
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-forest-800/60">
                <td colSpan={2} className="td font-semibold text-green-400">Gesamt</td>
                <td className="td text-right font-bold text-white">{formatEur(totalCosts)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Config Tab ──────────────────────────────────────────────────────────────

function ConfigTab({ config, onRefresh }: { config: FestivalConfig | null; onRefresh: () => void }) {
  const [form, setForm] = useState({
    festival_name: config?.festival_name ?? '',
    festival_start: config?.festival_start ?? '',
    num_days: String(config?.num_days ?? 4),
    daily_rate: String(config?.daily_rate ?? 25),
    guest_daily_rate: String(config?.guest_daily_rate ?? 15),
    location: config?.location ?? '',
    bank_name: config?.bank_name ?? '',
    bank_iban: config?.bank_iban ?? '',
    bank_recipient: config?.bank_recipient ?? '',
    payment_deadline: config?.payment_deadline ?? '',
    payment_reference: config?.payment_reference ?? '',
    notes: config?.notes ?? '',
    donation_org1_name: config?.donation_org1_name ?? '',
    donation_org1_url: config?.donation_org1_url ?? '',
    donation_org1_description: config?.donation_org1_description ?? '',
    donation_org2_name: config?.donation_org2_name ?? '',
    donation_org2_url: config?.donation_org2_url ?? '',
    donation_org2_description: config?.donation_org2_description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      festival_name: form.festival_name,
      festival_start: form.festival_start || null,
      num_days: parseInt(form.num_days) || 4,
      daily_rate: parseFloat(form.daily_rate) || 25,
      guest_daily_rate: parseFloat(form.guest_daily_rate) || 15,
      location: form.location || null,
      bank_name: form.bank_name || null,
      bank_iban: form.bank_iban || null,
      bank_recipient: form.bank_recipient || null,
      payment_deadline: form.payment_deadline || null,
      payment_reference: form.payment_reference || null,
      notes: form.notes || null,
      donation_org1_name: form.donation_org1_name || null,
      donation_org1_url: form.donation_org1_url || null,
      donation_org1_description: form.donation_org1_description || null,
      donation_org2_name: form.donation_org2_name || null,
      donation_org2_url: form.donation_org2_url || null,
      donation_org2_description: form.donation_org2_description || null,
    }
    if (config) {
      await supabase.from('festival_config').update(payload).eq('id', 1)
    } else {
      await supabase.from('festival_config').insert({ id: 1, ...payload })
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onRefresh()
  }

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  return (
    <form onSubmit={save} className="card max-w-lg">
      <div className="card-body space-y-5">
        <h2 className="card-title">Festival</h2>
        <Field label="Name">
          <input {...f('festival_name')} required className="input-sm w-full" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Startdatum (erster Tag)">
            <input type="date" {...f('festival_start')} className="input-sm w-full" />
          </Field>
          <Field label="Anzahl Tage">
            <input type="number" min="1" max="14" {...f('num_days')} className="input-sm w-full" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tagespauschale (€/Tag)">
            <input type="number" step="0.01" {...f('daily_rate')} className="input-sm w-full" />
          </Field>
          <Field label="Tagesgast-Pauschale (€/Tag)">
            <input type="number" step="0.01" {...f('guest_daily_rate')} className="input-sm w-full" />
          </Field>
        </div>
        <Field label="Ort">
          <input {...f('location')} className="input-sm w-full" />
        </Field>

        <h2 className="card-title pt-1">Bankverbindung</h2>
        <Field label="Empfänger">
          <input {...f('bank_recipient')} className="input-sm w-full" />
        </Field>
        <Field label="Bank">
          <input {...f('bank_name')} className="input-sm w-full" />
        </Field>
        <Field label="IBAN">
          <input {...f('bank_iban')} className="input-sm w-full" placeholder="DE00 0000 0000 0000 0000 00" />
        </Field>
        <Field label="Verwendungszweck">
          <input {...f('payment_reference')} className="input-sm w-full" placeholder="z.B. WaldWieseWeed25 {Name}" />
          <p className="text-xs text-gray-500 mt-1">
            <code className="bg-forest-800 px-1 rounded">{'{Name}'}</code> wird durch den vollen Namen des Teilnehmers ersetzt.
          </p>
        </Field>

        <h2 className="card-title pt-1">Altguthaben — Spendenorganisationen</h2>
        <p className="text-xs text-gray-500 -mt-3">
          Zwei konfigurierbare Spendenoptionen für das Altguthaben-Survey (leer lassen = nicht anzeigen).
        </p>
        <Field label="Organisation 1 — Name">
          <input {...f('donation_org1_name')} className="input-sm w-full" placeholder="z.B. Greenpeace" />
        </Field>
        <Field label="Organisation 1 — Website">
          <input {...f('donation_org1_url')} className="input-sm w-full" placeholder="https://..." type="url" />
        </Field>
        <Field label="Organisation 1 — Beschreibung">
          <input {...f('donation_org1_description')} className="input-sm w-full" placeholder="Kurze Beschreibung für die Teilnehmer" />
        </Field>
        <Field label="Organisation 2 — Name">
          <input {...f('donation_org2_name')} className="input-sm w-full" placeholder="z.B. WWF" />
        </Field>
        <Field label="Organisation 2 — Website">
          <input {...f('donation_org2_url')} className="input-sm w-full" placeholder="https://..." type="url" />
        </Field>
        <Field label="Organisation 2 — Beschreibung">
          <input {...f('donation_org2_description')} className="input-sm w-full" placeholder="Kurze Beschreibung für die Teilnehmer" />
        </Field>

        <h2 className="card-title pt-1">Sonstiges</h2>
        <Field label="Zahlungsdeadline">
          <input type="date" {...f('payment_deadline')} className="input-sm w-full" />
        </Field>
        <Field label="Hinweise für Teilnehmer">
          <textarea {...f('notes')} rows={3} className="input-sm w-full resize-none" />
        </Field>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary"
        >
          {saved ? '✓ Gespeichert' : saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white'}`}>
        {value}
      </p>
    </div>
  )
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)
}

// ─── Legacy Tab ───────────────────────────────────────────────────────────────

const DECISION_LABELS: Record<string, string> = {
  refund: 'Rückzahlung',
  apply_www7: 'Verrechnung WWW7',
  donate_www: 'Spende ans WWW',
  donate_org1: 'Spende Org 1',
  donate_org2: 'Spende Org 2',
}

function LegacyTab({
  credits,
  requests,
  decisions,
  participants,
  onRefresh,
}: {
  credits: LegacyCredit[]
  requests: LegacyCreditRequest[]
  decisions: LegacyCreditDecision[]
  participants: ParticipantWithPayment[]
  onRefresh: () => void
}) {
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [working, setWorking] = useState<string | null>(null)

  const profileName = (userId: string) => {
    const p = participants.find(p => p.id === userId)
    return p ? fullName(p) : userId.slice(0, 8) + '…'
  }

  const pendingRequests = requests.filter(r => r.status === 'pending')
  const matched = credits.filter(c => c.match_confirmed)
  const decided = decisions.length
  const unmatched = credits.filter(c => !c.matched_user_id)
  const totalAmount = credits.reduce((s, c) => s + c.amount_owed, 0)
  const decidedAmount = decisions.reduce((s, d) => {
    const credit = credits.find(c => c.id === d.legacy_credit_id)
    return s + (credit?.amount_owed ?? 0)
  }, 0)

  const approve = async (requestId: string) => {
    setWorking(requestId)
    await supabase.rpc('approve_legacy_credit_request', { p_request_id: requestId })
    setWorking(null)
    onRefresh()
  }

  const reject = async (requestId: string) => {
    setWorking(requestId)
    await supabase.rpc('reject_legacy_credit_request', { p_request_id: requestId, p_note: rejectNote || null })
    setRejectId(null)
    setRejectNote('')
    setWorking(null)
    onRefresh()
  }

  const decisionSummary = Object.entries(DECISION_LABELS).map(([key, label]) => ({
    key,
    label,
    count: decisions.filter(d => d.decision === key).length,
    amount: decisions
      .filter(d => d.decision === key)
      .reduce((s, d) => s + (credits.find(c => c.id === d.legacy_credit_id)?.amount_owed ?? 0), 0),
  })).filter(d => d.count > 0)

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Gesamtguthaben" value={formatEur(totalAmount)} />
        <SummaryCard label="Zugeordnet" value={`${matched.length} / ${credits.length}`} />
        <SummaryCard label="Entschieden" value={`${decided} · ${formatEur(decidedAmount)}`} color="green" />
        <SummaryCard label="Offen (kein Account)" value={unmatched.length.toString()} color={unmatched.length > 0 ? 'red' : undefined} />
      </div>

      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-yellow-300">Offene Zuordnungsanfragen</h3>
          <div className="table-wrapper">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-forest-700 text-left">
                  <th className="th">Anfragender</th>
                  <th className="th">Beanspruchter Eintrag</th>
                  <th className="th text-right">Betrag</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map(req => {
                  const credit = credits.find(c => c.id === req.legacy_credit_id)
                  return (
                    <tr key={req.id} className="tr-row">
                      <td className="td font-medium">{profileName(req.requesting_user_id)}</td>
                      <td className="td text-gray-300">{credit?.display_name ?? '—'}</td>
                      <td className="td text-right">{credit ? formatEur(credit.amount_owed) : '—'}</td>
                      <td className="td">
                        <div className="flex gap-2 justify-end items-center">
                          {rejectId === req.id ? (
                            <>
                              <input
                                className="input-sm text-xs w-40"
                                placeholder="Begründung (optional)"
                                value={rejectNote}
                                onChange={e => setRejectNote(e.target.value)}
                              />
                              <button
                                onClick={() => reject(req.id)}
                                disabled={working === req.id}
                                className="text-xs text-red-400 hover:text-red-300 transition-colors"
                              >
                                Bestätigen
                              </button>
                              <button
                                onClick={() => { setRejectId(null); setRejectNote('') }}
                                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                              >
                                Abbrechen
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => approve(req.id)}
                                disabled={working === req.id}
                                className="text-xs px-3 py-1 rounded-lg bg-green-800 hover:bg-green-700 text-green-300 transition-colors"
                              >
                                Bestätigen
                              </button>
                              <button
                                onClick={() => setRejectId(req.id)}
                                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                              >
                                Ablehnen
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Decision summary */}
      {decisionSummary.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-green-400">Entscheidungen</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {decisionSummary.map(d => (
              <div key={d.key} className="stat-card text-left">
                <p className="stat-label">{d.label}</p>
                <p className="stat-value text-base">{d.count}× · {formatEur(d.amount)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All credits overview */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-400">Alle Einträge (WWW6)</h3>
        <div className="table-wrapper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-forest-700 text-left">
                <th className="th">Name (WWW6)</th>
                <th className="th text-right">Betrag</th>
                <th className="th">Zugeordnet an</th>
                <th className="th">Entscheidung</th>
              </tr>
            </thead>
            <tbody>
              {credits.map(credit => {
                const decision = decisions.find(d => d.legacy_credit_id === credit.id)
                const req = requests.find(r => r.legacy_credit_id === credit.id && r.status === 'pending')
                return (
                  <tr key={credit.id} className="tr-row">
                    <td className="td font-medium">{credit.display_name}</td>
                    <td className="td text-right">{formatEur(credit.amount_owed)}</td>
                    <td className="td text-gray-300 text-xs">
                      {credit.matched_user_id && credit.match_confirmed
                        ? profileName(credit.matched_user_id)
                        : req
                          ? <span className="text-yellow-400">Anfrage: {profileName(req.requesting_user_id)}</span>
                          : <span className="text-gray-600">—</span>
                      }
                    </td>
                    <td className="td text-xs">
                      {decision
                        ? <span className="text-green-400">{DECISION_LABELS[decision.decision]}</span>
                        : credit.match_confirmed
                          ? <span className="text-yellow-500">Ausstehend</span>
                          : <span className="text-gray-600">—</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
