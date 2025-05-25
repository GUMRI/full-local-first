import { Injectable } from '@angular/core';
import * as localforage from 'localforage';

// Re-export LocalForageOptions for convenience if needed by consumers
export interface LocalForageConfigOptions extends LocalForageOptions {}

@Injectable({
  providedIn: 'root'
})
export class LocalForageAdapter {
  private defaultStore: LocalForage;
  private namedStores: Map<string, LocalForage> = new Map();

  constructor() {
    // Configure a default instance
    this.defaultStore = localforage.createInstance({
      name: 'appDefaultStore', // Database name
      driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
      storeName: 'default_data', // Store name within the database
      description: 'Default data store for the application'
    });
    console.log('LocalForageAdapter initialized with default store (`appDefaultStore/default_data`).');
  }

  /**
   * Configures the default LocalForage instance or creates/replaces a named instance.
   * If instanceName is provided, it configures a named store. Otherwise, the default store.
   * @param config The LocalForage options.
   * @param instanceName Optional name for the instance. If not provided, configures the default instance.
   * @returns The configured LocalForage instance.
   */
  public configureInstance(config: LocalForageConfigOptions, instanceName?: string): LocalForage {
    const instance = localforage.createInstance(config);
    if (instanceName) {
      this.namedStores.set(instanceName, instance);
      console.log(`Configured named LocalForage instance: ${instanceName} (DB: ${config.name}, Store: ${config.storeName})`);
    } else {
      this.defaultStore = instance;
      console.log(`Default LocalForage instance reconfigured (DB: ${config.name}, Store: ${config.storeName})`);
    }
    return instance;
  }

  /**
   * Gets a LocalForage instance.
   * @param instanceName If provided, gets the named store. Otherwise, the default store.
   * @returns The LocalForage instance.
   * @throws Error if a named instance is requested but not found.
   */
  private getStore(instanceName?: string): LocalForage {
    if (instanceName) {
      const store = this.namedStores.get(instanceName);
      if (!store) {
        throw new Error(`LocalForage instance '${instanceName}' not found. Configure it first using configureInstance().`);
      }
      return store;
    }
    return this.defaultStore;
  }

  async get<T>(key: string, instanceName?: string): Promise<T | null> {
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      return await this.getStore(instanceName).getItem<T>(key);
    } catch (error) {
      console.error(`Error getting item '${key}' from LocalForage instance '${storeId}':`, error);
      throw error; // Re-throw to allow caller to handle
    }
  }

  async set<T>(key: string, value: T, instanceName?: string): Promise<T> {
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      return await this.getStore(instanceName).setItem<T>(key, value);
    } catch (error) {
      console.error(`Error setting item '${key}' in LocalForage instance '${storeId}':`, error);
      throw error;
    }
  }

  async remove(key: string, instanceName?: string): Promise<void> {
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      await this.getStore(instanceName).removeItem(key);
    } catch (error) {
      console.error(`Error removing item '${key}' from LocalForage instance '${storeId}':`, error);
      throw error;
    }
  }

  async clear(instanceName?: string): Promise<void> {
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      await this.getStore(instanceName).clear();
    } catch (error) {
      console.error(`Error clearing LocalForage instance '${storeId}':`, error);
      throw error;
    }
  }

  /**
   * Iterates over all key/value pairs in the store.
   * The promise resolves with void when iteration is complete.
   * The iteratorCallback can return a non-undefined value to stop iteration early.
   */
  async iterate<T, U = any>( // U is what the callback might return for early exit
    iteratorCallback: (value: T, key: string, iterationNumber: number) => U,
    instanceName?: string
  ): Promise<void> { // localforage.iterate's promise resolves with void
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      // The type U of the callback return is for early exit (return non-undefined value).
      // The Promise from localforage.iterate itself resolves to void upon completion or early exit.
      await this.getStore(instanceName).iterate<T, U | void>(iteratorCallback);
    } catch (error) {
      console.error(`Error iterating LocalForage instance '${storeId}':`, error);
      throw error;
    }
  }
  
  async keys(instanceName?: string): Promise<string[]> {
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      return await this.getStore(instanceName).keys();
    } catch (error) {
      console.error(`Error getting keys from LocalForage instance '${storeId}':`, error);
      throw error;
    }
  }

  async length(instanceName?: string): Promise<number> {
    const storeId = instanceName || `default (${this.defaultStore.config().name}/${this.defaultStore.config().storeName})`;
    try {
      return await this.getStore(instanceName).length();
    } catch (error) {
      console.error(`Error getting length of LocalForage instance '${storeId}':`, error);
      throw error;
    }
  }
}
