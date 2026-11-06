export interface ShopAccountState {
  id: string;
  role: string;
  status: string;
  deletedAt: Date | null;
}

export function isActiveShopAccount(
  user: ShopAccountState | null,
): user is ShopAccountState & { role: 'USER' | 'ADMIN' } {
  return (
    user !== null &&
    user.status === 'ACTIVE' &&
    user.deletedAt === null &&
    (user.role === 'USER' || user.role === 'ADMIN')
  );
}

export function mayManageShop(
  ownerId: string,
  user: ShopAccountState,
): boolean {
  return (
    isActiveShopAccount(user) && (user.role === 'ADMIN' || ownerId === user.id)
  );
}
