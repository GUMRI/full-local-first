import {
  Item, CreateItemInput, UpdateItemInput, ListOptions,
  BaseItem, UpdatesLogs, FieldType // FieldType might not be directly used here but good for context
} from '../models/list.model';
import { FileInput, FileRead } from '../models/file.model';
import { LocalForageAdapter } from '../adapters/LocalForageAdapter';
import { FilesAdapter } from '../adapters/FilesAdapter';
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts';

export class ListCRUDImpl<T extends Record<string, any>> {
  private localForageStoreName: string;
  // private encryptionKey?: CryptoKey; // Not storing key here, EncryptedStorageService handles it.

  constructor(
    private listOptions: Readonly<ListOptions<T>>,
    private localForageAdapter: LocalForageAdapter,
    private filesAdapter: FilesAdapter,
    private encryptedStorageService?: EncryptedStorageService // Optional service
  ) {
    this.localForageStoreName = `list_${listOptions.name}`;
    console.log(`ListCRUDImpl for ${this.localForageStoreName} initialized. Encryption enabled potential: ${!!this.listOptions.replication?.firestore && !!this.encryptedStorageService?.isKeySet()}`);
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private async _encrypt(data: string): Promise<string> {
    if (!this.encryptedStorageService || !this.encryptedStorageService.isKeySet()) {
      return data; 
    }
    try {
      const { iv, encryptedData } = await this.encryptedStorageService.encrypt(data);
      const ivString = btoa(String.fromCharCode(...iv));
      const encryptedString = btoa(String.fromCharCode(...new Uint8Array(encryptedData)));
      return `${ivString}:${encryptedString}`;
    } catch (e) {
      console.error(`[${this.localForageStoreName}] Encryption failed:`, e);
      throw e; 
    }
  }

  private async _decrypt(data: string): Promise<string> {
    if (!this.encryptedStorageService || !this.encryptedStorageService.isKeySet() || !data.includes(':')) {
      return data; 
    }
    try {
      const [ivString, encryptedString] = data.split(':', 2); // Ensure splitting only once
      if (!ivString || !encryptedString) return data; 

      const iv = new Uint8Array(atob(ivString).split('').map(char => char.charCodeAt(0)));
      const encryptedDataBuffer = new Uint8Array(atob(encryptedString).split('').map(char => char.charCodeAt(0))).buffer;
      
      return await this.encryptedStorageService.decrypt(encryptedDataBuffer, iv);
    } catch (e) {
      console.warn(`[${this.localForageStoreName}] Decryption failed, returning raw data (it might not have been encrypted or key changed):`, e);
      return data; 
    }
  }

  private async _serializeAndEncrypt(item: Item<T>): Promise<string | Item<T>> {
    // Condition for encryption: if firestore replication is configured and encryption service + key are available
    if (this.listOptions.replication?.firestore && this.encryptedStorageService?.isKeySet()) {
        return this._encrypt(JSON.stringify(item));
    }
    return item; // Store as object if no encryption
  }

  private async _deserializeAndDecrypt(data: string | Item<T>): Promise<Item<T>> {
    if (typeof data === 'string') {
        const decryptedString = await this._decrypt(data);
        try {
            return JSON.parse(decryptedString) as Item<T>;
        } catch (e) {
            console.error(`[${this.localForageStoreName}] Failed to parse decrypted string: ${decryptedString.substring(0,100)}...`, e);
            throw new Error('Failed to parse decrypted item data.');
        }
    }
    return data; // Already an object
  }
  
  private async _handleFileOutput(
    itemData: Partial<T>, // Input data that might contain fields to be updated with file IDs
    filesInput?: { [K in keyof T]?: FileInput }
  ): Promise<Partial<T>> { // Returns a partial T with only the file fields updated with IDs
    if (!filesInput) return {};
    
    const fileHandlingResults: Partial<T> = {};

    for (const fieldKey in filesInput) {
        // Ensure fieldKey is a key of T and listOptions.fields
        if (!Object.prototype.hasOwnProperty.call(filesInput, fieldKey) || !this.listOptions.fields[fieldKey as keyof T]) {
            continue;
        }

        const fileInputField = filesInput[fieldKey as keyof T];
        if (fileInputField && this.listOptions.fields[fieldKey as keyof T] === 'file') {
            try {
                const fileMeta = await this.filesAdapter.addFile(fileInputField);
                (fileHandlingResults as any)[fieldKey] = fileMeta.id; // Store file ID
            } catch (e) {
                console.error(`[${this.localForageStoreName}] Error adding file for field ${String(fieldKey)}:`, e);
                // Decide how to handle: throw, skip, or set field to an error state/null
            }
        }
    }
    return fileHandlingResults;
  }

  async createItem(itemInput: CreateItemInput<T>): Promise<Item<T>> {
    const id = this.generateId();
    const now = new Date().toISOString();

    // Process files and get fields updated with file IDs
    const fileDataFields = await this._handleFileOutput(itemInput.data, itemInput.files as { [K in keyof T]?: FileInput });

    const newItemData: T = {
        ...itemInput.data,
        ...fileDataFields // Overwrite/set file fields with their IDs
    };

    const newItem: Item<T> = {
      ...newItemData, // This is now the complete data part of T
      _id: id,
      createdAt: now,
      createdBy: itemInput.createdBy || 'system',
      _updatedAt: now,
      updatesLogs: [],
      _deleted: false,
    } as Item<T>; // Cast ensures BaseItem properties are correctly overlaid

    const storableItem = await this._serializeAndEncrypt(newItem);
    await this.localForageAdapter.set(id, storableItem, this.localForageStoreName);
    return newItem;
  }

  async readItem(id: string): Promise<Item<T> | undefined> {
    const data = await this.localForageAdapter.get<string | Item<T>>(id, this.localForageStoreName);
    if (data === null || data === undefined) return undefined; // localforage.get returns null for not found
    return this._deserializeAndDecrypt(data);
  }

  async updateItem(itemUpdate: UpdateItemInput<T>): Promise<Item<T>> {
    const currentItem = await this.readItem(itemUpdate.id);
    if (!currentItem) {
      throw new Error(`[${this.localForageStoreName}] Item with id ${itemUpdate.id} not found.`);
    }

    const fileDataFields = await this._handleFileOutput(itemUpdate.data, itemUpdate.files as { [K in keyof T]?: FileInput });

    const updatedItemData: Partial<T> = { 
        ...itemUpdate.data, 
        ...fileDataFields 
    };
    
    const updatedItem: Item<T> = {
      ...currentItem,
      ...(updatedItemData as T), // Apply partial updates to the full item
      _updatedAt: new Date().toISOString(),
    };

    const logEntry: UpdatesLogs<T> = {
        at: updatedItem._updatedAt,
        by: itemUpdate.updatedBy || 'system',
        before: {} as Partial<T>, // Simplified: Populate with actual changed fields
        after: {} as Partial<T>   // Simplified: Populate with actual changed fields
    };
    // Example for detailed logging (complex and needs a diff utility)
    // Object.keys(updatedItemData).forEach(key => {
    //   if (currentItem[key as keyof T] !== updatedItem[key as keyof T]) {
    //     (logEntry.before as any)[key] = currentItem[key as keyof T];
    //     (logEntry.after as any)[key] = updatedItem[key as keyof T];
    //   }
    // });
    updatedItem.updatesLogs = [...(currentItem.updatesLogs || []), logEntry];

    const storableItem = await this._serializeAndEncrypt(updatedItem);
    await this.localForageAdapter.set(itemUpdate.id, storableItem, this.localForageStoreName);
    return updatedItem;
  }

  async deleteItem(id: string, userId?: string): Promise<Item<T>> {
    const item = await this.readItem(id);
    if (!item) throw new Error(`[${this.localForageStoreName}] Item with id ${id} not found for deletion.`);

    item._deleted = true;
    item._deletedAt = new Date().toISOString();
    item.deletedBy = userId || 'system';
    item._updatedAt = item._deletedAt;
    
    const logEntry: UpdatesLogs<T> = {
        at: item._updatedAt, by: userId || 'system', 
        before: { _deleted: false } as Partial<T>, 
        after: { _deleted: true } as Partial<T>
    };
    item.updatesLogs = [...(item.updatesLogs || []), logEntry];

    const storableItem = await this._serializeAndEncrypt(item);
    await this.localForageAdapter.set(id, storableItem, this.localForageStoreName);
    return item;
  }

  async restoreItem(id: string, userId?: string): Promise<Item<T>> {
    const item = await this.readItem(id);
    if (!item) throw new Error(`[${this.localForageStoreName}] Item with id ${id} not found for restoration.`);
    if (!item._deleted) {
        console.warn(`[${this.localForageStoreName}] Item with id ${id} is not deleted. Restoration aborted.`);
        return item; // Or throw error, depending on desired strictness
    }

    const updateLog: UpdatesLogs<T> = {
        at: new Date().toISOString(),
        by: userId || 'system',
        before: { _deleted: item._deleted, _deletedAt: item._deletedAt, deletedBy: item.deletedBy } as Partial<T>,
        after: { _deleted: false, _deletedAt: undefined, deletedBy: undefined } as Partial<T>
    };

    item._deleted = false;
    delete item._deletedAt; // Or set to undefined
    delete item.deletedBy;  // Or set to undefined
    item._updatedAt = updateLog.at;
    item.updatesLogs = [...(item.updatesLogs || []), updateLog];

    const storableItem = await this._serializeAndEncrypt(item);
    await this.localForageAdapter.set(id, storableItem, this.localForageStoreName);
    return item;
  }

  async purgeDeletedItem(id: string): Promise<void> {
    const item = await this.readItem(id); // Read first to get file details

    if (item) { 
        for (const fieldKey in this.listOptions.fields) {
            if (this.listOptions.fields[fieldKey as keyof T] === 'file') {
                const fileId = item[fieldKey as keyof T] as unknown as string;
                if (fileId && typeof fileId === 'string') {
                    try {
                        await this.filesAdapter.deleteFile(fileId);
                        console.log(`[${this.localForageStoreName}] Deleted associated file ${fileId} for item ${id}.`);
                    } catch (e) {
                        console.warn(`[${this.localForageStoreName}] Failed to delete file ${fileId} for item ${id}:`, e);
                    }
                }
            }
        }
    } else {
        console.warn(`[${this.localForageStoreName}] Item ${id} not found during purge. It might have been already purged or ID is incorrect.`);
    }
    
    await this.localForageAdapter.remove(id, this.localForageStoreName);
    console.log(`[${this.localForageStoreName}] Item ${id} purged from local store.`);
  }
  
  async getAllItems(): Promise<Item<T>[]> {
    const allItems: Item<T>[] = [];
    const keys = await this.localForageAdapter.keys(this.localForageStoreName);
    for (const key of keys) {
        // Avoid reading items that might be just metadata or unrelated if store isn't exclusively for these items
        if (typeof key === 'string') { // Basic check, UUIDs are strings
             const item = await this.readItem(key);
             if (item) {
                 allItems.push(item);
             }
        }
    }
    return allItems;
  }
}
