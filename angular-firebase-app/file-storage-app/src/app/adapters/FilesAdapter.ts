// In FilesAdapter.ts
import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { LocalForageAdapter } from './LocalForageAdapter';
// Ensure all necessary fields are imported from FileRead, and also FileInput
import { FileInput, FileRead } from '../models/file.model'; 

const FILE_META_STORE_NAME = 'fileMetadataStore';
const FILE_BLOBS_STORE_NAME = 'fileBlobsStore';

@Injectable({
  providedIn: 'root'
})
export class FilesAdapter {

  constructor(private localForageAdapter: LocalForageAdapter) {
    this.ensureStoresConfigured().then(() => {
        // console.log('FilesAdapter initialized and stores configured.'); // Already logged
    }).catch(error => {
        console.error('Error configuring stores for FilesAdapter:', error);
    });
  }

  private generateId(): string {
    return uuidv4();
  }
  
  public async ensureStoresConfigured() { // Keep this method as it was
    this.localForageAdapter.configureInstance({ name: 'fileMetaDb', storeName: 'file_metadata' }, FILE_META_STORE_NAME);
    this.localForageAdapter.configureInstance({ name: 'fileBlobsDb', storeName: 'file_blobs' }, FILE_BLOBS_STORE_NAME);
  }

  async addFile(fileInput: FileInput, additionalMeta: Record<string, any> = {}): Promise<FileRead> {
    const id = this.generateId();
    const { name, data } = fileInput;

    await this.localForageAdapter.set<Blob>(id, data, FILE_BLOBS_STORE_NAME);

    const metadata: FileRead = {
      id,
      name,
      type: data.type,
      size: data.size,
      // Replication fields initialized
      isUploaded: false,
      isDownloading: false,
      storagePath: undefined,
      remoteUrl: undefined,
      // Other UI fields
      isLoading: false,
      progress: 0,
      previewURL: URL.createObjectURL(data), // Create a temporary local preview URL
      ...additionalMeta 
    };

    await this.localForageAdapter.set<FileRead>(id, metadata, FILE_META_STORE_NAME);
    
    const returnedMeta = { ...metadata };
    // delete returnedMeta.data; // data field is already optional in FileRead and not set here.
    return returnedMeta;
  }

  async getFileData(id: string): Promise<Blob | null> {
    return this.localForageAdapter.get<Blob>(id, FILE_BLOBS_STORE_NAME);
  }

  async getFileMeta(id: string): Promise<FileRead | null> {
    return this.localForageAdapter.get<FileRead>(id, FILE_META_STORE_NAME);
  }
  
  async getFile(id: string): Promise<FileRead | null> { // Renamed from previous getFileMeta to avoid confusion
    const meta = await this.getFileMeta(id);
    if (!meta) return null;
    // For local display, create object URL if blob data is expected to be available but not directly on meta.
    // This depends on how FileRead.data is used. For now, assume data is only fetched via getFileData.
    return meta;
  }
  
  async updateFileMeta(id: string, metaUpdates: Partial<FileRead>): Promise<FileRead | null> {
    const currentMeta = await this.getFileMeta(id);
    if (!currentMeta) {
      console.warn(`File metadata not found for ID: ${id}. Cannot update.`);
      return null;
    }
    // Ensure blob data isn't accidentally written into metadata if metaUpdates somehow contains it
    if ('data' in metaUpdates) {
        delete metaUpdates.data;
    }
    const updatedMeta = { ...currentMeta, ...metaUpdates };
    await this.localForageAdapter.set<FileRead>(id, updatedMeta, FILE_META_STORE_NAME);
    return updatedMeta;
  }

  async deleteFile(id: string): Promise<void> {
    const meta = await this.getFileMeta(id);
    if (meta && meta.previewURL && meta.previewURL.startsWith('blob:')) {
        URL.revokeObjectURL(meta.previewURL); // Clean up local preview URL
    }
    await this.localForageAdapter.remove(id, FILE_BLOBS_STORE_NAME);
    await this.localForageAdapter.remove(id, FILE_META_STORE_NAME);
    console.log(`File with ID ${id} deleted (blob and metadata).`);
  }

