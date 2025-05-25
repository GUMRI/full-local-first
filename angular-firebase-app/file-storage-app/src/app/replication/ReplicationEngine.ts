import { Injectable } from '@angular/core';
import { ListOptions, Item } from '../models/list.model';
import { Checkpoint, ReplicationStrategy } from './replication.model';
import { LocalForageAdapter } from '../adapters/LocalForageAdapter'; // For checkpoint persistence
import { ListImpl } from '../list/ListImpl'; // To interact with the list
import { LoggerService } from '../utils/Logger.ts'; // For logging

// Placeholder for a specific strategy like Firestore
// import { FirestoreReplicationStrategy } from './strategies/FirestoreReplicationStrategy';

const CHECKPOINT_STORE_NAME = 'replicationCheckpoints';

@Injectable({
  providedIn: 'root' 
})
export class ReplicationEngineService { 
  private activeStrategies: Map<string, ReplicationStrategy<any>> = new Map(); // listName -> strategy
  private replicationIntervals: Map<string, any> = new Map(); // listName -> interval ID
  private pushQueues: Map<string, Item<any>[]> = new Map(); // listName -> items to push

  constructor(
    private localForageAdapter: LocalForageAdapter,
    private logger: LoggerService,
    // Potentially inject a map of available strategies or a strategy factory
    // private firestoreStrategy: FirestoreReplicationStrategy // Example
  ) {
    this.logger.info('ReplicationEngineService initialized.');
    // Configure the checkpoint store instance when the service is created
    this.localForageAdapter.configureInstance({
        name: 'appReplicationDB',
        storeName: CHECKPOINT_STORE_NAME,
        description: 'Stores replication checkpoints'
    }, CHECKPOINT_STORE_NAME);
    this.logger.info(`Configured LocalForage instance for checkpoints: ${CHECKPOINT_STORE_NAME}`);
  }

  public async registerListForReplication<T extends Record<string, any>>(
    list: ListImpl<T>, // The ListImpl instance
    strategy: ReplicationStrategy<T> 
    // pullIntervalMs: number = 300000, // e.g., 5 minutes
    // pushIntervalMs: number = 60000   // e.g., 1 minute
  ): Promise<void> {
    const listName = list.options.name;
    if (!list.options.replication?.firestore) {
      this.logger.warn(`List ${listName} has no replication config. Skipping registration.`);
      return;
    }

    this.logger.info(`Registering list ${listName} for replication with strategy ${strategy.strategyName}.`);
    
    await strategy.initialize(
      list.options, 
      list.options.replication.firestore, 
      list.options.replication.firebaseStorage
    );
    this.activeStrategies.set(listName, strategy);
    
    // TODO: Setup periodic pull/push or event-driven triggers
    // this.setupPeriodicSync(listName, pullIntervalMs, pushIntervalMs);

    // Initial sync trigger
    this.triggerSync(listName, list);
  }

  public unregisterList(listName: string): void {
    this.logger.info(`Unregistering list ${listName} from replication.`);
    if (this.replicationIntervals.has(listName)) {
      clearInterval(this.replicationIntervals.get(listName));
      this.replicationIntervals.delete(listName);
    }
    this.activeStrategies.delete(listName);
    this.pushQueues.delete(listName);
  }

  public async triggerSync<T extends Record<string, any>>(listName: string, list: ListImpl<T>): Promise<void> {
    this.logger.info(`Manual sync triggered for list ${listName}.`);
    
    // Placeholder: Accessing ListImpl's state update methods (assuming they exist)
    // list.setStatus('syncing'); // Direct call if ListImpl exposes such a method
    // list.setError(null);
    // For now, we'll assume ListImpl handles its own status based on events or direct calls.
    // The following are conceptual calls to ListImpl's internal state management.
    // In a real scenario, ListImpl would have methods like:
    // list.getInternalState().setStatus('syncing');
    // list.getInternalState().setError(null);
    // Or, ReplicationEngine emits events that ListImpl listens to.
    // As ListImpl.status is a Signal, it's not directly settable from outside.
    // This will be refined when integrating ListImpl.
    // For now, we'll log the intent.
    this.logger.debug(`Setting status to 'syncing' for list ${listName} (conceptual).`);


    try {
      await this._performPull(listName, list);
      await this._performPush(listName, list); 
      this.logger.debug(`Setting status to 'loaded' for list ${listName} (conceptual).`);
    } catch (error: any) {
      this.logger.error(`Error during sync for list ${listName}:`, error);
      this.logger.debug(`Setting status to 'error' for list ${listName} (conceptual).`);
      // list.getInternalState().setError(error); // Conceptual
    }
  }

