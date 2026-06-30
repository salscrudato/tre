// Firebase web SDK initialization for Tre.
// Config comes only from VITE_FIREBASE_ env vars (see .env.local), never hardcoded.
// Auth uses Google sign-in (the docs' email/password references are overridden).

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  setPersistence,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Fail loudly during development if the env file was not loaded, rather than
// letting the SDK initialize with undefined values and fail later at sign-in.
const missing = (['apiKey', 'authDomain', 'projectId', 'appId'] as const).filter(
  (key) => !firebaseConfig[key],
)
if (missing.length > 0) {
  throw new Error(
    `Missing Firebase config values: ${missing.join(', ')}. Check that .env.local exists and the dev server was restarted.`,
  )
}

// Reuse the existing app across hot module reloads to avoid a duplicate-app error.
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Firestore with offline persistence: previously loaded data is readable without a
// connection, and writes queue and sync when it returns. Multi-tab safe.
function createFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch {
    // Already initialized (hot reload): reuse the existing instance.
    return getFirestore(app)
  }
}
export const db = createFirestore()

// Callable functions live in us-east1 (see docs/ARCHITECTURE.md section 6).
export const functions = getFunctions(app, 'us-east1')

// Single shared Google provider instance for sign-in flows.
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// By default the app talks to the LIVE Firebase project (sallisascru) even in dev,
// so you can sign in with Google and use real data from localhost. To exercise the
// local emulators instead, set VITE_USE_EMULATORS=true in .env.local. Production
// builds never use emulators. The flag survives hot reloads to avoid reconnecting.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  const flags = globalThis as typeof globalThis & { __nestEmulatorsConnected?: boolean }
  if (!flags.__nestEmulatorsConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    flags.__nestEmulatorsConnected = true
  }
}

// Keep the session on the installed PWA across launches. Persistence can fail in
// private mode or restricted webviews; sign-in still works for the session if so.
setPersistence(auth, browserLocalPersistence).catch(() => {})
