import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshRequest {
  @IsString()
  @IsNotEmpty()
  readonly refreshToken: string;
}