  private async _getCheckpoint(listName: string): Promise<Checkpoint> {
    const checkpoint = await this.localForageAdapter.get<Checkpoint>(listName, CHECKPOINT_STORE_NAME);
    return checkpoint || { listName }; 
  }

  private async _setCheckpoint(listName: string, checkpoint: Checkpoint): Promise<void> {
    await this.localForageAdapter.set(listName, checkpoint, CHECKPOINT_STORE_NAME);
  }

  private async _performPull<T extends Record<string, any>>(listName: string, list: ListImpl<T>): Promise<void> {
    const strategy = this.activeStrategies.get(listName);
    if (!strategy) {
      this.logger.warn(`No replication strategy found for list ${listName} during pull.`);
      return;
    }
    this.logger.info(`Performing PULL for list ${listName}`);
    
    const currentCheckpoint = await this._getCheckpoint(listName);
    const pullResult = await strategy.pullChanges(listName, currentCheckpoint);

    for (const pulledItem of pullResult.pulledItems) {
      const existing = await list.read(pulledItem._id); 
      if (existing) {
        if (new Date(pulledItem._updatedAt) > new Date(existing._updatedAt)) {
          await list.update({ id: pulledItem._id, data: pulledItem as Partial<T> }); 
        } else if (new Date(pulledItem._updatedAt) < new Date(existing._updatedAt)) {
          this.logger.info(`Local item ${pulledItem._id} is newer, not overwriting from pull.`);
        } else {
          this.logger.info(`Item ${pulledItem._id} has same timestamp, remote version applied (default).`);
          await list.update({ id: pulledItem._id, data: pulledItem as Partial<T> });
        }
      } else {
        await list.create({ data: pulledItem as T }); 
      }
    }

    if (pullResult.newCheckpoint) {
      await this._setCheckpoint(listName, { ...currentCheckpoint, ...pullResult.newCheckpoint });
    }
    this.logger.info(`PULL complete for list ${listName}. Applied ${pullResult.pulledItems.length} items.`);
  }

  private async _performPush<T extends Record<string, any>>(listName: string, list: ListImpl<T>): Promise<void> {
    const strategy = this.activeStrategies.get(listName);
    if (!strategy) {
      this.logger.warn(`No replication strategy found for list ${listName} during push.`);
      return;
    }
    this.logger.info(`Performing PUSH for list ${listName}`);

    const itemsToPush: Item<T>[] = []; 
    // Placeholder: Real logic to get dirty items is complex and will be added later.
    // For now, an empty array means no explicit push logic here.
    // Items might be added to pushQueues by other mechanisms (e.g. event listeners on ListImpl)

    const pushQueue = this.pushQueues.get(listName) || [];
    const itemsToAttemptPush = [...pushQueue, ...itemsToPush]; 
    this.pushQueues.set(listName, []); 

    if (itemsToAttemptPush.length === 0) {
      this.logger.info(`No items to PUSH for list ${listName}.`);
      return;
    }
    
    const pushResult = await strategy.pushChanges(listName, itemsToAttemptPush);

    if (pushResult.failedItemIds.length > 0) {
      this.logger.warn(`Some items failed to push for list ${listName}. Re-queuing.`);
      const requeueItems = itemsToAttemptPush.filter(item => pushResult.failedItemIds.includes(item._id));
      this.pushQueues.set(listName, [...(this.pushQueues.get(listName) || []), ...requeueItems]);
    }
    
    this.logger.info(`PUSH complete for list ${listName}. ${pushResult.successfulItemIds.length} succeeded.`);
  }
}
