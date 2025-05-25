import { Injectable } from '@angular/core';
import { ListOptions, ListRef } from '../models/list.model';
import { ListImpl } from './ListImpl';

import { LocalForageAdapter } from '../adapters/LocalForageAdapter';
import { FilesAdapter } from '../adapters/FilesAdapter';
import { EncryptedStorageService } from '../crypto/EncryptedStorage.ts';

// --- New Imports ---
import { ReplicationEngineService } from '../replication/ReplicationEngineService';
import { FirestoreReplicationStrategy } from '../replication/strategies/FirestoreReplicationStrategy';
import { LoggerService } from '../utils/Logger.ts'; // For FirestoreReplicationStrategy

@Injectable({
  providedIn: 'root'
})
export class ListFactoryService {

  constructor(
    private localForageAdapter: LocalForageAdapter,
    private filesAdapter: FilesAdapter,
    private encryptedStorageService: EncryptedStorageService,
    // --- Injected Services ---
    private replicationEngineService: ReplicationEngineService,
    private logger: LoggerService // To be passed to FirestoreReplicationStrategy
  ) {
    console.log('ListFactoryService initialized with dependencies, including ReplicationEngineService and LoggerService.');
  }

  list<T extends Record<string, any>>(options: ListOptions<T>): ListRef<T> {
    console.log('ListFactoryService: Creating ListImpl instance for list:', options.name);
    
    const newListImpl = new ListImpl<T>(
      options,
      this.localForageAdapter,
      this.filesAdapter,
      this.encryptedStorageService
    );

    // --- Replication Engine Registration ---
    if (options.replication && options.replication.firestore) {
      this.logger.info(`ListFactory: Replication configured for list ${options.name}. Registering with ReplicationEngineService.`);
      
      // Create the specific strategy instance
      // FirestoreReplicationStrategy expects LoggerService in its constructor
      const firestoreStrategy = new FirestoreReplicationStrategy<T>(this.logger);
      
      // Register the list with the replication engine
      // Note: registerListForReplication is async but we don't await it here.
      // Registration will happen in the background. Error handling within registerListForReplication is important.
      this.replicationEngineService.registerListForReplication<T>(newListImpl, firestoreStrategy)
        .then(() => {
          this.logger.info(`List ${options.name} successfully registered with ReplicationEngineService.`);
        })
        .catch(error => {
          this.logger.error(`Error registering list ${options.name} with ReplicationEngineService:`, error);
          // Potentially set an error state on the list itself if registration fails critically
          // Using the new method from ListImpl (Task 1)
          newListImpl.setSyncError(`Failed to initialize replication: ${error.message || error}`);
        });
    } else {
      this.logger.info(`ListFactory: No replication configured for list ${options.name}.`);
    }

    return newListImpl;
  }
}
