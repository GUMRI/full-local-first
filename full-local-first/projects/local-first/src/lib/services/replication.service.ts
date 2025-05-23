/**
 * @file Implements the Real-Time Replication Engine for a specific list.
 * This service handles the two-way synchronization of data between the local
 * LocalForage store and a remote Firestore backend, including file attachments.
 */

import { signal, Signal } from '@angular/core';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  DocumentSnapshot,
  CollectionReference,
  Firestore,
  Unsubscribe,
  query,
  where,
  orderBy,
  getDocs,
  runTransaction
} from '@angular/fire/firestore';
import {
  FirebaseStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  StorageReference
} from '@angular/fire/storage';
import { Subscription } from 'rxjs';

import { ListOptions, Item, StoredFile, FileInput } from '../types';
import { LocalForageService } from './localforage.service';
import { EventBusService, ReplicationStatusEvent, SyncErrorEvent } from './event-bus.service';

// --- Replication Queue Item Definition ---

/**
 * Represents an item in the replication push queue.
 * Each item corresponds to a local change that needs to be pushed to the remote backend.
 */
export interface ReplicationQueueItem {
  /** Unique identifier for this queue entry (e.g., UUID). */
  id: string;
  /** ID of the domain item (e.g., product ID, user ID) that this queue item pertains to. */
  itemId: string;
  /** Type or name of the list/collection the item belongs to (e.g., 'products', 'users'). */
  itemType: string;
  /** The CRUD action that was performed locally and needs to be replicated. */
  action: 'create' | 'update' | 'delete';
  /**
   * The actual data for 'create' or 'update' actions.
   * For 'delete', this might be undefined or contain minimal info like the ID.
   */
  data?: any; // Should be Item<T, U> for create/update, or at least Partial<Item<T,U>>
  /** Timestamp (milliseconds since UNIX epoch) when the local change occurred. */
  timestamp: number;
  /** Number of replication attempts made for this queue item. */
  attempts: number;
  /** Timestamp of the last replication attempt. */
  lastAttempt?: number;
  /** Current processing status of this queue item. */
  status: 'pending' | 'processing' | 'failed' | 'completed';
  /** Error information if the last attempt failed. */
  error?: any;
  /** Simplified information for files that need to be uploaded as part of this item's replication. */
  filesToUpload?: {
    fieldName: string; // The field in the item that holds this file
    fileId: string;    // The local ID of the file (e.g., from StoredFile.fileId)
    originalName: string; // Original name of the file for reference
  }[];
}

// --- Replication Engine Definition ---

/**
 * Manages real-time replication for a single list/collection.
 * It handles both pushing local changes to Firestore and pulling remote changes.
 * FUTURE: Explore SharedWorker for background replication to offload main thread.
 * @template T The type of items in the list (must be an object).
 * @template U The type for user identifiers. Defaults to `any`.
 */
export class ReplicationEngine<T extends object, U = any> {
  // --- Core Properties ---
  private dbCollection?: CollectionReference; // Firestore collection reference
  private readonly _pushQueue = signal<ReplicationQueueItem[]>([]);
  /** Readonly signal representing the current state of the push queue. */
  public readonly pushQueue: Signal<ReplicationQueueItem[]> = this._pushQueue.asReadonly();
  private subscriptions = new Subscription(); // For managing RxJS subscriptions (e.g., Firestore listener)
  private _isReplicating = signal(false);
  /** Readonly signal indicating if replication is currently active. */
  public readonly isReplicating: Signal<boolean> = this._isReplicating.asReadonly();
  private lastPulledServerTimestamp: Timestamp | null = null; // Firestore Timestamp for delta pulls
  private pushQueueStoreName: string;
  private firestoreListenerUnsubscribe?: Unsubscribe;


