export class AuthSessionResponse {
  id!: string;
  createdAt!: Date;
  lastUsedAt!: Date;
  expiresAt!: Date;
  current!: boolean;
}
