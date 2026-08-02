import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { captureException } from '../observability/sentry';

/**
 * GlobalExceptionFilter
 *
 * Catches all exceptions and returns structured JSON error responses.
 * Logs all errors with correlation ID for tracing.
 * Never exposes internal implementation details to clients.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = (request as any).correlationId ?? 'unknown';

    // Typed as `number`, not `HttpStatus`: `getStatus()` may return a code
    // outside the enum, and the `>= 500` severity check below compares against
    // a plain number.
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const body = exceptionResponse as Record<string, any>;
        message = body.message ?? message;
        if (Array.isArray(body.message)) {
          errors = body.message;
          message = 'Validation failed';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Log at appropriate level
    if (status >= 500) {
      this.logger.error(
        `[${correlationId}] ${request.method} ${request.url} → ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );

      // Only 5xx is reported. 4xx is expected traffic — validation failures
      // and unauthorised calls would bury genuine defects in noise.
      captureException(exception, {
        correlationId:
          typeof correlationId === 'string' ? correlationId : undefined,
        tenantId: (request as any)?.user?.tenantId as string | undefined,
        path: request.url,
      });
    } else {
      this.logger.warn(
        `[${correlationId}] ${request.method} ${request.url} → ${status}: ${message}`,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
    });
  }
}