  /**
   * Constructs the ReplicationEngine.
   * @param listOptions Configuration options for the list being replicated.
   * @param listName The name of the list (used as collection name in Firestore).
   * @param localForageService Service for local data persistence.
   * @param eventBus Service for emitting replication events.
   * @param firestore Optional Firestore instance for remote persistence.
   * @param storage Optional Firebase Storage instance for file handling.
   */
  constructor(
    private listOptions: ListOptions<T>,
    private listName: string,
    private localForageService: LocalForageService,
    private eventBus: EventBusService,
    private firestore?: Firestore,
    private storage?: FirebaseStorage
  ) {
    if (this.firestore) {
      this.dbCollection = collection(this.firestore, this.listName);
    }
    this.pushQueueStoreName = `_replication_push_queue_${this.listName}`;
    this.loadPushQueueFromStorage().then(() => {
      // Optionally start processing queue if start() is called later or auto-start logic exists
    });
  }

  // --- Public Methods ---

  /**
   * Starts the replication process.
   * Initializes Firestore listener and starts processing the push queue.
   */
  public start(): void {
    if (this._isReplicating()) return; // Already running

    this._isReplicating.set(true);
    this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'pulling', message: 'Replication started, initial pull.' });

    if (this.dbCollection) {
      this.setupFirestoreListener();
    } else {
      console.warn(`[ReplicationEngine:${this.listName}] Firestore not configured. Replication will only manage local queue.`);
      this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'paused', message: 'Firestore not configured.' });
    }
    
    // Start processing push queue (e.g. using an interval or a more sophisticated loop)
    // For now, a simple call. A robust implementation would use a persistent loop.
    this.processPushQueue(); 
  }

  /**
   * Stops the replication process.
   * Unsubscribes from Firestore listeners and clears any active processing.
   */
  public stop(): void {
    this._isReplicating.set(false);
    if (this.firestoreListenerUnsubscribe) {
      this.firestoreListenerUnsubscribe();
      this.firestoreListenerUnsubscribe = undefined;
    }
    this.subscriptions.unsubscribe(); // Unsubscribe from any other RxJS subscriptions
    this.subscriptions = new Subscription(); // Reset subscriptions
    this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'stopped', message: 'Replication stopped.' });
    console.log(`[ReplicationEngine:${this.listName}] Replication stopped.`);
  }

  /**
   * Pauses the replication process.
   * Data listeners might remain active, but queue processing is halted.
   */
  public pause(): void {
    if (!this._isReplicating()) return;
    this._isReplicating.set(false);
    // Note: Firestore listener might still be active depending on desired pause behavior.
    // For a full pause of remote interactions, unsubscribe should happen here too.
    // For now, it mainly stops the push queue processing.
    this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'paused', message: 'Replication paused.' });
    console.log(`[ReplicationEngine:${this.listName}] Replication paused.`);
  }

  /**
   * Resumes a paused replication process.
   */
  public resume(): void {
    if (this._isReplicating()) return;
    this._isReplicating.set(true);
    this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'pulling', message: 'Replication resumed.' });
    if (this.dbCollection && !this.firestoreListenerUnsubscribe) {
        this.setupFirestoreListener(); // Re-setup if it was torn down during pause/stop
    }
    this.processPushQueue(); // Restart queue processing
    console.log(`[ReplicationEngine:${this.listName}] Replication resumed.`);
  }

  /**
   * Enqueues a local change (create, update, delete) to be pushed to the remote backend.
   * @param itemId The ID of the item that changed.
   * @param action The type of change.
   * @param itemData The full item data for 'create' or 'update' actions.
   *                 For 'delete', this may be omitted or contain minimal data.
   */
  public async enqueueChange(
    itemId: string,
    action: 'create' | 'update' | 'delete',
    itemData?: Item<T, U> // Full item for create/update
  ): Promise<void> {
    const queueId = crypto.randomUUID();
    
    let filesToUploadInfo: ReplicationQueueItem['filesToUpload'] = [];
    if ((action === 'create' || action === 'update') && itemData) {
        for(const fieldKey in this.listOptions.fields) {
            const fieldName = fieldKey as keyof T;
            if (this.listOptions.fields[fieldName] === 'file') {
                const fileValue = itemData[fieldName] as unknown as StoredFile | undefined;
                if (fileValue && fileValue.fileId && fileValue.state !== 'synced') { // Only unsynced files
                    filesToUploadInfo.push({
                        fieldName: String(fieldName),
                        fileId: fileValue.fileId,
                        originalName: fileValue.originalName
                    });
                }
            }
        }
    }

    const queueItem: ReplicationQueueItem = {
      id: queueId,
      itemId,
      itemType: this.listName,
      action,
      data: itemData, // Store the full item for create/update
      timestamp: Date.now(),
      attempts: 0,
      status: 'pending',
      filesToUpload: filesToUploadInfo.length > 0 ? filesToUploadInfo : undefined,
    };

    this._pushQueue.update(queue => [...queue, queueItem]);
    await this.savePushQueueToStorage();
    console.log(`[ReplicationEngine:${this.listName}] Enqueued change: ${action} for item ${itemId}. Queue size: ${this._pushQueue().length}`);
    
    // Trigger queue processing if not already running and replication is active
    if (this._isReplicating()) {
        this.processPushQueue();
    }
  }

  /**
   * Initiates the leader election process (placeholder).
   * In a multi-tab environment, one tab should be elected as leader to perform
   * certain tasks like managing the replication push queue or handling timers.
   */
  public async initiateLeaderElection(): Promise<void> {
    this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'paused', message: 'Leader election initiated (not implemented).' });
    console.warn(`[${this.listName}] Leader election process initiated but not implemented.`);
    // TODO: Implement actual leader election logic (e.g., using Web Locks API or a Firestore-based mechanism).
    // On becoming leader, set a flag and potentially resume/start more active replication.
    // On losing leadership, pause certain replication tasks.
    this.eventBus.emitLeaderElection({ isLeader: false, listName: this.listName, timestamp: Date.now() }); // Simulate not being leader
  }

  // --- Private/Placeholder Methods ---

  /** @private Loads the push queue from LocalForage. */
  private async loadPushQueueFromStorage(): Promise<void> {
    try {
      const storedQueue = await this.localForageService.getItem<ReplicationQueueItem[]>(this.pushQueueStoreName, 'queue');
      if (storedQueue) {
        this._pushQueue.set(storedQueue);
        console.log(`[ReplicationEngine:${this.listName}] Push queue loaded from storage. Size: ${storedQueue.length}`);
      } else {
        this._pushQueue.set([]);
      }
    } catch (error) {
      console.error(`[ReplicationEngine:${this.listName}] Error loading push queue from storage:`, error);
      this._pushQueue.set([]); // Start with an empty queue on error
    }
  }

  /** @private Saves the current push queue to LocalForage. */
  private async savePushQueueToStorage(): Promise<void> {
    try {
      await this.localForageService.setItem(this.pushQueueStoreName, 'queue', this._pushQueue());
    } catch (error) {
      console.error(`[ReplicationEngine:${this.listName}] Error saving push queue to storage:`, error);
      // Optionally, emit an event or retry
    }
  }

  /** @private Sets up the Firestore listener for incoming changes. */
  private setupFirestoreListener(): void {
    if (!this.dbCollection || !this.firestore) {
        console.warn(`[ReplicationEngine:${this.listName}] Firestore not configured, cannot set up listener.`);
        return;
    }
    if (this.firestoreListenerUnsubscribe) { // Unsubscribe from previous listener if any
        this.firestoreListenerUnsubscribe();
    }

    console.log(`[ReplicationEngine:${this.listName}] Setting up Firestore listener. Last pulled timestamp:`, this.lastPulledServerTimestamp);
    
    // Query for documents updated after the last pulled server timestamp.
    // Firestore's serverTimestamp is an object, so direct comparison needs care.
    // Using a server-side '_updatedAtServer' field populated with serverTimestamp() is more robust.
    // For client-side _updatedAt (ISO string), this query is more complex or less reliable across clients.
    // Assuming a field like `_remoteUpdatedAt` that is a Firestore Timestamp.
    // If `_updatedAt` is a client-set ISO string, this query won't work as intended for deltas.
    // For this placeholder, we'll assume a server-side timestamp field or fetch all and filter.
    // A more robust delta query typically relies on a server-generated timestamp.
    const q = query(this.dbCollection, where('_updatedAt', '>', this.lastPulledServerTimestamp || new Date(0)), orderBy('_updatedAt'));
    // Using `_updatedAt` assumes it's a Firestore Timestamp. If it's a string, this query is problematic.

    this.firestoreListenerUnsubscribe = onSnapshot(q, 
      (snapshot) => {
        if (!this._isReplicating()) return; // Don't process if not replicating

        this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'pulling', direction: 'pull', message: `Received ${snapshot.docChanges().length} changes.` });
        snapshot.docChanges().forEach(async (change) => {
          const doc = change.doc;
          console.log(`[ReplicationEngine:${this.listName}] Incoming doc change: ${change.type} for doc ${doc.id}`);
          if (change.type === 'added' || change.type === 'modified') {
            await this.handleIncomingDoc(doc as DocumentSnapshot<T>); // Cast needed if using converters
          } else if (change.type === 'removed') {
            // Handle remote deletion: remove from local store
            try {
                await this.localForageService.removeItem(this.listName, doc.id);
                // TODO: Need to update SignalStateService as well. This requires access to it,
                // or the ListRef should handle it via an event. For now, log.
                console.log(`[ReplicationEngine:${this.listName}] Item ${doc.id} removed locally due to remote delete.`);
            } catch (error) {
                console.error(`[ReplicationEngine:${this.listName}] Error removing item ${doc.id} locally:`, error);
                this.eventBus.emitSyncError({listName: this.listName, itemId: doc.id, error, operation: 'delete_item_remote'});
            }
          }
          // Update lastPulledServerTimestamp with the server timestamp of the processed document
          // This requires the document to have a server timestamp field.
          const remoteTimestamp = doc.data()?._updatedAt; // Assuming _updatedAt is a Firestore Timestamp
          if (remoteTimestamp instanceof Timestamp && (!this.lastPulledServerTimestamp || remoteTimestamp.toMillis() > this.lastPulledServerTimestamp.toMillis())) {
            this.lastPulledServerTimestamp = remoteTimestamp;
          }
        });
        if (snapshot.docChanges().length > 0) {
            this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'in_sync', message: 'Finished processing incoming changes.' });
        }
      },
      (error) => {
        console.error(`[ReplicationEngine:${this.listName}] Error in Firestore listener:`, error);
        this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'error', error, message: 'Firestore listener error.' });
        this._isReplicating.set(false); // Stop replication on listener error
      }
    );
    this.subscriptions.add(() => {
        if (this.firestoreListenerUnsubscribe) this.firestoreListenerUnsubscribe();
    });
  }

  /** @private Processes the push queue. Placeholder implementation. */
  private async processPushQueue(): Promise<void> {
    if (!this._isReplicating() || this._pushQueue().length === 0) {
      if (this._pushQueue().length === 0 && this._isReplicating()) {
        this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'in_sync', message: 'Push queue empty, all local changes synced.' });
      }
      return;
    }

    this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'pushing', direction: 'push', message: `Processing ${this._pushQueue().length} items in push queue.` });
    
    // Simple sequential processing for this placeholder
    const queueCopy = [...this._pushQueue()]; // Process a copy
    for (const queueItem of queueCopy) {
      if (!this._isReplicating()) break; // Stop if replication is paused/stopped

      // Update status to 'processing' (and save queue)
      this._pushQueue.update(q => q.map(qi => qi.id === queueItem.id ? {...qi, status: 'processing', attempts: qi.attempts + 1, lastAttempt: Date.now()} : qi));
      await this.savePushQueueToStorage();
      
      await this.processSinglePushItem(queueItem);
    }
    // Further calls to processPushQueue would be needed if new items are enqueued during processing
    // or if a more robust loop (like with setInterval or requestIdleCallback) is used.
    if (this._isReplicating() && this._pushQueue().length > 0) {
        // If items remain (e.g. new items added during processing, or failures not removed yet)
        // schedule next run. For placeholder, this is a simple tail call.
        // A real implementation needs guards against rapid loops on persistent failure.
        // setTimeout(() => this.processPushQueue(), 1000); // Basic retry/continuation
    } else if (this._isReplicating()) {
        this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'in_sync', message: 'Push queue processed.' });
    }
  }

  /** @private Processes a single item from the push queue. Placeholder. */
  private async processSinglePushItem(queueItem: ReplicationQueueItem): Promise<void> {
    console.log(`[ReplicationEngine:${this.listName}] Processing push item:`, queueItem.id, queueItem.action, queueItem.itemId);
    if (!this.dbCollection || !this.firestore) {
        console.warn(`[ReplicationEngine:${this.listName}] Firestore not available. Cannot process push item ${queueItem.id}.`);
        this._pushQueue.update(q => q.map(qi => qi.id === queueItem.id ? {...qi, status: 'failed', error: 'Firestore not configured'} : qi));
        await this.savePushQueueToStorage();
        return;
    }

    try {
      // Placeholder: Simulate API call
      // await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network latency

      // Step 1: Upload files if any
      let processedData = queueItem.data ? { ...queueItem.data } : {}; // Copy data
      if (queueItem.filesToUpload && queueItem.filesToUpload.length > 0 && this.storage) {
        for (const fileInfo of queueItem.filesToUpload) {
            const fileBlob = await this.localForageService.retrieveFile(fileInfo.fileId);
            if (fileBlob) {
                const storagePath = await this.uploadFile(fileInfo.fileId, fileBlob);
                // Update item data with remote storage path
                // Assuming fileInfo.fieldName points to a StoredFile object or just its path in itemData
                if (processedData[fileInfo.fieldName]) {
                    (processedData[fileInfo.fieldName] as StoredFile).storagePath = storagePath;
                    (processedData[fileInfo.fieldName] as StoredFile).state = 'synced';
                } else {
                     // This case implies the file field was not part of the original itemData, which is unusual.
                     // Or, structure is { fieldName: 'remotePath' }
                    processedData[fileInfo.fieldName] = { storagePath, state: 'synced' };
                }
            } else {
                throw new Error(`File blob not found locally for fileId: ${fileInfo.fileId}`);
            }
        }
      }


      // Step 2: Perform Firestore operation
      const itemDocRef = doc(this.dbCollection, queueItem.itemId);
      const serverTimestampValue = serverTimestamp(); // Get Firestore server timestamp

      // Add/update _remoteUpdatedAt for delta queries by Firestore listener
      // This assumes the Item<T,U> structure can hold this field.
      // It's often better to have a dedicated sub-object for metadata e.g. item._meta._remoteUpdatedAt
      const dataWithServerTimestamp = { ...processedData, _remoteUpdatedAt: serverTimestampValue };


      if (queueItem.action === 'create') {
        await setDoc(itemDocRef, dataWithServerTimestamp);
      } else if (queueItem.action === 'update') {
        // For update, it's crucial that queueItem.data contains the *full* item
        // or specific fields to update. Firestore's updateDoc does partial merge.
        // If queueItem.data is partial, updateDoc is fine. If it's full, setDoc with merge might be an option.
        // Here, assuming dataWithServerTimestamp contains the fields to be updated.
        await updateDoc(itemDocRef, dataWithServerTimestamp);
      } else if (queueItem.action === 'delete') {
        await deleteDoc(itemDocRef);
      }

      // If successful, remove from queue
      this._pushQueue.update(q => q.filter(qi => qi.id !== queueItem.id));
      await this.savePushQueueToStorage();
      console.log(`[ReplicationEngine:${this.listName}] Successfully processed push item ${queueItem.id}.`);
      this.eventBus.emitReplicationStatus({ listName: this.listName, status: 'pushing', direction: 'push', message: `Item ${queueItem.itemId} synced.` });

    } catch (error: any) {
      console.error(`[ReplicationEngine:${this.listName}] Error processing push item ${queueItem.id}:`, error);
      this.eventBus.emitSyncError({listName: this.listName, itemId: queueItem.itemId, error, operation: `${queueItem.action}_item` as any });
      this._pushQueue.update(q => q.map(qi => qi.id === queueItem.id ? {...qi, status: 'failed', error: error.message || error} : qi));
      await this.savePushQueueToStorage();
    }
  }

  /** @private Handles an incoming document change from Firestore. Placeholder. */
  private async handleIncomingDoc(docSnap: DocumentSnapshot<T>): Promise<void> { // T might need to be Item<T,U>
    console.log(`[ReplicationEngine:${this.listName}] Handling incoming doc:`, docSnap.id, docSnap.data());
    const remoteItem = docSnap.data() as Item<T, U>; // Assuming data is Item<T,U> or convert
    if (!remoteItem) {
      console.warn(`[ReplicationEngine:${this.listName}] Incoming doc ${docSnap.id} has no data. Skipping.`);
      return;
    }

    // Placeholder: Basic conflict resolution (remote wins) or just update local
    try {
      // TODO: Implement full custom conflictResolver logic from listOptions.conflictResolver if provided. Current is basic last-write-wins.
      // TODO: Implement actual conflict resolution if necessary.
      // For now, remote data overwrites local if timestamps differ or local doesn't exist.
      const localItem = await this.localForageService.getItem<Item<T,U>>(this.listName, docSnap.id);

      // Simple "last write wins" based on a server timestamp, assuming _remoteUpdatedAt exists
      // This is a very basic conflict strategy.
      // @ts-ignore
      const remoteTimestamp = remoteItem._remoteUpdatedAt instanceof Timestamp ? remoteItem._remoteUpdatedAt.toMillis() : Date.parse(remoteItem._updatedAt);
      const localTimestamp = localItem ? Date.parse(localItem._updatedAt) : 0;

      if (!localItem || remoteTimestamp > localTimestamp) {
        console.log(`[ReplicationEngine:${this.listName}] Updating local item ${docSnap.id} with remote data.`);
        await this.localForageService.setItem(this.listName, docSnap.id, remoteItem);
        // TODO: Update SignalStateService. This requires ListRef or direct access.
        // This is a key part of making remote changes reflect in the UI.
        // Example: this.listRef.signalStateService.updateItemInState(remoteItem); (if listRef was passed in or accessible)
        this.eventBus.emitItemChange({ listName: this.listName, itemId: docSnap.id, item: remoteItem, operation: localItem ? 'updated' : 'created' });

      } else {
        console.log(`[ReplicationEngine:${this.listName}] Local item ${docSnap.id} is same or newer. No update from remote.`)
      }

    } catch (error) {
      console.error(`[ReplicationEngine:${this.listName}] Error handling incoming doc ${docSnap.id}:`, error);
      this.eventBus.emitSyncError({listName: this.listName, itemId: docSnap.id, error, operation: 'pull_item'});
    }
  }

  /** @private Uploads a file to Firebase Storage. Placeholder. */
  private async uploadFile(fileId: string, blob: Blob): Promise<string> {
    console.log(`[ReplicationEngine:${this.listName}] Uploading file: ${fileId}`);
    if (!this.storage) throw new Error("Firebase Storage not configured.");

    const storageRef = ref(this.storage, `${this.listName}/${fileId}`); // Example path
    // Simulate upload, in reality use uploadBytesResumable for progress
    await uploadBytesResumable(storageRef, blob);
    const downloadURL = await getDownloadURL(storageRef);
    console.log(`[ReplicationEngine:${this.listName}] File ${fileId} uploaded to ${downloadURL}`);
    return downloadURL; // Or just storagePath `${this.listName}/${fileId}`
  }

  /** @private Downloads a file from Firebase Storage. Placeholder. */
  private async downloadFile(storagePath: string): Promise<Blob> {
    console.log(`[ReplicationEngine:${this.listName}] Downloading file from: ${storagePath}`);
    if (!this.storage) throw new Error("Firebase Storage not configured.");
    
    const storageRef = ref(this.storage, storagePath);
    const response = await fetch(await getDownloadURL(storageRef));
    if (!response.ok) {
        throw new Error(`Failed to download file ${storagePath}: ${response.statusText}`);
    }
    return response.blob();
  }
}
