import crypto from 'crypto';
import config from '../config';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Derive a 32-byte key from ENCRYPTION_SECRET_KEY (pad or truncate)
const getEncryptionKey = (): Buffer => {
  const secret = config.security.encryptionSecretKey || 'default_secret_key';
  return crypto.createHash('sha256').update(String(secret)).digest();
};

export const encryptText = (text: string): string => {
  if (!text) return text;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    const encrypted1 = cipher.update(text, 'utf8', 'hex');
    const encrypted2 = cipher.final('hex');
    
    // Format: iv:encryptedData
    return `${iv.toString('hex')}:${encrypted1}${encrypted2}`;
};

export const decryptText = (encryptedData: string): string => {
  if (!encryptedData || !encryptedData.includes(':')) return encryptedData;
  
  try {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0] as string, 'hex');
    const encryptedText = parts[1] as string;
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    
    const decrypted1 = decipher.update(encryptedText, 'hex', 'utf8');
    const decrypted2 = decipher.final('utf8');
    
    return decrypted1 + decrypted2;
  } catch (error) {
    console.error('Failed to decrypt data', error);
    return '*** DECRYPTION_FAILED ***';
  }
};

const GCM_PREFIX = 'gcm:';
const GCM_IV_LENGTH = 12;

export const encryptSecretGCM = (plainText: string): string => {
  if (!plainText) return '';
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${GCM_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptSecretGCM = (payload: string): string => {
  if (!payload) return '';
  if (!payload.startsWith(GCM_PREFIX)) {
    const legacy = decryptText(payload);
    return legacy === '*** DECRYPTION_FAILED ***' ? '' : legacy;
  }

  try {
    const body = payload.slice(GCM_PREFIX.length);
    const [ivHex, authTagHex, encryptedHex] = body.split(':');
    if (!ivHex || !authTagHex || encryptedHex === undefined) return '';

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    if (iv.length !== GCM_IV_LENGTH || authTag.length !== 16) return '';

    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
};

export const maskSecretToken = (token: string): string => {
  const clean = (token || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
};
