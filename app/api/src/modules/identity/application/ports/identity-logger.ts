export const IDENTITY_LOGGER = Symbol('IDENTITY_LOGGER');

export interface IdentityLogger {
  error(message: string): void;
}
