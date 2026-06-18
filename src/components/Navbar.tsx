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
    <nav className="nav-bar">
      <Link to="/dashboard" className="flex items-baseline gap-2">
        <span className="text-lg font-black tracking-tight bg-gradient-to-r from-green-400 to-yellow-300 bg-clip-text text-transparent">
          Wald Wiese Weed
        </span>
      </Link>
      <div className="flex items-center gap-5">
        {profile?.is_admin && (
          <Link
            to="/admin"
            className="text-xs font-medium text-green-500 hover:text-green-400 transition-colors tracking-wide uppercase"
          >
            Admin
          </Link>
        )}
        <span className="text-sm text-gray-400">{profile?.name}</span>
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Abmelden
        </button>
      </div>
    </nav>
  )
}
