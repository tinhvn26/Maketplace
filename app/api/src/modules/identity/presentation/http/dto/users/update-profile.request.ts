import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'fullName phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(100, { message: 'fullName không được dài quá 100 ký tự' })
  fullName?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'phoneNumber phải là chuỗi ký tự' })
  @MaxLength(16, { message: 'phoneNumber không được dài quá 16 ký tự' })
  @Matches(/^\+?[0-9]{7,15}$/, {
    message:
      'phoneNumber phải có từ 7 đến 15 chữ số, có thể bắt đầu bằng dấu +',
  })
  phoneNumber?: string | null;

  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'avatarUrl phải là URL HTTP hoặc HTTPS hợp lệ' },
  )
  @MaxLength(2048, { message: 'avatarUrl không được dài quá 2048 ký tự' })
  avatarUrl?: string | null;
}
