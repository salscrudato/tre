import { lazy, Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { queryClient } from './lib/queryClient'
import { ThemeProvider } from './context/ThemeProvider'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppShell } from './components/AppShell'
import { Splash } from './components/Splash'

// Every route is code-split, so the initial load only pulls the shell and the
// landing screen. Optimize (the AI page) and its dependencies load on demand.
const Login = lazy(() => import('./routes/Login'))
const Home = lazy(() => import('./routes/Home'))
const Spending = lazy(() => import('./routes/Spending'))
const House = lazy(() => import('./routes/House'))
const Bills = lazy(() => import('./routes/Recurring'))
const Optimize = lazy(() => import('./routes/Optimize'))
const Settings = lazy(() => import('./routes/Settings'))

// Routes. Primary navigation lives in the header hamburger drawer (Home, Spending,
// House, Settings). Logging happens via the floating Log button, which opens the
// Quick Add in a sheet from any screen except Home, whose hero is the Quick Add
// itself. Bills and Optimize are reached from within Spending and House. Legacy paths
// redirect so a cached PWA link still lands on the right screen.
export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<Splash />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppShell />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/spending" element={<Spending />} />
                    <Route path="/house" element={<House />} />
                    <Route path="/bills" element={<Bills />} />
                    <Route path="/optimize" element={<Optimize />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/dashboard" element={<Navigate to="/spending" replace />} />
                    <Route path="/recurring" element={<Navigate to="/bills" replace />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
