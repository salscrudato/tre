import { arrayRemove, arrayUnion, deleteField, doc, updateDoc } from 'firebase/firestore'
import { db } from '../config/firebase'
import { householdRef } from './firestore'
import type { HouseholdSettings } from '../types'

// Patch only the changed settings fields using dotted field paths, so the rest of the
// settings object is untouched. A field set to undefined is removed (Firestore rejects
// a stored undefined), so an optional setting like targetHomePrice can be turned off.
// The real-time HouseholdContext picks up the change, so money.ts reads the new
// assumptions everywhere.
export async function updateHouseholdSettings(patch: Partial<HouseholdSettings>): Promise<void> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    data[`settings.${key}`] = value === undefined ? deleteField() : value
  }
  await updateDoc(householdRef(), data)
}

// Normalize an email for storage and comparison. Google tokens carry lowercase
// emails, and the security rules compare the token email to this list verbatim.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Invite a partner by their Google email. They join automatically the next time they
// sign in (HouseholdProvider adds their uid to members). Only an existing member can
// call this; the rules enforce it.
export async function addInvitedEmail(email: string): Promise<void> {
  await updateDoc(householdRef(), { invitedEmails: arrayUnion(normalizeEmail(email)) })
}

export async function removeInvitedEmail(email: string): Promise<void> {
  await updateDoc(householdRef(), { invitedEmails: arrayRemove(normalizeEmail(email)) })
}

// The signed-in user adds their own uid to the household they were invited to. The
// rules allow this only when their verified email is in invitedEmails, so a partner
// becomes a member just by signing in. arrayUnion is idempotent, so a duplicate call
// is harmless. Takes the household id explicitly because it runs before the household
// is adopted as active.
export async function joinHousehold(hid: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'households', hid), { members: arrayUnion(uid) })
}

// Record or update a member's display name (a first name) on the active household.
// Any member can set their own; the owner pickers and per-person views read these.
export async function setMemberName(uid: string, name: string): Promise<void> {
  await updateDoc(householdRef(), { [`memberNames.${uid}`]: name })
}
