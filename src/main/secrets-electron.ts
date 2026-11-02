import { safeStorage } from 'electron';
import type { SecretCodec } from './secrets';

export function safeStorageCodec(): SecretCodec {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}
