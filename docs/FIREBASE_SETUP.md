# FIREBASE_SETUP.md

How the Firebase backend gets set up for Nest. You are building from your MacBook with Claude Code in the terminal, and the firebase, gcloud, and gh CLIs are authenticated, so the agent provisions almost everything. This file lists the few steps that need you in a browser, and the CLI steps the agent runs.

Project id: sallisascru (already created, on Blaze). Firestore: the existing `(default)` database, Native mode, multi-region nam5 (location is immutable, do not recreate). Functions region: us-east1.

Legend: [YOU] = a quick step in the Firebase console. [AGENT] = Claude Code via the firebase or gcloud CLI.

## A. Project and billing
1. [AGENT] The project already exists; attach to it with `firebase use sallisascru`. Do not create it.
2. [DONE] Blaze is already enabled. Nothing to do.

## B. Authentication
3. [YOU] Authentication, Sign-in method: enable the Email/Password provider, and disable the Anonymous provider (the app does not use it, and leaving it on lets anyone with the link get a token). This is the one auth step the agent cannot script.
4. [AGENT] Create the two user accounts via the Admin SDK (initialized with projectId sallisascru) from the emails and passwords you provide, print both UIDs, and write them into seed/seed-data.json and the security rules. No manual user creation, no copying UIDs.

## C. Firestore
5. [AGENT] Firestore already exists ((default) database, nam5, immutable). Do not recreate or relocate it; reuse it. Wire firestore.rules and firestore.indexes.json into firebase.json without touching the live database.
6. [AGENT] Lock the rules to the two member UIDs and deploy them with `firebase deploy --only firestore:rules`.

## D. API keys for the AI features
7. [YOU] Get an Anthropic API key at console.anthropic.com, Keys. This powers the optimization advice page, and receipt scanning if you use Anthropic.
8. [AGENT] Set it as a Functions secret, never in the repo: `firebase functions:secrets:set ANTHROPIC_API_KEY`, prompting you to paste the value.
9. [YOU, optional] Receipt scanning is off by default. To use Grok instead of Anthropic, get an xAI key at console.x.ai and have the agent run `firebase functions:secrets:set XAI_API_KEY`. Skip entirely if you do not want photo capture.

## E. Seed and deploy
10. [AGENT] `npm run seed` writes the household, categories, fixed expenses, budget, goals, and accounts from seed/seed-data.json, using the UIDs from step 4.
11. [AGENT] `firebase deploy --only hosting,functions,firestore:rules` and report the Hosting URL.

## F. Install
12. [YOU] On the Mac, open the Hosting URL in Chrome and click the install icon in the address bar, or use the in-app Install button. On each iPhone, open the URL in Safari, tap Share, then Add to Home Screen.
13. [YOU] Sign in on each device with the account created in step 4.

## G. Keep it private
- The Firestore rules restrict all reads and writes to the two member UIDs. Anyone who finds the URL still cannot read your data without one of those two logins.
- Do not enable any public sharing. There is none in v1.

## CLI quick reference for the agent
```bash
firebase login
gcloud auth login
gcloud config set project sallisascru               # align gcloud with the firebase project (default may be telltheloom)
gcloud auth application-default login               # lets admin scripts create users and seed
firebase use sallisascru                            # project already exists; attach to it (do not create)
firebase apps:create web Nest                       # then: firebase apps:sdkconfig web  -> write into .env.local
firebase init                                       # Functions (TypeScript, Node 20) and Hosting; reuse existing Firestore; do not overwrite files
firebase deploy --only firestore:rules
firebase functions:secrets:set ANTHROPIC_API_KEY    # already set on sallisascru; skip if version exists
firebase functions:secrets:set XAI_API_KEY          # optional, only if using Grok for receipt scanning
npm run seed
firebase deploy --only hosting,functions,firestore:rules
```
