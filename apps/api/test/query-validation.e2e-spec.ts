/**
 * Валідація query-параметрів на межі HTTP: невідомі енуми, нечислові
 * page/limit і невалідні дати = 400 від глобального ValidationPipe
 * (unification query-DTO), а не мовчазний дефолт/провал у SQL.
 */
import { bootstrapTestApp } from './helpers/test-app';
import request from 'supertest';

describe('Query validation (400 on the edge)', () => {
  let app: any;

  beforeAll(async () => {
    const result = await bootstrapTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  const uuid = '11111111-1111-1111-1111-111111111111';

  const expect400 = (url: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${url}`)
      .expect((res) => expect(res.status).toBe(400));

  it('sort невідомий у відгуках закладу → 400', () =>
    expect400(`/venues/${uuid}/reviews?sort=bogus`));

  it('page не числова у каталогу → 400', () => expect400('/venues?page=abc'));

  it('isPromoted відмінний від true у новини → 400', () =>
    expect400('/news?isPromoted=false'));

  it('status невідомий у зустрічах → 400', () =>
    expect400('/hangouts?status=bogus'));

  it('date невалідна у зустрічах → 400', () =>
    expect400('/hangouts?date=not-a-date'));

  it('валідні фільтри проходять (200)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/hangouts?status=open&date=2026-01-01&page=1&limit=12')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/venues?sort=newest&page=1&limit=10')
      .expect(200);
  });
});
