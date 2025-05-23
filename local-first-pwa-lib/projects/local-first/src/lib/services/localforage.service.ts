/**
 * @file Implements a service for interacting with LocalForage.
 * This service provides a low-level wrapper around LocalForage for storing and retrieving data and files.
 */

import { Injectable } from '@angular/core';
import * as localforage from 'localforage';
import { BaseItem } from '../types'; // Assuming types.ts is in ../types relative to this service

/**
 * Service for interacting with LocalForage.
 * It allows creating and managing multiple data stores (for different lists) and a dedicated store for files.
 */
@Injectable({
  providedIn: 'root',
})
export class LocalForageService {
  private readonly fileStoreName = '_localFiles'; // Dedicated store name for files
  private readonly dbName = 'LocalFirstDB'; // Main DB name for list data
  private readonly filesDbName = 'LocalFirstFiles'; // DB name for file blobs

  constructor() {
    // Configure localforage drivers if needed, e.g., prefer IndexedDB.
    localforage.config({
      driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
      name: this.dbName, // Default DB name, instances can override this
    });
  }

  /**
   * Creates or retrieves a LocalForage instance configured for a specific list.
   * @param listName The name of the list, used as the storeName in LocalForage.
   * @returns A LocalForage instance.
   */
  private getInstance(listName: string): LocalForage {
    return localforage.createInstance({
      name: this.dbName, // Shared database name
      storeName: listName, // Unique store name per list
    });
  }

