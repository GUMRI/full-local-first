// In list-factory.service.ts
import { Injectable } from '@angular/core';
import { ListOptions, ListRef } from '../models/list.model';
import { ListImpl } from './ListImpl';

import { LocalForageAdapter } from '../adapters/LocalForageAdapter';
import { FilesAdapter } from '../adapters/FilesAdapter';
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts';
import { ReplicationEngineService } from '../replication/ReplicationEngineService';
import { FirestoreReplicationStrategy } from '../replication/strategies/FirestoreReplicationStrategy';
import { LoggerService } from '../utils/Logger.ts';
import { IndexedDBManager } from '../utils/IndexedDBManager.ts'; // <-- Import IndexedDBManager

@Injectable({
  providedIn: 'root'
})
export class ListFactoryService {

  constructor(
    private localForageAdapter: LocalForageAdapter,
    private filesAdapter: FilesAdapter,
    private encryptedStorageService: EncryptedStorageService,
    private replicationEngineService: ReplicationEngineService,
    private logger: LoggerService,
    private indexedDBManager: IndexedDBManager // <-- Inject IndexedDBManager
  ) {
    // console.log('ListFactoryService initialized with dependencies including IndexedDBManager.');
  }

  list<T extends Record<string, any>>(options: ListOptions<T>): ListRef<T> {
    // console.log('ListFactoryService: Creating real ListImpl instance for list:', options.name);
    
    // ListCRUDImpl needs LoggerService and IndexedDBManager.
    // ListImpl needs IndexedDBManager for ensureStoreWithIndexes.
    // ListImpl also needs LoggerService for itself if it does any logging.
    // The constructor of ListImpl currently doesn't take LoggerService.
    // ListCRUDImpl's constructor was updated to take LoggerService and IndexedDBManager.
    // Let's ensure ListImpl receives what it needs.

    const newListImpl = new ListImpl<T>(
      options,
      this.localForageAdapter, // For ListCRUDImpl via ListImpl
      this.filesAdapter,       // For ListCRUDImpl via ListImpl
      this.indexedDBManager,   // Pass to ListImpl directly
      this.logger,             // Pass to ListImpl (for itself or to pass down)
      this.encryptedStorageService // For ListCRUDImpl via ListImpl
    );

    if (options.replication && options.replication.firestore) {
      // ... (existing replication registration logic) ...
      this.logger.info(`ListFactory: Replication configured for list ${options.name}. Registering with ReplicationEngineService.`);
      const firestoreStrategy = new FirestoreReplicationStrategy<T>(this.logger);
      this.replicationEngineService.registerListForReplication<T>(newListImpl, firestoreStrategy)
        .then(() => { 
             this.logger.info(`List ${options.name} successfully registered with ReplicationEngineService.`);
        })
        .catch(error => { 
            this.logger.error(`Error registering list ${options.name} with ReplicationEngineService:`, error);
            newListImpl.setSyncError(`Failed to initialize replication: ${(error as Error).message || error}`);
        });
    } else {
      this.logger.info(`ListFactory: No replication configured for list ${options.name}.`);
    }
    return newListImpl;
  }
}
