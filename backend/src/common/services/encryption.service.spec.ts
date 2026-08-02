import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

/**
 * Builds an EncryptionService with a given ENCRYPTION_KEY value.
 * Passing `undefined` simulates a missing key (fail-secure path).
 */
function buildService(key?: string): EncryptionService {
  const config = {
    get: (name: string) => (name === 'ENCRYPTION_KEY' ? key : undefined),
  } as unknown as ConfigService;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  const HEX_KEY = 'a'.repeat(64); // valid 32-byte key expressed as 64 hex chars
  const PASSPHRASE = 'a-non-hex-passphrase-that-gets-hashed';

  describe('round-trip (hex key)', () => {
    const service = buildService(HEX_KEY);

    it('encrypts then decrypts back to the original plaintext', () => {
      const secret = 'wc_consumer_secret_1234567890';
      const cipher = service.encrypt(secret);

      expect(cipher).not.toEqual(secret);
      expect(service.isEncrypted(cipher)).toBe(true);
      expect(service.decrypt(cipher)).toEqual(secret);
    });

    it('produces a versioned envelope: v1:iv:tag:ciphertext', () => {
      const cipher = service.encrypt('hello');
      const parts = cipher.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
    });

    it('produces a different ciphertext each call (random IV)', () => {
      const a = service.encrypt('same-value');
      const b = service.encrypt('same-value');
      expect(a).not.toEqual(b);
      expect(service.decrypt(a)).toEqual(service.decrypt(b));
    });

    it('is idempotent — encrypting ciphertext returns it unchanged', () => {
      const cipher = service.encrypt('payload');
      expect(service.encrypt(cipher)).toEqual(cipher);
    });
  });

  describe('round-trip (passphrase key)', () => {
    it('derives a usable key by hashing a non-hex passphrase', () => {
      const service = buildService(PASSPHRASE);
      const cipher = service.encrypt('token');
      expect(service.decrypt(cipher)).toEqual('token');
    });
  });

  describe('backward compatibility', () => {
    const service = buildService(HEX_KEY);

    it('returns legacy plaintext unchanged on decrypt', () => {
      // A value written before encryption was introduced.
      expect(service.decrypt('plain-legacy-token')).toBe('plain-legacy-token');
    });
  });

  describe('integrity / tamper detection', () => {
    const service = buildService(HEX_KEY);

    it('throws when the ciphertext or auth tag is tampered', () => {
      const cipher = service.encrypt('sensitive');
      const parts = cipher.split(':');
      // Corrupt the ciphertext segment.
      parts[3] = Buffer.from('tampered-bytes').toString('base64');
      const tampered = parts.join(':');
      expect(() => service.decrypt(tampered)).toThrow(
        InternalServerErrorException,
      );
    });

    it('throws when decrypting with a different key', () => {
      const cipher = buildService(HEX_KEY).encrypt('sensitive');
      const other = buildService('b'.repeat(64));
      expect(() => other.decrypt(cipher)).toThrow(InternalServerErrorException);
    });
  });

  describe('fail-secure (no key configured)', () => {
    const service = buildService(undefined);

    it('throws on encrypt when ENCRYPTION_KEY is missing', () => {
      expect(() => service.encrypt('x')).toThrow(InternalServerErrorException);
    });

    it('still returns legacy plaintext on decrypt (no crypto needed)', () => {
      expect(service.decrypt('legacy')).toBe('legacy');
    });
  });

  describe('nullable helpers', () => {
    const service = buildService(HEX_KEY);

    it('passes through null/undefined/empty untouched', () => {
      expect(service.encryptNullable(null)).toBeNull();
      expect(service.encryptNullable(undefined)).toBeUndefined();
      expect(service.encryptNullable('')).toBe('');
      expect(service.decryptNullable(null)).toBeNull();
    });

    it('encrypts and decrypts a present value', () => {
      const cipher = service.encryptNullable('v');
      expect(typeof cipher).toBe('string');
      expect(service.decryptNullable(cipher as string)).toBe('v');
    });
  });
});
