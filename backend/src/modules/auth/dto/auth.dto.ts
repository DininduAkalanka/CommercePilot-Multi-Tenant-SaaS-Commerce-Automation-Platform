import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsNotEmpty,
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

  @ApiProperty({
    example: 'password123',
    description: 'Password (min 8 chars)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
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
