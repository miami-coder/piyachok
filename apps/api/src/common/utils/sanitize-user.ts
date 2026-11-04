import { User } from '../../modules/users/entities/user.entity';

/**
 * Публічне подання користувача:
 * жодних passwordHash / email / emailVerified / deletedAt у відповідях,
 * куди анонім не має права зазирати. Телефон — теж приватний (PII),
 * фронт у owner-профілі читає лише імʼя/аватар. Профіль — білим списком.
 */
export interface SanitizedUser {
  id: string;
  isDeleted?: boolean;
  profile: {
    firstname: string;
    lastname?: string;
    age?: number | null;
    avatarUrl?: string | null;
  } | null;
}

export function sanitizeUser(
  user: User | null | undefined,
): SanitizedUser | null | undefined {
  if (!user) return user;
  // Видалений автор: позначка замість персональних даних.
  if (user.deletedAt) {
    return {
      id: user.id,
      isDeleted: true,
      profile: { firstname: 'Обліковий запис', lastname: 'видалено' },
    };
  }
  const p = user.profile;
  return {
    id: user.id,
    profile: p
      ? {
          firstname: p.firstname,
          lastname: p.lastname,
          age: p.age,
          avatarUrl: p.avatarUrl,
        }
      : null,
  };
}
