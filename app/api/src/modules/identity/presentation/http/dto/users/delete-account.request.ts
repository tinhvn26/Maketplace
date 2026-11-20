import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteAccountRequest {
  @IsString({ message: 'currentPassword phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'currentPassword không được để trống' })
  @MaxLength(128, { message: 'currentPassword không được dài quá 128 ký tự' })
  currentPassword!: string;
}
