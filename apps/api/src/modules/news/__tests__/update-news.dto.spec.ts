import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateNewsDto } from '../dto/update-news.dto';

/**
 * PATCH-тіло новин на межі HTTP: глобальний ValidationPipe запущений з
 * whitelist: true (без forbidNonWhitelisted), тому валідація і відсікання
 * сторонніх полів живуть у декораторах UpdateNewsDto. Перевіряємо клас
 * тим самим набором опцій, що його включає пайп.
 */
describe('UpdateNewsDto — валідація PATCH /news/:id', () => {
  function instance(body: Record<string, unknown>) {
    return plainToInstance(UpdateNewsDto, body, {
      excludeExtraneousValues: false,
    });
  }

  async function errors(body: Record<string, unknown>) {
    const dto = instance(body);
    // whitelist: true — лише поля з метаданими декораторів лишаються,
    // forbidNonWhitelisted: true — сторонні поля дають помилку, а не мовчазне
    // пропускання, щоб тест «заборона сторонніх полів» мав спостережуваний ефект.
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  it('порожній PATCH валідний — усі поля необовʼязкові', async () => {
    expect(await errors({})).toEqual([]);
  });

  it('валідний патч із частини полів проходить', async () => {
    expect(await errors({ title: 'Оновлений заголовок' })).toEqual([]);
    expect(
      await errors({
        title: 'Оновлений заголовок',
        content: 'Оновлений текст новини, достатньо довгий',
      }),
    ).toEqual([]);
    expect(await errors({ status: 'published', isPromoted: true })).toEqual([]);
  });

  it('сторонні поля заборонені — не можуть протекти в Object.assign на сущність', async () => {
    // id/promotedUntil/publishedAt — службові колонки News, яких немає в DTO
    for (const key of ['id', 'promotedUntil', 'publishedAt', 'createdAt']) {
      const errs = await errors({ [key]: 'hack' });
      expect(errs.find((e) => e.property === key)).toBeTruthy();
    }
  });

  it('невідоме поле відсіюється validation-прогоном (whitelist-поведінка пайпа)', async () => {
    const dto = instance({ title: 'Оновлений заголовок', bogus: 'x' });
    await validate(dto, { whitelist: true });
    expect((dto as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(dto.title).toBe('Оновлений заголовок');
  });

  it('невалідні значення не проходять: короткий title і невідомий category', async () => {
    const errs = await errors({ title: 'кц' });
    expect(errs.find((e) => e.property === 'title')).toBeTruthy();

    const errs2 = await errors({ category: 'not-a-category' });
    expect(errs2.find((e) => e.property === 'category')).toBeTruthy();

    const errs3 = await errors({ status: 'not-a-status' });
    expect(errs3.find((e) => e.property === 'status')).toBeTruthy();

    const errs4 = await errors({ venueId: 'not-a-uuid' });
    expect(errs4.find((e) => e.property === 'venueId')).toBeTruthy();
  });

  it('isPromoted має бути булевим', async () => {
    expect((await errors({ isPromoted: 'yes' })).length).toBeGreaterThan(0);
    expect(await errors({ isPromoted: false })).toEqual([]);
  });
});
