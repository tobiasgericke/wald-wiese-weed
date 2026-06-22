// Supabase Edge Function: notify
// Verschickt transaktionale Mails über Resend (https://resend.com).
// Wird vom Client per supabase.functions.invoke('notify', { body: {...} }) aufgerufen.
//
// Kein Service-Role-Key nötig: Autorisierung läuft über den User-JWT + SECURITY-DEFINER-
// Funktionen (is_admin, notify_admin_emails, notify_get_recipient).
//
// Secrets (Supabase → Edge Functions → notify → Secrets):
//   RESEND_API_KEY   – API-Key von Resend (ohne diesen werden Mails nur übersprungen)
//   MAIL_FROM        – optional, Absender (Default: 'WaldWieseWeed <info@waldwieseweed.de>')
//   MAIL_APP_URL     – optional, Link zur App (Default: 'https://waldwieseweed.de')

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'WaldWieseWeed <info@waldwieseweed.de>'
const APP_URL = Deno.env.get('MAIL_APP_URL') ?? 'https://waldwieseweed.de'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Payload =
  | { type: 'new_request' }
  | { type: 'decision'; userId: string; status: 'approved' | 'rejected' }
  | { type: 'payment_confirmed'; userId: string }

type Recipient = { email: string; first_name: string | null; name: string | null }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Warmer, schlichter Mail-Rahmen mit fester Grußzeile.
function shell(bodyHtml: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:460px;margin:0 auto;padding:8px;color:#1f2937;line-height:1.65;font-size:16px">
    ${bodyHtml}
    <p style="margin-top:28px;color:#6b7280;font-size:14px">Bis bald im Wald 🌲<br/>eure WaldWieseWeed-Crew</p>
  </div>`
}

const button = (label: string, href = APP_URL) =>
  `<p style="margin-top:18px"><a href="${href}" style="display:inline-block;background:#2f6b3a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:12px;font-weight:600">${label}</a></p>`

async function sendMail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY nicht gesetzt – Mail wird übersprungen:', subject)
    return { skipped: true }
  }
  const recipients = to.filter(Boolean)
  if (recipients.length === 0) return { skipped: true, reason: 'no recipients' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: recipients, subject, html }),
  })
  const text = await res.text()
  if (!res.ok) console.error('Resend-Fehler', res.status, text)
  return { ok: res.ok, status: res.status }
}

const firstName = (p: { first_name?: string | null; name?: string | null } | null) =>
  (p?.first_name?.trim() || p?.name?.trim() || 'du')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    // Ein Client im Kontext des aufrufenden Users (sein JWT).
    const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const payload = (await req.json()) as Payload

    if (payload.type === 'new_request') {
      // Vom anfragenden Nutzer ausgelöst → Admins benachrichtigen.
      const { data: requester } = await sb
        .from('profiles').select('first_name, last_name, name').eq('id', user.id).maybeSingle()
      const { data: admins } = await sb.rpc('notify_admin_emails')
      const who = [requester?.first_name, requester?.last_name].filter(Boolean).join(' ') || requester?.name || 'Jemand'
      const r = await sendMail(
        (admins as string[] | null) ?? [],
        'Jemand möchte sein Altguthaben zuordnen',
        shell(`<p>Kurzer Hinweis:</p>
          <p><strong>${who}</strong> möchte das Guthaben vom letzten Mal zugeordnet bekommen. Schau bei Gelegenheit kurz drüber und bestätige es – dann geht's für die Person weiter.</p>
          ${button('Im Admin-Bereich ansehen')}`),
      )
      return json({ ok: true, mail: r })
    }

    // decision & payment_confirmed sind Admin-Aktionen.
    const { data: isAdmin } = await sb.rpc('is_admin')
    if (isAdmin !== true) return json({ error: 'forbidden' }, 403)

    const { data: target } = await sb.rpc('notify_get_recipient', { p_user_id: payload.userId })
    const recipient = target as Recipient | null
    if (!recipient?.email) return json({ error: 'recipient not found' }, 404)
    const name = firstName(recipient)

    if (payload.type === 'decision') {
      const r = payload.status === 'approved'
        ? await sendMail([recipient.email], 'Passt – dein Guthaben gehört dir 🌿',
            shell(`<p>Hey ${name}!</p>
              <p>Wir haben dein Guthaben vom letzten WaldWieseWeed gefunden und dir zugeordnet.</p>
              <p>Jetzt darfst du entscheiden, was damit passieren soll: zurück aufs Konto, fürs nächste Mal gutschreiben oder spenden – ganz wie du magst.</p>
              ${button('Jetzt entscheiden')}`))
        : await sendMail([recipient.email], 'Kurze Rückfrage zu deinem Guthaben',
            shell(`<p>Hey ${name}!</p>
              <p>Wir konnten deine Auswahl noch nicht eindeutig zuordnen – vielleicht hat sich irgendwo ein Name verheddert. Kein Stress: schau nochmal kurz ins Tool und probier's erneut, dann kriegen wir das gemeinsam hin.</p>
              ${button('Nochmal versuchen')}`))
      return json({ ok: true, mail: r })
    }

    if (payload.type === 'payment_confirmed') {
      const r = await sendMail([recipient.email], 'Dein Platz ist sicher 🌲',
        shell(`<p>Hey ${name}!</p>
          <p>Dein Geld ist angekommen – damit bist du fix dabei. Wir freuen uns schon riesig auf dich!</p>`))
      return json({ ok: true, mail: r })
    }

    return json({ error: 'unknown type' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: String(e) }, 500)
  }
})
