import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <Link to="/dashboard" className="text-lg font-bold text-indigo-400 tracking-wide">
        🎪 Festival
      </Link>
      <div className="flex items-center gap-4">
        {profile?.is_admin && (
          <Link
            to="/admin"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Admin
          </Link>
        )}
        <span className="text-sm text-gray-400">{profile?.name}</span>
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-red-400 transition-colors"
        >
          Abmelden
        </button>
      </div>
    </nav>
  )
}
