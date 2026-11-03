export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface AuthSession {
  id: string;
  userId: string;
  authVersion: number;
  refreshTokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
}

export interface ActiveSession {
  session: AuthSession;
  role: 'USER' | 'ADMIN';
}

export interface SessionRepository {
  /** Creates only while the user is active and authVersion still matches. */
  createIfActive(session: AuthSession): Promise<boolean>;
  findActive(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<ActiveSession | null>;
  /** Atomically rotates a token. Reuse of an old signed token revokes the session. */
  rotateRefreshToken(
    sessionId: string,
    userId: string,
    expectedHash: string,
    newHash: string,
    now: Date,
  ): Promise<boolean>;
  revoke(sessionId: string, userId: string, now: Date): Promise<void>;
  /** Increments authVersion and revokes all existing sessions atomically. */
  revokeAll(userId: string, now: Date): Promise<void>;
  listActive(userId: string, now: Date): Promise<AuthSession[]>;
}
