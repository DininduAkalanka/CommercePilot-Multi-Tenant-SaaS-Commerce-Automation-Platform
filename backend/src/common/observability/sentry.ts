import * as Sentry from '@sentry/node';
import { Logger } from '@nestjs/common';

const logger = new Logger('Observability');

/**
 * Initialise error tracking.
 *
 * Must be called BEFORE the Nest application is created so the SDK can
 * instrument HTTP and database calls as modules load.
 *
 * No-ops when SENTRY_DSN is unset, so local development and CI stay silent
 * and no account is required to run the app.
 *
 * PRIVACY — this matters more here than in a typical service. Requests carry
 * customer phone numbers, delivery addresses and raw WhatsApp message text,
 * and SECURITY.md classifies that as Restricted. `sendDefaultPii` is therefore
 * left off and `beforeSend` strips anything that could carry customer data or
 * credentials before an event leaves the process.
 */
export function initObservability(): void {
  const dsn = process.env.SENTRY_DSN?.trim();

  if (!dsn) {
    logger.log('SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RENDER_GIT_COMMIT ?? undefined,

    // Never attach cookies, headers or request bodies automatically.
    sendDefaultPii: false,

    // Performance sampling is opt-in; tracing every request on a free tier
    // burns the quota within days.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),

    beforeSend(event) {
      // Request bodies can contain the full WhatsApp payload.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;

        // Query strings can carry tokens (e.g. the webhook verify handshake).
        if (event.request.query_string) {
          event.request.query_string = '[redacted]';
        }
      }

      // Tenant id is safe and useful for triage; user identity is not.
      if (event.user) {
        event.user = { id: event.user.id };
      }

      return event;
    },
  });

  logger.log(
    `Error tracking enabled (env=${process.env.NODE_ENV ?? 'development'})`,
  );
}

/**
 * Report an exception with tenant context attached.
 *
 * Used by the global exception filter for 5xx responses. Client errors (4xx)
 * are deliberately NOT reported — they are expected traffic, and sending them
 * would bury real defects under validation noise.
 */
export function captureException(
  error: unknown,
  context: { correlationId?: string; tenantId?: string; path?: string } = {},
): void {
  if (!process.env.SENTRY_DSN?.trim()) return;

  Sentry.withScope((scope) => {
    if (context.correlationId) {
      scope.setTag('correlationId', context.correlationId);
    }
    if (context.tenantId) {
      scope.setTag('tenantId', context.tenantId);
    }
    if (context.path) {
      scope.setTag('path', context.path);
    }
    Sentry.captureException(error);
  });
}
