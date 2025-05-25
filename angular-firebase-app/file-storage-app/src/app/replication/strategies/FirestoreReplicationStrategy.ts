import {
  ReplicationStrategy, Checkpoint, ReplicationPullResult, ReplicationPushResult
} from '../replication.model';
import { Item, ListOptions } from '../../models/list.model';
import { FileReplicationInput } from '../../models/file.model';
import {
  Firestore, collection, query, where, getDocs, Timestamp,
  doc, writeBatch, serverTimestamp, orderBy
} from '@angular/fire/firestore';
// Firebase Storage imports
import { 
  FirebaseStorage,
  ref as storageRef, 
  uploadBytesResumable, 
  getDownloadURL,
  deleteObject as deleteFileFromStorage, // Ensured import
  getBlob 
} from '@angular/fire/storage';
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
        const data = docSnapshot.data() as T & { createdAt?: any, _updatedAt?: any, _deletedAt?: any }; 
        
        const itemWithConvertedDates: Item<T> = {
          ...(data as Item<T>), 
          _id: docSnapshot.id, 
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
        const { _id, ...payloadWithoutId } = item; 
        const firestorePayload: Record<string, any> = { ...payloadWithoutId };

        if (firestorePayload.createdAt && typeof firestorePayload.createdAt === 'string') {
          firestorePayload.createdAt = Timestamp.fromDate(new Date(firestorePayload.createdAt));
        }
        if (firestorePayload._updatedAt && typeof firestorePayload._updatedAt === 'string') {
          firestorePayload._updatedAt = Timestamp.fromDate(new Date(firestorePayload._updatedAt));
        } else {
           firestorePayload._updatedAt = serverTimestamp(); 
        }

        if (firestorePayload._deletedAt && typeof firestorePayload._deletedAt === 'string') {
          firestorePayload._deletedAt = Timestamp.fromDate(new Date(firestorePayload._deletedAt));
        } else if (firestorePayload._deleted && !firestorePayload._deletedAt) {
          firestorePayload._deletedAt = serverTimestamp();
        }
        
        Object.keys(this.listOptions.fields).forEach(fieldKey => {
            if (this.listOptions.fields[fieldKey as keyof T] === 'file') {
                const fileId = item[fieldKey as keyof T];
                if (fileId && this.firebaseStorage) {
                    this.logger.debug(`File field '${String(fieldKey)}' with ID '${String(fileId)}' needs push. Actual file push not implemented yet in item metadata push.`);
                }
            }
        });

        const itemDocRef = doc(this.firestore, `lists/${listName}/items/${_id}`);
        batch.set(itemDocRef, firestorePayload, { merge: true }); 
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
      const prepSuccessIds = [...successfulItemIds]; 
      successfulItemIds.length = 0; 
      failedItemIds.push(...prepSuccessIds); 
      errors.push({ batchError }); 
    }

    return { successfulItemIds, failedItemIds, errors };
  }

  async pushFile(
    fileInput: FileReplicationInput,
    listOptions: Readonly<ListOptions<T>>
  ): Promise<{ storagePath: string; downloadUrl?: string }> {
    if (!this.firebaseStorage) {
      this.logger.error('[FirestoreStrategy] FirebaseStorage instance not available. Initialize strategy with firebaseStorage configuration.');
      throw new Error('FirebaseStorage instance not available.');
    }

    const { id: fileId, name: fileName, data: fileBlob, itemId, fieldKey } = fileInput;
    const listContextName = listOptions.name; 

    const filePath = `lists/${listContextName}/items/${itemId}/${fieldKey}/${fileId}-${fileName}`;
    const fileStorageRef = storageRef(this.firebaseStorage, filePath);

    this.logger.info(`[FirestoreStrategy] Uploading file ${fileName} (ID: ${fileId}) to ${filePath}`);

    try {
      const uploadTask = uploadBytesResumable(fileStorageRef, fileBlob);
      await uploadTask; 
      
      this.logger.info(`[FirestoreStrategy] File ${fileName} uploaded successfully to ${filePath}.`);

      let downloadUrl: string | undefined = undefined;
      try {
        downloadUrl = await getDownloadURL(fileStorageRef);
        this.logger.debug(`[FirestoreStrategy] Got download URL for ${filePath}: ${downloadUrl}`);
      } catch (urlError) {
        this.logger.warn(`[FirestoreStrategy] Could not get download URL for ${filePath}:`, urlError);
      }

      return {
        storagePath: filePath,
        downloadUrl: downloadUrl
      };

    } catch (error) {
      this.logger.error(`[FirestoreStrategy] Error uploading file ${fileName} (ID: ${fileId}) to ${filePath}:`, error);
      throw error; 
    }
  }

  async pullFile(
    fileMeta: { id: string; storagePath: string; fileName: string; }, 
    listOptions: Readonly<ListOptions<T>> 
  ): Promise<Blob> {
    if (!this.firebaseStorage) {
      this.logger.error('[FirestoreStrategy] FirebaseStorage instance not available for pulling file.');
      throw new Error('FirebaseStorage instance not available.');
    }

    const { storagePath, id: fileId, fileName } = fileMeta;
    this.logger.info(`[FirestoreStrategy] Pulling file ID ${fileId} (name: ${fileName}) from path: ${storagePath}`);

    try {
      const fileStorageRef = storageRef(this.firebaseStorage, storagePath);
      const blob = await getBlob(fileStorageRef);
      this.logger.info(`[FirestoreStrategy] File ID ${fileId} (name: ${fileName}) pulled successfully from ${storagePath}. Size: ${blob.size}`);
      return blob;
    } catch (error) {
      this.logger.error(`[FirestoreStrategy] Error pulling file ID ${fileId} (name: ${fileName}) from ${storagePath}:`, error);
      if ((error as any).code === 'storage/object-not-found') {
        throw new Error(`File not found at path: ${storagePath}`); 
      }
      throw error; 
    }
  }

  // --- Updated deleteFile method ---
  async deleteFile(
    fileMeta: { id: string; storagePath: string; },
    listOptions: Readonly<ListOptions<T>> // listOptions available for context
  ): Promise<void> {
    if (!this.firebaseStorage) {
      this.logger.warn('[FirestoreStrategy] FirebaseStorage instance not available. Cannot delete file.');
      // Depending on desired behavior, either throw an error or return gracefully.
      // Throwing an error might be better to signal that the operation couldn't be performed.
      throw new Error('FirebaseStorage instance not available. Initialize strategy with firebaseStorage configuration.');
    }

    const { storagePath, id: fileId } = fileMeta;
    this.logger.info(`[FirestoreStrategy] Deleting file ID ${fileId} from path: ${storagePath}`);

    try {
      const fileStorageRef = storageRef(this.firebaseStorage, storagePath);
      await deleteFileFromStorage(fileStorageRef); // Use the imported deleteObject
      this.logger.info(`[FirestoreStrategy] File ID ${fileId} deleted successfully from ${storagePath}.`);
    } catch (error) {
      this.logger.error(`[FirestoreStrategy] Error deleting file ID ${fileId} from ${storagePath}:`, error);
      // Check for specific errors, e.g., 'storage/object-not-found'
      // If file is already not found, it's effectively deleted from storage perspective.
      if ((error as any).code === 'storage/object-not-found') {
        this.logger.warn(`[FirestoreStrategy] File not found at path ${storagePath} during delete attempt. Considering it deleted.`);
        return; // Success, as the file isn't there.
      }
      throw error; // Re-throw other errors
    }
  }
}
