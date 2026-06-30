import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { Button } from '../components/Button'
import { AppIcon } from '../components/AppIcon'
import { Spinner } from '../components/Spinner'
import { Splash } from '../components/Splash'
import { AlertIcon } from '../components/icons/ui'
import { GoogleGlyph } from '../components/icons/Google'
import { APP_NAME } from '../config/app'

export default function Login() {
  const { user, loading, signInWithGoogle, signingIn, error } = useAuth()

  // Wait for the first auth resolution so an already-signed-in visitor does not
  // see a flash of the sign-in screen before the redirect.
  if (loading) return <Splash />
  if (user) return <Navigate to="/" replace />

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-bg px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[env(safe-area-inset-top)] motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
      <div className="flex flex-col items-center gap-5 text-center">
        <AppIcon size={72} decorative className="rounded-lg shadow-sm ring-1 ring-line" />
        <div className="flex flex-col gap-2">
          <h1 className="text-display text-ink">{APP_NAME}</h1>
          <p className="max-w-[320px] text-body text-ink-2">
            See what our spending today could become if we invested it instead. Sign in to our
            household.
          </p>
        </div>
      </div>

      <div className="flex w-full max-w-[320px] flex-col items-center gap-3">
        <Button
          size="lg"
          fullWidth
          aria-busy={signingIn}
          onClick={() => void signInWithGoogle()}
          disabled={signingIn}
          leadingIcon={
            signingIn ? (
              <Spinner size={20} />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                <GoogleGlyph size={16} />
              </span>
            )
          }
        >
          {signingIn ? 'Signing in' : 'Continue with Google'}
        </Button>
        <div className="min-h-5">
          {error != null && (
            <p role="alert" className="inline-flex items-center gap-1.5 text-center text-caption text-danger">
              <AlertIcon size={14} strokeWidth={2} aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
