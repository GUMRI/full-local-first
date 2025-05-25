import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class EncryptedStorageService {
  private encryptionKey?: CryptoKey;
  private readonly ALGORITHM = 'AES-GCM';
  private readonly IV_LENGTH = 12; // Bytes for GCM

  constructor() {
    console.log('EncryptedStorageService initialized');
  }

  public isKeySet(): boolean {
    return !!this.encryptionKey;
  }

  async setKey(key: CryptoKey): Promise<void> {
    // It's good practice to check the key's algorithm and usages.
    if (key.algorithm.name !== this.ALGORITHM && key.algorithm.name !== 'PBKDF2') { // PBKDF2 is for key derivation
       // Allow PBKDF2 for intermediate keys, but final key for AES-GCM should match.
       // This check might need refinement based on how keys are derived and used.
       // For a directly used AES-GCM key, it must match this.ALGORITHM.
       // If the key object passed is the one *derived* for AES-GCM, its algorithm.name will be AES-GCM.
    }
    if (!key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
        // This check is important if the key is directly used.
        // If it's a master key for derivation, usages might be different (e.g., 'deriveKey').
        // console.warn('Key does not have encrypt/decrypt usages. This might be intended if it is a master key for derivation.');
    }
    this.encryptionKey = key;
    console.log('Encryption key set.');
  }

  // Example: Method to generate a key from a password (can be expanded)
  async generateKeyFromPassword(password: string, saltInput: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' }, // Specify PBKDF2 for the key material
      false, // not exportable
      ['deriveKey'] // usage
    );
    const salt = enc.encode(saltInput); // Salt should be unique per user/password
    
    // Derive a key for AES-GCM
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000, // NIST recommendation: >= 10,000
        hash: 'SHA-256' // SHA-256 is a common choice
      },
      keyMaterial, // This is the CryptoKey from importKey
      { name: this.ALGORITHM, length: 256 }, // Key algorithm parameters for AES-GCM 256-bit
      true, // exportable - choose based on your security requirements
      ['encrypt', 'decrypt'] // Key usages
    );
  }
  
  // Method to import a raw key
  async importKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
    // Ensure the rawKey is of a valid length for AES-GCM (e.g., 16, 24, or 32 bytes for AES-128, AES-192, AES-256)
    if (rawKey.byteLength !== 16 && rawKey.byteLength !== 24 && rawKey.byteLength !== 32) {
        throw new Error('Invalid key length for AES-GCM. Must be 16, 24, or 32 bytes.');
    }
    return crypto.subtle.importKey(
        "raw",
        rawKey,
        this.ALGORITHM, // Specify AES-GCM directly as the algorithm for this key
        true, // exportable - choose based on your security requirements
        ["encrypt", "decrypt"] // Key usages
    );
  }


  async encrypt(data: string): Promise<{ iv: Uint8Array; encryptedData: ArrayBuffer; }> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not set. Call setKey() first.');
    }
    // Ensure the key set is actually for AES-GCM if it was set via setKey directly
    // This is a runtime check; the derived key from generateKeyFromPassword should already be AES-GCM.
    if (this.encryptionKey.algorithm.name !== this.ALGORITHM) {
        throw new Error(`Invalid encryption key type. Expected ${this.ALGORITHM}, got ${this.encryptionKey.algorithm.name}. Ensure the key used for encryption is an AES-GCM key.`);
    }


    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);

    const encryptedData = await crypto.subtle.encrypt(
      {
        name: this.ALGORITHM,
        iv: iv
        // tagLength: 128 // Optional: GCM tag length, defaults to 128
      },
      this.encryptionKey,
      encodedData
    );

    return { iv, encryptedData };
  }

  async decrypt(encryptedData: ArrayBuffer, iv: Uint8Array): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not set. Call setKey() first.');
    }
     if (this.encryptionKey.algorithm.name !== this.ALGORITHM) {
        throw new Error(`Invalid decryption key type. Expected ${this.ALGORITHM}, got ${this.encryptionKey.algorithm.name}. Ensure the key used for decryption is an AES-GCM key.`);
    }


    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv
          // tagLength: 128 // Optional: GCM tag length, must match encryption
        },
        this.encryptionKey,
        encryptedData
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (error) {
      console.error('Decryption failed:', error);
      // Avoid exposing detailed crypto errors to the caller directly for security reasons.
      // Log detailed error for debugging, but return a generic error message.
      throw new Error('Decryption failed. The key may be incorrect or the data corrupted.');
    }
  }
}
