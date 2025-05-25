// In ListCRUDImpl.ts
import {
  Item, CreateItemInput, UpdateItemInput, ListOptions,
  UpdatesLogs, FieldType // Keep FieldType if _handleFileOutput or other logic needs it
} from '../models/list.model';
import { FileInput, FileRead } from '../models/file.model'; // Keep for _handleFileOutput
// import { LocalForageAdapter } from './LocalForageAdapter'; // REMOVE
import { FilesAdapter } from './FilesAdapter';
// import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts'; // REMOVE if only for LF full item encryption
import { IndexedDBManager } from '../utils/IndexedDBManager.ts';
import { LoggerService } from '../utils/Logger.ts';

export class ListCRUDImpl<T extends Record<string, any>> {
  // private localForageStoreName: string; // REMOVE
  private indexedDBStoreName: string; 

  constructor(
    private listOptions: Readonly<ListOptions<T>>,
    // private localForageAdapter: LocalForageAdapter, // REMOVE
    private filesAdapter: FilesAdapter, // Keep for file field handling
    private indexedDBManager: IndexedDBManager,
    private logger: LoggerService
    // private encryptedStorageService?: EncryptedStorageService // REMOVE
  ) {
    // this.localForageStoreName = `list_${listOptions.name}`; // REMOVE
    this.indexedDBStoreName = `list_${listOptions.name}`; 
    this.logger.info(`ListCRUDImpl for IDB store '${this.indexedDBStoreName}' initialized.`);
  }

  private generateId(): string { return crypto.randomUUID(); }

  // REMOVE _encrypt, _decrypt, _serializeAndEncrypt, _deserializeAndDecrypt methods
  // if their sole purpose was full item encryption for LocalForage.

  private async _handleFileOutput(itemData: T, filesInput?: { [K in keyof T]?: FileInput }): Promise<Partial<T>> {
    if (!filesInput) return {};
    const fileHandlingResults: Partial<T> = {};
    for (const fieldKey in filesInput) {
        const fileInputField = filesInput[fieldKey as keyof T];
        // Ensure fieldKey is a valid key of T for listOptions.fields access
        if (fileInputField && Object.prototype.hasOwnProperty.call(this.listOptions.fields, fieldKey) && this.listOptions.fields[fieldKey as keyof T] === 'file') {
            const fileMeta = await this.filesAdapter.addFile(fileInputField);
            (fileHandlingResults as any)[fieldKey] = fileMeta.id;
        }
    }
    return fileHandlingResults;
  }

