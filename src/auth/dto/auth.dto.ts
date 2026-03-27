import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail({}, { message: 'O e-mail deve ser válido.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'O e-mail deve ser válido.' })
  email: string;

  @IsString()
  password: string;
}