import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'My Awesome Store',
    description: 'Name of the business',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  businessName: string;

  @ApiProperty({ example: 'John Doe', description: 'Name of the store owner' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ownerName: string;

  @ApiProperty({
    example: 'owner@example.com',
    description: 'Email address of the owner',
  })
  @IsEmail()
  email: string;

  /**
   * SECURITY.md §14: minimum 12 characters, requiring uppercase, lowercase,
   * a number and a special character. The policy was previously
   * `@MinLength(8)` with no complexity rule, so "password" was accepted —
   * and this credential guards an entire tenant's order book.
   *
   * The upper bound is 72 because bcrypt silently truncates beyond 72 bytes;
   * accepting more would give a false impression of added strength.
   */
  @ApiProperty({
    example: 'Str0ng!Passphrase',
    description:
      'Password — min 12 chars, with uppercase, lowercase, number and special character',
    minLength: 12,
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @MaxLength(72)
  @Matches(/[A-Z]/, {
    message: 'Password must contain at least one uppercase letter',
  })
  @Matches(/[a-z]/, {
    message: 'Password must contain at least one lowercase letter',
  })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'Password must contain at least one special character',
  })
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The valid refresh token' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
