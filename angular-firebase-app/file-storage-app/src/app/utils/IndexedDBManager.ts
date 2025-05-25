import { Injectable, signal, WritableSignal } from '@angular/core';
import { LoggerService } from './Logger.ts'; // Assuming LoggerService is in utils

const DB_NAME = 'localFirstDataDB';
const DB_VERSION = 1; // Increment this when object stores or indexes change

interface IndexDefinition {
  name: string;
  keyPath: string;
  options?: IDBIndexParameters;
}

@Injectable({
  providedIn: 'root'
})
export class IndexedDBManager {
  private db: WritableSignal<IDBDatabase | null> = signal(null);
  private dbPromise: Promise<IDBDatabase>;
  private initializing: WritableSignal<boolean> = signal(false);
  private initError: WritableSignal<any | null> = signal(null);

  constructor(private logger: LoggerService) {
    this.logger.info('[IndexedDBManager] Initializing...');
    this.dbPromise = this.openDb();
    this.dbPromise.then(dbInstance => {
      this.db.set(dbInstance);
      this.logger.info(`[IndexedDBManager] Database '${DB_NAME}' version '${DB_VERSION}' opened successfully.`);
    }).catch(err => {
      this.logger.error('[IndexedDBManager] Failed to open database:', err);
      this.initError.set(err);
    });
  }

