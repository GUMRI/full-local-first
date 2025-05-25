import {
  Item, CreateItemInput, UpdateItemInput, ListOptions,
  BaseItem, UpdatesLogs, FieldType // FieldType might not be directly used here but good for context
} from '../models/list.model';
import { FileInput, FileRead } from '../models/file.model';
import { LocalForageAdapter } from '../adapters/LocalForageAdapter';
import { FilesAdapter } from '../adapters/FilesAdapter';
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts';
import { IndexedDBManager } from '../utils/IndexedDBManager.ts'; // <-- Import
import { LoggerService } from '../utils/Logger.ts'; // <-- Import

export class ListCRUDImpl<T extends Record<string, any>> {
  private localForageStoreName: string;
  private indexedDBStoreName: string; // <-- New property for IDB store name

  constructor(
    private listOptions: Readonly<ListOptions<T>>,
    private localForageAdapter: LocalForageAdapter,
    private filesAdapter: FilesAdapter,
    private indexedDBManager: IndexedDBManager, // <-- Inject
    private logger: LoggerService, // <-- Inject LoggerService
    private encryptedStorageService?: EncryptedStorageService
  ) {
    this.localForageStoreName = `list_${listOptions.name}`;
    this.indexedDBStoreName = `list_${listOptions.name}`; // Same naming convention for IDB store
    this.logger.info(`ListCRUDImpl for LF store '${this.localForageStoreName}' and IDB store '${this.indexedDBStoreName}' initialized.`);
  }

  private generateId(): string { return crypto.randomUUID(); }

  private async _encrypt(data: string): Promise<string> { 
    if (!this.encryptedStorageService || !this.encryptedStorageService.isKeySet()) { return data; }
    try {
      const { iv, encryptedData } = await this.encryptedStorageService.encrypt(data);
      const ivString = btoa(String.fromCharCode(...iv));
      const encryptedString = btoa(String.fromCharCode(...new Uint8Array(encryptedData)));
      return `${ivString}:${encryptedString}`;
    } catch (e) { this.logger.error(`[${this.localForageStoreName}] Encryption failed:`, e); throw e; }
  }

  private async _decrypt(data: string): Promise<string> { 
    if (!this.encryptedStorageService || !this.encryptedStorageService.isKeySet() || !data.includes(':')) { return data; }
    try {
      const [ivString, encryptedString] = data.split(':', 2); 
      if (!ivString || !encryptedString) return data; 
      const iv = new Uint8Array(atob(ivString).split('').map(char => char.charCodeAt(0)));
      const encryptedDataBuffer = new Uint8Array(atob(encryptedString).split('').map(char => char.charCodeAt(0))).buffer;
      return await this.encryptedStorageService.decrypt(encryptedDataBuffer, iv);
    } catch (e) { this.logger.warn(`[${this.localForageStoreName}] Decryption failed, returning raw data:`, e); return data; }
  }

  private async _serializeAndEncrypt(item: Item<T>): Promise<string | Item<T>> { 
    if (this.listOptions.replication?.firestore && this.encryptedStorageService?.isKeySet()) {
        return this._encrypt(JSON.stringify(item));
    }
    return item; 
  }

  private async _deserializeAndDecrypt(data: string | Item<T>): Promise<Item<T>> { 
    if (typeof data === 'string') {
        const decryptedString = await this._decrypt(data);
        try {
            return JSON.parse(decryptedString) as Item<T>;
        } catch (e) {
            this.logger.error(`[${this.localForageStoreName}] Failed to parse decrypted string: ${decryptedString.substring(0,100)}...`, e);
            throw new Error('Failed to parse decrypted item data.');
        }
    }
    return data; 
  }
  
