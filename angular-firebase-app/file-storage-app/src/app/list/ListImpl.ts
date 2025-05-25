import { Signal, effect, untracked, WritableSignal, signal, computed } from '@angular/core';
import {
  ListRef, ListOptions, Item, CreateItemInput, UpdateItemInput,
  FilterArgs 
} from '../models/list.model';
import { FileResult } from '../models/file.model';
import { ListStateImpl, ListStatus } from './ListStateImpl';
import { ListCRUDImpl } from './ListCRUDImpl';
import { ListQueriesImpl } from './ListQueriesImpl';

import { LocalForageAdapter } from '../adapters/LocalForageAdapter';
import { FilesAdapter } from '../adapters/FilesAdapter';
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts';
import { IndexedDBManager } from '../utils/IndexedDBManager.ts'; 
import { LoggerService } from '../utils/Logger.ts';         

interface IndexData { name: string; keyPath: string; options?: IDBIndexParameters; }


export class ListImpl<T extends Record<string, any>> implements ListRef<T> {
  public readonly options: Readonly<ListOptions<T>>;

  public readonly items: Signal<Item<T>[]>;
  public readonly status: Signal<ListStatus>;
  public readonly filteredItems: Signal<Item<T>[]>;
  public readonly deletedItems: Signal<Item<T>[]>;
  public readonly currentError: Signal<any | null>;
  public readonly filesState: Signal<Map<string, FileResult[]>>;
  public readonly totalFilteredCount: Signal<number>; 

  private listState: ListStateImpl<T>;
  private listCRUD: ListCRUDImpl<T>;
  private listQueries: ListQueriesImpl<T>;
  
  private clientQueryArgs: WritableSignal<FilterArgs<T> | null> = signal(null);
  
  private indexedDBManager: IndexedDBManager; 
  private logger: LoggerService;

  constructor(
    listOptions: Readonly<ListOptions<T>>,
    localForageAdapter: LocalForageAdapter,
    filesAdapter: FilesAdapter,
    indexedDBManager: IndexedDBManager, 
    logger: LoggerService,             
    encryptedStorageService?: EncryptedStorageService
  ) {
    this.options = listOptions;
    this.indexedDBManager = indexedDBManager; 
    this.logger = logger;                     
    this.logger.info(`[ListImpl-${this.options.name}] Initializing...`);

    this.listState = new ListStateImpl<T>(this.options.name);
    // Pass ListOptions, IDBManager, Logger to ListQueriesImpl
    this.listQueries = new ListQueriesImpl<T>(
        this.options.name, // listNameForLog
        this.options, 
        this.indexedDBManager, 
        this.logger
    );
    this.listCRUD = new ListCRUDImpl<T>( 
      this.options,
      localForageAdapter,
      filesAdapter,
      this.indexedDBManager, 
      this.logger,           
      encryptedStorageService
    );

    this.items = this.listState.items;
    this.status = this.listState.status;
    this.filteredItems = this.listState.filteredItems;
    this.deletedItems = this.listState.deletedItems;
    this.currentError = this.listState.currentError;
    this.filesState = this.listState.filesState;
    this.totalFilteredCount = this.listState.totalFilteredCount.asReadonly();


    this.ensureIndexedDBSetup().then(() => {
      this.logger.info(`[ListImpl-${this.options.name}] IndexedDB setup complete. Proceeding to load initial data.`);
      this._loadInitialData(); 
    }).catch(err => {
        this.logger.error(`[ListImpl-${this.options.name}] Critical error during IndexedDB setup:`, err);
        this.setSyncError(`IDB_SETUP_FAILED: ${(err as Error).message}`); 
    });

    const combinedQueryArgs = computed(() => {
      const externalQuery = this.options.queries ? this.options.queries() : ({} as FilterArgs<T>);
      const clientQuery = this.clientQueryArgs() || ({} as FilterArgs<T>);
      const mergedArgs: FilterArgs<T> = { ...externalQuery, ...clientQuery };
      if (Object.keys(mergedArgs).length === 0) return {} as FilterArgs<T>;
      return mergedArgs;
    });

    // Effect for dynamic queries
    effect(async () => { // Make effect async
      // const currentItems = this.items(); // No longer pass items directly
      const finalQueryArgs = combinedQueryArgs(); 
      
      try {
        // Set loading status before async query.
        // Use untracked for setStatus if it's not meant to be a dependency itself.
        untracked(() => this.listState.setStatus('loading')); 
        
        // query method is now async as it interacts with IndexedDB
        const queryResult = await this.listQueries.query(finalQueryArgs); // Remove currentItems
        this.listState.applyFilteredResult(queryResult.items, queryResult.totalCount);
        untracked(() => this.listState.setStatus('loaded'));
      } catch (error) {
        this.logger.error(`[ListImpl-${this.options.name}] Error during query execution or state update:`, error);
        // setError in ListStateImpl should also set status to 'error'
        untracked(() => this.listState.setError(error)); 
      }
    });
  }

