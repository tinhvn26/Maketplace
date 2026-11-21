import validator from 'validator';

export const PROFILE_INPUT_LIMITS = { avatarUrl: 2048 } as const;

export function isValidAvatarUrl(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === 'string' &&
    validator.isLength(value, { max: PROFILE_INPUT_LIMITS.avatarUrl }) &&
    validator.isURL(value, {
      protocols: ['http', 'https'],
      require_protocol: true,
    })
  );
}
