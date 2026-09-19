import { IsNumber, IsString } from "class-validator";

export class AuthTokenResponse {
  @IsString()
  accessToken!: string;

  @IsString()
  refreshToken!: string;

  @IsString()
  tokenType!: 'Bearer';

  @IsNumber()
  expiresIn!: number;
}