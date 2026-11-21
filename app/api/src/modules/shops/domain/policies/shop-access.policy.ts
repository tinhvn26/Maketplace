export interface ShopAccountState {
  id: string;
  role: string;
  status: string;
  deletedAt: Date | null;
}

export function isActiveShopAccount(
  user: ShopAccountState | null,
): user is ShopAccountState & { role: 'ADMIN' | 'EMPLOYER' | 'CUSTOMER' } {
  return (
    user !== null &&
    user.status === 'ACTIVE' &&
    user.deletedAt === null &&
    (user.role === 'ADMIN' ||
      user.role === 'EMPLOYER' ||
      user.role === 'CUSTOMER')
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
