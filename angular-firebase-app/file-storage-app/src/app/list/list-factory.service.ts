import { Injectable } from '@angular/core';
import { ListOptions, ListRef } from '../models/list.model';
import { ListImpl } from './ListImpl';

// Adapters and Services that ListImpl will need
import { LocalForageAdapter } from '../adapters/LocalForageAdapter';
import { FilesAdapter } from '../adapters/FilesAdapter';
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts'; // Ensure .ts

@Injectable({
  providedIn: 'root'
})
export class ListFactoryService {

  constructor(
    private localForageAdapter: LocalForageAdapter,
    private filesAdapter: FilesAdapter,
    private encryptedStorageService: EncryptedStorageService // Can be optional if not all lists need it
                                                            // or if EncryptedStorageService handles null key gracefully.
                                                            // ListImpl constructor already treats it as optional.
  ) {
    console.log('ListFactoryService initialized with dependencies.');
  }

  list<T extends Record<string, any>>(options: ListOptions<T>): ListRef<T> {
    console.log('ListFactoryService: Creating real ListImpl instance for list:', options.name);
    
    // Create and return an instance of ListImpl<T>
    // ListImpl's constructor expects EncryptedStorageService to be potentially undefined.
    return new ListImpl<T>(
      options,
      this.localForageAdapter,
      this.filesAdapter,
      this.encryptedStorageService // Pass it, ListImpl will use if available & configured
    );
  }
}
