import { IsArray, IsString, ArrayNotEmpty, IsNumber } from 'class-validator';

export class CreateAsaasCheckoutDto {
  @IsString()
  raffleId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  selectedTickets: number[];
}