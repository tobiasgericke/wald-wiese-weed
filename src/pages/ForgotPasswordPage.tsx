import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // redirectTo ohne Hash: supabase hängt das Recovery-Token als Fragment an.
    // window.location.origin funktioniert lokal wie in Prod (beide in der
    // Redirect-Allowlist hinterlegt).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })

    if (error) {
      setError('Das hat nicht geklappt. Versuch es später nochmal.')
    } else {
      // Aus Datenschutzgründen verraten wir nicht, ob die E-Mail existiert.
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent">
            Wald Wiese Weed
          </h1>
          <p className="text-gray-500 text-sm">Passwort zurücksetzen</p>
        </div>

        <div className="card">
          <div className="card-body">
            {sent ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-300">
                  Falls ein Konto mit dieser E-Mail existiert, haben wir dir einen
                  Link zum Zurücksetzen geschickt. Schau in dein Postfach (ggf. auch
                  im Spam-Ordner).
                </p>
                <Link to="/login" className="btn-block text-center block">
                  Zurück zum Login
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="field-label">E-Mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="input-field"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-block mt-2"
                >
                  {loading ? 'Wird gesendet…' : 'Link anfordern'}
                </button>

                <p className="text-center text-sm text-gray-500 pt-2">
                  <Link to="/login" className="text-green-400 hover:text-green-300 font-medium">
                    Zurück zum Login
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
