import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UserRole } from '../../../../domain/types/user-role.types.js';
import type { UserStatus } from '../../../../domain/types/user-status.type.js';

export class ListUsersRequest {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'LOCKED'])
  status?: UserStatus;

  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: UserRole;
}

export class UpdateUserStatusRequest {
  @IsIn(['ACTIVE', 'LOCKED'])
  status!: UserStatus;
}

export class UpdateUserRoleRequest {
  @IsIn(['USER', 'ADMIN'])
  role!: UserRole;
}
