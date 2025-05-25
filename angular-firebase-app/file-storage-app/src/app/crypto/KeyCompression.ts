import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class KeyCompressionService {

  constructor() {
    console.log('KeyCompressionService initialized');
  }

  // Helper to convert ArrayBuffer to Base64 string
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Helper to convert Base64 string to ArrayBuffer
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * "Compresses" a string by encoding it to UTF-8 and then to Base64.
   * This serves as a placeholder for more advanced compression.
   * @param text The string to compress.
   * @returns The Base64 encoded string.
   */
  compress(text: string): string {
    try {
      const encoder = new TextEncoder(); // UTF-8 encoding
      const encodedData = encoder.encode(text);
      return this.arrayBufferToBase64(encodedData);
    } catch (e) {
      console.error('Failed to compress text to Base64:', e);
      throw new Error('Compression failed');
    }
  }

  /**
   * "Decompresses" a string from Base64 and then decodes it using UTF-8.
   * @param compressedText The Base64 encoded string.
   * @returns The original string.
   */
  decompress(compressedText: string): string {
    try {
      const decodedDataBuffer = this.base64ToArrayBuffer(compressedText);
      const decoder = new TextDecoder(); // UTF-8 decoding
      return decoder.decode(decodedDataBuffer);
    } catch (e) {
      console.error('Failed to decompress text from Base64:', e);
      throw new Error('Decompression failed');
    }
  }
}
