export interface RegisterInput {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly avatarUrl?: string | null;
}
