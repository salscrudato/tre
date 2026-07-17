import { lazy, Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { queryClient } from './lib/queryClient'
import { ThemeProvider } from './context/ThemeProvider'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppShell } from './components/AppShell'
import { Splash } from './components/Splash'
import { UpdatePrompt } from './components/UpdatePrompt'

// Every route is code-split, so the initial load only pulls the shell and the
// landing screen. Optimize (the AI page) and its dependencies load on demand.
// The two entry screens start downloading with the boot instead of one render
// round-trip later, so first paint never waits serially on a lazy chunk.
const loginChunk = import('./routes/Login')
const homeChunk = import('./routes/Home')
const Login = lazy(() => loginChunk)
const Home = lazy(() => homeChunk)
const Spending = lazy(() => import('./routes/Spending'))
const Budget = lazy(() => import('./routes/Budget'))
const Income = lazy(() => import('./routes/Income'))
const House = lazy(() => import('./routes/House'))
const Bills = lazy(() => import('./routes/Recurring'))
const Optimize = lazy(() => import('./routes/Optimize'))
const Plan = lazy(() => import('./routes/Plan'))
const Settings = lazy(() => import('./routes/Settings'))

// Routes. Primary navigation lives in the header hamburger drawer (Home, Spending,
// Budget, Income, House, Settings). Logging happens only on Home (the Quick Add hero),
// so there is no floating Log button anywhere. Bills, Optimize, and the purchase planner
// are reached from within Spending and House. Legacy paths redirect so a cached PWA link
// still lands on the right screen.
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
                    <Route path="/budget" element={<Budget />} />
                    <Route path="/income" element={<Income />} />
                    <Route path="/house" element={<House />} />
                    <Route path="/bills" element={<Bills />} />
                    <Route path="/optimize" element={<Optimize />} />
                    <Route path="/plan" element={<Plan />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/dashboard" element={<Navigate to="/spending" replace />} />
                    <Route path="/recurring" element={<Navigate to="/bills" replace />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          {/* Portals to the body, so it rides above every screen when a deploy lands. */}
          <UpdatePrompt />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
