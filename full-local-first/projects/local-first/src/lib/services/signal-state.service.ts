/**
 * @file Implements a service for managing reactive state using Angular Signals.
 * This service is responsible for holding and updating the in-memory state of a list,
 * including its items, status, and related metadata. It does not directly interact
 * with persistence layers but provides methods for higher-level services to update its state.
 */

import { signal, computed, WritableSignal, Signal } from '@angular/core';
import { Item, FileResult, ListOptions, BaseItem, FileInput } from '../types'; // Added FileInput
import { LocalForageService } from './localforage.service';

/**
 * Manages the reactive state for a single list using Angular Signals.
 * @template T The type of the data items in the list (must be an object).
 * @template U The type for user identifiers (e.g., string, a custom User object). Defaults to `any`.
 */
export class SignalStateService<T extends object, U = any> {
  // --- Internal State Signals ---

  /** @private Signal holding the array of active (not soft-deleted) items. */
  private readonly _items = signal<Item<T, U>[]>([]);
  /** @private Signal holding the array of soft-deleted items. */
  private readonly _deletedItems = signal<Item<T, U>[]>([]);
  /** @private Signal holding the current operational status of the list. */
  private readonly _status = signal<'idle' | 'loading' | 'error' | 'success'>('idle');
  /** @private Signal holding the last error message, if any. */
  private readonly _error = signal<string | null>(null);
  /** @private Signal holding a map of file states, keyed by file ID. */
  private readonly _filesState = signal<Map<string, FileResult>>(new Map());

  // --- Public Read-only Signals & Computeds ---

  /** Public read-only signal for active items. */
  public readonly items: Signal<Item<T, U>[]> = this._items.asReadonly();
  /** Public read-only signal for soft-deleted items. */
  public readonly deletedItems: Signal<Item<T, U>[]> = this._deletedItems.asReadonly();
  /** Public read-only signal for the list's operational status. */
  public readonly status: Signal<'idle' | 'loading' | 'error' | 'success'> = this._status.asReadonly();
  /** Public read-only signal for the last error message. */
  public readonly error: Signal<string | null> = this._error.asReadonly();
  /** Public read-only signal for the state of files associated with items in the list. */
  public readonly filesState: Signal<Map<string, FileResult>> = this._filesState.asReadonly();

  /** Computed signal indicating if the list is currently in a loading state. */
  public readonly isLoading: Signal<boolean> = computed(() => this.status() === 'loading');
  /** Computed signal indicating if the list has successfully loaded and contains items. */
  public readonly hasValue: Signal<boolean> = computed(() => this._items().length > 0);
  /** Computed signal for the count of active (not soft-deleted) items. */
  public readonly count: Signal<number> = computed(() => this._items().length);
  /** Computed signal for the total count of items, including active and soft-deleted ones. */
  public readonly totalCount: Signal<number> = computed(() => this._items().length + this._deletedItems().length);

  /**
   * Constructs the SignalStateService.
   * @param listName The unique name of the list this state service manages.
   * @param listOptions Configuration options for the list.
   * @param localForageService Instance of LocalForageService for data persistence.
   */
  constructor(
    public readonly listName: string,
    public readonly listOptions: ListOptions<T>,
    private localForageService: LocalForageService
  ) {
    this.loadInitialData();
  }

  /**
   * Loads initial data from LocalForage into the state signals.
   * This is typically called upon service initialization.
   * It populates the `_items` and `_deletedItems` signals.
   */
  async loadInitialData(): Promise<void> {
    this.setLoading('Loading initial data...');
    try {
      const allItems = await this.localForageService.getAllItems<Item<T, U>>(this.listName);
      const activeItems: Item<T, U>[] = [];
      const softDeletedItems: Item<T, U>[] = [];

      for (const item of allItems) {
        if (item._deleted) {
          softDeletedItems.push(item);
        } else {
          activeItems.push(item);
        }
      }

      this._items.set(activeItems);
      this._deletedItems.set(softDeletedItems);
      this.setSuccess();
    } catch (e: any) {
      const errorMessage = e.message || 'Failed to load initial data';
      console.error(`[SignalStateService - ${this.listName}] Error loading initial data:`, e);
      this.setError(errorMessage);
    }
  }

  /**
   * Adds an item to the in-memory state.
   * Assumes the item has already been persisted by the caller.
   * @param item The item to add to the state.
   */
  addItemToState(item: Item<T, U>): void {
    this._items.update(currentItems => [...currentItems, item]);
    // Note: If the item might already exist (e.g., due to optimistic updates or races),
    // you might want to filter it out first:
    // this._items.update(currentItems => [...currentItems.filter(i => i._id !== item._id), item]);
  }

  /**
   * Updates an existing item in the in-memory state.
   * If the item's `_deleted` status changes, it will be moved between `_items` and `_deletedItems` signals.
   * @param updatedItem The item with updated information.
   */
  updateItemInState(updatedItem: Item<T, U>): void {
    if (updatedItem._deleted) {
      // Item is marked as deleted
      this._items.update(items => items.filter(item => item._id !== updatedItem._id));
      this._deletedItems.update(items => {
        const existingIndex = items.findIndex(item => item._id === updatedItem._id);
        if (existingIndex > -1) {
          const newItems = [...items];
          newItems[existingIndex] = updatedItem;
          return newItems;
        }
        return [...items, updatedItem];
      });
    } else {
      // Item is not marked as deleted (could be an update to an active item or a restoration)
      this._deletedItems.update(items => items.filter(item => item._id !== updatedItem._id));
      this._items.update(items => {
        const existingIndex = items.findIndex(item => item._id === updatedItem._id);
        if (existingIndex > -1) {
          const newItems = [...items];
          newItems[existingIndex] = updatedItem;
          return newItems;
        }
        // If it wasn't in _deletedItems and not found in _items, it's a new active item (or already there)
        // To prevent duplicates if called multiple times, ensure it's not already there.
        if (!items.find(item => item._id === updatedItem._id)) {
          return [...items, updatedItem];
        }
        return items; // No change if already present and not updated
      });
    }
  }

