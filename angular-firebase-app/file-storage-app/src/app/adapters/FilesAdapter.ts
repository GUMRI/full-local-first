import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { LocalForageAdapter } from './LocalForageAdapter';
import { FileInput, FileRead } from '../models/file.model'; // Assuming FileRead might be extended or used as is

const FILE_META_STORE_NAME = 'fileMetadataStore';
const FILE_BLOBS_STORE_NAME = 'fileBlobsStore';

@Injectable({
  providedIn: 'root'
})
export class FilesAdapter {

  constructor(private localForageAdapter: LocalForageAdapter) {
    // Ensure dedicated stores are configured.
    this.ensureStoresConfigured().then(() => {
        console.log('FilesAdapter initialized and stores configured: metadata store and blob store.');
    }).catch(error => {
        console.error('Error configuring stores for FilesAdapter:', error);
    });
  }

  private generateId(): string {
    return uuidv4();
  }
  
  public async ensureStoresConfigured(): Promise<void> {
    // Configure the instance for file metadata
    this.localForageAdapter.configureInstance({ 
      name: 'fileMetaDb', // Database name for metadata
      storeName: 'file_metadata', // Store name within that database
      description: 'Stores metadata for files'
    }, FILE_META_STORE_NAME);

    // Configure the instance for file blobs
    this.localForageAdapter.configureInstance({ 
      name: 'fileBlobsDb', // Database name for blobs
      storeName: 'file_blobs', // Store name within that database
      description: 'Stores file blobs'
    }, FILE_BLOBS_STORE_NAME);
    // Note: No explicit console.log here, constructor handles it.
  }

  async addFile(fileInput: FileInput, additionalMeta: Record<string, any> = {}): Promise<FileRead> {
    const id = this.generateId();
    const { name, data } = fileInput;

    // Store the blob
    await this.localForageAdapter.set<Blob>(id, data, FILE_BLOBS_STORE_NAME);

    // Create and store metadata
    // Note: `FileRead` fields like `previewURL`, `isLoading`, `progress` are typically
    // managed by UI or replication logic, not set directly here unless provided.
    const metadata: FileRead = {
      id,
      name,
      type: data.type,
      size: data.size,
      // data: undefined, // Explicitly ensure data is not part of stored metadata
      ...additionalMeta 
    };

    await this.localForageAdapter.set<FileRead>(id, metadata, FILE_META_STORE_NAME);
    
    // Return metadata (without blob data by default)
    const returnedMeta = { ...metadata };
    // delete returnedMeta.data; // Not needed if 'data' is not in 'metadata' to begin with
    return returnedMeta;
  }

  async getFileData(id: string): Promise<Blob | null> {
    return this.localForageAdapter.get<Blob>(id, FILE_BLOBS_STORE_NAME);
  }

  async getFileMeta(id: string): Promise<FileRead | null> {
    return this.localForageAdapter.get<FileRead>(id, FILE_META_STORE_NAME);
  }

  async getFile(id: string): Promise<FileRead | null> {
    // This method primarily returns metadata.
    // If blob is needed, one should call getFileData separately.
    const meta = await this.getFileMeta(id);
    if (!meta) return null;
    
    // Example: If FileRead could hold the blob for small files (not the current design)
    // if (meta.size < SOME_THRESHOLD_SIZE_FOR_INLINE_DATA) {
    //   meta.data = await this.getFileData(id); // Assuming FileRead has 'data?: Blob'
    // }
    return meta;
  }
  
  async updateFileMeta(id: string, metaUpdates: Partial<FileRead>): Promise<FileRead | null> {
    const currentMeta = await this.getFileMeta(id);
    if (!currentMeta) {
      console.warn(`File metadata not found for ID: ${id}. Cannot update.`);
      return null;
    }
    // Ensure 'data' field is not accidentally introduced into metadata if it's part of metaUpdates
    const { data, ...validMetaUpdates } = metaUpdates as any; // Exclude 'data' if present
    if (data !== undefined) {
        console.warn(`Attempted to update metadata for ID: ${id} with a 'data' field. Blob data should be managed via getFileData/addFile.`);
    }

    const updatedMeta = { ...currentMeta, ...validMetaUpdates };
    await this.localForageAdapter.set<FileRead>(id, updatedMeta, FILE_META_STORE_NAME);
    return updatedMeta;
  }

  async deleteFile(id: string): Promise<void> {
    await this.localForageAdapter.remove(id, FILE_BLOBS_STORE_NAME);
    await this.localForageAdapter.remove(id, FILE_META_STORE_NAME);
    console.log(`File with ID ${id} deleted (blob and metadata).`);
  }

  async getAllFileMetas(): Promise<FileRead[]> {
    const metas: FileRead[] = [];
    // The iterate callback in LocalForageAdapter is defined as (value: T, key: string, iterationNumber: number) => U
    // The U type parameter is for early exit. If we don't need early exit, we can return void or undefined.
    await this.localForageAdapter.iterate<FileRead, void>((value, key, iterationNumber) => {
      // value here is FileRead, key is the file ID, iterationNumber is the index
      metas.push(value);
    }, FILE_META_STORE_NAME);
    return metas;
  }
}
