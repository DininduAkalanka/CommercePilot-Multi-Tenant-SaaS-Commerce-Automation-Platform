import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * SimulateMessageDto
 *
 * Body for the dashboard's WhatsApp simulator.
 *
 * This was previously an inline type annotation (`body: { phone: string;
 * message: string }`). TypeScript types are erased at runtime, so the global
 * ValidationPipe had no metatype to inspect and skipped the payload entirely —
 * `whitelist` and `forbidNonWhitelisted` never applied, and both fields
 * reached the message pipeline unchecked. A DTO class restores validation.
 */
export class SimulateMessageDto {
  @ApiProperty({
    example: '+94771234567',
    description: 'Customer phone number in E.164-ish form',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^\+?[0-9]{7,15}$/, {
    message: 'phone must be 7-15 digits, optionally prefixed with +',
  })
  phone: string;

  @ApiProperty({
    example: 'I want to buy 2 wireless mouse',
    description: 'The simulated customer message',
  })
  @IsString()
  @IsNotEmpty()
  // Bounded because this text is fed into an LLM prompt; an unbounded body
  // is both a cost and a prompt-injection surface.
  @MaxLength(4096)
  message: string;
}
