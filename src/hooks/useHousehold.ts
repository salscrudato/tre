// The household is a single document the whole app needs reactively, so it is
// served by the real-time HouseholdContext (onSnapshot), not a one-shot query.
// Re-exported here so the hooks directory is the single import surface.
export { useHousehold } from '../context/household-context'
