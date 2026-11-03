import validator from 'validator';

export const USER_INPUT_LIMITS = {
  fullName: 100,
  email: 254,
  passwordMin: 8,
  passwordMax: 128,
  avatarUrl: 2048,
} as const;

export function isValidFullName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    validator.isLength(value.trim(), {
      min: 1,
      max: USER_INPUT_LIMITS.fullName,
    })
  );
}

export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    validator.isLength(value, { max: USER_INPUT_LIMITS.email }) &&
    validator.isEmail(value)
  );
}

export function isValidPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    validator.isLength(value, {
      min: USER_INPUT_LIMITS.passwordMin,
      max: USER_INPUT_LIMITS.passwordMax,
    })
  );
}

export function isValidCurrentPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    validator.isLength(value, { min: 1, max: USER_INPUT_LIMITS.passwordMax })
  );
}

export function isValidAvatarUrl(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === 'string' &&
    validator.isLength(value, { max: USER_INPUT_LIMITS.avatarUrl }) &&
    validator.isURL(value, {
      protocols: ['http', 'https'],
      require_protocol: true,
    })
  );
}
