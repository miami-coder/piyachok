import { BadRequestException } from '@nestjs/common';
import { ParseUuidPipe } from './parse-uuid.pipe';

describe('ParseUuidPipe', () => {
  const pipe = new ParseUuidPipe();

  it('пропускає валідний UUID', () => {
    const uuid = '3f2b0e2a-1c9d-4b8e-9f0a-7d6c5b4a3e2f';
    expect(pipe.transform(uuid)).toBe(uuid);
  });

  it('кидає 400 на довільний рядок', () => {
    expect(() => pipe.transform('не-і-денті-фікатор')).toThrow(
      BadRequestException,
    );
  });

  it('кидає 400 на рядок, схожий на UUID з обірваною хвісткою', () => {
    expect(() => pipe.transform('3f2b0e2a-1c9d-4b8e-9f0a')).toThrow(
      BadRequestException,
    );
  });

  it('кидає 400 на порожньому значенні', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('текст помилки — той самий, що віддає фільтр по 22P02', () => {
    try {
      pipe.transform('nope');
      fail('очікував BadRequestException');
    } catch (e) {
      const resp = (e as BadRequestException).getResponse() as {
        message: string;
      };
      expect(resp.message).toBe('Некоректний ідентифікатор');
    }
  });
});