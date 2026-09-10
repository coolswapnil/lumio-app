/**
 * lifecycleState.ts — Single source of truth for the current Android lifecycle
 * classification used by the share diagnostics pipeline.
 *
 * Lifecycle states (canonical strings, used verbatim in diagnostics):
 *
 *   cold_start        — First JS execution after the process was killed.
 *                       +native-intent.ts receives initial=true with an empty
 *                       diagnostics log.
 *
 *   warm_start        — App is already running; share arrives via the Linking
 *                       'url' event (initial=false in redirectSystemPath).
 *
 *   background_resume — App was backgrounded (JS survived) and is brought back
 *                       to the foreground by a new share intent.
 *                       initial=true but the diagnostics log already has entries.
 *
 * The state is set once per redirectSystemPath call and read by
 * shareIngestion.ingest() to stamp every pipeline diagnostic with it.
 */

export type LifecycleState = 'cold_start' | 'warm_start' | 'background_resume' | 'unknown';

let _current: LifecycleState = 'unknown';

/**
 * Classify and persist the lifecycle state from the redirectSystemPath `initial`
 * flag and the current diagnostics log length.
 *
 * Call this ONCE at the top of redirectSystemPath, before any other work.
 */
export function classifyAndSetLifecycleState(
  initial: boolean,
  diagEntriesCount: number
): LifecycleState {
  let state: LifecycleState;
  if (!initial) {
    state = 'warm_start';
  } else if (diagEntriesCount === 0) {
    state = 'cold_start';
  } else {
    state = 'background_resume';
  }
  _current = state;
  return state;
}

/** Returns the most recently classified lifecycle state. */
export function getLifecycleState(): LifecycleState {
  return _current;
}

/**
 * Reset to 'unknown'.
 * Called by DataProvider.resetReadinessGate() so that background→foreground
 * remounts start with a fresh classification on the next redirectSystemPath call.
 */
export function resetLifecycleState(): void {
  _current = 'unknown';
}
