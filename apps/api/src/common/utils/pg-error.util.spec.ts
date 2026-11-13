import { PG_CODES, isPgError } from './pg-error.util';

describe('isPgError', () => {
  it('розпізнає PG-код на обʼєкті помилки', () => {
    expect(isPgError({ code: '23505' }, PG_CODES.UNIQUE_VIOLATION)).toBe(true);
    expect(isPgError({ code: '22P02' }, PG_CODES.UNIQUE_VIOLATION)).toBe(false);
  });

  it('працює з кількома кодами одночасно', () => {
    expect(
      isPgError(
        { code: '22P02' },
        PG_CODES.UNIQUE_VIOLATION,
        PG_CODES.INVALID_TEXT_REPRESENTATION,
      ),
    ).toBe(true);
  });

  it('не падає на не-обʼєктах і обʼєктах без code', () => {
    expect(isPgError(null, PG_CODES.UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError(undefined, PG_CODES.UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError('23505', PG_CODES.UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError(new Error('no code'), PG_CODES.UNIQUE_VIOLATION)).toBe(
      false,
    );
    expect(isPgError({ code: 23505 }, PG_CODES.UNIQUE_VIOLATION)).toBe(false);
  });
});
