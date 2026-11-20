import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordRequest {
  @IsString({ message: 'currentPassword phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'currentPassword không được để trống' })
  @MaxLength(128, { message: 'currentPassword không được dài quá 128 ký tự' })
  currentPassword!: string;

  @IsString({ message: 'newPassword phải là chuỗi ký tự' })
  @MinLength(8, { message: 'newPassword phải có ít nhất 8 ký tự' })
  @MaxLength(128, { message: 'newPassword không được dài quá 128 ký tự' })
  newPassword!: string;
}
