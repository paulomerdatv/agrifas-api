import { IsArray, IsString, ArrayNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class CreateAsaasCheckoutDto {
  @IsString()
  raffleId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  selectedTickets: number[];

  @IsOptional()
  @IsString()
  couponCode?: string;
}
