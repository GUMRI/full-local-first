import { Item, ListOptions } from '../models/list.model'; // Keep existing imports
import { Firestore } from '@angular/fire/firestore'; 
import { FirebaseStorage } from '@angular/fire/storage';
import { FileReplicationInput } from '../models/file.model'; // <-- Add this import

// ... (Checkpoint, ReplicationPullResult, ReplicationPushResult interfaces remain the same) ...
export interface Checkpoint {
  listName: string;
  lastPulledAt?: string;
}

export interface ReplicationPullResult<T> {
  pulledItems: Item<T>[];
  newCheckpoint: Partial<Checkpoint>;
  errors?: any[];
}

export interface ReplicationPushResult {
  successfulItemIds: string[];
  failedItemIds: string[];
  errors?: any[];
}


export interface ReplicationStrategy<T extends Record<string, any>> {
  readonly strategyName: string;

  initialize(
    listOptions: Readonly<ListOptions<T>>,
    firestore: Firestore, 
    firebaseStorage?: FirebaseStorage
  ): Promise<void>;

  pullChanges(listName: string, currentCheckpoint: Checkpoint): Promise<ReplicationPullResult<T>>;
  
  pushChanges(listName: string, itemsToPush: Item<T>[]): Promise<ReplicationPushResult>;

  // --- New optional methods for file replication ---
  pushFile?(
    fileInput: FileReplicationInput, 
    listOptions: Readonly<ListOptions<T>> // Pass listOptions for context if needed
  ): Promise<{ storagePath: string; downloadUrl?: string; }>; // downloadUrl might not always be available/needed

  pullFile?(
    fileMeta: { id: string; storagePath: string; fileName: string; }, // Added fileName for potential use
    listOptions: Readonly<ListOptions<T>>
  ): Promise<Blob>;

  deleteFile?(
    fileMeta: { id: string; storagePath: string; },
    listOptions: Readonly<ListOptions<T>>
  ): Promise<void>;
}
