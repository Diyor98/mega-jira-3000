import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
    mockContext = {} as ExecutionContext;
  });

  function createCallHandler(data: unknown): CallHandler {
    return { handle: () => of(data) };
  }

  it('wraps a plain object in { data: T }', (done) => {
    const handler = createCallHandler({ id: '1', name: 'Test' });

    interceptor.intercept(mockContext, handler).subscribe((result) => {
      expect(result).toEqual({ data: { id: '1', name: 'Test' } });
      done();
    });
  });

  it('does NOT double-wrap already-wrapped { data: T } objects', (done) => {
    const handler = createCallHandler({ data: { id: '1' } });

    interceptor.intercept(mockContext, handler).subscribe((result) => {
      expect(result).toEqual({ data: { id: '1' } });
      done();
    });
  });

  it('wraps arrays in { data: T[] }', (done) => {
    const handler = createCallHandler([{ id: '1' }, { id: '2' }]);

    interceptor.intercept(mockContext, handler).subscribe((result) => {
      expect(result).toEqual({ data: [{ id: '1' }, { id: '2' }] });
      done();
    });
  });

  it('wraps null responses', (done) => {
    const handler = createCallHandler(null);

    interceptor.intercept(mockContext, handler).subscribe((result) => {
      expect(result).toEqual({ data: null });
      done();
    });
  });

  it('wraps string responses', (done) => {
    const handler = createCallHandler('hello');

    interceptor.intercept(mockContext, handler).subscribe((result) => {
      expect(result).toEqual({ data: 'hello' });
      done();
    });
  });

  it('does not re-wrap objects with data key plus other keys', (done) => {
    const handler = createCallHandler({ data: [], pagination: { nextCursor: null } });

    interceptor.intercept(mockContext, handler).subscribe((result) => {
      // Has more than one key, so it should be wrapped
      expect(result).toEqual({ data: { data: [], pagination: { nextCursor: null } } });
      done();
    });
  });
});
