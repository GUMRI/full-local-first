// In shared-data.service.ts
import { Injectable, OnDestroy, Signal, WritableSignal, signal, effect } from '@angular/core';
import { LeaderElectionService } from '../workers/LeaderElectionService';
import { LoggerService } from '../utils/Logger.ts';

const SHARED_DATA_CHANNEL_NAME = 'appSharedDataChannel';
const LEADER_DATA_FETCH_INTERVAL_MS = 10000;

interface SharedDataPayload {
  timestamp: number;
  value: any; 
  sourceInstanceId?: string; 
}

@Injectable({
  providedIn: 'root'
})
export class SharedDataService implements OnDestroy {
  private readonly _sharedData: WritableSignal<SharedDataPayload | null> = signal(null);
  public readonly sharedData: Signal<SharedDataPayload | null> = this._sharedData.asReadonly();

  private dataChannel: BroadcastChannel;
  private leaderDataInterval?: any;

  constructor(
    public leaderElectionService: LeaderElectionService,
    private logger: LoggerService
  ) {
    this.logger.info(`[SharedDataService-${this.myId}] Initializing.`);
    this.dataChannel = new BroadcastChannel(SHARED_DATA_CHANNEL_NAME);
    this.dataChannel.onmessage = this.handleDataMessage.bind(this);

    effect(() => {
      const isLeader = this.leaderElectionService.isLeader();
      this.logger.info(`[SharedDataService-${this.myId}] Leadership status changed: ${isLeader}`);
      if (isLeader) {
        this.startLeaderTasks();
      } else {
        this.stopLeaderTasks();
      }
    });
  }

  private startLeaderTasks(): void {
    this.logger.info(`[SharedDataService-${this.myId}] Became LEADER. Starting leader tasks.`);
    if (this.leaderDataInterval) {
      clearInterval(this.leaderDataInterval);
    }
    this.fetchAndBroadcastData(); 
    this.leaderDataInterval = setInterval(() => {
      this.fetchAndBroadcastData();
    }, LEADER_DATA_FETCH_INTERVAL_MS);
  }

  private stopLeaderTasks(): void {
    this.logger.info(`[SharedDataService-${this.myId}] Lost LEADERSHIP or is FOLLOWER. Stopping leader tasks.`);
    if (this.leaderDataInterval) {
      clearInterval(this.leaderDataInterval);
      this.leaderDataInterval = undefined;
    }
  }

  private fetchAndBroadcastData(): void {
    const simulatedData = {
      message: 'Live data update!',
      randomNumber: Math.random(),
      fetchedAt: new Date().toLocaleTimeString()
    };
    const payload: SharedDataPayload = {
      timestamp: Date.now(),
      value: simulatedData,
      sourceInstanceId: this.myId 
    };
    this.logger.info(`[SharedDataService-${this.myId}] (Leader) Fetched new data, broadcasting:`, payload);
    this._sharedData.set(payload); // Leader updates its own signal
    try {
      this.dataChannel.postMessage(payload);
    } catch (error) {
      this.logger.error(`[SharedDataService-${this.myId}] (Leader) Error broadcasting data:`, error);
    }
  }

  // --- Updated handleDataMessage method ---
  private handleDataMessage(event: MessageEvent<SharedDataPayload>): void {
    const receivedPayload = event.data;
    this.logger.debug(`[SharedDataService-${this.myId}] Message received on dataChannel:`, receivedPayload);

    // Ignore messages if this instance is the leader (it shouldn't process its own broadcasts)
    // or if the message is from itself (though BroadcastChannel typically doesn't self-deliver).
    if (this.leaderElectionService.isLeader() || receivedPayload.sourceInstanceId === this.myId) {
      // Leader might receive its own message if channel is misconfigured or for certain test scenarios.
      // Or, if a tab briefly becomes leader then follower, it might get a message it previously sent.
      // Generally, leader should not act on messages it originated for this pattern.
      if (receivedPayload.sourceInstanceId === this.myId) {
        // this.logger.debug(`[SharedDataService-${this.myId}] (Leader) Ignoring own broadcasted message.`);
      } else if (this.leaderElectionService.isLeader()) {
        // This case should ideally not happen if a clear leader is established and it's the sole broadcaster.
        // Could indicate a brief period of leader ambiguity or a message from a previous leader.
        this.logger.warn(`[SharedDataService-${this.myId}] (Leader) Received message from another source ${receivedPayload.sourceInstanceId}. Current Leader (self): ${this.myId}. Ignoring.`);
      }
      return;
    }

    // Follower tab: Update local sharedData signal with the data from the leader
    this.logger.info(`[SharedDataService-${this.myId}] (Follower) Updating sharedData from leader ${receivedPayload.sourceInstanceId}:`, receivedPayload);
    this._sharedData.set(receivedPayload);
  }
  
  public get myId(): string {
      return this.leaderElectionService.instanceId;
  }
  
  // Helper to get current leader ID for logging in handleDataMessage (if LeaderElectionService exposes it)
  // Assuming LeaderElectionService has a way to get currentLeaderId, e.g. a signal or public property.
  // For now, let's assume it's for logging context and LeaderElectionService.isLeader() is the primary check.
  // private currentLeaderId(): string | undefined { // Commented out as it accesses private state of another service
      // Accessing private property for example, ideally LeaderElectionService would expose this if needed.
      // This is just for a log message, not critical for logic if not available.
      // return (this.leaderElectionService as any).currentLeaderId; 
      // return undefined; // Placeholder, as direct access to other service's private state is bad.
  // }


  ngOnDestroy(): void {
    this.logger.info(`[SharedDataService-${this.myId}] Destroying.`);
    this.dataChannel.close();
    if (this.leaderDataInterval) {
      clearInterval(this.leaderDataInterval);
    }
  }
}
