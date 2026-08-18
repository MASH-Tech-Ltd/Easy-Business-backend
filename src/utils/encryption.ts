import crypto from 'crypto';
import config from '../config';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Derive a 32-byte key from JWT_SECRET (pad or truncate)
const getEncryptionKey = (): Buffer => {
  const secret = config.jwt_secret || 'default_secret_key';
  return crypto.scryptSync(secret, 'salt', 32);
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
