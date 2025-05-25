import { Signal, effect, untracked, WritableSignal, signal, computed } from '@angular/core'; // Added WritableSignal, signal, computed
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
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts'; // Ensure .ts extension

export class ListImpl<T extends Record<string, any>> implements ListRef<T> {
  public readonly options: Readonly<ListOptions<T>>;

  public readonly items: Signal<Item<T>[]>;
  public readonly status: Signal<ListStatus>;
  public readonly filteredItems: Signal<Item<T>[]>;
  public readonly deletedItems: Signal<Item<T>[]>;
  public readonly currentError: Signal<any | null>;
  public readonly filesState: Signal<Map<string, FileResult[]>>;
  public readonly totalFilteredCount: Signal<number>; // <-- New signal exposure

  private listState: ListStateImpl<T>;
  private listCRUD: ListCRUDImpl<T>;
  private listQueries: ListQueriesImpl<T>;

  // New signal for client-side query arguments (e.g., from StudioComponent)
  private clientQueryArgs: WritableSignal<FilterArgs<T> | null> = signal(null);

  constructor(
    listOptions: Readonly<ListOptions<T>>,
    localForageAdapter: LocalForageAdapter,
    filesAdapter: FilesAdapter,
    encryptedStorageService?: EncryptedStorageService
  ) {
    this.options = listOptions;

    this.listState = new ListStateImpl<T>(this.options.name);
    this.listQueries = new ListQueriesImpl<T>(this.options.name);
    this.listCRUD = new ListCRUDImpl<T>(
      this.options,
      localForageAdapter,
      filesAdapter,
      encryptedStorageService
    );

    this.items = this.listState.items;
    this.status = this.listState.status;
    this.filteredItems = this.listState.filteredItems;
    this.deletedItems = this.listState.deletedItems;
    this.currentError = this.listState.currentError;
    this.filesState = this.listState.filesState;
    this.totalFilteredCount = this.listState.totalFilteredCount.asReadonly(); // <-- Expose as readonly


    this._loadInitialData();

    // Combined query signal for the effect
    const combinedQueryArgs = computed(() => {
      const externalQuery = this.options.queries ? this.options.queries() : ({} as FilterArgs<T>);
      const clientQuery = this.clientQueryArgs() || ({} as FilterArgs<T>);
      
      // Client query takes precedence for properties it defines.
      // 'where' clauses are tricky to merge; for now, client 'where' overrides external 'where'.
      // A more advanced merge could combine 'where' conditions if needed.
      const mergedArgs: FilterArgs<T> = {
        ...externalQuery,
        ...clientQuery, // This will let clientQuery fields overwrite externalQuery fields
        // If specific merge strategies are needed per field (e.g. for 'where'), handle them explicitly:
        // where: clientQuery.where || externalQuery.where, // Example: client takes precedence
      };
      
      // Ensure empty args object if no queries are set
      if (Object.keys(mergedArgs).length === 0) return {} as FilterArgs<T>;
      return mergedArgs;
    });

    // Effect for dynamic queries
    effect(() => {
      const currentItems = this.items(); // Depend on items signal
      const finalQueryArgs = combinedQueryArgs(); // Depend on combined query signal
      
      // query method now returns an object { items: Item<T>[], totalCount: number }
      const queryResult = untracked(() => this.listQueries.query(currentItems, finalQueryArgs));
      // Use the modified method in ListStateImpl
      this.listState.applyFilteredResult(queryResult.items, queryResult.totalCount); // <-- Update
    });
  }

