import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateVenueDto } from '../dto/update-venue.dto';

/** Перетворення PATCH-поля: порожній рядок → null (очистити), а не 0. */
describe('UpdateVenueDto — числові поля', () => {
  function instance(body: Record<string, unknown>) {
    return plainToInstance(UpdateVenueDto, body, {
      excludeExtraneousValues: false,
    });
  }

  it('порожній рядок у latitude/longitude/averageCheck → null (не 0)', () => {
    const dto = instance({ latitude: '', longitude: '', averageCheck: '' });
    expect(dto.latitude).toBeNull();
    expect(dto.longitude).toBeNull();
    expect(dto.averageCheck).toBeNull();
    // рядок → число
    const dto2 = instance({
      latitude: '50.4',
      longitude: '30.5',
      averageCheck: '250',
    });
    expect(dto2.latitude).toBe(50.4);
    expect(dto2.longitude).toBe(30.5);
    expect(dto2.averageCheck).toBe(250);
  });

  it('явні null не перетворюються на 0 і валідні', async () => {
    const dto = instance({
      latitude: null,
      longitude: null,
      averageCheck: null,
    });
    expect(dto.latitude).toBeNull();
    const errors = await validate(dto);
    const relevant = errors.filter((e) => e.constraints);
    expect(relevant).toEqual([]);
  });

  it('неправильне значення валідацію не проходить (валідація жива після Transform)', async () => {
    const dto = instance({ latitude: '999' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'latitude')).toBeTruthy();
  });
});