  async getAllFileMetas(): Promise<FileRead[]> {
    const metas: FileRead[] = [];
    await this.localForageAdapter.iterate<FileRead, void>((value, key, iterationNumber) => {
      metas.push(value);
    }, FILE_META_STORE_NAME);
    return metas;
  }

  // --- New/Updated Methods for Replication Support ---

  async markFileAsUploaded(id: string, storagePath: string, remoteUrl?: string): Promise<FileRead | null> {
    const currentMeta = await this.getFileMeta(id);
    if (!currentMeta) {
      console.warn(`[FilesAdapter] markFileAsUploaded: Meta not found for ${id}`);
      return null;
    }
    const updates: Partial<FileRead> = {
      isUploaded: true,
      isDownloading: false, // Should not be downloading if it was just uploaded
      storagePath: storagePath,
      remoteUrl: remoteUrl,
      isLoading: false, // Assuming upload process is complete
      progress: 100 // Assuming 100% progress
    };
    return this.updateFileMeta(id, updates);
  }

  async getFileForUpload(id: string): Promise<{ meta: FileRead; blob: Blob } | null> {
    const meta = await this.getFileMeta(id);
    if (!meta) {
      console.warn(`[FilesAdapter] getFileForUpload: Meta not found for ${id}`);
      return null;
    }
    if (meta.isUploaded) {
      console.info(`[FilesAdapter] getFileForUpload: File ${id} is already marked as uploaded.`);
      // Decide if you want to return it anyway or return null
      // return null; 
    }
    const blob = await this.getFileData(id);
    if (!blob) {
      console.warn(`[FilesAdapter] getFileForUpload: Blob data not found for ${id}`);
      return null;
    }
    return { meta, blob };
  }

  async saveDownloadedFile(
    id: string, // This should be the known file ID
    blob: Blob,
    remoteFileMeta: Pick<FileRead, 'name' | 'type' | 'size' | 'storagePath' | 'remoteUrl'>
  ): Promise<FileRead | null> {
    // Save the blob first
    await this.localForageAdapter.set<Blob>(id, blob, FILE_BLOBS_STORE_NAME);
    
    // Now update or create metadata for this downloaded file
    let currentMeta = await this.getFileMeta(id);
    const previewURL = URL.createObjectURL(blob);

    const updatedMetaData: FileRead = {
        ...(currentMeta || {}), // Spread existing if updating, or provide defaults
        id: id, // Ensure ID is correct
        name: remoteFileMeta.name || currentMeta?.name || 'downloaded_file',
        type: blob.type || remoteFileMeta.type || currentMeta?.type || '',
        size: blob.size, // Always use the actual downloaded blob's size
        storagePath: remoteFileMeta.storagePath || currentMeta?.storagePath,
        remoteUrl: remoteFileMeta.remoteUrl || currentMeta?.remoteUrl,
        isUploaded: true, // It exists in remote storage
        isDownloading: false,
        isLoading: false,
        progress: 100, // Download complete
        previewURL: previewURL,
        // Clear any previous sync error related to download if applicable
    };
    
    await this.localForageAdapter.set<FileRead>(id, updatedMetaData, FILE_META_STORE_NAME);
    return updatedMetaData;
  }

  async updateFileReplicationState(
    id: string, 
    updates: Partial<Pick<FileRead, 'isUploaded' | 'isDownloading' | 'storagePath' | 'remoteUrl' | 'isLoading' | 'progress'>>
  ): Promise<FileRead | null> {
    const currentMeta = await this.getFileMeta(id);
    if (!currentMeta) {
      console.warn(`[FilesAdapter] updateFileReplicationState: Meta not found for ${id}`);
      return null;
    }
    return this.updateFileMeta(id, updates);
  }
}
