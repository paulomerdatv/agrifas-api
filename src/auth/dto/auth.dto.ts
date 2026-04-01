import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail({}, { message: 'O e-mail deve ser valido.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter no minimo 6 caracteres.' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ref?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  utm_source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  utm_medium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  utm_campaign?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'O e-mail deve ser valido.' })
  email: string;

  @IsString()
  password: string;
}
