import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '../config/firebase'
import { AuthContext } from './auth-context'

function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : ''
}

// Popup failures that should fall back to a full-page redirect rather than be
// treated as a real error. A COOP-isolated popup (the localhost symptom) reports
// itself as closed or cancelled even though the user did nothing, so those codes
// trigger the redirect too: the redirect path always completes sign-in.
function shouldRedirect(err: unknown): boolean {
  const code = errorCode(err)
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/web-storage-unsupported' ||
    code === 'auth/operation-not-supported-in-this-environment'
  )
}

function authErrorMessage(err: unknown): string {
  switch (errorCode(err)) {
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for sign in. Add it in Firebase Auth settings.'
    case 'auth/operation-not-allowed':
      return 'Google sign in is not enabled for this project yet.'
    default:
      return 'Sign in did not complete. Try again.'
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next)
      setLoading(false)
    })
    // Complete any redirect-based sign-in and surface its errors.
    getRedirectResult(auth).catch((err) => setError(authErrorMessage(err)))
    return unsubscribe
  }, [])

  const signInWithGoogle = useCallback(async () => {
    setError(null)
    setSigningIn(true)
    try {
      await signInWithPopup(auth, googleProvider)
      setSigningIn(false)
    } catch (err) {
      if (shouldRedirect(err)) {
        // Fall back to a full-page redirect: the popup was blocked or isolated by
        // COOP. The page navigates away, so keep the signing-in state until return,
        // where getRedirectResult and onAuthStateChanged complete the sign-in.
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
    // Callers fire-and-forget this, so catch here: a failed sign-out should say so
    // rather than reject unhandled with no feedback.
    try {
      await firebaseSignOut(auth)
    } catch {
      setError('Could not sign out. Check your connection and try again.')
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return (
    <AuthContext.Provider
      value={{ user, loading, signingIn, error, signInWithGoogle, signOut, clearError }}
    >
      {children}
    </AuthContext.Provider>
  )
}
