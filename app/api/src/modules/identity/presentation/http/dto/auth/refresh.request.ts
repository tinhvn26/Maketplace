import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshRequest {
  @IsString({ message: 'refreshToken phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'refreshToken không được để trống' })
  @MaxLength(4096, { message: 'refreshToken không được dài quá 4096 ký tự' })
  readonly refreshToken: string;
}
