export interface RegisterInput {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly phoneNumber?: string | null;
  readonly avatarUrl?: string | null;
}
