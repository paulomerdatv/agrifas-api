import { ArrayNotEmpty, IsArray, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsObject()
  origin?: {
    ref?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  };
}
