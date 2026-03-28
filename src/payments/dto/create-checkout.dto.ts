import { ArrayNotEmpty, IsArray, IsInt, IsString, Min } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  raffleId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  selectedTickets: number[];
}