import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('returns { status: "ok" } (wrapped as { data: { status: "ok" } } by global TransformInterceptor)', () => {
    const result = controller.check();

    // Raw controller return — TransformInterceptor wraps this as { data: { status: 'ok' } }
    // This is consistent with AC 1 (all responses use { data: T }) taking precedence
    expect(result).toEqual({ status: 'ok' });
  });

  it('has @Public() metadata', () => {
    const metadata = Reflect.getMetadata('isPublic', HealthController.prototype.check);
    expect(metadata).toBe(true);
  });
});
