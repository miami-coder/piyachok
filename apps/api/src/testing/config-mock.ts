import { ConfigService } from '@nestjs/config';
import { EnvVars } from '../config/env.validation';

/**
 * Мок ConfigService для спеків: читає process.env, а за відсутності ключа
 * повертає дефолт з EnvVars — так само, як чинить валідований конфіг
 * (validate повертає інстанс EnvVars, який Nest кладе до конфіг-стору).
 * Ключ, якого нема ані в process.env, ані в дефолтах (обовʼязкові варси
 * без дефолтів, напр. JWT_ACCESS_SECRET), кидає помилку через getOrThrow.
 */
export function makeConfigMock(
  overrides: Record<string, unknown> = {},
): ConfigService {
  const defaults = new EnvVars() as unknown as Record<string, unknown>;
  const read = (key: string): unknown => {
    if (key in overrides) return overrides[key];
    if (key in process.env) return process.env[key];
    return defaults[key];
  };
  return {
    get: (key: string) => read(key),
    getOrThrow: (key: string) => {
      const value = read(key);
      if (value === undefined) {
        throw new Error(`Config value "${key}" is missing`);
      }
      return value;
    },
  } as unknown as ConfigService;
}
