/**
 * @file Implements an RxJS-based event bus for inter-service communication.
 * This service allows different parts of the library (and potentially the consuming application)
 * to publish and subscribe to significant events occurring within the local-first system.
 */

import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { Item } from '../types'; // Assuming Item is exported from ../types

// --- Event Type Definitions ---

/**
 * Represents the status of data replication for a specific list.
 */
export interface ReplicationStatusEvent {
  /** The name of the list whose replication status is being reported. */
  listName: string;
  /** The current status of replication. */
  status: 'pushing' | 'pulling' | 'in_sync' | 'paused' | 'error' | 'stopped';
  /** The direction of data flow if status is 'pushing' or 'pulling'. */
  direction?: 'push' | 'pull';
  /** Any error object associated with an 'error' status. */
  error?: any;
  /** An optional message providing more details about the status. */
  message?: string;
}

/**
 * Represents an error that occurred during a synchronization operation.
 */
export interface SyncErrorEvent {
  /** The name of the list where the sync error occurred. */
  listName: string;
  /** The ID of the item involved in the error, if applicable. */
  itemId?: string;
  /** The ID of the file involved in the error, if applicable. */
  fileId?: string;
  /** The error object or a description of the error. */
  error: any;
  /** The specific synchronization operation that failed. */
  operation: 'push_item' | 'pull_item' | 'delete_item_remote' | 'file_upload' | 'file_download' | 'file_delete_remote';
  /** An optional user-friendly message describing the error. */
  message?: string;
}

/**
 * Represents an event related to leader election status.
 * Leader election is used to ensure only one tab/instance performs certain background tasks.
 */
export interface LeaderElectionEvent {
  /** True if the current instance has become the leader, false otherwise. */
  isLeader: boolean;
  /** The name of the list for which leader election is relevant, if applicable (e.g., per-list sync leaders). */
  listName?: string;
  /** Timestamp (milliseconds since UNIX epoch) when the event occurred. */
  timestamp: number;
}

/**
 * Represents a change to an item within a list (creation, update, deletion, restoration).
 * @template T The type of the item data.
 * @template U The type for user identifiers.
 */
export interface ItemChangeEvent<T extends object, U = any> {
  /** The name of the list where the item change occurred. */
  listName: string;
  /** The type of operation that caused the change. */
  operation: 'created' | 'updated' | 'deleted' | 'restored';
  /** The ID of the item that changed. */
  itemId: string;
  /** The current state of the item after the change. Undefined for 'deleted' if the item is hard-deleted. */
  item?: Item<T, U>;
  /** The value of the item before the update or deletion. Useful for undo or auditing. */
  previousValue?: Partial<Item<T,U>>;
  /** For 'updated' operations, this may contain only the fields that actually changed. */
  changes?: Partial<Item<T,U>>;
  /** Identifier for the user or process that performed the delete operation (for 'deleted' events). */
  deletedBy?: U | string | null;
}


// --- EventBusService Definition ---

/**
 * Provides a centralized event bus for publishing and subscribing to various
 * local-first library events using RxJS Subjects and Observables.
 */
@Injectable({
  providedIn: 'root',
})
export class EventBusService {
  // --- Replication Status Event Stream ---
  private readonly _replicationState = new Subject<ReplicationStatusEvent>();
  /** Observable for replication status events. */
  public readonly replicationState$: Observable<ReplicationStatusEvent> = this._replicationState.asObservable();

  // --- Sync Error Event Stream ---
  private readonly _syncError = new Subject<SyncErrorEvent>();
  /** Observable for synchronization error events. */
  public readonly syncError$: Observable<SyncErrorEvent> = this._syncError.asObservable();

  // --- Leader Election Event Stream ---
  private readonly _leaderElection = new Subject<LeaderElectionEvent>();
  /** Observable for leader election events. */
  public readonly leaderElection$: Observable<LeaderElectionEvent> = this._leaderElection.asObservable();

  // --- Item Change Event Stream ---
  // Using 'any' for the generic subject type here for simplicity in a global bus.
  // Consumers can filter by listName and cast to their specific ItemChangeEvent<T, U> type.
  private readonly _itemChanged = new Subject<ItemChangeEvent<any, any>>();
  /** Observable for item change events (creations, updates, deletions, restorations). */
  public readonly itemChanged$: Observable<ItemChangeEvent<any, any>> = this._itemChanged.asObservable();

  constructor() {}

  // --- Emit Methods ---

  /**
   * Emits a replication status event.
   * @param event The replication status event to emit.
   */
  emitReplicationStatus(event: ReplicationStatusEvent): void {
    this._replicationState.next(event);
  }

  /**
   * Emits a synchronization error event.
   * @param event The sync error event to emit.
   */
  emitSyncError(event: SyncErrorEvent): void {
    this._syncError.next(event);
  }

  /**
   * Emits a leader election event.
   * @param event The leader election event to emit.
   */
  emitLeaderElection(event: LeaderElectionEvent): void {
    this._leaderElection.next(event);
  }

  /**
   * Emits an item change event.
   * @template T The type of the item data.
   * @template U The type for user identifiers.
   * @param event The item change event to emit.
   */
  emitItemChange<T extends object, U = any>(event: ItemChangeEvent<T, U>): void {
    // Cast to ItemChangeEvent<any, any> for the Subject, but the emitted event retains its original strong typing.
    this._itemChanged.next(event as ItemChangeEvent<any, any>);
  }
}
