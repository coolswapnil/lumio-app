/**
 * Centralized error logging.
 *
 * In development: logs to console with full details.
 * In production: wire this to Sentry / Bugsnag by replacing the body of
 * `reportError` with your SDK call, e.g.:
 *   Sentry.captureException(error, { extra: { context } });
 *
 * SECURITY: Never log API keys, passwords, or PII here.
 * The `context` parameter should contain only non-sensitive metadata
 * (screen name, action taken, provider name — NOT the key value itself).
 */

export interface ErrorContext {
  /** Screen or module where the error occurred */
  screen?: string;
  /** The action being performed when the error occurred */
  action?: string;
  /** AI provider name (without key) */
  provider?: string;
  /** HTTP status code if available */
  status?: number;
}

/**
 * Log an error with structured context.
 * Safe to call from any catch block — never throws.
 */
export function logError(error: unknown, context?: ErrorContext): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    if (__DEV__) {
      console.error(
        '[Lumio Error]',
        context ? JSON.stringify(context) : '',
        err.message,
        err.stack
      );
    } else {
      // Production: replace with Sentry call
      // Sentry.captureException(err, { extra: context });
      console.error('[Lumio Error]', context?.action ?? 'unknown', err.message);
    }
  } catch {
    // logError must never throw
  }
}

/**
 * Returns a safe user-facing error message.
 * Strips technical details and sensitive information.
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof Error) {
    // Return a short, safe message — never expose stack traces or keys to user
    const msg = error.message;
    if (msg.includes('network') || msg.includes('fetch')) {
      return 'Network error. Check your connection and try again.';
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('API')) {
      return 'Invalid API key or insufficient permissions.';
    }
    if (msg.includes('429')) {
      return 'Rate limit reached. Please wait a moment and try again.';
    }
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return 'The AI service is temporarily unavailable. Try again later.';
    }
  }
  return 'An unexpected error occurred. Please try again.';
}
