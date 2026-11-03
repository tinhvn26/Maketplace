export class InvalidCredentialsError extends Error {
  readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    super('Email hoặc mật khẩu không đúng');
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidRefreshTokenError extends Error {
  readonly code = 'INVALID_REFRESH_TOKEN';
  constructor() {
    super('Refresh token không hợp lệ hoặc đã hết hạn');
    this.name = 'InvalidRefreshTokenError';
  }
}

export class InvalidFullNameError extends Error {
  readonly code = 'INVALID_FULL_NAME';
  constructor() {
    super('Họ tên không được để trống');
    this.name = 'InvalidFullNameError';
  }
}

export class EmailAlreadyExistsError extends Error {
  readonly code = 'EMAIL_ALREADY_EXISTS';
  constructor() {
    super('Email đã được sử dụng');
    this.name = 'EmailAlreadyExistsError';
  }
}

export class InvalidRegistrationInputError extends Error {
  readonly code = 'INVALID_REGISTRATION_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRegistrationInputError';
  }
}
