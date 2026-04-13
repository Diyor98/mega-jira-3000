import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

const STATUS_TO_ERROR: Record<number, string> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  422: 'UnprocessableEntity',
  429: 'TooManyRequests',
  500: 'InternalServerError',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'InternalServerError';
    let extras: Record<string, unknown> = {};

    // Only these top-level fields on an HttpException response body are
    // forwarded to the client. Any other fields (message[] arrays from
    // ValidationPipe, internal IDs, stack traces, etc.) are dropped.
    const FORWARDABLE_FIELDS = new Set(['rule']);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      error = STATUS_TO_ERROR[status] ?? 'Error';
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const res = exceptionResponse as Record<string, unknown>;
        const rawMessage = res['message'];
        if (typeof rawMessage === 'string') {
          message = rawMessage;
        } else if (Array.isArray(rawMessage) && rawMessage.length > 0) {
          // NestJS ValidationPipe emits a string[] — join for the wire.
          message = rawMessage.filter((m): m is string => typeof m === 'string').join(', ');
        }
        error = (res['error'] as string) ?? error;

        // Forward only explicitly allow-listed structured fields (e.g. `rule`
        // on WorkflowRuleViolationException). Everything else is dropped to
        // avoid leaking internal exception payload fields.
        for (const key of Object.keys(res)) {
          if (FORWARDABLE_FIELDS.has(key)) {
            extras[key] = res[key];
          }
        }
      }
    }

    response.status(status).json({
      ...extras,
      error,
      message,
      code: status,
    });
  }
}
