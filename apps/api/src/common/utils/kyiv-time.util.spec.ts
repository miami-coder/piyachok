import { kyivWallToUtc } from './kyiv-time.util';

// Розбір стен-часу підпорядкований тим самим правилам IANA Europe/Kyiv,
// за якими Postgres рахує AT TIME ZONE 'Europe/Kyiv' у кроні завершення.
describe('kyivWallToUtc', () => {
  it('взимку офсет +2 (Europe/Kyiv за IANA)', () => {
    expect(kyivWallToUtc('2026-01-15', '20:00').toISOString()).toBe(
      '2026-01-15T18:00:00.000Z',
    );
  });

  it('улітку офсет +3', () => {
    expect(kyivWallToUtc('2026-07-15', '20:00').toISOString()).toBe(
      '2026-07-15T17:00:00.000Z',
    );
  });

  it('межа доби взимку: 2026-01-16 00:30 → попередній день 22:30 UTC', () => {
    expect(kyivWallToUtc('2026-01-16', '00:30').toISOString()).toBe(
      '2026-01-15T22:30:00.000Z',
    );
  });

  it('неіснуючий стен-час у весняний перехід (03:00→04:00) береться за офсетом до переходу, як у Postgres', () => {
    // Перехід 2026-03-29 о 01:00 UTC; 03:30 локального за +3 не існує
    expect(kyivWallToUtc('2026-03-29', '03:30').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('неможливий стен-час → NaN як і раніше відсіюється перевіркою в сервісі', () => {
    expect(kyivWallToUtc('2026-01-15', '25:99').getTime()).toBeNaN();
    expect(kyivWallToUtc('не-дата', '20:00').getTime()).toBeNaN();
  });
});
