import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * EncryptionService
 *
 * Application-layer encryption for *Restricted* data at rest
 * (SECURITY.md §3 / §12 / §20) — e.g. WhatsApp access tokens,
 * WooCommerce consumer keys/secrets.
 *
 * Algorithm: AES-256-GCM (authenticated encryption).
 *   - 256-bit key derived from the ENCRYPTION_KEY environment variable.
 *   - 96-bit (12-byte) random IV per ciphertext (GCM best practice).
 *   - 128-bit authentication tag verifies integrity on decrypt.
 *
 * Stored format (single string, ':' delimited, versioned for rotation):
 *   v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 *
 * Design rules:
 *   - Fail securely: encrypt/decrypt throw if no key is configured.
 *   - Never log plaintext, keys, or ciphertext.
 *   - Backward compatible: decrypt() returns legacy plaintext unchanged
 *     (values not in the versioned format), enabling a zero-downtime
 *     migration away from previously-unencrypted columns.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly version = 'v1';
  private readonly ivLength = 12;
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>('ENCRYPTION_KEY');
    this.key = rawKey ? this.deriveKey(rawKey) : null;

    if (!this.key) {
      // Warn once at startup — actual failure is deferred to call time so
      // the app still boots for features that don't touch encrypted data.
      this.logger.warn(
        'ENCRYPTION_KEY is not set. Encryption of restricted data is DISABLED and will fail on use.',
      );
    }
  }

  /**
   * Derive a stable 32-byte key from the configured secret.
   * Accepts a 64-char hex string (used as-is) or any passphrase
   * (hashed to 32 bytes via SHA-256). Deterministic per configured value.
   */
  private deriveKey(rawKey: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }
    return createHash('sha256').update(rawKey, 'utf8').digest();
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new InternalServerErrorException(
        'Encryption key is not configured (ENCRYPTION_KEY).',
      );
    }
    return this.key;
  }

  /** True if the value is already in the versioned encrypted format. */
  isEncrypted(value: string): boolean {
    return value.startsWith(`${this.version}:`) && value.split(':').length === 4;
  }

  /**
   * Encrypt a plaintext string. Returns the versioned ciphertext envelope.
   * Idempotent: already-encrypted input is returned unchanged.
   */
  encrypt(plaintext: string): string {
    const key = this.requireKey();

    if (this.isEncrypted(plaintext)) {
      return plaintext;
    }

    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      this.version,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt a versioned ciphertext envelope back to plaintext.
   * Legacy (unencrypted) values are returned unchanged to support the
   * migration window. Throws if the payload is malformed or tampered.
   */
  decrypt(value: string): string {
    if (!this.isEncrypted(value)) {
      // Legacy plaintext written before encryption was introduced.
      return value;
    }

    const key = this.requireKey();
    const [, ivB64, tagB64, dataB64] = value.split(':');

    try {
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(tagB64, 'base64');
      const ciphertext = Buffer.from(dataB64, 'base64');

      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Do not leak details of the ciphertext or key.
      throw new InternalServerErrorException(
        'Failed to decrypt a stored secret. The value may be corrupt or the encryption key changed.',
      );
    }
  }

  /**
   * Convenience: encrypt a nullable/optional value.
   * Returns null/undefined untouched so callers can spread conditionally.
   */
  encryptNullable(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') {
      return value;
    }
    return this.encrypt(value);
  }

  /** Convenience: decrypt a nullable/optional value. */
  decryptNullable(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') {
      return value;
    }
    return this.decrypt(value);
  }
}
