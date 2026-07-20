import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export function ResetPasswordPage() {
  const { recovery, clearRecovery, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Hierher kommt man nur über einen Recovery-Link. Wer die Seite direkt
  // aufruft (kein aktiver Reset), fliegt zum Login.
  if (!recovery && !done) {
    return <Navigate to="/login" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (password !== confirm) {
      setError('Die Passwörter stimmen nicht überein.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError('Das Zurücksetzen ist fehlgeschlagen. Fordere den Link ggf. neu an.')
      return
    }

    // Erfolg: Recovery beenden und die temporäre Session verwerfen, damit man
    // sich frisch mit dem neuen Passwort anmeldet.
    setDone(true)
    clearRecovery()
    await signOut()
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent">
            Wald Wiese Weed
          </h1>
          <p className="text-gray-500 text-sm">Neues Passwort vergeben</p>
        </div>

        <div className="card">
          <div className="card-body">
            {done ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-300">
                  Dein Passwort wurde geändert. Du kannst dich jetzt mit dem neuen
                  Passwort anmelden.
                </p>
                <Link to="/login" className="btn-block text-center block">
                  Zum Login
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="field-label">Neues Passwort</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="field-label">Passwort wiederholen</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
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
                  {loading ? 'Wird gespeichert…' : 'Passwort speichern'}
                </button>
              </form>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
