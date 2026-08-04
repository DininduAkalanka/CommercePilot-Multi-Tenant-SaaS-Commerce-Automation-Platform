import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * The filter decides what a customer sees when something breaks, which makes
 * it the last line of defence against information disclosure. It had no tests
 * at all, and a QA pass found it returning this to any authenticated caller
 * who put a malformed id in a URL:
 *
 *   Invalid `this.prisma.product.findFirst()` invocation in
 *   C:\Users\dinin\OneDrive\Desktop\CommercePilot...\products.service.js:86:51
 *
 * That is the ORM query shape, the source path, the line number, and the
 * server's directory layout — handed to whoever asked.
 */
describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/api/v1/products/x' }),
      }),
    } as unknown as ArgumentsHost;

    // Silence the filter's own logging during assertions.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const bodyOf = () => json.mock.calls[0][0] as Record<string, unknown>;

  describe('unexpected errors', () => {
    it('never returns the underlying error message to the client', () => {
      filter.catch(
        new Error(
          'Invalid `this.prisma.product.findFirst()` invocation in ' +
            'C:\\Users\\dinin\\Desktop\\app\\dist\\products.service.js:86:51',
        ),
        host,
      );

      const body = bodyOf();
      expect(body.message).toBe('Internal server error');
      expect(JSON.stringify(body)).not.toContain('prisma');
      expect(JSON.stringify(body)).not.toContain('C:\\');
      expect(JSON.stringify(body)).not.toContain('.js:');
    });

    it('never leaks a stack trace', () => {
      const err = new Error('boom');
      err.stack =
        'Error: boom\n    at Object.<anonymous> (/srv/app/secret.js:12:7)';

      filter.catch(err, host);

      expect(JSON.stringify(bodyOf())).not.toContain('secret.js');
    });

    it('still answers with 500 so the caller knows it failed', () => {
      filter.catch(new Error('anything'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(bodyOf().success).toBe(false);
    });

    it('logs the real error server-side — hiding it from the client is not hiding it from us', () => {
      const spy = jest.spyOn(filter['logger'], 'error');
      filter.catch(new Error('database exploded'), host);

      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0][0])).toContain('database exploded');
    });
  });

  describe('deliberate HTTP errors', () => {
    it('passes a thrown message through, because those are written for the caller', () => {
      // "Insufficient stock for Blue Shirt" is useful and safe. Only
      // unexpected errors are generic.
      filter.catch(
        new HttpException('Insufficient stock for "Blue Shirt"', 400),
        host,
      );

      expect(bodyOf().message).toBe('Insufficient stock for "Blue Shirt"');
      expect(status).toHaveBeenCalledWith(400);
    });

    it('keeps field-level validation errors', () => {
      filter.catch(
        new HttpException(
          { message: ['price must be a number'], statusCode: 400 },
          400,
        ),
        host,
      );

      const body = bodyOf();
      expect(body.message).toBe('Validation failed');
      expect(body.errors).toEqual(['price must be a number']);
    });

    it('preserves a 404 rather than turning it into a 500', () => {
      filter.catch(new HttpException('Product not found', 404), host);

      expect(status).toHaveBeenCalledWith(404);
      expect(bodyOf().message).toBe('Product not found');
    });
  });
});
