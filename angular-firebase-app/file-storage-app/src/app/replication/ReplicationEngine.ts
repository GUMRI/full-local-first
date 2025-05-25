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
    this.logger.debug(`Getting checkpoint for list ${listName} from store '${CHECKPOINT_STORE_NAME}'.`);
    try {
      const checkpoint = await this.localForageAdapter.get<Checkpoint>(listName, CHECKPOINT_STORE_NAME);
      if (checkpoint) {
        this.logger.debug(`Found checkpoint for ${listName}:`, checkpoint);
        return checkpoint;
      } else {
        this.logger.debug(`No checkpoint found for ${listName}. Returning initial default.`);
        return { listName: listName, lastPulledAt: undefined }; // lastPulledAt: undefined indicates first sync
      }
    } catch (error) {
      this.logger.error(`Error getting checkpoint for list ${listName}:`, error);
      // Depending on error strategy, rethrow or return a default that signals an issue
      throw error; // Or return a default to prevent sync from stopping entirely
    }
  }

  private async _setCheckpoint(listName: string, checkpoint: Checkpoint): Promise<void> {
    this.logger.debug(`Setting checkpoint for list ${listName}:`, checkpoint);
    try {
      await this.localForageAdapter.set<Checkpoint>(listName, checkpoint, CHECKPOINT_STORE_NAME);
      this.logger.debug(`Checkpoint for ${listName} successfully set.`);
    } catch (error) {
      this.logger.error(`Error setting checkpoint for list ${listName}:`, error);
      throw error; // Or handle more gracefully
    }
  }

  private async _performPull<T extends Record<string, any>>(listName: string, list: ListImpl<T>): Promise<void> {
    const strategy = this.activeStrategies.get(listName);
    if (!strategy) {
      this.logger.warn(`No replication strategy found for list ${listName} during pull.`);
      return;
    }
    this.logger.info(`Performing PULL for list ${listName}`);
    // Conceptual: list.status.set('syncing'); // Update status - Assuming ListImpl allows this
    // For ListImpl as defined, status is a readonly Signal. This line is a placeholder.
    // A more robust approach would be for ListImpl to expose a method like list.setStatus('syncing').
    // Or, ReplicationEngine emits events that ListImpl listens to.
    // For now, we directly log the intent of status change here, and acknowledge ListImpl.status is not directly settable.
    this.logger.debug(`List ${listName}: Attempting to set status to 'syncing' (conceptual).`);


    const currentCheckpoint = await this._getCheckpoint(listName);
    const pullResult = await strategy.pullChanges(listName, currentCheckpoint);
    let itemsAppliedCount = 0;

    if (pullResult.errors && pullResult.errors.length > 0) {
        this.logger.error(`Errors encountered during pull for list ${listName}:`, pullResult.errors);
        // Decide if partial application is okay or if we should stop. For now, continue with pulled items.
    }

    for (const pulledItem of pullResult.pulledItems) {
      try {
        const existingLocalItem = await list.read(pulledItem._id); // list.read now checks active & deleted signals

        if (!existingLocalItem) {
          this.logger.debug(`List ${listName}: Pulled new item ID ${pulledItem._id}. Creating locally.`);
          await list.create({ data: pulledItem as T }); // Ensure 'as T' is appropriate
          itemsAppliedCount++;
        } else {
          // Validate timestamps
          const remoteDate = pulledItem._updatedAt ? new Date(pulledItem._updatedAt) : null;
          const localDate = existingLocalItem._updatedAt ? new Date(existingLocalItem._updatedAt) : null;

          if (!remoteDate) {
            this.logger.warn(`List ${listName}: Pulled item ID ${pulledItem._id} has invalid/missing _updatedAt. Skipping update.`);
            continue;
          }
          if (!localDate && existingLocalItem) { // Local item exists but has no date (should not happen for valid items)
             this.logger.warn(`List ${listName}: Local item ID ${existingLocalItem._id} has invalid/missing _updatedAt. Remote item will be applied.`);
             await list.update({ id: pulledItem._id, data: pulledItem as Partial<T> });
             itemsAppliedCount++;
             continue;
          }
          
          if (remoteDate > localDate!) {
            this.logger.debug(`List ${listName}: Remote item ID ${pulledItem._id} is newer. Updating local.`);
            await list.update({ id: pulledItem._id, data: pulledItem as Partial<T> });
            itemsAppliedCount++;
          } else if (remoteDate < localDate!) {
            this.logger.debug(`List ${listName}: Local item ID ${existingLocalItem._id} is newer. Remote change ignored.`);
            // Optional: Mark existingLocalItem for re-push if not already dirty.
            // For now, just log. this.addToPushQueue(listName, existingLocalItem);
          } else { // Timestamps are identical
            this.logger.debug(`List ${listName}: Item ID ${pulledItem._id} has identical timestamps. Applying remote data (default policy).`);
            // Could compare object hash here to avoid unnecessary write if data is identical
            await list.update({ id: pulledItem._id, data: pulledItem as Partial<T> });
            itemsAppliedCount++; // Counted as an application, even if data might be same.
          }
        }
      } catch (itemError) {
        this.logger.error(`List ${listName}: Error processing pulled item ID ${pulledItem._id}:`, itemError);
        // Continue with next item
      }
    }

    if (pullResult.newCheckpoint && Object.keys(pullResult.newCheckpoint).length > 0) {
      // Only update checkpoint if there's something new to set (e.g. new lastPulledAt)
      // And ideally, only if there were no major errors during the pull.
      await this._setCheckpoint(listName, { ...currentCheckpoint, ...pullResult.newCheckpoint });
    }
    
    this.logger.info(`PULL complete for list ${listName}. Processed ${pullResult.pulledItems.length} items from remote, applied/updated ${itemsAppliedCount} locally.`);
    // Conceptual: list.status.set('loaded'); // Status will be set by triggerSync after both pull and push
    this.logger.debug(`List ${listName}: Pull phase complete, status would conceptually be set to 'loaded' by triggerSync (conceptual).`);
  }

  private async _performPush<T extends Record<string, any>>(listName: string, list: ListImpl<T>): Promise<void> {
    const strategy = this.activeStrategies.get(listName);
    if (!strategy) {
      this.logger.warn(`No replication strategy found for list ${listName} during push.`);
      return;
    }
    this.logger.info(`Performing PUSH for list ${listName}`);
    // Conceptual: list.status.set('syncing'); // Update status - Assuming ListImpl allows this
    this.logger.debug(`List ${listName}: Attempting to set status to 'syncing' (conceptual).`);

    // 1. Get items currently in the list's active and deleted states
    const currentLocalActiveItems = list.items(); 
    const currentLocalDeletedItems = list.deletedItems(); 

    // 2. Get items from the persistent push queue for this list
    const queuedItemsArray = this.pushQueues.get(listName) || [];
    
    // 3. Combine and deduplicate:
    //    All current local items (active + deleted) are candidates for push.
    //    Items from the queue are also candidates.
    //    Prioritize the version from local signals if IDs overlap with queue.
    const itemsToAttemptPushMap = new Map<string, Item<T>>();
    
    // Add queued items first
    queuedItemsArray.forEach(item => itemsToAttemptPushMap.set(item._id, item));
    // Then add/overwrite with current local soft-deleted items
    currentLocalDeletedItems.forEach(item => itemsToAttemptPushMap.set(item._id, item));
    // Finally, add/overwrite with current local active items (these are the "freshest" if ID conflicts)
    currentLocalActiveItems.forEach(item => itemsToAttemptPushMap.set(item._id, item));

    const itemsToAttemptPush = Array.from(itemsToAttemptPushMap.values());

    // Clear the queue as we are attempting them now
    this.pushQueues.set(listName, []); 

    if (itemsToAttemptPush.length === 0) {
      this.logger.info(`No items to PUSH for list ${listName}.`);
      // Conceptual: list.status.set('loaded'); // Status handled by triggerSync
      this.logger.debug(`List ${listName}: Push phase - no items, status would conceptually be set to 'loaded' by triggerSync (conceptual).`);
      return;
    }
    
    this.logger.info(`Attempting to push ${itemsToAttemptPush.length} items for list ${listName}.`);
    const pushResult = await strategy.pushChanges(listName, itemsToAttemptPush);

    let newQueuedItems: Item<T>[] = [];
    if (pushResult.failedItemIds && pushResult.failedItemIds.length > 0) {
      this.logger.warn(`${pushResult.failedItemIds.length} items failed to push for list ${listName}. Re-queuing.`);
      
      // Get the full item objects for re-queuing
      const failedItemsMap = new Map(itemsToAttemptPush.map(item => [item._id, item]));
      pushResult.failedItemIds.forEach(id => {
        const item = failedItemsMap.get(id);
        if (item) {
          newQueuedItems.push(item);
        }
      });
      this.pushQueues.set(listName, newQueuedItems); // Update queue with only the ones that just failed
    }

    if (pushResult.errors && pushResult.errors.length > 0) {
        this.logger.error(`Errors encountered during push for list ${listName}:`, pushResult.errors);
    }
    
    this.logger.info(
      `PUSH complete for list ${listName}. ` +
      `Attempted: ${itemsToAttemptPush.length}, ` +
      `Succeeded: ${pushResult.successfulItemIds.length}, ` +
      `Failed (re-queued): ${newQueuedItems.length}.`
    );
    // Conceptual: list.status.set('loaded'); // Status handled by triggerSync
    this.logger.debug(`List ${listName}: Push phase complete, status would conceptually be set to 'loaded' by triggerSync (conceptual).`);
  }
}
