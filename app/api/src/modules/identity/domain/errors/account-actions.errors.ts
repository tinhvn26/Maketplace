export class InvalidAccountActionError extends Error {
  readonly code = 'INVALID_ACCOUNT_ACTION';
  constructor() {
    super('The code or token is invalid or has expired');
    this.name = 'InvalidAccountActionError';
  }
}

export class IncorrectAccountPasswordError extends Error {
  readonly code = 'INCORRECT_ACCOUNT_PASSWORD';
  constructor() {
    super('The current password is incorrect');
    this.name = 'IncorrectAccountPasswordError';
  }
}

export class InvalidEmailChangeError extends Error {
  readonly code = 'INVALID_EMAIL_CHANGE';
  constructor() {
    super('The new email must be different from the current email');
    this.name = 'InvalidEmailChangeError';
  }
}

export class InvalidAccountPasswordError extends Error {
  readonly code = 'INVALID_ACCOUNT_PASSWORD';
  constructor() {
    super('The password must contain between 8 and 128 characters');
    this.name = 'InvalidAccountPasswordError';
  }
}
