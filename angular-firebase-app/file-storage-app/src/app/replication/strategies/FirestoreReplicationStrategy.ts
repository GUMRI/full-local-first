import {
  ReplicationStrategy, Checkpoint, ReplicationPullResult, ReplicationPushResult
} from '../replication.model';
import { Item, ListOptions } from '../../models/list.model';
import {
  Firestore, collection, query, where, getDocs, Timestamp,
  doc, writeBatch, serverTimestamp, collectionGroup, orderBy
} from '@angular/fire/firestore';
import { FirebaseStorage } from '@angular/fire/storage';
import { LoggerService } from '../../utils/Logger.ts';

export class FirestoreReplicationStrategy<T extends Record<string, any>> implements ReplicationStrategy<T> {
  public readonly strategyName = 'firestore';
  private firestore!: Firestore;
  private firebaseStorage?: FirebaseStorage;
  private listOptions!: Readonly<ListOptions<T>>;

  constructor(private logger: LoggerService) {
    this.logger.info('FirestoreReplicationStrategy instance created.');
  }

  async initialize(
    listOptions: Readonly<ListOptions<T>>,
    firestore: Firestore,
    firebaseStorage?: FirebaseStorage
  ): Promise<void> {
    this.listOptions = listOptions;
    this.firestore = firestore;
    this.firebaseStorage = firebaseStorage;
    this.logger.info(`FirestoreReplicationStrategy initialized for list: ${this.listOptions.name}`);
  }

  async pullChanges(listName: string, currentCheckpoint: Checkpoint): Promise<ReplicationPullResult<T>> {
    if (!this.firestore) {
      throw new Error('Firestore instance not available. Initialize strategy first.');
    }
    this.logger.info(`Pulling changes for list ${listName} from Firestore. Checkpoint:`, currentCheckpoint);

    const pulledItems: Item<T>[] = [];
    let newLastPulledAtString = currentCheckpoint.lastPulledAt || new Date(0).toISOString();

    try {
      const itemsCollectionRef = collection(this.firestore, `lists/${listName}/items`);
      
      const checkpointTimestamp = Timestamp.fromDate(new Date(newLastPulledAtString));
      
      const q = query(
        itemsCollectionRef,
        where('_updatedAt', '>', checkpointTimestamp),
        orderBy('_updatedAt', 'asc')
      );

      const querySnapshot = await getDocs(q);
      let latestDocTimestampISO = newLastPulledAtString;

      querySnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data() as T & { createdAt?: any, _updatedAt?: any, _deletedAt?: any }; // More specific type for conversion
        
        const itemWithConvertedDates: Item<T> = {
          ...(data as Item<T>), // Base spread
          _id: docSnapshot.id, // Ensure _id is from docSnapshot.id
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : String(data.createdAt),
          _updatedAt: data._updatedAt?.toDate ? data._updatedAt.toDate().toISOString() : String(data._updatedAt),
          _deletedAt: data._deletedAt?.toDate ? data._deletedAt.toDate().toISOString() : (data._deletedAt ? String(data._deletedAt) : undefined),
        };
        
        pulledItems.push(itemWithConvertedDates);

        if (itemWithConvertedDates._updatedAt > latestDocTimestampISO) {
          latestDocTimestampISO = itemWithConvertedDates._updatedAt;
        }
      });
      
      if (pulledItems.length > 0) {
        newLastPulledAtString = latestDocTimestampISO;
      }
      
      this.logger.info(`Pulled ${pulledItems.length} items for list ${listName}. New potential lastPulledAt: ${newLastPulledAtString}`);
      
