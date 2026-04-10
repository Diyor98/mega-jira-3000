import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

function isAlreadyWrapped(value: unknown): value is { data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Object.keys(value).length === 1
  );
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { data: T }> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ data: T }> {
    return next.handle().pipe(
      map((data) => {
        if (isAlreadyWrapped(data)) {
          return data as { data: T };
        }
        return { data };
      }),
    );
  }
}
