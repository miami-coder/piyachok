import { ForbiddenException } from '@nestjs/common';
import { PermissionsService } from '../modules/rbac/permissions.service';

/**
 * Мок PermissionsService для спеків: hasPermission настроюється тестом,
 * assertOwnerOrPermission працює за тією самою логікою, що й реальний
 * сервіс (власник пропускається, інакше право, інакше 403 з message).
 */
export function makePermsMock() {
  const perms = {
    hasPermission: jest.fn(),
    assertOwnerOrPermission: jest.fn(),
  };
  perms.assertOwnerOrPermission.mockImplementation(
    async (
      ownerId: string,
      userId: string,
      permission: string,
      message: string,
    ) => {
      if (ownerId === userId) return;
      if (await perms.hasPermission(userId, permission)) return;
      throw new ForbiddenException(message);
    },
  );
  return perms as jest.Mocked<
    Pick<PermissionsService, 'hasPermission' | 'assertOwnerOrPermission'>
  >;
}
