import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { Splash } from './Splash'

// Gate for the authenticated app. Shows a splash while auth resolves, then either
// renders the nested routes or sends a signed-out visitor to the login screen.
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}
