import { IsNumber, IsString } from 'class-validator';

export class AuthTokenResponse {
  @IsString({ message: 'accessToken phải là chuỗi ký tự' })
  accessToken!: string;

  @IsString({ message: 'refreshToken phải là chuỗi ký tự' })
  refreshToken!: string;

  @IsString({ message: 'tokenType phải là chuỗi ký tự' })
  tokenType!: 'Bearer';

  @IsNumber({}, { message: 'expiresIn phải là số hợp lệ' })
  expiresIn!: number;
}
