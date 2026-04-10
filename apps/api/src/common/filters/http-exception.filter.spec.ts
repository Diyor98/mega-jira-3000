import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost;
  });

  it('returns { error, message, code } for HttpException', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: expect.any(String),
      message: 'Not Found',
      code: 404,
    });
  });

  it('returns 500 with generic message for non-HttpException (no stack trace)', () => {
    const exception = new Error('Database connection failed');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    const response = mockResponse.json.mock.calls[0][0];
    expect(response).toEqual({
      error: 'InternalServerError',
      message: 'Internal server error',
      code: 500,
    });
    // Must NOT contain stack trace or original error message
    expect(JSON.stringify(response)).not.toContain('Database connection failed');
    expect(JSON.stringify(response)).not.toContain('stack');
  });

  it('extracts message from exception response object', () => {
    const exception = new HttpException(
      { error: 'Conflict', message: 'Email already registered', statusCode: 409 },
      HttpStatus.CONFLICT,
    );

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Conflict',
      message: 'Email already registered',
      code: 409,
    });
  });

  it('extracts message from string exception response with correct error name', () => {
    const exception = new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(429);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'TooManyRequests',
      message: 'Too many requests',
      code: 429,
    });
  });

  it('handles BadRequestException with validation message', () => {
    const exception = new HttpException(
      { error: 'Bad Request', message: 'Invalid email format' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Bad Request',
      message: 'Invalid email format',
      code: 400,
    });
  });
});
