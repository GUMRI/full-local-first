import { signal, computed, WritableSignal, Signal, untracked } from '@angular/core';
import { Item } from '../models/list.model';
import { FileResult } from '../models/file.model'; // Assuming FileResult is the correct model

export type ListStatus = 'idle' | 'loading' | 'error' | 'syncing' | 'loaded';

export class ListStateImpl<T> {
  // Public signals
  public readonly items: WritableSignal<Item<T>[]>;
  public readonly status: WritableSignal<ListStatus>;
  public readonly deletedItems: WritableSignal<Item<T>[]>; // For soft-deleted items
  public readonly filesState: WritableSignal<Map<string, FileResult[]>>; // Key: itemId
  public readonly currentError: WritableSignal<any | null>;
  
  // Filtered items - can be made more complex later with query integration
  // For now, it's explicitly set, but could be a computed signal.
  public readonly filteredItems: WritableSignal<Item<T>[]>; 

  private listName: string;

  constructor(listName: string) {
    this.listName = listName;
    this.items = signal<Item<T>[]>([]);
    this.status = signal<ListStatus>('idle');
    this.deletedItems = signal<Item<T>[]>([]);
    this.filesState = signal<Map<string, FileResult[]>>(new Map());
    this.currentError = signal<any | null>(null);
    
    // Initialize filteredItems. Initially, it mirrors 'items'.
    // It will be updated when actual filtering is applied.
    this.filteredItems = signal<Item<T>[]>([]); 
    
    console.log(`ListStateImpl for ${this.listName} initialized`);

    // Keep filteredItems in sync with items if no filter is applied (basic setup)
    // A more robust solution will come with ListQueriesImpl
    // Effect to sync items to filteredItems when items change IF no filter is active.
    // For now, this direct setting in setItems will handle the base case.
  }

  // --- Mutators for signals ---

  setItems(newItems: Item<T>[]): void {
    this.items.set(newItems);
    this.filteredItems.set(newItems); // Default: filtered is same as all items
    this.setStatus('loaded');
  }

  addItem(item: Item<T>): void {
    this.items.update(currentItems => [...currentItems, item]);
    // Potentially update filteredItems as well, depending on filter logic
    this.filteredItems.update(currentFiltered => [...currentFiltered, item]); // Simplistic update
  }

  updateItem(updatedItem: Item<T>): void {
    this.items.update(currentItems =>
      currentItems.map(item => (item._id === updatedItem._id ? updatedItem : item))
    );
    this.filteredItems.update(currentFiltered =>
      currentFiltered.map(item => (item._id === updatedItem._id ? updatedItem : item)) // Simplistic update
    );
  }

  removeItem(itemId: string): void {
    // This physically removes. Soft delete logic (moving to deletedItems) would be separate.
    const itemToRemove = untracked(this.items).find(item => item._id === itemId);
    this.items.update(currentItems => currentItems.filter(item => item._id !== itemId));
    this.filteredItems.update(currentFiltered => currentFiltered.filter(item => item._id !== itemId)); // Simplistic update
    if (itemToRemove && itemToRemove._deleted) {
        this.addDeletedItem(itemToRemove);
    }
  }
  
  addDeletedItem(item: Item<T>): void {
    this.deletedItems.update(current => [...current, item]);
  }

  setDeletedItems(deleted: Item<T>[]): void {
    this.deletedItems.set(deleted);
  }

  setStatus(newStatus: ListStatus): void {
    this.status.set(newStatus);
  }

  setError(error: any | null): void {
    this.currentError.set(error);
    if (error) {
      this.setStatus('error');
    }
  }

  setFileState(itemId: string, fileResults: FileResult[]): void {
    this.filesState.update(currentMap => {
      const newMap = new Map(currentMap);
      newMap.set(itemId, fileResults);
      return newMap;
    });
  }

  updateFileProgress(itemId: string, fileId: string, progress: number, isLoading: boolean): void {
    this.filesState.update(currentMap => {
      const newMap = new Map(currentMap);
      const files = newMap.get(itemId) || [];
      const fileIndex = files.findIndex(f => f.id === fileId);

      if (fileIndex > -1) {
        const updatedFile = { ...files[fileIndex], progress, isLoading };
        const updatedFiles = [...files];
        updatedFiles[fileIndex] = updatedFile;
        newMap.set(itemId, updatedFiles);
      } else {
        // Optionally add if not found, or log warning
        console.warn(`File ${fileId} not found for item ${itemId} to update progress.`);
      }
      return newMap;
    });
  }
  
  // Method to apply filters - to be used by ListQueriesImpl or ListImpl
  applyFilteredItems(filtered: Item<T>[]) {
    this.filteredItems.set(filtered);
  }
}