      return {
        pulledItems,
        newCheckpoint: { lastPulledAt: newLastPulledAtString },
      };

    } catch (error) {
      this.logger.error(`Error pulling changes from Firestore for list ${listName}:`, error);
      return {
        pulledItems: [],
        newCheckpoint: {},
        errors: [error],
      };
    }
  }

  async pushChanges(listName: string, itemsToPush: Item<T>[]): Promise<ReplicationPushResult> {
    if (!this.firestore) {
      throw new Error('Firestore instance not available. Initialize strategy first.');
    }
    if (!itemsToPush || itemsToPush.length === 0) {
      this.logger.info(`No items to push for list ${listName}.`);
      return { successfulItemIds: [], failedItemIds: [], errors: [] };
    }

    this.logger.info(`Pushing ${itemsToPush.length} items for list ${listName} to Firestore.`);

    const batch = writeBatch(this.firestore);
    const successfulItemIds: string[] = [];
    const failedItemIds: string[] = [];
    const errors: any[] = [];

    for (const item of itemsToPush) {
      try {
        const { _id, ...payloadWithoutId } = item; // Separate _id from the rest of the payload
        
        // Defensive copy to avoid mutating original item object
        const firestorePayload: Record<string, any> = { ...payloadWithoutId };

        // Convert dates to Firestore Timestamps
        if (firestorePayload.createdAt && typeof firestorePayload.createdAt === 'string') {
          firestorePayload.createdAt = Timestamp.fromDate(new Date(firestorePayload.createdAt));
        }
        if (firestorePayload._updatedAt && typeof firestorePayload._updatedAt === 'string') {
          // For _updatedAt, it's common to use serverTimestamp() to ensure accuracy,
          // especially if this push is an update. If it's a new item or local _updatedAt is authoritative,
          // convert from string. For now, convert local string.
          firestorePayload._updatedAt = Timestamp.fromDate(new Date(firestorePayload._updatedAt));
        } else {
          // If _updatedAt is missing, or for ensuring server sets it on new docs if local isn't set
           firestorePayload._updatedAt = serverTimestamp(); 
        }

        if (firestorePayload._deletedAt && typeof firestorePayload._deletedAt === 'string') {
          firestorePayload._deletedAt = Timestamp.fromDate(new Date(firestorePayload._deletedAt));
        } else if (firestorePayload._deleted && !firestorePayload._deletedAt) {
          // If it's marked deleted but no _deletedAt, set it to now (server time)
          firestorePayload._deletedAt = serverTimestamp();
        }
        
        // TODO: File handling placeholder
        // Iterate over fields of type 'file' in listOptions.fields
        // If item[fieldKey] contains a file ID and this.firebaseStorage is available,
        // this is where one would initiate a file upload if the file isn't already uploaded.
        // For now, we assume file IDs are just data. Actual file blob push is complex.
        Object.keys(this.listOptions.fields).forEach(fieldKey => {
            if (this.listOptions.fields[fieldKey as keyof T] === 'file') {
                const fileId = item[fieldKey as keyof T];
                if (fileId && this.firebaseStorage) {
                    this.logger.debug(`File field '${String(fieldKey)}' with ID '${fileId}' needs push. Actual file push not implemented yet.`);
                    // Example: payload[fieldKey] = { id: fileId, path: `lists/${listName}/files/${fileId}` };
                }
            }
        });

        const itemDocRef = doc(this.firestore, `lists/${listName}/items/${_id}`);
        batch.set(itemDocRef, firestorePayload, { merge: true }); // Use merge:true for upsert behavior
        successfulItemIds.push(_id);

      } catch (error) {
        this.logger.error(`Error preparing item ${item._id} for batch push to list ${listName}:`, error);
        failedItemIds.push(item._id);
        errors.push({ itemId: item._id, error });
      }
    }

    try {
      await batch.commit();
      this.logger.info(`Batch committed for list ${listName}. Success: ${successfulItemIds.length}, Failures (in prep): ${failedItemIds.length}`);
    } catch (batchError) {
      this.logger.error(`Error committing batch for list ${listName}:`, batchError);
      // All items in the batch are considered failed if the batch commit fails
      // Return all originally attempted items as failed (excluding those that failed in prep)
      const prepSuccessIds = [...successfulItemIds]; // copy
      successfulItemIds.length = 0; // Clear successful ones as batch failed
      // failedItemIds should now include all items that were in successfulItemIds before batch failure
      failedItemIds.push(...prepSuccessIds); 
      errors.push({ batchError }); // Add batch error to general errors
    }

    return { successfulItemIds, failedItemIds, errors };
  }
}
