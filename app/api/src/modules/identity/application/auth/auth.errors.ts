export class InvalidCredentialsError extends Error {
  constructor() {
    super('Email hoặc mật khẩu không đúng');
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Refresh token không hợp lệ hoặc đã hết hạn');
    this.name = 'InvalidRefreshTokenError';
  }
}

export class InvalidFullNameError extends Error {
  constructor() {
    super('Họ tên không được để trống');
    this.name = 'InvalidFullNameError';
  }
}