  async createItem(itemInput: CreateItemInput<T>): Promise<Item<T>> {
    const id = this.generateId();
    const now = new Date().toISOString();
    const fileData = await this._handleFileOutput(itemInput.data, itemInput.files as { [K in keyof T]?: FileInput });

    const newItem: Item<T> = {
      ...itemInput.data,
      ...fileData,
      _id: id, createdAt: now, createdBy: itemInput.createdBy || 'system',
      _updatedAt: now, updatesLogs: [], _deleted: false,
    } as Item<T>;

    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...newItem });
      this.logger.debug(`[ListCRUDImpl] Item ${id} successfully PUT into IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to PUT item ${id} into IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError; // Re-throw to allow ListImpl to catch and set error state
    }
    
    return newItem;
  }

  async readItem(id: string): Promise<Item<T> | undefined> {
    try {
      const item = await this.indexedDBManager.getItem<Item<T>>(this.indexedDBStoreName, id);
      this.logger.debug(`[ListCRUDImpl] Item ${id} read from IDB store ${this.indexedDBStoreName}. Found: ${!!item}`);
      return item;
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to GET item ${id} from IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError;
    }
  }

  async updateItem(itemUpdate: UpdateItemInput<T>): Promise<Item<T>> {
    const currentItem = await this.readItem(itemUpdate.id);
    if (!currentItem) throw new Error(`Item with id ${itemUpdate.id} not found for update.`);

    const fileData = await this._handleFileOutput(itemUpdate.data as T, itemUpdate.files as { [K in keyof T]?: FileInput });
    const updatedItemData: Partial<T> = { ...itemUpdate.data, ...fileData };
    
    const updatedItem: Item<T> = { 
      ...currentItem, 
      ...updatedItemData, 
      _updatedAt: new Date().toISOString() 
    };
    updatedItem.updatesLogs = [...(currentItem.updatesLogs || []), {
        at: updatedItem._updatedAt, by: itemUpdate.updatedBy || 'system',
        before: { /* selective diff */ } as Partial<T>, after: { /* selective diff */ } as Partial<T>
    }];

    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...updatedItem });
      this.logger.debug(`[ListCRUDImpl] Item ${updatedItem._id} successfully UPDATED in IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to UPDATE item ${updatedItem._id} in IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError;
    }
    return updatedItem;
  }

  async deleteItem(id: string, userId?: string): Promise<Item<T>> { // Soft delete
    const item = await this.readItem(id);
    if (!item) throw new Error(`Item with id ${id} not found for soft deletion.`);

    item._deleted = true;
    item._deletedAt = new Date().toISOString();
    item.deletedBy = userId || 'system';
    item._updatedAt = item._deletedAt;
    item.updatesLogs = [...(item.updatesLogs || []), {
        at: item._updatedAt, by: userId || 'system', 
        before: { _deleted: false } as Partial<T>, after: { _deleted: true } as Partial<T>
    }];

    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...item }); // Update in IDB with _deleted flag
      this.logger.debug(`[ListCRUDImpl] Item ${id} (soft deleted) successfully UPDATED in IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to UPDATE soft-deleted item ${id} in IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError;
    }
    return item;
  }

  async restoreItem(id: string, userId?: string): Promise<Item<T>> {
    const item = await this.readItem(id);
    if (!item) throw new Error(`Item with id ${id} not found for restoration.`);
    if (!item._deleted) throw new Error(`Item with id ${id} is not deleted.`); // Stricter handling

    const updateLog: UpdatesLogs<T> = { 
        at: new Date().toISOString(), by: userId || 'system',
        before: { _deleted: item._deleted, _deletedAt: item._deletedAt, deletedBy: item.deletedBy } as Partial<T>,
        after: { _deleted: false, _deletedAt: undefined, deletedBy: undefined } as Partial<T>
    };
    item._deleted = false; delete item._deletedAt; delete item.deletedBy;
    item._updatedAt = updateLog.at; item.updatesLogs = [...(item.updatesLogs || []), updateLog];

    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...item }); // Update in IDB
      this.logger.debug(`[ListCRUDImpl] Item ${id} (restored) successfully UPDATED in IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to UPDATE restored item ${id} in IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError;
    }
    return item;
  }

  async purgeDeletedItem(id: string): Promise<void> {
    const item = await this.readItem(id); // Read from IDB to get file info
    
    // Delete from IndexedDB first
    try {
      await this.indexedDBManager.deleteItem(this.indexedDBStoreName, id);
      this.logger.debug(`[ListCRUDImpl] Item ${id} successfully DELETED from IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to DELETE item ${id} from IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError; // If IDB delete fails, perhaps don't proceed with file deletion? Or make it more resilient.
    }

    // Then, delete associated files (if any)
    if (item) { // Item data was successfully read before deletion attempt from IDB
        for (const fieldKey in this.listOptions.fields) {
            if (Object.prototype.hasOwnProperty.call(this.listOptions.fields, fieldKey) && this.listOptions.fields[fieldKey as keyof T] === 'file') {
                const fileId = item[fieldKey as keyof T] as unknown as string;
                if (fileId && typeof fileId === 'string') {
                    try { 
                        await this.filesAdapter.deleteFile(fileId); // This deletes from FilesAdapter's metadata store (IDB soon) and blob store (LocalForage now, OPFS later)
                        this.logger.debug(`[ListCRUDImpl] Associated file ${fileId} for item ${id} deleted via FilesAdapter.`);
                    } 
                    catch (e) { this.logger.warn(`[ListCRUDImpl] Failed to delete associated file ${fileId} for item ${id}:`, e); }
                }
            }
        }
    }
    this.logger.info(`[ListCRUDImpl] Item ${id} purged from IDB. Associated file cleanup attempted.`);
  }
  
  async getAllItems(): Promise<Item<T>[]> {
    try {
      const items = await this.indexedDBManager.getAllItems<Item<T>>(this.indexedDBStoreName);
      this.logger.debug(`[ListCRUDImpl] Successfully fetched ${items.length} items from IDB store ${this.indexedDBStoreName} for getAllItems.`);
      return items;
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to GET ALL items from IDB store ${this.indexedDBStoreName}:`, idbError);
      throw idbError;
    }
  }
}
