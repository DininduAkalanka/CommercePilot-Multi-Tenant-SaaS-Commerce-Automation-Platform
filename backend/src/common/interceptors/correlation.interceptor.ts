import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

/**
 * CorrelationInterceptor
 *
 * Assigns a unique correlationId to every incoming request.
 * This ID is:
 *   - Added to the request object for downstream use
 *   - Added to the response headers
 *   - Logged with request/response for distributed tracing
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Use existing correlation ID from header (upstream service) or generate new
    const correlationId =
      (request.headers['x-correlation-id'] as string) ?? uuidv4();

    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);

    const { method, url } = request;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] → ${method} ${url}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;
          this.logger.log(
            `[${correlationId}] ← ${method} ${url} ${statusCode} (${duration}ms)`,
          );
        },
        error: () => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `[${correlationId}] ← ${method} ${url} ERROR (${duration}ms)`,
          );
        },
      }),
    );
  }
}