  /**
   * Retrieves an item from the specified list store.
   * @template T The type of the item, extending BaseItem.
   * @param listName The name of the list.
   * @param id The ID of the item to retrieve.
   * @returns A promise that resolves to the item or null if not found.
   */
  async getItem<T extends BaseItem<any>>(listName: string, id: string): Promise<T | null> {
    const instance = this.getInstance(listName);
    try {
      const item = await instance.getItem<T>(id);
      // TODO: Data Transformation Hooks (Decryption, Decompression)
      // These would typically be called here if item is retrieved and transformations are enabled.
      // Example:
      // if (item && listSpecificOptions?.encryption?.enabled) { /* item = decrypt(item, key); */ console.warn('Decryption hook - not implemented'); }
      // if (item && listSpecificOptions?.keyCompression?.enabled) { /* item = decompress(item); */ console.warn('Key decompression hook - not implemented'); }
      return item;
    } catch (error) {
      console.error(`[LocalForageService] Error getting item '${id}' from list '${listName}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Retrieves all items from the specified list store.
   * @template T The type of the items, extending BaseItem.
   * @param listName The name of the list.
   * @returns A promise that resolves to an array of items.
   */
  async getAllItems<T extends BaseItem<any>>(listName: string): Promise<T[]> {
    const instance = this.getInstance(listName);
    const items: T[] = [];
    try {
      await instance.iterate<T, void>((value) => {
        items.push(value);
      });
      return items;
    } catch (error) {
      console.error(`[LocalForageService] Error getting all items from list '${listName}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Sets (adds or updates) an item in the specified list store.
   * @template T The type of the item, extending BaseItem.
   * @param listName The name of the list.
   * @param id The ID of the item to set. This should typically be `item._id`.
   * @param item The item data to store.
   * @returns A promise that resolves to the stored item.
   */
  async setItem<T extends BaseItem<any>>(listName: string, id: string, item: T): Promise<T> {
    const instance = this.getInstance(listName);
    try {
      // TODO: Data Transformation Hooks (Encryption, Compression)
      // These would typically be called here before setting the item.
      // Example:
      // let processedItem = { ...item };
      // if (listSpecificOptions?.keyCompression?.enabled) { /* processedItem = compress(processedItem); */ console.warn('Key compression hook - not implemented'); }
      // if (listSpecificOptions?.encryption?.enabled) { /* processedItem = encrypt(processedItem, key); */ console.warn('Encryption hook - not implemented'); }
      // const storedItem = await instance.setItem<T>(id, processedItem);
      const storedItem = await instance.setItem<T>(id, item);
      return storedItem;
    } catch (error) {
      console.error(`[LocalForageService] Error setting item '${id}' in list '${listName}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Removes an item from the specified list store.
   * @param listName The name of the list.
   * @param id The ID of the item to remove.
   * @returns A promise that resolves when the item is removed.
   */
  async removeItem(listName: string, id: string): Promise<void> {
    const instance = this.getInstance(listName);
    try {
      await instance.removeItem(id);
    } catch (error) {
      console.error(`[LocalForageService] Error removing item '${id}' from list '${listName}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Clears all items from the specified list store.
   * @param listName The name of the list.
   * @returns A promise that resolves when the store is cleared.
   */
  async clearStore(listName: string): Promise<void> {
    const instance = this.getInstance(listName);
    try {
      await instance.clear();
    } catch (error) {
      console.error(`[LocalForageService] Error clearing list store '${listName}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Iterates over all key/value pairs in the specified list store.
   * @template T The type of the items in the store, extending BaseItem.
   * @template U The type of the result returned by the iterator callback.
   * @param listName The name of the list.
   * @param iteratorCallback A function that is called for each key/value pair.
   *                       It receives the value, key, and iteration number.
   *                       If the callback returns a non-undefined value, the iteration is terminated,
   *                       and that value is returned by `instance.iterate()`.
   *                       For this wrapper, we collect all non-undefined results into an array.
   * @returns A promise that resolves to an array of results from the iteratorCallback.
   */
  async iterate<T extends BaseItem<any>, U>(
    listName: string,
    iteratorCallback: (value: T, key: string, iterationNumber: number) => U | undefined | void
  ): Promise<U[]> {
    const instance = this.getInstance(listName);
    const results: U[] = [];
    try {
      // localforage's iterate stops if the callback returns anything other than undefined.
      // To collect all results, we ensure our callback always returns void for the underlying iterate,
      // and we push to our results array within the callback.
      await instance.iterate<T, void>((value, key, iterationNumber) => {
        const result = iteratorCallback(value, key, iterationNumber);
        if (result !== undefined) {
          results.push(result);
        }
      });
      return results;
    } catch (error) {
      console.error(`[LocalForageService] Error iterating over list store '${listName}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  // --- File Handling Methods ---

  /**
   * Creates or retrieves a LocalForage instance specifically for storing file blobs.
   * @returns A LocalForage instance for files.
   */
  private getFilesStoreInstance(): LocalForage {
    return localforage.createInstance({
      name: this.filesDbName, // Separate DB name for files
      storeName: 'blobs', // Common store name for all file blobs
    });
  }

  /**
   * Stores a file blob in the dedicated files store.
   * @param fileId The unique ID for the file, used as the key.
   * @param blob The file data as a Blob.
   * @returns A promise that resolves to the fileId (the key under which it was stored).
   */
  async storeFile(fileId: string, blob: Blob): Promise<string> {
    const instance = this.getFilesStoreInstance();
    try {
      await instance.setItem(fileId, blob);
      return fileId;
    } catch (error) {
      console.error(`[LocalForageService] Error storing file '${fileId}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Retrieves a file blob from the files store.
   * @param fileId The ID of the file to retrieve.
   * @returns A promise that resolves to the Blob or null if not found.
   */
  async retrieveFile(fileId: string): Promise<Blob | null> {
    const instance = this.getFilesStoreInstance();
    try {
      const blob = await instance.getItem<Blob>(fileId);
      return blob;
    } catch (error) {
      console.error(`[LocalForageService] Error retrieving file '${fileId}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }

  /**
   * Removes a file blob from the files store.
   * @param fileId The ID of the file to remove.
   * @returns A promise that resolves when the file is removed.
   */
  async removeFile(fileId: string): Promise<void> {
    const instance = this.getFilesStoreInstance();
    try {
      await instance.removeItem(fileId);
    } catch (error) {
      console.error(`[LocalForageService] Error removing file '${fileId}':`, error);
      throw error; // Re-throw or handle as appropriate
    }
  }
}
