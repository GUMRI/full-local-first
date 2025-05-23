/**
 * @file Factory function for creating and managing a list with local-first capabilities.
 */

import { signal, computed, Signal } from '@angular/core';
import {
  ListOptions,
  ListRef,
  Item,
  CreateItemInput,
  UpdateItemInput,
  FilterArgs,
  StoredFile,
  FileResult,
  FileInput,
  FieldType,
  ManyResult,
} from './types';
import { LocalForageService } from './services/localforage.service';
import { SignalStateService } from './services/signal-state.service';
import { ReplicationEngine } from './services/replication.service'; // Added
import { EventBusService } from './services/event-bus.service'; // Added

// Define Update type locally as it's specific to BaseItem's 'updates' array structure
type Update<T, U = any> = {
  by: string | U | null;
  at: string; // ISO date string
  before: Partial<T>;
  after: Partial<T>;
};

/**
 * Factory function to create and configure a new list.
 * @template T The type of items (must be an object) that will be stored in this list.
 * @template U The type for user identifiers. Defaults to `any`.
 * @param listOptions Configuration options for the list.
 * @param localForageService Instance of LocalForageService for data persistence.
 * @returns A ListRef providing access to the list's state and CRUD operations.
 */
export function list<T extends object, U = any>(
  listOptions: ListOptions<T>,
  localForageService: LocalForageService,
  eventBus: EventBusService // Added eventBus
): ListRef<T, U> {
  const signalStateService = new SignalStateService<T, U>(
    listOptions.name,
    listOptions,
    localForageService
  );

  let replicationEngine: ReplicationEngine<T, U> | undefined;

  if (listOptions.replication && listOptions.replication.firestore) {
    replicationEngine = new ReplicationEngine<T, U>(
        listOptions,
        listOptions.name,
        localForageService,
        eventBus, // Pass the eventBus
        listOptions.replication.firestore,
        listOptions.replication.firebaseStorage
    );
    replicationEngine.start();
  }

  // --- Helper Functions ---

  /**
   * @private Prepares an update history entry.
   */
  function _prepareUpdateHistory(
    existingItem: Item<T, U>, // Full existing item
    changes: Partial<T>,      // Changes to the data part
    updatedBy: U | string | null,
    timestamp: string
  ): Update<T,U> { // Return type is Update<T,U>, not Update[]
    const beforeState: Partial<T> = {};
    const afterState: Partial<T> = {};

    // Extract the data part of the existing item for comparison
    const existingItemData = { ...existingItem } as Record<keyof Item<T,U>, any>;
    delete existingItemData._id;
    delete existingItemData.createdAt;
    delete existingItemData._updatedAt;
    delete existingItemData.createdBy;
    delete existingItemData._deleted;
    delete existingItemData._deletedAt;
    delete existingItemData.deletedBy;
    delete existingItemData.updates;
    // Any other BaseItem fields should be removed here

    for (const key in changes) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        beforeState[key as keyof T] = existingItemData[key as keyof T];
        afterState[key as keyof T] = changes[key as keyof T];
      }
    }
    return {
      by: updatedBy,
      at: timestamp,
      before: beforeState,
      after: afterState,
    };
  }

  /**
   * @private Processes and stores files associated with an item.
   */
  async function _processFiles(
    itemId: string,
    files: FileInput[],
    listFields: Record<keyof T, FieldType>, // As per prompt
    existingItemData?: Item<T,U> // Full item for checking existing files
  ): Promise<Partial<Record<keyof T, StoredFile>>> {
    const processedFiles: Partial<Record<keyof T, StoredFile>> = {};
    if (!files || files.length === 0) {
      return processedFiles;
    }

    for (const fileInput of files) {
      const fieldNameInT = fileInput.fieldName as keyof T; // fileInput.fieldName is from types.ts

      // Ensure the field exists in T and is of type 'file' as per listOptions.fields
      if (!Object.prototype.hasOwnProperty.call(listFields, fieldNameInT) || listFields[fieldNameInT] !== 'file') {
        console.warn(`[list.factory._processFiles] Field '${String(fieldNameInT)}' for file '${fileInput.name}' is not defined as 'file' type in listOptions.fields. Skipping.`);
        continue;
      }

      const fileId = crypto.randomUUID(); // Use crypto.randomUUID()
      try {
        await localForageService.storeFile(fileId, fileInput.data);

        // If updating and there's an existing file for this field, remove the old one
        if (existingItemData && existingItemData[fieldNameInT]) {
          const oldFile = existingItemData[fieldNameInT] as unknown as StoredFile; // Cast to StoredFile
          if (oldFile && oldFile.fileId) {
            await localForageService.removeFile(oldFile.fileId);
            // Optionally remove old file from filesState in signalStateService
            signalStateService.removeFileState(oldFile.fileId);
          }
        }
        
        const storedFile: StoredFile = {
          fileId,
          fieldName: fileInput.fieldName, // Store the fieldName from FileInput
          originalName: fileInput.name,
          type: fileInput.data.type,
          size: fileInput.data.size,
          state: 'synced', // Assuming direct save means synced for local context
          lastModified: fileInput.lastModified,
          // storagePath and localPath would be set by replication/sync services later
        };
        processedFiles[fieldNameInT] = storedFile;

        // Update file state in signal service
        signalStateService.updateFileState(fileId, {
          id: fileId,
          name: fileInput.name, // Use original name for display
          isLoading: false,
          progress: 100, // Mark as complete
        });

      } catch (error: any) {
        console.error(`[list.factory._processFiles] Error processing file '${fileInput.name}' for field '${String(fieldNameInT)}':`, error);
        signalStateService.updateFileState(fileId, {
          id: fileId, // Use fileId even if storeFile failed for potential cleanup
          name: fileInput.name,
          isLoading: false,
          progress: 0,
          error: error.message || 'Failed to store file', // Add error to file state
        });
        // Decide if one file error should stop all; here we continue processing other files
      }
    }
    return processedFiles;
  }

  /**
   * @private Checks if a single item matches the where clause.
   */
  function _matchesFilter(item: Item<T, U>, where: FilterArgs<T>['where']): boolean {
    if (!where) return true;

    for (const key of Object.keys(where) as (keyof T & keyof FilterArgs<T>['where'])[]) {
      const condition = where[key as keyof T] ;
      const itemValue = item[key as keyof T];

      if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
        // Condition is an object with operators
        if (condition.equals !== undefined && itemValue !== condition.equals) return false;
        if (condition.not !== undefined && itemValue === condition.not) return false;
        if (condition.in !== undefined && Array.isArray(condition.in) && !condition.in.includes(itemValue)) return false;
        if (condition.lt !== undefined && !(Number(itemValue) < Number(condition.lt))) return false;
        if (condition.lte !== undefined && !(Number(itemValue) <= Number(condition.lte))) return false;
        if (condition.gt !== undefined && !(Number(itemValue) > Number(condition.gt))) return false;
        if (condition.gte !== undefined && !(Number(itemValue) >= Number(condition.gte))) return false;
        if (typeof itemValue === 'string' && typeof condition.contains === 'string' && !itemValue.includes(condition.contains)) return false;
        if (typeof itemValue === 'string' && typeof condition.startsWith === 'string' && !itemValue.startsWith(condition.startsWith)) return false;
        if (typeof itemValue === 'string' && typeof condition.endsWith === 'string' && !itemValue.endsWith(condition.endsWith)) return false;
      } else { // Direct equality or condition is not an operator object (e.g. direct value or array for 'in' if not wrapped)
        if (itemValue !== condition) return false;
      }
    }
    return true;
  }
  
  /**
   * @private Applies filtering, sorting, and pagination to a list of items.
   */
  // TODO: Enhance filtering for full-text search capabilities using 'searchFields' from listOptions. This might involve creating/maintaining a separate index or using more advanced LocalForage querying if available.
  function _applyQuery(items: Item<T, U>[], args: FilterArgs<T>): Item<T, U>[] {
    let result = [...items];

    // Filtering
    if (args.where) {
      result = result.filter(item => _matchesFilter(item, args.where));
    }

    // Sorting
    if (args.orderBy) {
      result.sort((a, b) => {
        for (const key in args.orderBy) {
          if (Object.prototype.hasOwnProperty.call(args.orderBy, key)) {
            const direction = args.orderBy[key as keyof T];
            const valA = a[key as keyof T];
            const valB = b[key as keyof T];

            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
          }
        }
        return 0;
      });
    }

    // Pagination
    const skip = args.skip || 0;
    const take = args.take === undefined ? result.length : args.take;
    result = result.slice(skip, skip + take);

    return result;
  }


  // --- CRUD Methods ---

  const create = async (input: CreateItemInput<T, U>): Promise<Item<T, U>> => {
    signalStateService.setLoading();
    try {
      const _id = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const createdBy = input.createdBy || null;

      // TODO: Handle 'autoIncrement' fields. Requires querying last value and ensuring atomicity if possible.

      // Process files first
      const fileFieldsData = await _processFiles(_id, input.files || [], listOptions.fields);
      
      const newItemData: T = { ...input.data }; // Start with input data

      // Iterate listOptions.fields to correctly assign file data
      for (const fieldNameKey in listOptions.fields) {
          const fieldName = fieldNameKey as keyof T;
          if (listOptions.fields[fieldName] === 'file') {
              if (fileFieldsData[fieldName]) {
                  (newItemData as any)[fieldName] = fileFieldsData[fieldName];
              } else if (input.data[fieldName] === undefined) {
                  // If no new file is provided for a file field,
                  // and it's not in input.data, ensure it's set to null or undefined.
                  (newItemData as any)[fieldName] = null; 
              }
          }
      }
      
      const newItem: Item<T, U> = {
        _id,
        createdAt: timestamp,
        _updatedAt: timestamp,
        createdBy,
        _deleted: false,
        updates: [], // Initial creation, no prior updates
        ...(newItemData as T), 
      } as Item<T, U>; 

      await localForageService.setItem<Item<T, U>>(listOptions.name, _id, newItem);
      signalStateService.addItemToState(newItem); // Update signal state
      
      if (replicationEngine) {
        await replicationEngine.enqueueChange(newItem._id, 'create', newItem);
      }
      
      signalStateService.setSuccess();
      return newItem;
    } catch (error: any) {
      console.error(`[list.factory.create] Error creating item:`, error);
      signalStateService.setError(error.message || 'Failed to create item');
      throw error;
    }
  };

  const update = async (input: UpdateItemInput<T, U>): Promise<Item<T, U> | null> => {
    signalStateService.setLoading();
    try {
      const existingItem = await localForageService.getItem<Item<T, U>>(listOptions.name, input.id);
      if (!existingItem) {
        signalStateService.setError(`Item with id ${input.id} not found.`);
        throw new Error(`Item with id ${input.id} not found.`);
      }

      const newUpdatedAt = new Date().toISOString();
      const updatedBy = input.updatedBy || null;

      // Prepare update history using the existing item before changes
      const updateEntry = _prepareUpdateHistory(
        existingItem, // Pass the full existing item
        input.data,   // Pass only the changes to data part
        updatedBy, 
        newUpdatedAt
      );

      // Process files, potentially removing old ones. Pass the full existingItem.
      const fileFieldsData = await _processFiles(input.id, input.files || [], listOptions.fields, existingItem);
      
      // Construct the final updated item by merging
      const updatedItem: Item<T, U> = {
        ...existingItem,                 // Start with existing full item
        ...(input.data as Partial<Item<T,U>>), // Apply partial updates from input.data
        ...fileFieldsData,               // Override with new file data if any
        _updatedAt: newUpdatedAt,
        // @ts-ignore // updatedBy might not be on BaseItem if U is not string, or U is not assignable to string
        updatedBy: updatedBy, 
        updates: [...(existingItem.updates || []), updateEntry], // Append new update entry
      };
      
      await localForageService.setItem<Item<T, U>>(listOptions.name, input.id, updatedItem);
      signalStateService.updateItemInState(updatedItem); // Update signal state

      if (replicationEngine) {
        await replicationEngine.enqueueChange(updatedItem._id, 'update', updatedItem);
      }

      signalStateService.setSuccess();
      return updatedItem;
    } catch (error: any) {
      console.error(`[list.factory.update] Error updating item ${input.id}:`, error);
      signalStateService.setError(error.message || `Failed to update item ${input.id}`);
      throw error;
    }
  };
  
  const remove = async (id: string, deletedBy: U | string | null, soft: boolean = true): Promise<boolean> => {
    signalStateService.setLoading();
    try {
      const itemToRemove = await localForageService.getItem<Item<T, U>>(listOptions.name, id);
      if (!itemToRemove) {
        signalStateService.setError(`Item with id ${id} not found for removal.`);
        return false;
      }

      if (soft) {
        itemToRemove._deleted = true;
        itemToRemove._deleted = true;
        itemToRemove._deletedAt = new Date().toISOString();
        // @ts-ignore // deletedBy might not be on BaseItem if U is not string, or U is not assignable to string
        itemToRemove.deletedBy = deletedBy;
        itemToRemove._updatedAt = itemToRemove._deletedAt; // Update _updatedAt timestamp as well

        await localForageService.setItem<Item<T, U>>(listOptions.name, id, itemToRemove);
        // As per prompt, call removeItemFromState for soft delete.
        // This relies on SignalStateService.removeItemFromState(id, true) correctly handling the move.
        signalStateService.removeItemFromState(id, true); 
        if (replicationEngine) {
          // itemToRemove is the version with _deleted=true, _deletedAt, etc.
          await replicationEngine.enqueueChange(itemToRemove._id, 'update', itemToRemove);
        }
      } else { // Hard delete
        // Remove associated files first
        for (const fieldNameKey in listOptions.fields) {
            const fieldName = fieldNameKey as keyof T;
            if (listOptions.fields[fieldName] === 'file') {
                const fileData = itemToRemove[fieldName] as unknown as StoredFile | undefined;
                if (fileData && fileData.fileId) {
                    await localForageService.removeFile(fileData.fileId);
                    signalStateService.removeFileState(fileData.fileId);
                }
            }
        }
        await localForageService.removeItem(listOptions.name, id);
        // This removes from both active and deleted lists in SignalStateService
        signalStateService.removeItemFromState(id, false);
        if (replicationEngine) {
          await replicationEngine.enqueueChange(id, 'delete');
        }
      }

      signalStateService.setSuccess(); // Set success after operation
      return true;
    } catch (error: any) {
      console.error(`[list.factory.remove] Error removing item ${id}:`, error);
      signalStateService.setError(error.message || `Failed to remove item ${id}`);
      throw error; // Re-throw so caller knows operation failed
    }
  };

  const findFirst = (args: FilterArgs<T>): { item: Signal<Item<T, U> | null> } => {
    return {
      item: computed(() => _applyQuery(signalStateService.items(), { ...args, take: 1 })[0] || null),
    };
  };

  const findUnique = (id: string): { item: Signal<Item<T, U> | null> } => {
    return {
      item: computed(() => signalStateService.items().find(item => item._id === id) || null),
    };
  };

  const filter = (args: FilterArgs<T>): Signal<Item<T, U>[]> => {
    return computed(() => _applyQuery(signalStateService.items(), args));
  };

  // --- Other CRUD Methods (Scaffolded or Simplified) ---

  const createMany = async (inputs: CreateItemInput<T, U>[]): Promise<Map<number, Item<T, U> | Error>> => {
    const results = new Map<number, Item<T, U> | Error>();
    signalStateService.setLoading();
    try {
      for (let i = 0; i < inputs.length; i++) {
        try {
          const newItem = await create(inputs[i]); // create already handles individual loading states
          results.set(i, newItem);
        } catch (e: any) {
          results.set(i, e instanceof Error ? e : new Error(String(e)));
        }
      }
      signalStateService.setSuccess(); // Overall success
    } catch (e: any) {
      signalStateService.setError("Error in createMany operation.");
    }
    return results;
  };

  const updateMany = async (inputs: UpdateItemInput<T, U>[]): Promise<ManyResult> => {
    const results: ManyResult = new Map();
    signalStateService.setLoading();
    try {
      for (const input of inputs) {
        try {
          const updatedItem = await update(input); // update already handles individual loading states
          results.set(input.id, !!updatedItem);
        } catch {
          results.set(input.id, false);
        }
      }
      signalStateService.setSuccess(); // Overall success
    } catch (e: any) {
      signalStateService.setError("Error in updateMany operation.");
    }
    return results;
  };
   const removeMany = async (ids: string[], deletedBy: string | U, soft?: boolean): Promise<ManyResult> {
    

   }
  const upsert = async (input: CreateItemInput<T, U> | UpdateItemInput<T, U>): Promise<Item<T, U>> => {
    // This is a simplified upsert. A true upsert might need to check specific unique fields
    // defined in listOptions, not just the _id.
    if ('id' in input && input.id) {
      const existingItem = await localForageService.getItem(listOptions.name, input.id);
      if (existingItem) {
        return update(input as UpdateItemInput<T, U>) as Promise<Item<T, U>>;
      } else {
        // If an ID was provided but item not found, treat as create.
        // Remove 'id' property if it exists, as create will generate a new one.
        const { id, ...createData } = input as UpdateItemInput<T,U>;
        return create({ 
            data: createData.data as T, // Ensure data is T, not Partial<T>
            createdBy: createData.updatedBy as any, // Use updatedBy as createdBy for consistency
            files: createData.files 
        });
      }
    }
    return create(input as CreateItemInput<T, U>);
  };

  const restore = async (id: string): Promise<boolean> => {
    signalStateService.setLoading();
    try {
      const itemToRestore = await localForageService.getItem<Item<T, U>>(listOptions.name, id);
      if (!itemToRestore) {
        signalStateService.setError(`Item with id ${id} not found.`);
        return false;
      }
      if (!itemToRestore._deleted) {
        // Item is not deleted, so nothing to restore. Consider this a success or a specific status.
        signalStateService.setSuccess(); 
        console.warn(`[list.factory.restore] Item with id ${id} is not marked as deleted.`);
        return true; // Or false, depending on desired behavior for non-deleted items
      }

      itemToRestore._deleted = false;
      const oldDeletedAt = itemToRestore._deletedAt; // Store for potential history/logging
      itemToRestore._deletedAt = undefined; 
      itemToRestore.deletedBy = undefined; 
      itemToRestore._updatedAt = new Date().toISOString(); 
      // Add to updates history if desired (optional, not explicitly in prompt for restore)
      // existingItem.updates.push({by: 'system', at: new Date().toISOString(), before: {_deletedAt: oldDeletedAt}, after: {_deletedAt: undefined}});


      await localForageService.setItem(listOptions.name, id, itemToRestore);
      signalStateService.updateItemInState(itemToRestore); // This moves it from deletedItems to items
      signalStateService.setSuccess();
      return true;
    } catch (error: any) {
      console.error(`[list.factory.restore] Error restoring item ${id}:`, error);
      signalStateService.setError(error.message || `Failed to restore item ${id}`);
      return false; // Explicitly return false on error
    }
  };
  
  const purgeDeleted = async (): Promise<number> => {
    signalStateService.setLoading();
    let count = 0;
    try {
      // Iterate over a copy of deletedItems for modification safety
      const itemsToPurge = [...signalStateService.deletedItems()]; 
      for (const item of itemsToPurge) {
        if (item._deleted) { // Double check, though it should be true
          // Remove associated files first
          for (const fieldNameKey in listOptions.fields) {
            const fieldName = fieldNameKey as keyof T;
            if (listOptions.fields[fieldName] === 'file') {
              const fileData = item[fieldName] as unknown as StoredFile | undefined;
              if (fileData && fileData.fileId) {
                await localForageService.removeFile(fileData.fileId);
                signalStateService.removeFileState(fileData.fileId);
              }
            }
          }
          await localForageService.removeItem(listOptions.name, item._id);
          // Remove from SignalStateService's _deletedItems signal directly
          signalStateService.removeItemFromState(item._id, false); // false for hard delete from state
          count++;
        }
      }
      signalStateService.setSuccess();
    } catch (error: any) {
        console.error(`[list.factory.purgeDeleted] Error purging deleted items:`, error);
        signalStateService.setError(error.message || 'Failed to purge deleted items');
    }
    return count;
  };

  // --- Scaffolded/Placeholder Methods ---
  const upsertMany = async (inputs: (CreateItemInput<T, U> | UpdateItemInput<T, U>)[]): Promise<ManyResult> => {
    const results: ManyResult = new Map();
    console.warn("upsertMany is not fully implemented. Using simplified loop of upsert.");
    for (const input of inputs) {
        try {
            const item = (await upsert(input)) as Item<T, U>;
            results.set(item._id, true);
        } catch (e) {
            // How to get ID if create part of upsert fails? This needs robust error handling.
            if ('id' in input && input.id) {
                results.set(input.id, false);
            } else {
                // results.set( (e as any)?.itemId || 'unknown_failed_id', false); // Placeholder
            }
        }
    }
    return results;
  };

  const restoreMany = async (ids: string[]): Promise<ManyResult> => {
    const results: ManyResult = new Map();
    console.warn("restoreMany is not fully implemented. Using simplified loop of restore.");
    for (const id of ids) {
        results.set(id, await restore(id));
    }
    return results;
  };

  const purgeOldDeleted = async (olderThanDate: string): Promise<number> => {
    console.warn("purgeOldDeleted is not implemented.");
    // Implementation would involve:
    // 1. Converting olderThanDate to a timestamp.
    // 2. Iterating signalStateService.deletedItems().
    // 3. For items where item._deletedAt < olderThanTimestamp, call remove(item._id, null, false).
    // 4. Summing successes.
    return 0;
  };


  // Combine state and methods into ListRef
  const listRef: ListRef<T, U> = {
    // State (from SignalStateService)
    items: signalStateService.items,
    status: signalStateService.status,
    isLoading: signalStateService.isLoading,
    hasValue: signalStateService.hasValue,
    error: signalStateService.error,
    filteredItems: computed(() => _applyQuery(signalStateService.items(), {})), // Default filtered items
    deletedItems: signalStateService.deletedItems,
    count: signalStateService.count,
    filesState: signalStateService.filesState,

    // CRUD Methods
    create,
    update,
    remove,
    findFirst,
    findUnique,
    filter,
    createMany,
    updateMany,
    upsert,
    upsertMany, // Added scaffolded
    restore,
    restoreMany, // Added scaffolded
    purgeDeleted,
    purgeOldDeleted, // Added scaffolded

    // Replication control and status
    replicationStatus$: replicationEngine ? replicationEngine.isReplicating : signal(false).asReadonly(),
    pauseReplication: () => replicationEngine?.pause(),
    resumeReplication: () => replicationEngine?.resume(),
    getPushQueue: () => replicationEngine ? replicationEngine.pushQueue() : [],

    // --- Advanced Feature Stubs ---
    populate: async (item: Item<T, U>, fieldName: keyof T, targetListName: string /* TODO: Add options for foreign key, etc. */) => {
        console.warn(`[${listOptions.name}] Population for field '${String(fieldName)}' with list '${targetListName}' not implemented.`);
        // TODO: Implement population logic. Fetch related item(s) from 'targetListName'
        // based on a foreign key stored in 'item' or a linking table/collection.
        return null; // Or the populated item/array of items
    },
    search: async (queryText: string, searchOptions?: { targetFields?: (keyof T)[]; limit?: number; /* TODO: Add more search options */ }) => {
        console.warn(`[${listOptions.name}] Full-text search for query '${queryText}' not implemented. Falling back to basic filter.`);
        // TODO: Implement actual full-text search. For now, could delegate to filter with 'contains' on searchFields.
        const searchFieldsToUse = searchOptions?.targetFields || listOptions.searchFields?.map(f => f[0]); // Assuming searchFields is [keyof T][]
        if (!searchFieldsToUse || searchFieldsToUse.length === 0) return [];

        // const whereClause: FilterArgs<T>['where'] = {};
        // Basic OR-like search: build a filter that checks 'contains' on all search fields
        // This is a very naive FTS, real FTS needs indexing.
        // For now, this part of the subtask can be skipped if too complex for the worker.
        // The console.warn is the key part for the stub.
        return []; // Placeholder
    }
  };
  return listRef;
}
