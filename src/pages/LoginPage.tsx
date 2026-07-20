import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('E-Mail oder Passwort falsch.')
    } else {
      navigate('/dashboard')
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
          <p className="text-gray-500 text-sm">Willkommen zurück</p>
        </div>

        <div className="card">
          <div className="card-body">
            <form onSubmit={handleLogin} className="space-y-4">
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
              <div>
                <label className="field-label">Passwort</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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
                {loading ? 'Wird angemeldet…' : 'Anmelden'}
              </button>

              <p className="text-center text-sm pt-1">
                <Link to="/forgot-password" className="text-gray-500 hover:text-gray-400">
                  Passwort vergessen?
                </Link>
              </p>
            </form>

            <p className="text-center text-sm text-gray-500 pt-2">
              Noch kein Konto?{' '}
              <Link to="/register" className="text-green-400 hover:text-green-300 font-medium">
                Registrieren
              </Link>
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
