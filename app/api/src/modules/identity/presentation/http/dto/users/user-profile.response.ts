import type { UserStatus } from '../../../../domain/value-objects/user-status.type.js';

export class UserProfileResponse {
  id!: string;
  fullName!: string;
  email!: string;
  status!: UserStatus;
  createdAt!: string;
  updatedAt!: string;
}