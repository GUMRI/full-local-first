import { Item, ListOptions } from '../models/list.model';
import { Firestore } from '@angular/fire/firestore'; // For Firestore specific types
import { FirebaseStorage } from '@angular/fire/storage'; // For Storage specific types

export interface Checkpoint {
  listName: string;
  lastPulledAt?: string; // ISO string for timestamp-based sync
  // lastPulledVersion?: number; // For version-based sync
  // other checkpoint data
}

export interface ReplicationPullResult<T> {
  pulledItems: Item<T>[];
  newCheckpoint: Partial<Checkpoint>; // Or the full new checkpoint data
  errors?: any[];
}

export interface ReplicationPushResult {
  successfulItemIds: string[];
  failedItemIds: string[];
  errors?: any[];
}

// Interface for a specific replication provider strategy
export interface ReplicationStrategy<T extends Record<string, any>> {
  readonly strategyName: string; // e.g., 'firestore'

  initialize(listOptions: Readonly<ListOptions<T>>,
             firestore: Firestore, 
             firebaseStorage?: FirebaseStorage): Promise<void>;

  pullChanges(listName: string, currentCheckpoint: Checkpoint): Promise<ReplicationPullResult<T>>;
  
  pushChanges(listName: string, itemsToPush: Item<T>[]): Promise<ReplicationPushResult>;

  // Optional: Method to handle file replication for this strategy
  // pushFile?(fileData: { id: string, name: string, blob: Blob, path: string }): Promise<any>;
  // pullFile?(fileMeta: { id: string, name: string, path: string }): Promise<Blob>;
}