  private async ensureIndexedDBSetup(): Promise<void> {
    const storeName = `list_${this.options.name}`;
    const indexesToCreate: IndexData[] = [];

    if (this.options.indexing && Array.isArray(this.options.indexing)) {
      this.options.indexing.forEach(fieldKey => {
        if (typeof fieldKey === 'string') { 
            const isUnique = this.options.uniqueFields?.includes(fieldKey as keyof T) ?? false;
            indexesToCreate.push({
                name: fieldKey as string,
                keyPath: fieldKey as string,
                options: { unique: isUnique }
            });
        } else {
            this.logger.warn(`[ListImpl-${this.options.name}] Invalid fieldKey found in indexing array:`, fieldKey);
        }
      });
    }

    this.logger.info(`[ListImpl-${this.options.name}] Ensuring IDB store '${storeName}' with keyPath '_id' and indexes:`, indexesToCreate.map(i => i.name));
    await this.indexedDBManager.ensureStoreWithIndexes(storeName, '_id', indexesToCreate);
    this.logger.info(`[ListImpl-${this.options.name}] IDB store '${storeName}' and indexes are ready.`);
  }

  private async _loadInitialData(): Promise<void> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      // This still loads from LocalForage, which is the source of truth for "all items".
      // ListQueriesImpl will use IDB based on query args.
      // If IDB is empty, ListQueriesImpl.query() will return empty, then ListImpl.items will be empty.
      // This needs reconciliation: either populate IDB from LF here, or change query logic.
      // For now, this only populates the LF-backed 'items' signal.
      // The 'effect' will then run listQueries.query() which reads from IDB.
      // This is a potential mismatch if IDB is not populated from LF.
      // The task is to make ListQueriesImpl use IDB. _loadInitialData populates the *state* items.
      // The effect will then run using IDB, potentially showing different data if IDB is out of sync.
      // This will be addressed in subsequent item that populates IDB from LF after LF load.
      const allItems = await this.listCRUD.getAllItems(); // Reads from LocalForage
      const activeItems: Item<T>[] = [];
      const softDeletedItems: Item<T>[] = [];
      allItems.forEach(item => {
        if (item._deleted) {
          softDeletedItems.push(item);
        } else {
          activeItems.push(item);
        }
      });
      this.listState.setItems(activeItems); // This sets the main 'items' signal
      this.listState.setDeletedItems(softDeletedItems);
      // Status is set to 'loaded' by the query effect after it runs successfully.
      // Or, if no query effect runs initially (e.g. no initial combinedQueryArgs), set it here.
      // The effect *will* run because combinedQueryArgs is initialized.
      // If query is empty, it might return immediately.
      // this.listState.setStatus('loaded'); // Let effect handle this.
    } catch (e) {
      this.logger.error(`[ListImpl-${this.options.name}] Error loading initial data from LocalForage:`, e);
      this.listState.setError(e);
    }
  }

  async create(itemInput: CreateItemInput<T>): Promise<Item<T>> {
    untracked(() => this.listState.setStatus('loading')); 
    this.listState.setError(null);
    try {
      const newItem = await this.listCRUD.createItem(itemInput);
      // This will add to 'items' signal, triggering the effect which re-queries IDB.
      this.listState.addItem(newItem); 
      // The effect will set status to 'loaded' after query.
      return newItem;
    } catch (e) {
      this.logger.error(`[ListImpl-${this.options.name}] Error creating item:`, e);
      untracked(() => this.listState.setError(e));
      throw e;
    }
  }

  async read(id: string): Promise<Item<T> | undefined> {
    // This primarily reads from in-memory state signals.
    let item = untracked(this.items).find(i => i._id === id);
    if (item) return item;
    item = untracked(this.deletedItems).find(i => i._id === id);
    if (item) return item;
    
    // Fallback to LocalForage if not in current signal states (e.g. during initial load or if state is complex)
    // return this.listCRUD.readItem(id); // This was the previous more direct approach
    return undefined; // Preferring state signals as source of truth for reads by UI
  }

  async update(itemUpdate: UpdateItemInput<T>): Promise<Item<T>> {
    untracked(() => this.listState.setStatus('loading'));
    this.listState.setError(null);
    try {
      const updatedItem = await this.listCRUD.updateItem(itemUpdate);
      // This will update 'items' or 'deletedItems' signal, triggering the effect.
      if (updatedItem._deleted) {
        this.listState.deletedItems.update(items => 
          items.map(i => (i._id === updatedItem._id ? updatedItem : i))
        );
        this.listState.items.update(items => items.filter(i => i._id !== updatedItem._id));
      } else {
        this.listState.updateItem(updatedItem);
      }
      // The effect will set status to 'loaded' after query.
      return updatedItem;
    } catch (e) {
      this.logger.error(`[ListImpl-${this.options.name}] Error updating item:`, e);
      untracked(() => this.listState.setError(e));
      throw e;
    }
  }

  async delete(id: string, userId?: string): Promise<Item<T>> {
    untracked(() => this.listState.setStatus('loading'));
    this.listState.setError(null);
    try {
      const softDeletedItem = await this.listCRUD.deleteItem(id, userId);
      this.listState.items.update(items => items.filter(i => i._id !== id));
      this.listState.deletedItems.update(dItems => {
          if (!dItems.find(di => di._id === softDeletedItem._id)) {
              return [...dItems, softDeletedItem];
          }
          return dItems.map(di => di._id === softDeletedItem._id ? softDeletedItem : di);
      });
      // The effect will set status to 'loaded' after query.
      return softDeletedItem;
    } catch (e) {
      this.logger.error(`[ListImpl-${this.options.name}] Error deleting item:`, e);
      untracked(() => this.listState.setError(e));
      throw e;
    }
  }
  
  async restore(id: string, userId?: string): Promise<Item<T>> {
    untracked(() => this.listState.setStatus('loading'));
    this.listState.setError(null);
    try {
      const restoredItem = await this.listCRUD.restoreItem(id, userId);
      this.listState.deletedItems.update(d => d.filter(item => item._id !== id));
      this.listState.addItem(restoredItem); 
      // The effect will set status to 'loaded' after query.
      return restoredItem;
    } catch (e) {
      this.logger.error(`[ListImpl-${this.options.name}] Error restoring item:`, e);
      untracked(() => this.listState.setError(e));
      throw e;
    }
  }

  async purge(id: string): Promise<void> {
    untracked(() => this.listState.setStatus('loading'));
    this.listState.setError(null);
    try {
      await this.listCRUD.purgeDeletedItem(id);
      // Ensure item is removed from both signals, which triggers effect.
      this.listState.items.update(i => i.filter(item => item._id !== id));
      this.listState.deletedItems.update(d => d.filter(item => item._id !== id));
      // The effect will set status to 'loaded' after query.
    } catch (e) {
      this.logger.error(`[ListImpl-${this.options.name}] Error purging item:`, e);
      untracked(() => this.listState.setError(e));
      throw e;
    }
  }
  
  public setClientQuery(args: FilterArgs<T> | null): void {
    this.clientQueryArgs.set(args);
  }

  public getClientQuery(): FilterArgs<T> | null { 
    return this.clientQueryArgs(); 
  }

  public setSyncStatus(status: ListStatus): void {
    this.listState.setStatus(status);
  }

  public setSyncError(error: any | null): void {
    this.listState.setError(error); 
  }
  
  setFileState(itemId: string, fileResults: FileResult[]): void {
    this.listState.setFileState(itemId, fileResults);
  }

  updateFileProgress(itemId: string, fileId: string, progress: number, isLoading: boolean): void {
    this.listState.updateFileProgress(itemId, fileId, progress, isLoading);
  }
}
