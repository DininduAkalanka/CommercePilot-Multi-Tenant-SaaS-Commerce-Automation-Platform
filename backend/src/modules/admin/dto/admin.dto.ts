import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTenantStatusDto {
  @ApiProperty({
    example: false,
    description: 'Activate (true) or suspend (false) the tenant platform-wide',
  })
  @IsBoolean()
  isActive: boolean;
}
