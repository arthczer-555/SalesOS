import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET env var is not set");
  return Buffer.from(secret, "hex");
}

export interface EncryptedData {
  encryptedKey: string;
  iv: string;
  authTag: string;
}

export function encrypt(plaintext: string): EncryptedData {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}

export function decrypt(data: EncryptedData): string {
  const key = getKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(data.iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(data.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data.encryptedKey, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
