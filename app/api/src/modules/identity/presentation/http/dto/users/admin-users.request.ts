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
import {
  USER_ROLES,
  type UserRole,
} from '../../../../domain/types/user-role.type.js';
import type { UserStatus } from '../../../../domain/types/user-status.type.js';

export class ListUsersRequest {
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  @Max(2147483647, { message: 'page phải nhỏ hơn hoặc bằng 2147483647' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit phải nhỏ hơn hoặc bằng 100' })
  limit = 20;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'q phải là chuỗi ký tự' })
  @MaxLength(100, { message: 'q không được dài quá 100 ký tự' })
  q?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'LOCKED'], {
    message: 'status chỉ được là ACTIVE hoặc LOCKED',
  })
  status?: UserStatus;

  @IsOptional()
  @IsIn(USER_ROLES, {
    message: 'role chỉ được là ADMIN, EMPLOYER hoặc CUSTOMER',
  })
  role?: UserRole;
}

export class UpdateUserStatusRequest {
  @IsIn(['ACTIVE', 'LOCKED'], {
    message: 'status chỉ được là ACTIVE hoặc LOCKED',
  })
  status!: UserStatus;
}

export class UpdateUserRoleRequest {
  @IsIn(USER_ROLES, {
    message: 'role chỉ được là ADMIN, EMPLOYER hoặc CUSTOMER',
  })
  role!: UserRole;
}
