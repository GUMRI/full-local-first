/**
 * @file Defines core types and interfaces for the local-first library.
 */

import { Observable } from 'rxjs';
import { Signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { ReplicationEngine } from './services/replication.service';

// --- File Handling Types ---

/**
 * Represents a file to be uploaded.
 */
export interface FileInput {
  /** The name of the field in the parent item that this file is associated with. */
  fieldName: string;
  /** The name of the file. */
  name: string;
  /** The file data as a Blob. */
  data: Blob;
  lastModified: string
}
export interface StoredFile {
  fileId: string,
  fieldName: string, // Store the fieldName from FileInput
  originalName: string,
  type: string,
  size: number,
  state: 'synced' | 'nosynced'
  lastModified: string
}
/**
 * Represents a file that has been read or is being processed.
 */
export interface FileRead {
  /** Unique identifier for the file. */
  id: string;
  /** The name of the file. */
  name: string;
  /** The file data as a Blob (optional, might not be present for remote files). */
  data?: Blob;
  /** The MIME type of the file. */
  type: string;
  /** The size of the file in bytes. */
  size: number;
  /** A URL to preview the file (e.g., an object URL for local files). */
  previewURL?: string;
  /** Indicates if the file is currently being loaded or processed. */
  isLoading?: boolean;
  /** The progress of loading or processing the file (0-100). */
  progress?: number;
}

/**
 * Metadata for a file during replication.
 */
export interface FileReplicationMeta {
  /** Unique identifier for the file. */
  id: string;
  /** The name of the file. */
  name: string;
  /** The storage path of the file in the remote backend. */
  path: string;
}

/**
 * Input for replicating a file to remote storage.
 */
export interface FileReplicationInput {
  /** Unique identifier for the file. */
  id: string;
  /** The name of the file. */
  name: string;
  /** The file data as a Blob. */
  data: Blob;
  /** The name of the list this file is associated with. */
  listName: string;
  /** The ID of the item this file is associated with. */
  itemId: string;
}

/**
 * Represents the result of a file operation (e.g., upload, download).
 */
export interface FileResult {
  /** Unique identifier for the file. */
  id: string;
  /** The name of the file. */
  name: string;
  /** Indicates if the file operation is in progress. */
  isLoading?: boolean;
  /** The progress of the file operation (0-100). */
  progress?: number;
  error?: string
}

/**
 * An observable representing the result of a file replication process.
 * Emits FileResult objects as the replication progresses.
 */
export type FileReplicationResult = Observable<FileResult>;

// --- Item and BaseItem Types ---

/**
 * Utility type to get the keys of an object T.
 * @template T The object type.
 */
export type fieldsKeys<T> = keyof T;

/**
 * Base interface for all items managed by the library.
 * Includes common properties for tracking and synchronization.
 * @template T The specific type of the item's data.
 * @template U The type for user identifiers (e.g., string, a custom User object). Defaults to `any`.
 */
export interface BaseItem<T, U = any> {
  /**
   * Primary unique identifier for the item.
   * This field is typically a UUID and is added to uniqueFields by default.
   */
  _id: string;
  /** ISO date string representing when the item was created. */
  createdAt: string;
  /** Identifier for the user or process that created the item. */
  createdBy: string | U | null;
  /** ISO date string representing when the item was last updated. */
  _updatedAt: string;
  /**
   * An array of update records, tracking changes to the item.
   * Each record details who made the update, when, and the state before and after.
   */
  updates?: {
    by: string | U | null;
    at: string; // ISO date string
    before: Partial<T>;
    after: Partial<T>;
  }[];
  /** Flag indicating if the item is soft-deleted. */
  _deleted: boolean;
  /** ISO date string representing when the item was soft-deleted. */
  _deletedAt?: string;
  /** Identifier for the user or process that soft-deleted the item. */
  deletedBy?: string | U | null;
}

/**
 * Represents a complete item, combining the user-defined data structure T
 * with the BaseItem metadata.
 * @template T The specific type of the item's data.
 * @template U The type for user identifiers. Defaults to `any`.
 */
export type Item<T, U = any> = T & BaseItem<T, U>;

// --- Input Types for CRUD ---

/**
 * Input structure for creating a new item.
 * @template T The specific type of the item's data.
 * @template U The type for user identifiers. Defaults to `any`.
 */
export interface CreateItemInput<T, U = any> {
  /** Identifier for the user or process creating the item. */
  createdBy?: string | null; // Should this be string | U | null? User prompt has string | null
  /** Optional array of files to attach to the item. */
  files?: FileInput[];
  /** The actual data for the item. */
  data: T;
}

/**
 * Input structure for updating an existing item.
 * @template T The specific type of the item's data.
 * @template U The type for user identifiers. Defaults to `any`.
 */
export interface UpdateItemInput<T, U = any> {
  /** The ID of the item to update. */
  id: string;
  /** Identifier for the user or process performing the update. */
  updatedBy: string | U | null;
  /** The partial data to update in the item. */
  data: Partial<T>;
  /** Optional array of new files to attach or replace existing ones. */
  files?: FileInput[];
}

// --- Filtering and Querying ---

/**
 * Defines the structure for filtering and querying data.
 * @template T The type of items being queried.
 */
export interface FilterArgs<T> {
  /**
   * The `WHERE` clause to filter items.
   * Conditions are applied per field.
   * Example: `where: { name: { equals: 'John' }, age: { gt: 30 } }`
   */
  where?: {
    [K in keyof T]?: {
      equals?: T[K];
      in?: T[K][];
      not?: T[K];
      lt?: T[K]; // Less than
      lte?: T[K]; // Less than or equal to
      gt?: T[K]; // Greater than
      gte?: T[K]; // Greater than or equal to
      contains?: T[K] extends string ? string : never; // Contains for string fields
      startsWith?: T[K] extends string ? string : never; // StartsWith for string fields
      endsWith?: T[K] extends string ? string : never; // EndsWith for string fields
    };
  };
  /**
   * The `ORDER BY` clause to sort items.
   * Example: `orderBy: { createdAt: 'desc', name: 'asc' }`
   */
  orderBy?: { [K in keyof T]?: 'asc' | 'desc' };
  /** Number of items to skip from the beginning of the result set (for pagination). */
  skip?: number;
  /** Maximum number of items to return (for pagination). */
  take?: number;
}

// --- Field Type Definition ---

/**
 * Defines the possible data types for fields within a list item.
 * - `text`: Short text strings.
 * - `longText`: Longer text, potentially multi-line.
 * - `number`: Numeric values (integer or float).
 * - `boolean`: True or false values.
 * - `dateTime`: Date and time values, typically stored as ISO strings or timestamps.
 * - `file`: Represents an attached file.
 * - `object`: A nested JSON-like object.
 * - `array`: An array of primitive values or simple objects.
 * - `map`: A key-value map (similar to a JavaScript object).
 * - `autoIncrement`: An automatically incrementing number (e.g., for primary keys if not using UUID).
 * - `population`: Reference to a single item in another list (for relationships).
 * - `populations`: Reference to multiple items in another list (for many-to-many relationships).
 */
export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'boolean'
  | 'dateTime'
  | 'file'
  | 'object'
  | 'array'
  | 'map'
  | 'autoIncrement'
  | 'population'
  | 'populations';

// --- List Configuration ---

/**
 * Options for configuring a list (analogous to a table or collection).
 * @template T The type of items that will be stored in this list.
 */
export interface ListOptions<T> {
  /** The unique name of the list (e.g., 'users', 'products'). This will be the collection name. */
  name: string;
  /**
   * Configuration for each field in the items of this list.
   * Maps field names (keys of T) to their FieldType.
   * Example: `fields: { name: 'text', age: 'number', picture: 'file' }`
   */
  fields: Record<keyof T, FieldType>;
  /**
   * Defines unique constraints on sets of fields.
   * Each inner array represents a set of fields that, together, must be unique.
   * The `_id` field is implicitly unique and does not need to be specified here.
   * Example: `uniqueFields: [['email'], ['username']]` (email must be unique, username must be unique)
   * Example: `uniqueFields: [['orderId', 'productId']]` (the combination of orderId and productId must be unique)
   */
  uniqueFields: (keyof T)[][];
  /**
   * Fields that should be indexed for efficient searching.
   * Example: `searchFields: [['name'], ['email']]`
   */
  searchFields: (keyof T)[][];
  /**
   * Optional configuration for data replication, if using Firebase.
   */
  replication?: {
    /** Instance of Firestore for data replication. */
    firestore?: Firestore;
    /** Instance of Firebase Storage for file replication. */
    firebaseStorage?: Storage;
  };
  /** Optional configuration for data encryption at rest. */
  encryption?: {
    /** True if encryption is enabled. */
    enabled: boolean;
    /** 
     * TODO: Future options: type: 'AES-GCM', keyProvider?: () => Promise<CryptoKey> 
     * Placeholder for future encryption type and key management strategy.
     */
    // type?: 'AES-GCM'; // Example
    // keyProvider?: () => Promise<CryptoKey>; // Example
  };
  /** Optional configuration for compressing item keys or data. */
  keyCompression?: {
    /** True if key/data compression is enabled. */
    enabled: boolean;
    /** 
     * TODO: Future options: algorithm: 'LZString' | 'custom', customImpl?: { compress: (data: string) => string, decompress: (compressed: string) => string } 
     * Placeholder for compression algorithm selection.
     */
    // algorithm?: 'LZString' | 'custom'; // Example
    // customImpl?: { compress: (data: string) => string, decompress: (compressed: string) => string }; // Example
  };
  /** Optional debug settings for the list. */
  debug?: boolean | {
    /** General log level for this list. */
    level?: 'verbose' | 'info' | 'warn' | 'error';
    /** Enable/disable detailed replication logs for this list. */
    replication?: boolean;
    /** TODO: Add more specific debug flags as needed. */
  };
  /** Optional configuration for automatic compaction (purging) of old soft-deleted items. */
  autoCompact?: {
    /** True if auto-compaction is enabled. */
    enabled: boolean;
    /** Maximum age in days of soft-deleted items before they are considered for purging. */
    maxAgeDays: number;
    /** How often (in hours) to run the compaction process. Defaults to 24 hours. */
    intervalHours?: number;
  };
  // conflictResolver is already present from previous definitions (ListOptions in list-options.model.ts)
  // If this ListOptions is the primary one, ensure conflictResolver is here:
  /**
   * Optional custom conflict resolver function.
   * This function is called when a sync operation detects a conflict between a local and a remote item.
   * The function should return the resolved item or a promise that resolves to the item.
   * @param local The local version of the item (includes BaseItem properties).
   * @param remote The remote version of the item (includes BaseItem properties).
   * @returns The resolved item, or a promise that resolves to the item.
   */
  conflictResolver?: (local: Item<T, any>, remote: Item<T, any>) => Item<T, any> | Promise<Item<T, any>>;
}

// --- State and CRUD Operation Results ---

/**
 * Result type for operations affecting multiple items (e.g., updateMany, removeMany).
 * A map where keys are item IDs (or original indices for createMany) and values are booleans indicating success.
 */
export type ManyResult = Map<string, boolean>;

/**
 * Represents the reactive state of a list.
 * @template T The type of items in the list.
 * @template U The type for user identifiers. Defaults to `any`.
 */
export interface ListState<T, U = any> {
  /** Signal emitting the array of current items in the list. */
  items: Signal<Item<T, U>[]>;
  /** Signal emitting the current status of the list ('idle', 'loading', 'error', 'success'). */
  status: Signal<'idle' | 'loading' | 'error' | 'success'>;
  /** Signal emitting true if the list is currently loading or performing an operation. */
  isLoading: Signal<boolean>; // Corrected: 'isloading' to 'isLoading'
  /** Signal emitting true if the list has successfully loaded items. */
  hasValue: Signal<boolean>;
  /** Signal emitting the last error message, or null if no error. */
  error: Signal<string | null>;
  /** Signal emitting an array of items that match the current filter criteria. */
  filteredItems: Signal<Item<T, U>[]>;
  /** Signal emitting an array of items that have been soft-deleted. */
  deletedItems: Signal<Item<T, U>[]>;
  /** Signal emitting the total count of items in the list (excluding soft-deleted items unless specified by filters). */
  count: Signal<number>;
  /** Signal emitting a map of file states, where keys are file IDs and values are FileResult. */
  filesState: Signal<Map<string, FileResult>>;
}

// --- Main List Interface ---

/**
 * Defines the CRUD (Create, Read, Update, Delete) operations for a list.
 * @template T The type of items in the list.
 * @template U The type for user identifiers. Defaults to `any`.
 */
export interface ListCRUD<T, U = any> {
  /**
   * Finds the first item matching the filter arguments.
   * @param args Filtering and sorting arguments.
   * @returns An object containing a signal that emits the found item or null.
   */
  findFirst(args: FilterArgs<T>): { item: Signal<Item<T, U> | null> };
  /**
   * Finds a unique item by its ID.
   * @param id The ID of the item to find.
   * @returns An object containing a signal that emits the found item or null.
   */
  findUnique(id: string): { item: Signal<Item<T, U> | null> };
  /**
   * Filters items based on the provided arguments.
   * @param args Filtering and sorting arguments.
   * @returns A signal emitting an array of matching items.
   */
  filter(args: FilterArgs<T>): Signal<Item<T, U>[]>;
  /**
   * Creates a new item.
   * @param data The input data for creating the item.
   * @returns A promise that resolves to the created item.
   */
  create(data: CreateItemInput<T, U>): Promise<Item<T, U>>;
  /**
   * Creates multiple new items.
   * @param data An array of input data for creating items.
   * @returns A promise that resolves to a map where keys are original indices
   *          and values are either the created item or an Error object if creation failed for that item.
   */
  createMany(data: CreateItemInput<T, U>[]): Promise<Map<number, Item<T, U> | Error>>;
  /**
   * Updates an existing item.
   * @param input The input data for updating the item.
   * @returns A promise that resolves to the updated item, or null if not found.
   */
  update(input: UpdateItemInput<T, U>): Promise<Item<T, U> | null>;
  /**
   * Updates multiple existing items.
   * @param input An array of input data for updating items.
   * @returns A promise that resolves to a ManyResult indicating success for each item.
   */
  updateMany(input: UpdateItemInput<T, U>[]): Promise<ManyResult>;
  /**
   * Creates a new item or updates an existing one if it already exists (based on ID).
   * @param input The input data for creating or updating the item.
   * @returns A promise that resolves to the created or updated item.
   */
  upsert(input: CreateItemInput<T, U> | UpdateItemInput<T, U>): Promise<Item<T, U>>;
  /**
   * Creates or updates multiple items.
   * @param input An array of input data for creating or updating items.
   * @returns A promise that resolves to a ManyResult indicating success for each item.
   */
  upsertMany(input: (CreateItemInput<T, U> | UpdateItemInput<T, U>)[]): Promise<ManyResult>;
  /**
   * Removes an item.
   * @param id The ID of the item to remove.
   * @param deletedBy Identifier for the user or process performing the deletion.
   * @param soft If true, performs a soft delete (marks as deleted). Defaults to true.
   * @returns A promise that resolves to true if successful, false otherwise.
   */
  remove(id: string, deletedBy: string | U, soft?: boolean): Promise<boolean>;
  /**
   * Removes multiple items.
   * @param ids An array of IDs of items to remove.
   * @param deletedBy Identifier for the user or process performing the deletion.
   * @param soft If true, performs soft deletes. Defaults to true.
   * @returns A promise that resolves to a ManyResult indicating success for each item.
   */
  removeMany(ids: string[], deletedBy: string | U, soft?: boolean): Promise<ManyResult>;
  /**
   * Restores a soft-deleted item.
   * @param id The ID of the item to restore.
   * @returns A promise that resolves to true if successful, false otherwise.
   */
  restore(id: string): Promise<boolean>;
  /**
   * Restores multiple soft-deleted items.
   * @param ids An array of IDs of items to restore.
   * @returns A promise that resolves to a ManyResult indicating success for each item.
   */
  restoreMany(ids: string[]): Promise<ManyResult>;
  /**
   * Permanently purges all soft-deleted items from the local store and backend.
   * @returns A promise that resolves to the number of items purged.
   */
  purgeDeleted(): Promise<number>;
  /**
   * Permanently purges soft-deleted items older than a specified date.
   * @param olderThanDate An ISO date string. Items deleted on or before this date will be purged.
   * @returns A promise that resolves to the number of items purged.
   */
  purgeOldDeleted(olderThanDate: string): Promise<number>;
  replicationStatus$: any
  pauseReplication: () => any,
  resumeReplication: () => any,
  getPushQueue: () => any,
  populate: (item: Item<T, U>, fieldName: keyof T, targetListName: string) => any
  search:  (queryText: string, searchOptions?: { targetFields?: (keyof T)[]; limit?: number; /* TODO: Add more search options */ }) => any
}

/**
 * Represents a reference to a list, combining its state and CRUD operations.
 * @template T The type of items in the list.
 * @template U The type for user identifiers. Defaults to `any`.
 */
export type ListRef<T, U = any> = ListState<T, U> & ListCRUD<T, U>;

// --- Factory Function Declaration ---

/**
 * Factory function to create and configure a new list.
 * @template T The type of items that will be stored in this list.
 * @template U The type for user identifiers. Defaults to `any`.
 * @param options Configuration options for the list.
 * @returns A ListRef providing access to the list's state and CRUD operations.
 */
export declare function list<T, U = any>(options: ListOptions<T>): ListRef<T, U>;
