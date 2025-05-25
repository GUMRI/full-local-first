import { Signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { FileRead, FileInput } from './file.model'; // Adjusted import path

export type FieldType = 'text' | 'longText' | 'number' | 'boolean' | 'dateTime' | 'file' | 'object' | 'array' | 'map' | 'autoIncriment' | 'population' | 'populations';

export interface UpdatesLogs<T, U = any> { by?: string | U; at: string; before: Partial<T>; after: Partial<T>; }

export interface BaseItem<T, U = any> { _id: string; createdAt: string; createdBy: string | U; _updatedAt: string; updatesLogs?: UpdatesLogs<T, U>[]; _deleted: boolean; _deletedAt?: string; deletedBy?: string | U; ['file name']: FileRead; }

export type Item<T, U = any> = T & BaseItem<T, U>;

export interface CreateItemInput<T, U = any> { createdBy?: string; files?: FileInput[]; data: T; } // Assuming FileInput is from file.model.ts
export interface UpdateItemInput<T, U = any> { id: string; updatedBy?: string | U; files?: FileInput[]; data: Partial<T>; } // Assuming FileInput is from file.model.ts

export type FilterArgs<T> = { where?: { [K in keyof T]?: { equals?: T[K]; in?: T[K][]; not?: T[K]; lt?: T[K]; lte?: T[K]; gt?: T[K]; gte?: T[K]; contains?: string; startsWith?: string; endsWith?: string; }; }; search?: { fields: (keyof T)[], value: string }; orderBy?: { [K in keyof T]?: 'asc' | 'desc' }; skip?: number; take?: number; };

export interface ListOptions<T> { name: string; fields: Record<keyof T, FieldType>; uniqueFields?: (keyof T)[]; indexing?: (keyof T)[]; queries?: Signal<FilterArgs<T>>; replication?: { firestore: Firestore; firebaseStorage?: Storage; }; }

export type ManyResult = Map<string, boolean>;

import { FileResult } from './file.model'; // Add this
import { ListStatus } from '../list/ListStateImpl'; // Add this - path is relative to this file

export interface ListRef<T> {
  options: Readonly<ListOptions<T>>;
  
  // State Signals
  items: Signal<Item<T>[]>;
  status: Signal<ListStatus>;
  filteredItems: Signal<Item<T>[]>;
  deletedItems: Signal<Item<T>[]>;
  currentError: Signal<any | null>;
  filesState: Signal<Map<string, FileResult[]>>;

  // CRUD Methods
  create(item: CreateItemInput<T>): Promise<Item<T>>;
  read(id: string): Promise<Item<T> | undefined>;
  update(itemUpdate: UpdateItemInput<T>): Promise<Item<T>>;
  delete(id: string, userId?: string): Promise<Item<T>>; // Returns soft-deleted item

  // Additional Management Methods
  restore(id: string, userId?: string): Promise<Item<T>>;
  purge(id: string): Promise<void>;

  // File State Methods (if part of public API)
  setFileState(itemId: string, fileResults: FileResult[]): void;
  updateFileProgress(itemId: string, fileId: string, progress: number, isLoading: boolean): void;

  // Client Query Methods
  setClientQuery(args: FilterArgs<T> | null): void;
  getClientQuery(): FilterArgs<T> | null;

  // Pagination-related state
  totalFilteredCount: Signal<number>; 
}
