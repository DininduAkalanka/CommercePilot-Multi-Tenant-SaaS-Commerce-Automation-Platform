import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/**
 * Roles a tenant OWNER is allowed to assign to their staff.
 * SUPER_ADMIN is a platform-level role and can never be granted via the
 * tenant Users API (privilege-escalation guard).
 */
export const ASSIGNABLE_ROLES = [UserRole.OWNER, UserRole.STAFF] as const;

// SECURITY.md §14 — min 12 chars, upper + lower + number + special.
const STRONG_PASSWORD =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export class CreateUserDto {
  @ApiProperty({ example: 'Jane Staff', description: 'Full name of the team member' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'jane@store.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Str0ng!Passw0rd',
    description: 'Min 12 chars incl. upper, lower, number, special (SECURITY §14)',
    minLength: 12,
  })
  @IsString()
  @MaxLength(128)
  @Matches(STRONG_PASSWORD, {
    message:
      'Password must be at least 12 characters and include uppercase, lowercase, a number, and a special character.',
  })
  password: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES, example: UserRole.STAFF })
  @IsEnum(UserRole)
  role: UserRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane S.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ASSIGNABLE_ROLES })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ example: true, description: 'Deactivate/reactivate the account' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
