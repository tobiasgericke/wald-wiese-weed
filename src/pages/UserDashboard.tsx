import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Navbar } from '../components/Navbar'
import type { FestivalConfig, ParticipantPayment, Attendance, Profile, LegacyCredit, LegacyCreditDecision, LegacyCreditRequest, LegacyDecisionType } from '../lib/database.types'

function fullName(profile: Profile | null): string {
  if (!profile) return ''
  const fn = profile.first_name?.trim()
  const ln = profile.last_name?.trim()
  if (fn || ln) return [fn, ln].filter(Boolean).join(' ')
  return profile.name
}

function firstName(profile: Profile | null): string {
  return profile?.first_name?.trim() || profile?.name?.split(' ')[0] || ''
}

type View = 'planning' | 'calculating' | 'confirmed'
type LegacyPhase =
  | 'loading'
  | 'matched'       // confirmed match, no decision yet
  | 'decided'       // decision already submitted
  | 'no_match'      // no match found, show "were you there?" prompt
  | 'ask_name'      // user said yes → show dropdown
  | 'request_pending'
  | 'request_rejected'
  | 'skipped'       // user said "no, first time"

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

export function UserDashboard() {
  const { user, profile } = useAuth()
  const [config, setConfig] = useState<FestivalConfig | null>(null)
  const [payment, setPayment] = useState<ParticipantPayment | null>(null)
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('planning')
  const [activeSection, setActiveSection] = useState('sec-festival')

  // Legacy credit state
  const [legacyPhase, setLegacyPhase] = useState<LegacyPhase>('loading')
  const [legacyCredit, setLegacyCredit] = useState<LegacyCredit | null>(null)
  const [legacyDecision, setLegacyDecision] = useState<LegacyCreditDecision | null>(null)
  const [legacyRequest, setLegacyRequest] = useState<LegacyCreditRequest | null>(null)
  const [unmatchedCredits, setUnmatchedCredits] = useState<LegacyCredit[]>([])

  useEffect(() => {
    document.documentElement.classList.add('snap-page')
    return () => document.documentElement.classList.remove('snap-page')
  }, [])

  useEffect(() => {
    const ids = ['sec-festival', 'sec-anwesenheit', 'sec-kosten', 'sec-action', 'sec-zahlung', 'sec-status', 'sec-altguthaben']
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) setActiveSection(entry.target.id)
        })
      },
      { threshold: 0.4 }
    )
    ids.forEach(id => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [view])

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
      const alreadyConfirmed = localStorage.getItem(`wwwConfirmed_${user.id}`)
      if (alreadyConfirmed || pay) setView('confirmed')
    })

    // Legacy credit flow
    const skipped = localStorage.getItem(`wwwLegacySkip_${user.id}`)
    if (skipped) { setLegacyPhase('skipped'); return }

    supabase.rpc('try_automatch_legacy_credit').then(async ({ data }) => {
      const result = data as { status: string; credit_id?: string; amount?: number; display_name?: string }
      if (result?.status === 'matched' || result?.status === 'already_matched') {
        const { data: credit } = await supabase
          .from('legacy_credits').select('*').eq('matched_user_id', user.id).maybeSingle()
        const { data: decision } = await supabase
          .from('legacy_credit_decisions').select('*').eq('user_id', user.id).maybeSingle()
        setLegacyCredit(credit)
        setLegacyDecision(decision)
        setLegacyPhase(decision ? 'decided' : 'matched')
      } else {
        // Check for pending/rejected request
        const { data: req } = await supabase
          .from('legacy_credit_requests').select('*').eq('requesting_user_id', user.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (req?.status === 'pending') {
          setLegacyRequest(req)
          setLegacyPhase('request_pending')
        } else if (req?.status === 'rejected') {
          setLegacyRequest(req)
          setLegacyPhase('request_rejected')
        } else {
          setLegacyPhase('no_match')
        }
      }
    })
  }, [user])

  const handleAttendanceUpdate = (att: Attendance[]) => {
    setAttendance(att)
    if (view === 'confirmed') setView('planning')
  }

  const handleConfirm = () => {
    setView('calculating')
    scrollTo('sec-action')
    setTimeout(() => {
      setView('confirmed')
      if (user) localStorage.setItem(`wwwConfirmed_${user.id}`, '1')
      setTimeout(() => scrollTo('sec-zahlung'), 100)
    }, 2800)
  }

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

  const numDays = config?.num_days ?? 4
  const dailyRate = config?.daily_rate ?? 25
  const daysPresent = attendance.filter(a => a.present && a.day_index < numDays).length
  const estimatedCost = daysPresent * dailyRate
  const remaining = payment ? payment.amount_due - payment.amount_paid : 0

  const showLegacySection = legacyPhase !== 'skipped' && legacyPhase !== 'loading'

  const navLinks: { id: string; label: string }[] = [
    { id: 'sec-festival', label: 'Festival' },
    { id: 'sec-anwesenheit', label: 'Anwesenheit' },
    { id: 'sec-kosten', label: 'Kosten' },
    { id: 'sec-action', label: view === 'confirmed' ? 'Überweisung' : 'Bestätigung' },
    ...(view === 'confirmed' ? [{ id: 'sec-status', label: 'Status' }] : []),
    ...(showLegacySection ? [{ id: 'sec-altguthaben', label: 'Altguthaben' }] : []),
  ]

  return (
    <>
      <Navbar />

      {/* ── Fixed sidebar ───────────────────────────────────── */}
      <aside className="fixed left-6 top-1/2 -translate-y-1/2 z-20 hidden md:flex flex-col gap-4">
        {navLinks.map(link => (
          <button
            key={link.id}
            onClick={() => scrollTo(link.id)}
            className="flex items-center gap-2.5 group text-left"
          >
            <span className={`block w-1.5 h-1.5 rounded-full transition-all duration-300 ${
              activeSection === link.id
                ? 'bg-green-400 scale-150'
                : 'bg-gray-600 group-hover:bg-gray-400'
            }`} />
            <span className={`text-xs transition-colors duration-300 ${
              activeSection === link.id
                ? 'text-green-400 font-semibold'
                : 'text-gray-500 group-hover:text-gray-300'
            }`}>
              {link.label}
            </span>
          </button>
        ))}
      </aside>

      {/* ── Sections ────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4">

        {/* ── 0. Festival Info ────────────────────────────────── */}
        <section id="sec-festival" className="snap-section">
          {config ? (
            <div className="space-y-8">
              <div className="space-y-3">
                <h1 className="text-5xl font-black tracking-tight bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent leading-tight">
                  {config.festival_name}
                </h1>
                {config.festival_start && (
                  <p className="text-yellow-300 text-lg font-semibold">
                    {formatDateRange(config.festival_start, numDays)}
                  </p>
                )}
                {config.location && (
                  <p className="text-gray-300 text-base">{config.location}</p>
                )}
              </div>

              <div className="space-y-3 border-l-2 border-forest-600 pl-5">
                {config.daily_rate && (
                  <InfoLine label="Tagessatz" value={`${formatEur(config.daily_rate)} / Tag`} />
                )}
                {config.payment_deadline && (
                  <InfoLine label="Zahlungsdeadline" value={formatDate(config.payment_deadline)} highlight />
                )}
              </div>

              {config.notes && (
                <p className="text-gray-300 text-sm leading-relaxed italic border-t border-forest-700 pt-5">
                  {config.notes}
                </p>
              )}

              <button
                onClick={() => scrollTo('sec-anwesenheit')}
                className="text-sm text-gray-400 hover:text-green-400 transition-colors"
              >
                Zur Anwesenheit ↓
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <h1 className="text-5xl font-black bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent">
                Wald Wiese Weed
              </h1>
              <p className="text-gray-400">Festival noch nicht konfiguriert.</p>
            </div>
          )}
        </section>

        {/* ── 1. Anwesenheit ──────────────────────────────────── */}
        <section id="sec-anwesenheit" className="snap-section">
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-black text-white leading-tight">
                {firstName(profile)},<br />wann bist du dabei?
              </h2>
              <p className="text-gray-400 text-sm mt-2">
                Tippe auf die Tage an denen du anwesend bist.
              </p>
            </div>

            {config ? (
              <AttendanceSection
                user={user!}
                config={config}
                attendance={attendance}
                onUpdate={handleAttendanceUpdate}
              />
            ) : (
              <div className="card">
                <div className="card-body py-6 text-center text-sm text-gray-400">
                  Festival noch nicht konfiguriert.
                </div>
              </div>
            )}

            <button
              onClick={() => scrollTo('sec-kosten')}
              className="text-sm text-gray-400 hover:text-green-400 transition-colors"
            >
              Kostenvorschau ansehen ↓
            </button>
          </div>
        </section>

        {/* ── 2. Kostenvorschau ───────────────────────────────── */}
        <section id="sec-kosten" className="snap-section">
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-black text-white">Kostenvorschau</h2>
              <p className="text-gray-400 text-sm mt-2">
                Basierend auf deinen Tagen und dem Tagessatz.
              </p>
            </div>

            <div className="card">
              <div className="card-body">
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Deine Tage" value={daysPresent.toString()} />
                  <StatCard label="Tagessatz" value={config ? formatEur(dailyRate) : '—'} sub="/ Tag" />
                  <StatCard label="Geschätzte Kosten" value={formatEur(estimatedCost)} color="yellow" />
                </div>
                <p className="text-xs text-gray-400">
                  Endgültiger Betrag wird nach dem Festival aus den tatsächlichen Gesamtkosten berechnet.
                </p>
              </div>
            </div>

            <button
              onClick={() => scrollTo('sec-action')}
              className="text-sm text-gray-400 hover:text-green-400 transition-colors"
            >
              {view === 'confirmed' ? 'Zur Überweisung ↓' : 'Zur Bestätigung ↓'}
            </button>
          </div>
        </section>

        {/* ── 3a. Bestätigung / Skeleton (planning & calculating) */}
        {(view === 'planning' || view === 'calculating') && (
          <section id="sec-action" className="snap-section">
            <div className="space-y-6">
              {view === 'planning' ? (
                <>
                  <div>
                    <h2 className="text-3xl font-black text-white">Alles klar?</h2>
                    <p className="text-gray-400 text-sm mt-2">
                      Bestätige deine Anwesenheit damit wir planen können.
                    </p>
                  </div>
                  <div className="card">
                    <div className="card-body py-12 flex flex-col items-center text-center gap-6">
                      <div className="space-y-2">
                        <p className="text-white font-semibold text-xl">
                          {daysPresent === 0
                            ? 'Keine Tage ausgewählt'
                            : `${daysPresent} ${daysPresent === 1 ? 'Tag' : 'Tage'} · ${formatEur(estimatedCost)}`
                          }
                        </p>
                        <p className="text-gray-400 text-sm">
                          {daysPresent === 0
                            ? 'Scroll zurück und wähle zuerst deine Tage aus.'
                            : 'Stimmt das so? Dann bestätigen.'
                          }
                        </p>
                      </div>
                      <button
                        onClick={handleConfirm}
                        disabled={daysPresent === 0}
                        className="bg-green-700 hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-3.5 px-12 rounded-2xl transition-all text-base tracking-wide"
                      >
                        Anwesenheit bestätigen →
                      </button>
                      <button
                        onClick={() => scrollTo('sec-anwesenheit')}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        Zurück zur Auswahl
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <h2 className="text-3xl font-black text-white">Wird berechnet…</h2>
                    <p className="text-gray-400 text-sm mt-2">Einen Moment.</p>
                  </div>
                  <PaymentSkeleton />
                </>
              )}
            </div>
          </section>
        )}

        {/* ── 3b. Überweisung: Betrag + Bankdaten (confirmed) ── */}
        {view === 'confirmed' && (
          <section id="sec-action" className="snap-section">
            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-black text-white">Überweisung</h2>
                <p className="text-gray-400 text-sm mt-2">
                  {payment
                    ? 'Das ist dein festgelegter Betrag.'
                    : 'Geschätzter Betrag auf Basis deiner Tage.'}
                </p>
              </div>

              {/* Amount */}
              <div className="card">
                <div className="card-body">
                  <div className="grid grid-cols-3 gap-3">
                    {payment ? (
                      <>
                        <StatCard label="Zu zahlen" value={formatEur(payment.amount_due)} />
                        <StatCard label="Bezahlt" value={formatEur(payment.amount_paid)} color="green" />
                        <StatCard
                          label="Offen"
                          value={formatEur(remaining)}
                          color={remaining > 0 ? 'red' : 'green'}
                        />
                      </>
                    ) : (
                      <>
                        <StatCard label="Deine Tage" value={daysPresent.toString()} />
                        <StatCard label="Tagessatz" value={config ? formatEur(dailyRate) : '—'} sub="/ Tag" />
                        <StatCard label="Erwartete Kosten" value={formatEur(estimatedCost)} color="yellow" />
                      </>
                    )}
                  </div>
                  {payment?.notes && (
                    <p className="text-sm text-gray-300">{payment.notes}</p>
                  )}
                </div>
              </div>

              {/* Bank details */}
              {config?.bank_iban && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">Bankverbindung</h3>
                  </div>
                  <div className="card-body pt-4 space-y-3">
                    <InfoRow label="Empfänger" value={config.bank_recipient ?? '—'} />
                    <InfoRow label="Bank" value={config.bank_name ?? '—'} />
                    <InfoRow label="IBAN" value={config.bank_iban} mono />
                    {payment && remaining > 0 && (
                      <div className="border-t border-forest-700 pt-3">
                        <p className="text-xs text-gray-400 mb-1">Verwendungszweck</p>
                        <p className="font-mono text-sm text-gray-200">
                          {config?.payment_reference
                            ? config.payment_reference.replace('{Name}', fullName(profile))
                            : `Festival ${fullName(profile)}`}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4">
                <button
                  onClick={() => scrollTo('sec-status')}
                  className="text-sm text-gray-400 hover:text-green-400 transition-colors"
                >
                  Zum Zahlungsstatus ↓
                </button>
                <button
                  onClick={() => {
                    setView('planning')
                    setTimeout(() => scrollTo('sec-anwesenheit'), 50)
                  }}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Anwesenheit anpassen
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── 4. Zahlungsstatus (confirmed) ───────────────────── */}
        {view === 'confirmed' && (
          <section id="sec-status" className="snap-section">
            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-black text-white">Zahlungsstatus</h2>
                <p className="text-gray-400 text-sm mt-2">
                  Hier siehst du ob deine Zahlung bei uns angekommen ist.
                </p>
              </div>

              <div className="card">
                <div className="card-body">
                  {payment ? (
                    <div className={payment.paid ? 'badge-paid' : 'badge-pending'}>
                      {payment.paid
                        ? '✅ Zahlung eingegangen — alles erledigt!'
                        : '⏳ Noch nicht eingegangen — wir geben Bescheid'}
                    </div>
                  ) : (
                    <div className="badge-pending">
                      ⏳ Betrag noch nicht festgelegt — wird nach dem Festival berechnet
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Die Admins markieren deine Zahlung sobald sie auf dem Konto eingegangen ist.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── 5. Altguthaben (WWW6) ───────────────────────────── */}
        {showLegacySection && (
          <section id="sec-altguthaben" className="snap-section">
            <LegacySurveySection
              phase={legacyPhase}
              credit={legacyCredit}
              decision={legacyDecision}
              request={legacyRequest}
              unmatchedCredits={unmatchedCredits}
              config={config}
              onSkip={() => {
                localStorage.setItem(`wwwLegacySkip_${user!.id}`, '1')
                setLegacyPhase('skipped')
              }}
              onAskName={async () => {
                const { data } = await supabase
                  .from('legacy_credits').select('*').is('matched_user_id', null).order('display_name')
                setUnmatchedCredits(data ?? [])
                setLegacyPhase('ask_name')
              }}
              onSubmitRequest={async (creditId: string) => {
                const { data } = await supabase.rpc('submit_legacy_credit_request', { p_credit_id: creditId })
                if ((data as { error?: string })?.error) return
                const { data: req } = await supabase
                  .from('legacy_credit_requests').select('*').eq('requesting_user_id', user!.id)
                  .eq('status', 'pending').maybeSingle()
                setLegacyRequest(req)
                setLegacyPhase('request_pending')
              }}
              onDecide={async (decision: LegacyDecisionType) => {
                if (!legacyCredit) return
                await supabase.from('legacy_credit_decisions').insert({
                  legacy_credit_id: legacyCredit.id,
                  user_id: user!.id,
                  decision,
                })
                const { data: dec } = await supabase
                  .from('legacy_credit_decisions').select('*').eq('user_id', user!.id).maybeSingle()
                setLegacyDecision(dec)
                setLegacyPhase('decided')
              }}
            />
          </section>
        )}

      </div>
    </>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function PaymentSkeleton() {
  return (
    <div className="card">
      <div className="card-body space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="stat-card flex flex-col items-center gap-2 py-5">
              <div className="shimmer h-3 w-16 rounded" />
              <div className="shimmer h-7 w-24 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="shimmer h-14 w-full rounded-xl" />
        <div className="shimmer h-3 w-48 rounded" />
      </div>
    </div>
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
    <div className="card">
      <div className="card-body">
        <div className="flex gap-3 flex-wrap">
          {dayLabels.map((label, i) => {
            const present = isPresent(i)
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                disabled={saving === i}
                className={`flex flex-col items-center px-5 py-4 rounded-2xl border-2 font-medium transition-all min-w-[64px] ${
                  saving === i
                    ? 'opacity-50 cursor-wait border-forest-600 bg-forest-800'
                    : present
                      ? 'border-green-500 bg-green-900/30 text-green-300 shadow-lg shadow-green-900/20'
                      : 'border-forest-600 bg-forest-800 text-gray-400 hover:border-forest-500 hover:text-gray-200'
                }`}
              >
                <span className="text-base font-bold">{present ? '✓' : '+'}</span>
                <span className="text-xs mt-1">{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-white font-medium ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
    </div>
  )
}

function InfoLine({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-gray-400 uppercase tracking-wide w-32 shrink-0">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-yellow-300' : 'text-gray-200'}`}>{value}</span>
    </div>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub?: string
  color?: 'green' | 'red' | 'yellow'
}) {
  const textColor =
    color === 'green' ? 'text-green-400' :
    color === 'red' ? 'text-red-400' :
    color === 'yellow' ? 'text-yellow-300' :
    'text-white'
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${textColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Legacy Survey Section ────────────────────────────────────────────────────

function LegacySurveySection({
  phase,
  credit,
  decision,
  request,
  unmatchedCredits,
  config,
  onSkip,
  onAskName,
  onSubmitRequest,
  onDecide,
}: {
  phase: LegacyPhase
  credit: LegacyCredit | null
  decision: LegacyCreditDecision | null
  request: LegacyCreditRequest | null
  unmatchedCredits: LegacyCredit[]
  config: FestivalConfig | null
  onSkip: () => void
  onAskName: () => Promise<void>
  onSubmitRequest: (creditId: string) => Promise<void>
  onDecide: (decision: LegacyDecisionType) => Promise<void>
}) {
  const [selectedCredit, setSelectedCredit] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deciding, setDeciding] = useState<LegacyDecisionType | null>(null)

  const DECISION_OPTIONS: { key: LegacyDecisionType; label: string; desc: string; color: string }[] = [
    { key: 'refund',      label: 'Zurückzahlen',       desc: 'Ich möchte das Geld zurück.',                      color: 'border-blue-600 hover:border-blue-400' },
    { key: 'apply_www7',  label: 'Verrechnen',          desc: 'Mit meinen WWW7-Kosten verrechnen.',               color: 'border-green-600 hover:border-green-400' },
    { key: 'donate_www',  label: 'Spende ans WWW',      desc: 'Das Geld bleibt in der Gemeinschaft.',             color: 'border-yellow-600 hover:border-yellow-400' },
    ...(config?.donation_org1_name ? [{
      key: 'donate_org1' as LegacyDecisionType,
      label: `Spende: ${config.donation_org1_name}`,
      desc: config.donation_org1_description ?? '',
      color: 'border-purple-600 hover:border-purple-400',
    }] : []),
    ...(config?.donation_org2_name ? [{
      key: 'donate_org2' as LegacyDecisionType,
      label: `Spende: ${config.donation_org2_name}`,
      desc: config.donation_org2_description ?? '',
      color: 'border-pink-600 hover:border-pink-400',
    }] : []),
  ]

  const DECISION_LABELS: Record<LegacyDecisionType, string> = {
    refund: 'Rückzahlung',
    apply_www7: 'Verrechnung WWW7',
    donate_www: 'Spende ans WWW',
    donate_org1: config?.donation_org1_name ? `Spende: ${config.donation_org1_name}` : 'Spende Org 1',
    donate_org2: config?.donation_org2_name ? `Spende: ${config.donation_org2_name}` : 'Spende Org 2',
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-black text-white">Altguthaben</h2>
        <p className="text-gray-400 text-sm mt-2">Aus dem letzten WWW sind noch Gelder offen.</p>
      </div>

      {phase === 'decided' && decision && (
        <div className="card">
          <div className="card-body space-y-2">
            <div className="badge-paid">Deine Entscheidung ist gespeichert.</div>
            <p className="text-sm text-gray-300">
              Guthaben: <span className="text-white font-semibold">{credit ? formatEur(credit.amount_owed) : '—'}</span>
              {' · '}Wahl: <span className="text-green-400 font-semibold">{DECISION_LABELS[decision.decision]}</span>
            </p>
          </div>
        </div>
      )}

      {phase === 'matched' && credit && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-body">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Dein Guthaben</p>
              <p className="text-3xl font-black text-yellow-300">{formatEur(credit.amount_owed)}</p>
              <p className="text-xs text-gray-500 mt-1">aus WWW6 · {credit.display_name}</p>
            </div>
          </div>
          <p className="text-sm text-gray-300 font-medium">Was soll damit passieren?</p>
          <div className="space-y-2">
            {DECISION_OPTIONS.map(opt => (
              <button
                key={opt.key}
                disabled={!!deciding}
                onClick={async () => {
                  setDeciding(opt.key)
                  await onDecide(opt.key)
                  setDeciding(null)
                }}
                className={`w-full text-left p-4 rounded-xl border-2 bg-forest-800 transition-all ${deciding === opt.key ? 'opacity-50' : opt.color}`}
              >
                <p className="font-semibold text-white text-sm">{deciding === opt.key ? 'Wird gespeichert…' : opt.label}</p>
                {opt.desc && <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'no_match' && (
        <div className="card">
          <div className="card-body space-y-4">
            <p className="text-sm text-gray-200">Warst du beim letzten WaldWieseWeed dabei?</p>
            <div className="flex gap-3">
              <button
                onClick={async () => { setSubmitting(true); await onAskName(); setSubmitting(false) }}
                disabled={submitting}
                className="btn-primary text-sm"
              >
                {submitting ? 'Lädt…' : 'Ja, ich war dabei'}
              </button>
              <button onClick={onSkip} className="btn-ghost text-sm">
                Nein, erstes Mal
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'ask_name' && (
        <div className="card">
          <div className="card-body space-y-4">
            <p className="text-sm text-gray-200">
              Wähle deinen Namen aus der Liste des letzten Jahres:
            </p>
            <select
              value={selectedCredit}
              onChange={e => setSelectedCredit(e.target.value)}
              className="input-sm w-full"
            >
              <option value="">— Namen auswählen —</option>
              {unmatchedCredits.map(c => (
                <option key={c.id} value={c.id}>{c.display_name} · {formatEur(c.amount_owed)}</option>
              ))}
            </select>
            <button
              disabled={!selectedCredit || submitting}
              onClick={async () => {
                setSubmitting(true)
                await onSubmitRequest(selectedCredit)
                setSubmitting(false)
              }}
              className="btn-primary text-sm"
            >
              {submitting ? 'Wird gesendet…' : 'Anfrage absenden'}
            </button>
            <p className="text-xs text-gray-500">
              Ein Admin bestätigt deine Zuordnung — danach kannst du entscheiden.
            </p>
          </div>
        </div>
      )}

      {phase === 'request_pending' && (
        <div className="card">
          <div className="card-body">
            <div className="badge-pending">
              ⏳ Deine Anfrage ist eingegangen — wir bestätigen sie in Kürze.
            </div>
          </div>
        </div>
      )}

      {phase === 'request_rejected' && request && (
        <div className="card">
          <div className="card-body space-y-3">
            <div className="badge-pending">Anfrage abgelehnt.</div>
            {request.admin_note && (
              <p className="text-xs text-gray-400">Hinweis: {request.admin_note}</p>
            )}
            <button
              onClick={async () => { setSubmitting(true); await onAskName(); setSubmitting(false) }}
              disabled={submitting}
              className="btn-ghost text-sm"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function getDayLabel(config: FestivalConfig, dayIndex: number): string {
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  if (config.festival_start) {
    const d = new Date(config.festival_start)
    d.setDate(d.getDate() + dayIndex)
    return weekdays[d.getDay()] + ' ' + d.getDate() + '.'
  }
  return `Tag ${dayIndex + 1}`
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
