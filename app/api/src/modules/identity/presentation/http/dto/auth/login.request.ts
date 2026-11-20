import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'email phải là địa chỉ email hợp lệ' })
  @IsNotEmpty({ message: 'email không được để trống' })
  @MaxLength(254, { message: 'email không được dài quá 254 ký tự' })
  readonly email: string;

  @IsString({ message: 'password phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'password không được để trống' })
  @MaxLength(128, { message: 'password không được dài quá 128 ký tự' })
  readonly password: string;
}
