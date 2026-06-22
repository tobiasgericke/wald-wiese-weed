// Supabase Edge Function: notify
// Verschickt transaktionale Mails über Resend (https://resend.com).
// Wird vom Client per supabase.functions.invoke('notify', { body: {...} }) aufgerufen.
//
// Benötigte Secrets (im Supabase-Dashboard unter Edge Functions → notify → Secrets,
// oder: supabase secrets set ...):
//   RESEND_API_KEY   – API-Key von Resend
//   MAIL_FROM        – optional, Absender (Default: 'WaldWieseWeed <noreply@waldwieseweed.de>')
//   MAIL_APP_URL     – optional, Link zur App (Default: 'https://waldwieseweed.de')
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY werden automatisch injiziert.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'WaldWieseWeed <noreply@waldwieseweed.de>'
const APP_URL = Deno.env.get('MAIL_APP_URL') ?? 'https://waldwieseweed.de'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Payload =
  | { type: 'new_request' }
  | { type: 'decision'; userId: string; status: 'approved' | 'rejected' }
  | { type: 'payment_confirmed'; userId: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
    <h2 style="color:#2f6b3a">${title}</h2>
    ${bodyHtml}
    <p style="margin-top:24px"><a href="${APP_URL}" style="color:#2f6b3a">Zum Festival-Tool →</a></p>
    <p style="color:#888;font-size:12px;margin-top:24px">WaldWieseWeed</p>
  </div>`
}

async function sendMail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY nicht gesetzt – Mail wird übersprungen:', subject)
    return
  }
  const recipients = to.filter(Boolean)
  if (recipients.length === 0) return
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: recipients, subject, html }),
  })
  if (!res.ok) console.error('Resend-Fehler', res.status, await res.text())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const payload = (await req.json()) as Payload

    const isAdmin = async () => {
      const { data } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      return data?.is_admin === true
    }
    const greet = (p: { first_name?: string | null; name?: string | null } | null) =>
      (p?.first_name?.trim() || p?.name?.trim() || 'Hallo')

    if (payload.type === 'new_request') {
      // Vom anfragenden Nutzer ausgelöst → Admins benachrichtigen.
      const { data: requester } = await admin
        .from('profiles').select('first_name, last_name, name').eq('id', user.id).maybeSingle()
      const { data: admins } = await admin.from('profiles').select('email').eq('is_admin', true)
      const who = [requester?.first_name, requester?.last_name].filter(Boolean).join(' ') || requester?.name || 'Ein Nutzer'
      await sendMail(
        (admins ?? []).map((a) => a.email),
        'Neue Altguthaben-Anfrage',
        shell('Neue Altguthaben-Anfrage', `<p><strong>${who}</strong> hat eine Altguthaben-Zuordnung angefragt. Bitte im Admin-Bereich prüfen und bestätigen oder ablehnen.</p>`),
      )
      return json({ ok: true })
    }

    // decision & payment_confirmed sind Admin-Aktionen.
    if (!(await isAdmin())) return json({ error: 'forbidden' }, 403)

    const { data: target } = await admin
      .from('profiles').select('email, first_name, name').eq('id', payload.userId).maybeSingle()
    if (!target?.email) return json({ error: 'recipient not found' }, 404)

    if (payload.type === 'decision') {
      if (payload.status === 'approved') {
        await sendMail([target.email], 'Deine Altguthaben-Zuordnung wurde bestätigt',
          shell('Zuordnung bestätigt', `<p>${greet(target)}, deine Altguthaben-Zuordnung wurde bestätigt. Du kannst jetzt im Festival-Tool entscheiden, was mit deinem Guthaben passieren soll.</p>`))
      } else {
        await sendMail([target.email], 'Deine Altguthaben-Zuordnung konnte nicht bestätigt werden',
          shell('Zuordnung nicht bestätigt', `<p>${greet(target)}, leider konnten wir deine Altguthaben-Zuordnung nicht bestätigen. Du kannst es im Festival-Tool erneut versuchen.</p>`))
      }
      return json({ ok: true })
    }

    if (payload.type === 'payment_confirmed') {
      await sendMail([target.email], 'Zahlung eingegangen – deine Anmeldung ist final',
        shell('Zahlung eingegangen 🎉', `<p>${greet(target)}, wir haben deine Zahlung erhalten. Deine Anmeldung fürs WaldWieseWeed ist damit final – wir freuen uns auf dich!</p>`))
      return json({ ok: true })
    }

    return json({ error: 'unknown type' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: String(e) }, 500)
  }
})
