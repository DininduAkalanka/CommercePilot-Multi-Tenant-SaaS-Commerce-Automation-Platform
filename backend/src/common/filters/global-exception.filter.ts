import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
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
