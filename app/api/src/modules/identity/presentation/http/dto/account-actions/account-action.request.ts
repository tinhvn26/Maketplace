import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AccountEmailRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'email phải là địa chỉ email hợp lệ' })
  @MaxLength(254, { message: 'email không được dài quá 254 ký tự' })
  email!: string;
}

export class AccountActionTokenRequest {
  @IsString({ message: 'token phải là chuỗi ký tự' })
  @MaxLength(128, { message: 'token không được dài quá 128 ký tự' })
  token!: string;
}

export class ResetPasswordRequest extends AccountEmailRequest {
  @IsString({ message: 'otp phải là chuỗi ký tự' })
  @Matches(/^[0-9]{6}$/, { message: 'otp phải gồm đúng 6 chữ số từ 0 đến 9' })
  otp!: string;

  @IsString({ message: 'newPassword phải là chuỗi ký tự' })
  @MinLength(8, { message: 'newPassword phải có ít nhất 8 ký tự' })
  @MaxLength(128, { message: 'newPassword không được dài quá 128 ký tự' })
  newPassword!: string;
}

export class ChangeEmailRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'newEmail phải là địa chỉ email hợp lệ' })
  @MaxLength(254, { message: 'newEmail không được dài quá 254 ký tự' })
  newEmail!: string;

  @IsString({ message: 'currentPassword phải là chuỗi ký tự' })
  @MinLength(1, { message: 'currentPassword phải có ít nhất 1 ký tự' })
  @MaxLength(128, { message: 'currentPassword không được dài quá 128 ký tự' })
  currentPassword!: string;
}
