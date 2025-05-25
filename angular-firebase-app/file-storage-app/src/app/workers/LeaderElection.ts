import { Injectable, OnDestroy, signal, WritableSignal, Signal } from '@angular/core';

const LEADER_CHANNEL_NAME = 'appLeaderElection';
const Messages = {
  REQUEST_CANDIDACY: 'REQUEST_CANDIDACY', // Tab announces it wants to be leader
  ACKNOWLEDGE_CANDIDACY: 'ACKNOWLEDGE_CANDIDACY', // Another tab acknowledges, potentially denying candidacy
  CLAIM_LEADERSHIP: 'CLAIM_LEADERSHIP', // Tab claims leadership
  LEADER_HEARTBEAT: 'LEADER_HEARTBEAT',   // Leader sends periodic heartbeat
  LEADER_ABDICATE: 'LEADER_ABDICATE'    // Leader steps down
};
const ELECTION_TIMEOUT_MS = 100; // Time to wait for other candidates
const HEARTBEAT_INTERVAL_MS = 2000; // Leader sends heartbeat
const LEADER_TIMEOUT_MS = 5000; // Follower waits for heartbeat

@Injectable({
  providedIn: 'root'
})
export class LeaderElectionService implements OnDestroy {
  private readonly _isLeader: WritableSignal<boolean> = signal(false);
  public readonly isLeader: Signal<boolean> = this._isLeader.asReadonly();

  private channel: BroadcastChannel;
  public readonly instanceId: string; // Unique ID for this tab/instance - MADE PUBLIC READONLY
  private currentLeaderId?: string;
  
  private electionAttemptTimeout?: any;
  private leaderHeartbeatInterval?: any;
  private followerPingTimeout?: any;

  constructor() {
    this.instanceId = crypto.randomUUID();
    this.channel = new BroadcastChannel(LEADER_CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);

    console.log(`[LeaderElection] Instance ${this.instanceId} starting election.`);
    this.attemptElection();

    // Handle tab closing
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }

  private handleBeforeUnload(): void {
    if (this._isLeader()) {
      this.abdicateLeadership();
    }
  }

  private attemptElection(): void {
    console.log(`[LeaderElection] ${this.instanceId} attempting election.`);
    this.clearTimeoutsAndIntervals(); // Clear previous state
    this._isLeader.set(false);
    this.currentLeaderId = undefined;

    // Announce candidacy. If another responds quickly, it might already be leader or also candidating.
    this.channel.postMessage({ type: Messages.REQUEST_CANDIDACY, id: this.instanceId });

    // Wait a short period. If no one else claims leadership or is leader, claim it.
    // This is a simplified election: relies on timing.
    this.electionAttemptTimeout = setTimeout(() => {
      // If by this time we haven't heard of another leader or stronger candidate, claim it.
      if (!this.currentLeaderId) {
        this.claimLeadership();
      }
    }, ELECTION_TIMEOUT_MS + Math.random() * 50); // Add jitter
  }

  private claimLeadership(): void {
    console.log(`[LeaderElection] ${this.instanceId} claiming leadership.`);
    this._isLeader.set(true);
    this.currentLeaderId = this.instanceId;
    this.channel.postMessage({ type: Messages.CLAIM_LEADERSHIP, id: this.instanceId });
    this.startLeaderHeartbeat();
  }

  private abdicateLeadership(): void {
    console.log(`[LeaderElection] ${this.instanceId} abdicating leadership.`);
    this.clearTimeoutsAndIntervals();
    this._isLeader.set(false);
    // Don't set currentLeaderId to undefined here, let new election determine it.
    this.channel.postMessage({ type: Messages.LEADER_ABDICATE, id: this.instanceId });
  }

  private startLeaderHeartbeat(): void {
    if (this.leaderHeartbeatInterval) clearInterval(this.leaderHeartbeatInterval);
    this.leaderHeartbeatInterval = setInterval(() => {
      if (this._isLeader()) {
        // console.log(`[LeaderElection] ${this.instanceId} sending heartbeat.`);
        this.channel.postMessage({ type: Messages.LEADER_HEARTBEAT, id: this.instanceId });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private startFollowerPingTimeout(): void {
    if (this.followerPingTimeout) clearTimeout(this.followerPingTimeout);
    this.followerPingTimeout = setTimeout(() => {
      console.log(`[LeaderElection] ${this.instanceId} - Leader timed out. Attempting new election.`);
      this.currentLeaderId = undefined; // Assume leader is gone
      this._isLeader.set(false); // Ensure not leader
      this.attemptElection();
    }, LEADER_TIMEOUT_MS);
  }
  
  private handleMessage(event: MessageEvent): void {
    const message = event.data;
    // console.log(`[LeaderElection] ${this.instanceId} received message: `, message);

    switch (message.type) {
      case Messages.REQUEST_CANDIDACY:
        // If this tab is leader, assert it.
        // Or if this tab is also candidating and has a "stronger" ID (e.g. lexicographically smaller)
        // For simplicity now: if leader, send heartbeat. If not leader but candidating, ignore if other's ID is different.
        if (this._isLeader() && message.id !== this.instanceId) {
          console.log(`[LeaderElection] ${this.instanceId} (Leader) responding to candidacy request from ${message.id}.`);
          this.channel.postMessage({ type: Messages.LEADER_HEARTBEAT, id: this.instanceId });
        }
        break;

      case Messages.CLAIM_LEADERSHIP:
        if (message.id !== this.instanceId) {
          console.log(`[LeaderElection] ${this.instanceId} acknowledging new leader: ${message.id}.`);
          this.clearTimeoutsAndIntervals(); // Stop own election/heartbeat if any
          this._isLeader.set(false);
          this.currentLeaderId = message.id;
          this.startFollowerPingTimeout(); // Start monitoring the new leader
        }
        break;

      case Messages.LEADER_HEARTBEAT:
        if (message.id !== this.instanceId) { // Heartbeat from another tab
          if (!this.currentLeaderId || this.currentLeaderId !== message.id) {
             console.log(`[LeaderElection] ${this.instanceId} detected leader ${message.id}. Becoming follower.`);
             this.clearTimeoutsAndIntervals(); // Stop own election/heartbeat
             this._isLeader.set(false);
          }
          this.currentLeaderId = message.id;
          this.startFollowerPingTimeout(); // Reset timeout upon receiving heartbeat
        }
        break;
      
      case Messages.LEADER_ABDICATE:
        if (message.id === this.currentLeaderId && message.id !== this.instanceId) {
          console.log(`[LeaderElection] ${this.instanceId} - Leader ${message.id} abdicated. Attempting election.`);
          this.clearTimeoutsAndIntervals();
          this.currentLeaderId = undefined;
          this.attemptElection();
        }
        break;
    }
  }

  private clearTimeoutsAndIntervals(): void {
    if (this.electionAttemptTimeout) clearTimeout(this.electionAttemptTimeout);
    if (this.leaderHeartbeatInterval) clearInterval(this.leaderHeartbeatInterval);
    if (this.followerPingTimeout) clearTimeout(this.followerPingTimeout);
    this.electionAttemptTimeout = undefined;
    this.leaderHeartbeatInterval = undefined;
    this.followerPingTimeout = undefined;
  }

  ngOnDestroy(): void {
    console.log(`[LeaderElection] ${this.instanceId} destroying.`);
    if (this._isLeader()) {
      this.abdicateLeadership();
    }
    this.channel.close();
    this.clearTimeoutsAndIntervals();
    window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }
}
