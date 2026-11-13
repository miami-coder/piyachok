export const USER_ROLE_ADDED = 'user_role.added';
export const USER_ROLE_REMOVED = 'user_role.removed';

export interface UserRoleAddedEvent {
  userId: string;
}

export interface UserRoleRemovedEvent {
  userId: string;
}
