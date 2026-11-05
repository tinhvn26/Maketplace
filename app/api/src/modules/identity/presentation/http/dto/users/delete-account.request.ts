import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteAccountRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;
}
