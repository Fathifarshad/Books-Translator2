import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * API keys are stored encrypted (AES-256-GCM) in the database (SPEC §16). The key comes from APP_SECRET, or — when
 * that is unset or still the example value — from a random key created once in DATA_DIR/secret.key, so a fresh
 * install is secure without any setup. Keys never leave the server and are never logged.
 */
export interface SecretBox {
  encrypt(plain: string): string;
  /** null when the value cannot be decrypted (APP_SECRET changed, corrupted value). */
  decrypt(sealed: string): string | null;
}

const PLACEHOLDER = /^change-me/u;

function keyMaterial(appSecret: string | undefined, dataDir: string): Buffer {
  if (appSecret && appSecret.length >= 16 && !PLACEHOLDER.test(appSecret)) {
    return createHash('sha256').update(`dozabaneh:${appSecret}`).digest();
  }
  const file = join(dataDir, 'secret.key');
  if (existsSync(file)) {
    const stored = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (stored.length === 32) return stored;
  }
  const fresh = randomBytes(32);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${fresh.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: permissions are inherited from the folder.
  }
  return fresh;
}

export function createSecretBox(appSecret: string | undefined, dataDir: string): SecretBox {
  const key = keyMaterial(appSecret, dataDir);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    },
    decrypt(sealed) {
      const [v, iv, tag, data] = sealed.split(':');
      if (v !== 'v1' || !iv || !tag || data === undefined) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

/** «…x7Qa»: enough to recognise a key, useless to anyone else. */
export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}
