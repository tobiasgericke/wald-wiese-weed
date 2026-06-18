import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function RegisterPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      },
    })

    if (signUpError) {
      const msg = signUpError.message
      if (msg.includes('after')) {
        const seconds = msg.match(/\d+/)?.[0]
        setError(`Zu viele Versuche. Bitte ${seconds ? `${seconds} Sekunden` : 'kurz'} warten.`)
      } else if (msg.includes('rate limit')) {
        setError('Zu viele Registrierungsversuche. Bitte ein paar Minuten warten.')
      } else if (msg.includes('already registered') || msg.includes('already been registered')) {
        setError('Diese E-Mail-Adresse ist bereits registriert. Bitte anmelden.')
      } else {
        setError('Registrierung fehlgeschlagen. Bitte versuche es erneut.')
      }
      setLoading(false)
      return
    }

    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent">
            Wald Wiese Weed
          </h1>
          <p className="text-gray-500 text-sm">Konto erstellen</p>
        </div>

        <div className="card">
          <div className="card-body">
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Vorname</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required
                    autoComplete="given-name"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="field-label">Nachname</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    required
                    autoComplete="family-name"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="field-label">E-Mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="input-field"
                />
              </div>
              <div>
                <label className="field-label">Passwort</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
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
                {loading ? 'Wird registriert…' : 'Registrieren'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 pt-2">
              Bereits ein Konto?{' '}
              <Link to="/login" className="text-green-400 hover:text-green-300 font-medium">
                Anmelden
              </Link>
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
