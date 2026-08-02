import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

/**
 * Standard API response envelope.
 *
 * All API responses follow this structure:
 * {
 *   success: true,
 *   message: "Operation completed",
 *   data: { ... },
 *   meta: { timestamp, correlationId, pagination? }
 * }
 */
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
  meta: {
    timestamp: string;
    correlationId?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

/**
 * SKIP_RESPONSE_TRANSFORM metadata key.
 * Use @SkipResponseTransform() on SSE endpoints or special cases.
 */
export const SKIP_RESPONSE_TRANSFORM = 'skipResponseTransform';

/**
 * ResponseTransformInterceptor
 *
 * Wraps all controller responses in the standard API envelope format.
 *
 * Controllers can return data in two ways:
 *
 * 1. Simple return — interceptor wraps automatically:
 *    ```
 *    return { orders, total, page, limit, totalPages };
 *    ```
 *    Result: { success: true, data: { orders, total, ... }, meta: { ... } }
 *
 * 2. Pre-formatted return — interceptor detects and preserves:
 *    ```
 *    return { success: true, message: 'Done', data: { orders } };
 *    ```
 *    Result: { success: true, message: 'Done', data: { orders }, meta: { ... } }
 *
 * Pagination is auto-detected from data containing `page`, `limit`, `total`, `totalPages`.
 */
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    // Skip for SSE endpoints or explicitly marked handlers
    const skipTransform = this.reflector.get<boolean>(
      SKIP_RESPONSE_TRANSFORM,
      context.getHandler(),
    );
    if (skipTransform) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const correlationId = request.correlationId;

    return next.handle().pipe(
      map((responseBody) => {
        // If the response is already in the standard format, enhance it with meta
        if (
          responseBody &&
          typeof responseBody === 'object' &&
          'success' in responseBody
        ) {
          const existing = responseBody;
          return {
            success: existing.success,
            message: existing.message,
            data: existing.data ?? null,
            meta: {
              timestamp: new Date().toISOString(),
              correlationId,
              ...this.extractPagination(existing.data),
            },
          };
        }

        // Wrap raw response data in the standard envelope
        return {
          success: true,
          data: responseBody,
          meta: {
            timestamp: new Date().toISOString(),
            correlationId,
            ...this.extractPagination(responseBody),
          },
        };
      }),
    );
  }

  /**
   * Auto-detect pagination metadata from the response data.
   * If the data object contains page/limit/total/totalPages, extract it.
   */
  private extractPagination(data: unknown): {
    pagination?: ApiResponse<unknown>['meta']['pagination'];
  } {
    if (
      data &&
      typeof data === 'object' &&
      'page' in data &&
      'totalPages' in data
    ) {
      const paginated = data as Record<string, unknown>;
      return {
        pagination: {
          page: paginated.page as number,
          limit: (paginated.limit as number) ?? 20,
          total: (paginated.total as number) ?? 0,
          totalPages: paginated.totalPages as number,
        },
      };
    }
    return {};
  }
}
