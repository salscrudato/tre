import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '../config/firebase'
import { queryClient } from '../lib/queryClient'
import { showToast } from '../lib/toast'
import { AuthContext } from './auth-context'

function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : ''
}

// Popup failures that should fall back to a full-page redirect rather than be
// treated as a real error: the environment genuinely cannot run a popup. A popup
// the user closed on purpose is handled separately (a silent reset, not a
// redirect), so backing out of the Google chooser never yanks the whole page away.
function shouldRedirect(err: unknown): boolean {
  const code = errorCode(err)
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/web-storage-unsupported' ||
    code === 'auth/operation-not-supported-in-this-environment'
  )
}

function userClosedPopup(err: unknown): boolean {
  const code = errorCode(err)
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
}

function authErrorMessage(err: unknown): string {
  switch (errorCode(err)) {
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.'
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
      // Developer-configuration problems, phrased for the person seeing them.
      console.warn('Auth configuration error', errorCode(err))
      return 'Sign in is not set up for this app yet. Try again later.'
    default:
      return 'Sign in did not complete. Try again.'
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  // Returning from a redirect sign-in, onAuthStateChanged fires null first; holding
  // loading until getRedirectResult settles stops a flash of the idle sign-in button.
  const [redirectResolved, setRedirectResolved] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next)
      setAuthResolved(true)
    })
    // Complete any redirect-based sign-in and surface its errors.
    getRedirectResult(auth)
      .catch((err) => setError(authErrorMessage(err)))
      .finally(() => setRedirectResolved(true))
    return unsubscribe
  }, [])

  // iOS restores the page from the back-forward cache when the user backs out of the
  // Google page mid-redirect, reviving React state as it was: signingIn stuck true.
  // A bfcache restore resets it so the button is tappable again.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setSigningIn(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const signInWithGoogle = useCallback(async () => {
    setError(null)
    setSigningIn(true)
    try {
      await signInWithPopup(auth, googleProvider)
      setSigningIn(false)
    } catch (err) {
      if (userClosedPopup(err)) {
        // The user backed out on purpose: reset quietly, no error, no redirect.
        setSigningIn(false)
        return
      }
      if (shouldRedirect(err)) {
        // Fall back to a full-page redirect: the environment blocked the popup. The
        // page navigates away, so keep the signing-in state until return, where
        // getRedirectResult and onAuthStateChanged complete the sign-in.
        try {
          await signInWithRedirect(auth, googleProvider)
          return
        } catch (redirectErr) {
          setError(authErrorMessage(redirectErr))
        }
      } else {
        setError(authErrorMessage(err))
      }
      setSigningIn(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    // Callers fire-and-forget this, so surface failure where the user is (a toast;
    // the Login error line is not visible from Settings). On success, drop every
    // cached query so the next account never sees this session's data.
    try {
      await firebaseSignOut(auth)
      queryClient.clear()
    } catch {
      showToast('Could not sign out. Check your connection and try again.')
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const loading = !authResolved || !redirectResolved
  // Memoized so a parent re-render never hands every consumer a fresh context value.
  const value = useMemo(
    () => ({ user, loading, signingIn, error, signInWithGoogle, signOut, clearError }),
    [user, loading, signingIn, error, signInWithGoogle, signOut, clearError],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