  private async _loadInitialData(): Promise<void> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      const allItems = await this.listCRUD.getAllItems();
      const activeItems: Item<T>[] = [];
      const softDeletedItems: Item<T>[] = [];
      allItems.forEach(item => {
        if (item._deleted) {
          softDeletedItems.push(item);
        } else {
          activeItems.push(item);
        }
      });
      this.listState.setItems(activeItems); // This also sets filteredItems initially
      this.listState.setDeletedItems(softDeletedItems);
      // Note: filteredItems are set via setItems and then updated by the effects.
      this.listState.setStatus('loaded');
    } catch (e) {
      console.error(`Error loading initial data for list ${this.options.name}:`, e);
      this.listState.setError(e);
      this.listState.setStatus('error');
    }
  }

  async create(itemInput: CreateItemInput<T>): Promise<Item<T>> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      const newItem = await this.listCRUD.createItem(itemInput);
      this.listState.addItem(newItem);
      this.listState.setStatus('loaded');
      return newItem;
    } catch (e) {
      this.listState.setError(e);
      this.listState.setStatus('error');
      throw e;
    }
  }

  async read(id: string): Promise<Item<T> | undefined> {
    // Prioritize active items
    let item = untracked(this.items).find(i => i._id === id);
    if (item) return item;
    // Check deleted items if not found in active
    item = untracked(this.deletedItems).find(i => i._id === id);
    if (item) return item;
    
    // As a last resort, if not in memory, try fetching from CRUD layer.
    // This could be useful if the state isn't perfectly synced or for direct lookups.
    // However, for performance, relying on in-memory state is preferred.
    // console.warn(`Item ${id} not found in memory store for list ${this.options.name}. Attempting direct read.`);
    // return this.listCRUD.readItem(id);
    return undefined; // Default to not found if not in memory
  }

  async update(itemUpdate: UpdateItemInput<T>): Promise<Item<T>> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      const updatedItem = await this.listCRUD.updateItem(itemUpdate);
      if (updatedItem._deleted) {
        // If the item is soft-deleted, update it in the deletedItems array
        this.listState.deletedItems.update(items => 
          items.map(i => (i._id === updatedItem._id ? updatedItem : i))
        );
        // Also ensure it's removed from active items if it was there
        this.listState.items.update(items => items.filter(i => i._id !== updatedItem._id));
      } else {
        // If it's an active item, update it in the items array
        this.listState.updateItem(updatedItem);
      }
      this.listState.setStatus('loaded');
      return updatedItem;
    } catch (e) {
      this.listState.setError(e);
      this.listState.setStatus('error');
      throw e;
    }
  }

  async delete(id: string, userId?: string): Promise<Item<T>> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      const softDeletedItem = await this.listCRUD.deleteItem(id, userId);
      this.listState.removeItem(id); // Removes from active items, and potentially adds to deletedItems (ListStateImpl handles this)
      // Explicitly ensure it's in deletedItems, ListStateImpl.removeItem should handle if item was already marked _deleted
      // but an explicit add here ensures it if CRUD layer marks it _deleted.
      // ListStateImpl's removeItem already adds to deletedItems if itemToRemove._deleted is true.
      // However, deleteItem in CRUD returns the item *after* it's marked deleted.
      // So, we ensure it's in deletedItems and removed from active items.
      this.listState.deletedItems.update(dItems => {
          if (!dItems.find(di => di._id === softDeletedItem._id)) {
              return [...dItems, softDeletedItem];
          }
          return dItems.map(di => di._id === softDeletedItem._id ? softDeletedItem : di);
      });
      this.listState.items.update(items => items.filter(i => i._id !== id));

      this.listState.setStatus('loaded');
      return softDeletedItem;
    } catch (e) {
      this.listState.setError(e);
      this.listState.setStatus('error');
      throw e;
    }
  }
  
  async restore(id: string, userId?: string): Promise<Item<T>> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      const restoredItem = await this.listCRUD.restoreItem(id, userId);
      this.listState.deletedItems.update(d => d.filter(item => item._id !== id));
      this.listState.addItem(restoredItem); // Adds to active items
      this.listState.setStatus('loaded');
      return restoredItem;
    } catch (e) {
      this.listState.setError(e);
      this.listState.setStatus('error');
      throw e;
    }
  }

  async purge(id: string): Promise<void> {
    this.listState.setStatus('loading');
    this.listState.setError(null);
    try {
      await this.listCRUD.purgeDeletedItem(id);
      // Ensure removal from all relevant state arrays
      this.listState.items.update(i => i.filter(item => item._id !== id));
      this.listState.deletedItems.update(d => d.filter(item => item._id !== id));
      // applyFilteredItems will be called by the effect reacting to items change
      this.listState.setStatus('loaded');
    } catch (e) {
      this.listState.setError(e);
      this.listState.setStatus('error');
      throw e;
    }
  }
  
  setFileState(itemId: string, fileResults: FileResult[]): void {
    this.listState.setFileState(itemId, fileResults);
  }

  updateFileProgress(itemId: string, fileId: string, progress: number, isLoading: boolean): void {
    this.listState.updateFileProgress(itemId, fileId, progress, isLoading);
  }

  // New methods for ReplicationEngine to call:
  public setSyncStatus(status: ListStatus): void {
    // This method allows an external service (like ReplicationEngine) to update the list's status.
    // It assumes that ListStateImpl's status signal is indeed a WritableSignal.
    this.listState.setStatus(status);
  }

  public setSyncError(error: any | null): void {
    this.listState.setError(error); // setError in ListStateImpl also sets status to 'error' if error is not null
  }

  // New public method for StudioComponent or other clients to set/update client-side query
  public setClientQuery(args: FilterArgs<T> | null): void {
    this.clientQueryArgs.set(args);
  }

  public getClientQuery(): FilterArgs<T> | null { 
    return this.clientQueryArgs(); 
  }
}
