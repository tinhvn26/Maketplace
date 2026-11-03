export class UserUnavailableError extends Error {
  readonly code = 'USER_UNAVAILABLE';
  constructor() {
    super('Tài khoản không tồn tại hoặc không còn hoạt động');
    this.name = 'UserUnavailableError';
  }
}

export class EmptyProfileUpdateError extends Error {
  readonly code = 'EMPTY_PROFILE_UPDATE';
  constructor() {
    super('Cần cung cấp ít nhất một trường để cập nhật hồ sơ');
    this.name = 'EmptyProfileUpdateError';
  }
}

export class InvalidAccountInputError extends Error {
  readonly code = 'INVALID_ACCOUNT_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAccountInputError';
  }
}

export class IncorrectPasswordError extends Error {
  readonly code = 'INCORRECT_PASSWORD';
  constructor() {
    super('Current password is incorrect');
    this.name = 'IncorrectPasswordError';
  }
}

export class AccountChangedError extends Error {
  readonly code = 'ACCOUNT_CHANGED';
  constructor() {
    super('Account changed during the request; sign in again and retry');
    this.name = 'AccountChangedError';
  }
}

export class UserNotFoundError extends Error {
  readonly code = 'USER_NOT_FOUND';
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

export class AdminRequiredError extends Error {
  readonly code = 'ADMIN_REQUIRED';
  constructor() {
    super('An active administrator account is required');
    this.name = 'AdminRequiredError';
  }
}

export class LastAdminError extends Error {
  readonly code = 'LAST_ACTIVE_ADMIN';
  constructor() {
    super('The last active administrator cannot be locked, demoted or deleted');
    this.name = 'LastAdminError';
  }
}
