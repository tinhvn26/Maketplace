import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  readonly refreshToken: string;
}