  private openDb(): Promise<IDBDatabase> {
    this.initializing.set(true);
    this.initError.set(null);

    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        this.logger.error('[IndexedDBManager] IndexedDB is not supported in this browser.');
        this.initializing.set(false);
        return reject(new Error('IndexedDB not supported.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.logger.info(`[IndexedDBManager] Upgrading database to version ${db.version}. Old version was ${event.oldVersion}.`);
        // Object store creation and index definitions will be handled by ensureStoreAndIndexes,
        // but onupgradeneeded is where they *must* be created/modified.
        // We'll call ensureStoreAndIndexes when a list is initialized, which will trigger
        // a new version upgrade if needed by re-opening the DB with an incremented version.
        // This initial openDb just establishes the DB. Store creation will be dynamic.
      };

      request.onsuccess = (event) => {
        this.logger.debug('[IndexedDBManager] Database open request successful.');
        this.initializing.set(false);
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        this.logger.error('[IndexedDBManager] Error opening database:', (event.target as IDBOpenDBRequest).error);
        this.initializing.set(false);
        reject((event.target as IDBOpenDBRequest).error);
      };

      request.onblocked = (event) => {
        this.logger.warn('[IndexedDBManager] Database open request blocked. Close other connections.', event);
        // This typically means other tabs have an older version of the DB open.
        // Browser usually prompts user or handles this.
        this.initializing.set(false);
        reject(new Error('IndexedDB open request blocked.'));
      };
    });
  }
  
  private async getDb(): Promise<IDBDatabase> {
    const currentDb = this.db();
    if (currentDb) {
      return currentDb;
    }
    // If dbPromise is still pending due to initial load or a reopen
    return this.dbPromise;
  }

  // Method to ensure a store and its indexes exist.
  // This might need to trigger a DB version upgrade if new stores/indexes are added.
  // For simplicity, this example assumes ensureStoreAndIndexes is called when DB is already open
  // or it handles re-opening with new version if needed (complex).
  // A more robust way is to collect all required stores/indexes upfront and open DB once with highest version.
  // For this iteration, let's make ensureStoreAndIndexes create them if they don't exist *during an upgrade*.
  // This means we need a way to trigger an upgrade.
  public async ensureStoreWithIndexes(
    storeName: string, 
    keyPath: string = '_id', 
    indexes: IndexDefinition[] = []
  ): Promise<void> {
    let db = await this.getDb();
    
    // Check if store and indexes already exist in the current DB version
    if (db.objectStoreNames.contains(storeName)) {
        const transaction = db.transaction(storeName, 'readonly');
        const objectStore = transaction.objectStore(storeName);
        let allIndexesExist = true;
        for (const indexDef of indexes) {
            if (!objectStore.indexNames.contains(indexDef.name)) {
                allIndexesExist = false;
                break;
            }
        }
        if (allIndexesExist) {
            this.logger.debug(`[IndexedDBManager] Store '${storeName}' and all specified indexes already exist.`);
            return;
        }
    }

    // If store or indexes are missing, need to trigger a version upgrade.
    // This is the tricky part with dynamic schema changes.
    // Close current DB, increment version, re-open.
    const currentVersion = db.version;
    db.close(); // Close the current connection
    this.logger.info(`[IndexedDBManager] Need to upgrade DB for store '${storeName}'. Closing current DB (v${currentVersion}). Re-opening with v${currentVersion + 1}.`);

    this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, currentVersion + 1);
        request.onupgradeneeded = (event) => {
            const upgradedDb = (event.target as IDBOpenDBRequest).result;
            this.logger.info(`[IndexedDBManager] onupgradeneeded: Creating/updating store '${storeName}' in DB v${upgradedDb.version}`);
            let store: IDBObjectStore;
            if (!upgradedDb.objectStoreNames.contains(storeName)) {
                store = upgradedDb.createObjectStore(storeName, { keyPath: keyPath });
                this.logger.info(`[IndexedDBManager] Object store '${storeName}' created.`);
            } else {
                store = (event.target as IDBOpenDBRequest).transaction!.objectStore(storeName); // Get existing store in this upgrade transaction
                this.logger.info(`[IndexedDBManager] Object store '${storeName}' already exists.`);
            }

            for (const indexDef of indexes) {
                if (!store.indexNames.contains(indexDef.name)) {
                    store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options);
                    this.logger.info(`[IndexedDBManager] Index '${indexDef.name}' on '${indexDef.keyPath}' created for store '${storeName}'.`);
                }
            }
        };
        request.onsuccess = (event) => {
            const newDb = (event.target as IDBOpenDBRequest).result;
            this.db.set(newDb); // Update the signal with the new DB instance
            this.logger.info(`[IndexedDBManager] Database '${DB_NAME}' version '${newDb.version}' opened successfully after upgrade for store '${storeName}'.`);
            resolve(newDb);
        };
        request.onerror = (event) => {
            this.logger.error(`[IndexedDBManager] Error opening database for upgrade for store '${storeName}':`, (event.target as IDBOpenDBRequest).error);
            // Attempt to revert to previous promise if this fails badly, or signal critical error
            this.dbPromise = this.openDb(); // Fallback to trying to open original version
            reject((event.target as IDBOpenDBRequest).error);
        };
         request.onblocked = (event) => {
            this.logger.warn('[IndexedDBManager] Database upgrade request blocked.', event);
            reject(new Error('IndexedDB upgrade request blocked.'));
        };
    });
    await this.dbPromise; // Wait for the upgrade and reopen to complete
  }


  async putItem(storeName: string, item: any): Promise<string | number> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => this.logger.debug(`[IndexedDBManager] Item put in '${storeName}' successfully.`);
      transaction.onerror = (event) => this.logger.error(`[IndexedDBManager] Transaction error putting item in '${storeName}':`, event);
    });
  }

  async getItem<T>(storeName: string, id: IDBValidKey): Promise<T | undefined> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteItem(storeName: string, id: IDBValidKey): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => this.logger.debug(`[IndexedDBManager] Item deleted from '${storeName}' successfully.`);
      transaction.onerror = (event) => this.logger.error(`[IndexedDBManager] Transaction error deleting item from '${storeName}':`, event);
    });
  }

  async getAllItems<T>(storeName: string): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllByIndex<T>(storeName: string, indexName: string, queryValue: IDBValidKey): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(queryValue);
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async getItemsByRange<T>(
    storeName: string, 
    indexName: string, 
    lowerBound: any, 
    upperBound: any, 
    lowerExclusive: boolean = false, 
    upperExclusive: boolean = false
  ): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.bound(lowerBound, upperBound, lowerExclusive, upperExclusive);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }
  
  async count(storeName: string, keyRange?: IDBKeyRange | IDBValidKey): Promise<number> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = keyRange === undefined ? store.count() : store.count(keyRange);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
  }

  // TODO: Add method for cursor-based iteration with skip/take for pagination on indexed fields.
}
