import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PG_CODES, isPgError } from '../utils/pg-error.util';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as { message?: string | string[] };
        message = Array.isArray(r.message)
          ? r.message.join('; ')
          : (r.message ?? message);
      }
      code = this.codeFromStatus(status);
    } else if (exception instanceof Error) {
      const pg = this.fromPgError(exception);
      if (pg) {
        ({ status, code, message } = pg);
      } else {
        this.logger.error(exception.message, exception.stack);
      }
    } else {
      this.logger.error('Unknown exception', String(exception));
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${code} ${message}`,
      );
    }

    const body: ErrorResponse = { error: { code, message, details } };
    response.status(status).json(body);
  }

  /** Структурована обробка помилок Postgres: код → HTTP. Це фолбек —
   *  якщо серверний код сам не перевірив/не обробив код, віддаємо чесний
   *  4xx замість 500. Специфічні меседжі для юзера кидаються в сервісах,
   *  тут — загальні. */
  private fromPgError(
    exception: Error,
  ): { status: number; code: string; message: string } | null {
    if (isPgError(exception, PG_CODES.INVALID_TEXT_REPRESENTATION)) {
      // Невалідний UUID/число у запиті — не помилка сервера
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'Некоректний ідентифікатор',
      };
    }
    if (isPgError(exception, PG_CODES.UNIQUE_VIOLATION)) {
      // Гонка дублікатів, яку сервіс не обгорнув у ConflictException
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'Конфлікт даних, спробуйте ще раз',
      };
    }
    return null;
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
    };
    return map[status] ?? 'INTERNAL_ERROR';
  }
}
