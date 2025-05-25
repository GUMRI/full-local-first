// In file.model.ts
import { Signal } from '@angular/core'; // Keep existing imports
import { Observable } from 'rxjs';   // Keep existing imports

export interface FileInput { name: string; data: Blob; }

export interface FileRead { 
  id: string; 
  name: string; 
  data?: Blob; // Locally available blob data
  type: string; 
  size: number; 
  previewURL?: string; // For local previews
  isLoading?: boolean; // UI state: e.g., for initial load or download
  progress?: number;   // UI state: e.g., for upload/download progress

  // --- New fields for replication ---
  storagePath?: string;   // Path in remote storage (e.g., Firebase Storage path)
  remoteUrl?: string;     // Publicly accessible URL if available
  isUploaded?: boolean;   // True if the file blob has been successfully uploaded
  isDownloading?: boolean; // True if the file blob is currently being downloaded
  // lastSyncError?: any; // Optional: to store errors related to this specific file's sync
}

export interface FileReplicationMeta { 
  id: string; 
  name: string; 
  path: string; // This seems like it would be storagePath
}

// FileReplicationInput might need context for where the file belongs
export type FileReplicationInput = { 
  id: string; // File ID
  name: string; 
  data: Blob | File; // Ensure it's Blob or File, not string for actual file data
  listName: string; 
  itemId: string; 
  fieldKey: string; // Which field in the item this file belongs to
};

export type FileResult = { 
  id: string; 
  name: string; 
  isLoading?: boolean; 
  progress?: number; 
  syncState: 'synced' | 'pending' | 'syncing' | 'error' | 'conflict' | ''; 
  error: any;
  remoteUrl?: string; // Potentially include remoteUrl here too
  storagePath?: string; // And storagePath
};
export type FileReplicationResult = Observable<FileResult>;
