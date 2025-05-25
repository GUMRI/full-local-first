import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

// Define a simpler options type for the service, or use imageCompression.Options directly
export interface ImageCompressionOptions {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  useWebWorker?: boolean;
  maxIteration?: number;
  exifOrientation?: number;
  // Add other options from browser-image-compression.Options as needed
  // More options can be found at:
  // https://github.com/Donaldcwl/browser-image-compression/blob/master/lib/index.d.ts
  alwaysKeepResolution?: boolean;
  fileType?: string;
  initialQuality?: number;
  // ... and others
}

@Injectable({
  providedIn: 'root'
})
export class FilesCompressionService {

  constructor() {
    console.log('FilesCompressionService initialized');
  }

  /**
   * Compresses an image file.
   * @param imageFile The image File or Blob to compress.
   * @param options Compression options.
   * @returns A Promise that resolves with the compressed image Blob.
   */
  async compressImage(
    imageFile: File | Blob, 
    options?: ImageCompressionOptions
  ): Promise<Blob> {
    // Ensure imageFile is a File object if it's a Blob, as the library expects a File.
    // If it's already a File, this doesn't change it.
    // If it's a Blob without a name, provide a default name.
    const fileToCompress = imageFile instanceof File ? imageFile : new File([imageFile], "untitled_image", { type: imageFile.type });

    console.log(`Original image size: ${(fileToCompress.size / 1024 / 1024).toFixed(2)} MB, type: ${fileToCompress.type}`);

    // Check if the file type is an image type supported by the browser for compression
    // This is a basic check; the library itself will do more thorough checks.
    if (!fileToCompress.type.startsWith('image/')) {
        console.warn(`File type (${fileToCompress.type}) does not appear to be an image. Compression might fail or be ineffective. Returning original file.`);
        return fileToCompress;
    }
    
    const defaultOptions: imageCompression.Options = {
      maxSizeMB: 1,          // Default max size in MB
      maxWidthOrHeight: 1920, // Default max width or height
      useWebWorker: true,    // Enable web worker for better performance
      // It's good to set a sensible default for initialQuality if applicable
      // initialQuality: 0.7, // Example: start with 70% quality
      // alwaysKeepResolution: false, // Example: allow resolution change for better compression
    };

    const compressionOptions: imageCompression.Options = {
      ...defaultOptions,
      ...options,
    };

    try {
      // The library expects a File object.
      const compressedFileBlob = await imageCompression(fileToCompress, compressionOptions);
      console.log(`Compressed image size: ${(compressedFileBlob.size / 1024 / 1024).toFixed(2)} MB, new type: ${compressedFileBlob.type}`);
      
      // The library returns a File object, which is a Blob.
      // If a specific Blob (not File) is strictly needed, it's already compatible.
      return compressedFileBlob;
    } catch (error: any) {
      console.error('Image compression failed:', error);
      
      // More specific error checking based on common library errors
      if (error.message && (
          error.message.toLowerCase().includes('not an image') ||
          error.message.toLowerCase().includes('unsupported file type') ||
          error.message.toLowerCase().includes('canvas to blob error') || // Can happen for unsupported formats or too large images
          error.message.toLowerCase().includes('heic') // HEIC might need specific handling/polyfilling
        )
      ) {
        console.warn('The provided file is not a compressible image or is not supported, returning original file.');
        return fileToCompress; 
      }
      
      // For other errors, re-throw a more generic error or the original error
      throw new Error(`Image compression failed: ${error.message || 'Unknown error'}`);
    }
  }

  // Placeholder for other file type compressions (e.g., generic blobs if needed)
  // async compressBlob(blob: Blob, type: 'gzip' | 'deflate'): Promise<Blob> {
  //   // Implementation for generic blob compression using Compression Streams API, pako, etc.
  //   throw new Error('Method not implemented.');
  // }
}