  private async _handleFileOutput(
    itemData: Partial<T>, 
    filesInput?: { [K in keyof T]?: FileInput }
  ): Promise<Partial<T>> { 
    if (!filesInput) return {};
    const fileHandlingResults: Partial<T> = {};
    for (const fieldKey in filesInput) {
        if (!Object.prototype.hasOwnProperty.call(filesInput, fieldKey) || !this.listOptions.fields[fieldKey as keyof T]) {
            continue;
        }
        const fileInputField = filesInput[fieldKey as keyof T];
        if (fileInputField && this.listOptions.fields[fieldKey as keyof T] === 'file') {
            try {
                const fileMeta = await this.filesAdapter.addFile(fileInputField);
                (fileHandlingResults as any)[fieldKey] = fileMeta.id; 
            } catch (e) {
                this.logger.error(`[${this.localForageStoreName}] Error adding file for field ${String(fieldKey)}:`, e);
            }
        }
    }
    return fileHandlingResults;
  }

  async createItem(itemInput: CreateItemInput<T>): Promise<Item<T>> {
    const id = this.generateId();
    const now = new Date().toISOString();
    const fileDataFields = await this._handleFileOutput(itemInput.data, itemInput.files as { [K in keyof T]?: FileInput });

    const newItem: Item<T> = {
        ...itemInput.data,
        ...fileDataFields,
        _id: id, createdAt: now, createdBy: itemInput.createdBy || 'system',
        _updatedAt: now, updatesLogs: [], _deleted: false,
    } as Item<T>;

    // Store plain item in IndexedDB
    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...newItem }); 
      this.logger.debug(`[ListCRUDImpl] Item ${id} successfully put into IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to put item ${id} into IDB store ${this.indexedDBStoreName}:`, idbError);
    }

    const storableItemForLF = await this._serializeAndEncrypt({ ...newItem }); 
    await this.localForageAdapter.set(id, storableItemForLF, this.localForageStoreName);
    this.logger.debug(`[ListCRUDImpl] Item ${id} successfully set in LocalForage store ${this.localForageStoreName}.`);
    
    return newItem;
  }

  async readItem(id: string): Promise<Item<T> | undefined> {
    const data = await this.localForageAdapter.get<string | Item<T>>(id, this.localForageStoreName);
    if (data === null || data === undefined) return undefined;
    return this._deserializeAndDecrypt(data);
  }

  async updateItem(itemUpdate: UpdateItemInput<T>): Promise<Item<T>> {
    const currentItem = await this.readItem(itemUpdate.id); 
    if (!currentItem) throw new Error(`[${this.localForageStoreName}] Item with id ${itemUpdate.id} not found.`);

    const fileDataFields = await this._handleFileOutput(itemUpdate.data as T, itemUpdate.files as { [K in keyof T]?: FileInput });
    const updatedItemData: Partial<T> = { ...itemUpdate.data, ...fileDataFields };
    
    const updatedItem: Item<T> = { ...currentItem, ...(updatedItemData as T), _updatedAt: new Date().toISOString() };
    const logEntry: UpdatesLogs<T> = {
        at: updatedItem._updatedAt, by: itemUpdate.updatedBy || 'system',
        before: {} as Partial<T>, after: {} as Partial<T>
    };
    updatedItem.updatesLogs = [...(currentItem.updatesLogs || []), logEntry];

    // Store plain updated item in IndexedDB
    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...updatedItem });
      this.logger.debug(`[ListCRUDImpl] Item ${updatedItem._id} successfully updated in IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to update item ${updatedItem._id} in IDB store ${this.indexedDBStoreName}:`, idbError);
    }

    const storableItemForLF = await this._serializeAndEncrypt({ ...updatedItem });
    await this.localForageAdapter.set(itemUpdate.id, storableItemForLF, this.localForageStoreName);
    this.logger.debug(`[ListCRUDImpl] Item ${updatedItem._id} successfully updated in LocalForage store ${this.localForageStoreName}.`);

    return updatedItem;
  }

  async deleteItem(id: string, userId?: string): Promise<Item<T>> { 
    const item = await this.readItem(id);
    if (!item) throw new Error(`[${this.localForageStoreName}] Item with id ${id} not found for deletion.`);

    item._deleted = true;
    item._deletedAt = new Date().toISOString();
    item.deletedBy = userId || 'system';
    item._updatedAt = item._deletedAt;
    item.updatesLogs = [...(item.updatesLogs || []), {
        at: item._updatedAt, by: userId || 'system', 
        before: { _deleted: false } as Partial<T>, after: { _deleted: true } as Partial<T>
    }];

    // Store plain soft-deleted item in IndexedDB
    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...item });
      this.logger.debug(`[ListCRUDImpl] Item ${id} (soft deleted) successfully updated in IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to update soft-deleted item ${id} in IDB store ${this.indexedDBStoreName}:`, idbError);
    }

    const storableItemForLF = await this._serializeAndEncrypt({ ...item });
    await this.localForageAdapter.set(id, storableItemForLF, this.localForageStoreName);
    this.logger.debug(`[ListCRUDImpl] Item ${id} (soft deleted) successfully updated in LocalForage store ${this.localForageStoreName}.`);
    
    return item;
  }

  async restoreItem(id: string, userId?: string): Promise<Item<T>> {
    const item = await this.readItem(id);
    if (!item) throw new Error(`[${this.localForageStoreName}] Item with id ${id} not found for restoration.`);
    if (!item._deleted) {
        this.logger.warn(`[${this.localForageStoreName}] Item with id ${id} is not deleted. Restoration aborted.`);
        return item; 
    }

    const updateLog: UpdatesLogs<T> = { 
        at: new Date().toISOString(), by: userId || 'system',
        before: { _deleted: item._deleted, _deletedAt: item._deletedAt, deletedBy: item.deletedBy } as Partial<T>,
        after: { _deleted: false, _deletedAt: undefined, deletedBy: undefined } as Partial<T>
    };
    item._deleted = false; delete item._deletedAt; delete item.deletedBy;
    item._updatedAt = updateLog.at; item.updatesLogs = [...(item.updatesLogs || []), updateLog];

    // Store plain restored item in IndexedDB
    try {
      await this.indexedDBManager.putItem(this.indexedDBStoreName, { ...item });
      this.logger.debug(`[ListCRUDImpl] Item ${id} (restored) successfully updated in IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to update restored item ${id} in IDB store ${this.indexedDBStoreName}:`, idbError);
    }

    const storableItemForLF = await this._serializeAndEncrypt({ ...item });
    await this.localForageAdapter.set(id, storableItemForLF, this.localForageStoreName);
    this.logger.debug(`[ListCRUDImpl] Item ${id} (restored) successfully updated in LocalForage store ${this.localForageStoreName}.`);

    return item;
  }

  async purgeDeletedItem(id: string): Promise<void> {
    const itemForFileCleanup = await this.readItem(id); // Read before any deletion for file cleanup

    // First, delete from IndexedDB
    try {
      await this.indexedDBManager.deleteItem(this.indexedDBStoreName, id);
      this.logger.debug(`[ListCRUDImpl] Item ${id} successfully deleted from IDB store ${this.indexedDBStoreName}.`);
    } catch (idbError) {
      this.logger.error(`[ListCRUDImpl] Failed to delete item ${id} from IDB store ${this.indexedDBStoreName}:`, idbError);
    }

    if (itemForFileCleanup) { // Use the item read before deletion for file cleanup
        for (const fieldKey in this.listOptions.fields) {
            if (this.listOptions.fields[fieldKey as keyof T] === 'file') {
                const fileId = itemForFileCleanup[fieldKey as keyof T] as unknown as string;
                if (fileId && typeof fileId === 'string') {
                    try { await this.filesAdapter.deleteFile(fileId); } 
                    catch (e) { this.logger.warn(`[${this.localForageStoreName}] Failed to delete file ${fileId} for item ${id}:`, e); }
                }
            }
        }
    }
    await this.localForageAdapter.remove(id, this.localForageStoreName);
    this.logger.debug(`[ListCRUDImpl] Item ${id} purged from LocalForage store ${this.localForageStoreName}.`);
  }
  
  async getAllItems(): Promise<Item<T>[]> {
    const allItems: Item<T>[] = [];
    const keys = await this.localForageAdapter.keys(this.localForageStoreName);
    for (const key of keys) {
        if (typeof key === 'string') { 
             const item = await this.readItem(key);
             if (item) {
                 allItems.push(item);
             }
        }
    }
    return allItems;
  }
}
