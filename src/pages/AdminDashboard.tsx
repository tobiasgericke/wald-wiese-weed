import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import type { Profile, FestivalConfig, CostItem, ParticipantPayment } from '../lib/database.types'

type ParticipantWithPayment = Profile & { payment: ParticipantPayment | null }

type Tab = 'participants' | 'costs' | 'config'

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('participants')
  const [participants, setParticipants] = useState<ParticipantWithPayment[]>([])
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [config, setConfig] = useState<FestivalConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = async () => {
    const [{ data: profiles }, { data: costs }, { data: cfg }, { data: payments }] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('cost_items').select('*').order('created_at'),
      supabase.from('festival_config').select('*').eq('id', 1).single(),
      supabase.from('participant_payments').select('*'),
    ])

    const merged: ParticipantWithPayment[] = (profiles ?? []).map(p => ({
      ...p,
      payment: (payments ?? []).find(pay => pay.user_id === p.id) ?? null,
    }))

    setParticipants(merged)
    setCostItems(costs ?? [])
    setConfig(cfg)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const totalCosts = costItems.reduce((s, i) => s + i.amount, 0)
  const perPerson = participants.length > 0 ? totalCosts / participants.length : 0
  const totalPaid = participants.reduce((s, p) => s + (p.payment?.amount_paid ?? 0), 0)

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

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Admin-Dashboard</h1>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Teilnehmer" value={participants.length.toString()} />
          <SummaryCard label="Gesamtkosten" value={formatEur(totalCosts)} />
          <SummaryCard label="Pro Person" value={formatEur(perPerson)} />
          <SummaryCard label="Eingegangen" value={formatEur(totalPaid)} color="green" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 p-1 rounded-lg w-fit">
          {(['participants', 'costs', 'config'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t === 'participants' ? 'Teilnehmer' : t === 'costs' ? 'Kosten' : 'Festival-Infos'}
            </button>
          ))}
        </div>

        {tab === 'participants' && (
          <ParticipantsTab
            participants={participants}
            perPerson={perPerson}
            onRefresh={fetchAll}
          />
        )}
        {tab === 'costs' && (
          <CostsTab costItems={costItems} totalCosts={totalCosts} onRefresh={fetchAll} />
        )}
        {tab === 'config' && (
          <ConfigTab config={config} onRefresh={fetchAll} />
        )}
      </main>
    </>
  )
}

// ─── Participants Tab ────────────────────────────────────────────────────────