  /**
   * Removes an item from the in-memory state based on its ID.
   * If soft deleting, the item is moved from the active list to the deleted list.
   * It's assumed that the item's `_deleted` and related fields are updated by the caller
   * *before* or *after* this state update, typically via `updateItemInState`.
   * This method primarily handles the presence in the correct list (`_items` or `_deletedItems`).
   *
   * @param itemId The ID of the item to remove/move.
   * @param isSoftDelete True if the item is being soft-deleted, false if hard-deleted.
   */
  removeItemFromState(itemId: string, isSoftDelete: boolean): void {
    if (isSoftDelete) {
      const itemToMove = this._items().find(i => i._id === itemId);
      if (itemToMove) {
        this._items.update(currentItems => currentItems.filter(i => i._id !== itemId));
        // Ensure the item reflects its deleted state if it's being moved.
        // The caller is responsible for persisting this change and calling updateItemInState.
        // For now, we add it to deletedItems as is, assuming it will be updated.
        // A more robust way is for the caller to use updateItemInState with the item marked as deleted.
        // This method then becomes more about ensuring it's not in the active list.
        // However, "moves item" implies this method should do it.
        const softDeletedItem = { ...itemToMove, _deleted: true, _deletedAt: new Date().toISOString() }; // Basic marking
         this._deletedItems.update(currentDeletedItems => {
          if (!currentDeletedItems.find(i => i._id === itemId)) {
            return [...currentDeletedItems, softDeletedItem as Item<T,U>]; // Type assertion after basic marking
          }
          // If already present, update it (e.g. if _deletedAt changed)
          return currentDeletedItems.map(i => i._id === itemId ? (softDeletedItem as Item<T,U>) : i);
        });
      } else {
        // If not in _items, it might already be in _deletedItems or doesn't exist.
        // No operation needed on _items. If it's a soft delete, ensure it's in _deletedItems.
        // This could happen if a soft delete is requested for an already soft-deleted item.
        // The updateItemInState call from the orchestrator should handle the final state.
      }
    } else { // Hard delete
      this._items.update(currentItems => currentItems.filter(i => i._id !== itemId));
      this._deletedItems.update(currentDeletedItems => currentDeletedItems.filter(i => i._id !== itemId));
    }
  }

  /**
   * Clears all items from local state signals and attempts to clear them from LocalForage.
   */
  async clearAllLocalStateAndStorage(): Promise<void> {
    this.setLoading('Clearing all local data...');
    try {
      await this.localForageService.clearStore(this.listName);
      this._items.set([]);
      this._deletedItems.set([]);
      this._filesState.set(new Map());
      // _error is cleared by setSuccess
      this.setSuccess();
      console.log(`[SignalStateService - ${this.listName}] Cleared all local state and storage.`);
    } catch (e: any) {
      const errorMessage = e.message || `Failed to clear store ${this.listName}`;
      console.error(`[SignalStateService - ${this.listName}] Error clearing store:`, e);
      this.setError(errorMessage);
      throw e; // Re-throw to allow caller to handle
    }
  }

  /**
   * Sets the state to loading.
   * @param message Optional message (currently not stored, but could be for richer loading states).
   */
  setLoading(message?: string): void {
    this._status.set('loading');
    this._error.set(null);
    // if (message) console.log(`[SignalStateService - ${this.listName}] Loading: ${message}`);
  }

  /**
   * Sets the state to success.
   */
  setSuccess(): void {
    this._status.set('success');
    this._error.set(null);
  }

  /**
   * Sets the state to error.
   * @param errorMessage The error message to store.
   */
  setError(errorMessage: string): void {
    this._status.set('error');
    this._error.set(errorMessage);
    console.error(`[SignalStateService - ${this.listName}] Error: ${errorMessage}`);
  }

  // --- File State Management ---

  /**
   * Updates the state of a specific file in the `_filesState` map.
   * @param fileId The unique ID of the file.
   * @param stateChanges An object containing partial changes to the file's state (FileResult).
   */
  updateFileState(fileId: string, stateChanges: Partial<FileResult>): void {
    this._filesState.update(currentMap => {
      const newMap = new Map(currentMap);
      const existingState = newMap.get(fileId) || { id: fileId, name: '', isLoading: false, progress: 0 };
      newMap.set(fileId, { ...existingState, ...stateChanges });
      return newMap;
    });
  }

  /**
   * Removes the state entry for a specific file from the `_filesState` map.
   * @param fileId The unique ID of the file whose state is to be removed.
   */
  removeFileState(fileId: string): void {
    this._filesState.update(currentMap => {
      const newMap = new Map(currentMap);
      newMap.delete(fileId);
      return newMap;
    });
  }
}