function ParticipantsTab({
  participants,
  perPerson,
  onRefresh,
}: {
  participants: ParticipantWithPayment[]
  perPerson: number
  onRefresh: () => void
}) {
  const togglePaid = async (p: ParticipantWithPayment) => {
    if (!p.payment) {
      await supabase.from('participant_payments').insert({
        user_id: p.id,
        amount_due: perPerson,
        amount_paid: perPerson,
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

  const setAmountDue = async (p: ParticipantWithPayment, amount: number) => {
    if (!p.payment) {
      await supabase.from('participant_payments').insert({
        user_id: p.id,
        amount_due: amount,
        amount_paid: 0,
        paid: false,
      })
    } else {
      await supabase
        .from('participant_payments')
        .update({ amount_due: amount })
        .eq('id', p.payment.id)
    }
    onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          Pro-Kopf-Anteil aktuell: <span className="text-white font-medium">{formatEur(perPerson)}</span>
        </p>
        <button
          onClick={async () => {
            for (const p of participants) {
              await setAmountDue(p, perPerson)
            }
            onRefresh()
          }}
          className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-gray-300 transition-colors"
        >
          Alle auf Pro-Kopf setzen
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">E-Mail</th>
              <th className="text-right px-4 py-3">Betrag</th>
              <th className="text-right px-4 py-3">Bezahlt</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {participants.map(p => (
              <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{p.email}</td>
                <td className="px-4 py-3 text-right">
                  <AmountInput
                    value={p.payment?.amount_due ?? perPerson}
                    onSave={v => setAmountDue(p, v)}
                  />
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {formatEur(p.payment?.amount_paid ?? 0)}
                </td>
                <td className="px-4 py-3 text-center">
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AmountInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(value.toFixed(2))

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="hover:text-indigo-400 transition-colors">
        {formatEur(value)}
      </button>
    )
  }

  return (
    <input
      type="number"
      value={input}
      autoFocus
      onChange={e => setInput(e.target.value)}
      onBlur={() => {
        onSave(parseFloat(input) || 0)
        setEditing(false)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          onSave(parseFloat(input) || 0)
          setEditing(false)
        }
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-24 bg-gray-700 border border-indigo-500 rounded px-2 py-0.5 text-right text-sm focus:outline-none"
    />
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
      name,
      amount: parseFloat(amount),
      description: description || null,
    })
    setName('')
    setAmount('')
    setDescription('')
    setAdding(false)
    onRefresh()
  }

  const deleteItem = async (id: string) => {
    await supabase.from('cost_items').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <form onSubmit={addItem} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <input
          placeholder="Kostenposition"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <input
          placeholder="Beschreibung (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <input
          type="number"
          placeholder="Betrag €"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          required
          min="0"
          step="0.01"
          className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={adding}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
        >
          + Hinzufügen
        </button>
      </form>

      {/* List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {costItems.length === 0 ? (
          <p className="text-center text-gray-500 py-8 text-sm">Noch keine Kostenpositionen</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase">
                  <th className="text-left px-4 py-3">Position</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Beschreibung</th>
                  <th className="text-right px-4 py-3">Betrag</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {costItems.map(item => (
                  <tr key={item.id} className="border-b border-gray-800/50">
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{item.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{formatEur(item.amount)}</td>
                    <td className="px-4 py-3 text-right">
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
                <tr className="bg-gray-800/50">
                  <td colSpan={2} className="px-4 py-3 font-semibold text-indigo-400">Gesamt</td>
                  <td className="px-4 py-3 text-right font-bold text-white">{formatEur(totalCosts)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Config Tab ──────────────────────────────────────────────────────────────

function ConfigTab({ config, onRefresh }: { config: FestivalConfig | null; onRefresh: () => void }) {
  const [form, setForm] = useState({
    festival_name: config?.festival_name ?? '',
    festival_date: config?.festival_date ?? '',
    location: config?.location ?? '',
    bank_name: config?.bank_name ?? '',
    bank_iban: config?.bank_iban ?? '',
    bank_recipient: config?.bank_recipient ?? '',
    payment_deadline: config?.payment_deadline ?? '',
    notes: config?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const payload = {
      festival_name: form.festival_name,
      festival_date: form.festival_date || null,
      location: form.location || null,
      bank_name: form.bank_name || null,
      bank_iban: form.bank_iban || null,
      bank_recipient: form.bank_recipient || null,
      payment_deadline: form.payment_deadline || null,
      notes: form.notes || null,
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

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value })),
  })

  return (
    <form onSubmit={save} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4 max-w-lg">
      <h2 className="font-semibold text-indigo-400">Festival-Infos</h2>

      <Field label="Name des Festivals">
        <input {...field('festival_name')} required className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Datum">
          <input type="date" {...field('festival_date')} className={inputCls} />
        </Field>
        <Field label="Ort">
          <input {...field('location')} className={inputCls} />
        </Field>
      </div>

      <h2 className="font-semibold text-indigo-400 pt-2">Bankverbindung</h2>
      <Field label="Empfänger">
        <input {...field('bank_recipient')} className={inputCls} />
      </Field>
      <Field label="Bank">
        <input {...field('bank_name')} className={inputCls} />
      </Field>
      <Field label="IBAN">
        <input {...field('bank_iban')} className={inputCls} placeholder="DE00 0000 0000 0000 0000 00" />
      </Field>

      <h2 className="font-semibold text-indigo-400 pt-2">Sonstiges</h2>
      <Field label="Zahlungsdeadline">
        <input type="date" {...field('payment_deadline')} className={inputCls} />
      </Field>
      <Field label="Hinweise (sehen alle Teilnehmer)">
        <textarea {...field('notes')} rows={3} className={`${inputCls} resize-none`} />
      </Field>

      <button
        type="submit"
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
      >
        {saved ? '✓ Gespeichert' : saving ? 'Speichert…' : 'Speichern'}
      </button>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string; color?: 'green' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color === 'green' ? 'text-green-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)
}
