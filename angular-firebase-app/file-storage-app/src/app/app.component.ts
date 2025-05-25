// In app.component.ts
import { Component, OnInit, OnDestroy, effect, inject, Signal } from '@angular/core'; // Added Signal
import { CommonModule, JsonPipe, DatePipe } from '@angular/common'; // Added DatePipe
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms'; 

import { LeaderElectionService } from './workers/LeaderElectionService.ts'; // Ensure .ts
import { SharedWorkerService, SharedWorkerStatus } from './workers/SharedWorkerService.ts'; // Ensure .ts
import { SharedDataService } from './services/shared-data.service.ts'; // <-- Import SharedDataService & ensure .ts

// Define an interface for the expected structure of sharedData.value for the template
interface MyDemoSharedValue {
  message: string;
  randomNumber: number;
  fetchedAt: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule, JsonPipe, DatePipe], // JsonPipe & DatePipe for displaying object
  template: `
    <h1>App Component - Leader Election & SharedWorker Demo</h1>
    <p>My Tab ID: <strong>{{ leaderElectionService.instanceId }}</strong></p>
    <p>Am I Leader? <strong>{{ isLeader() }}</strong></p>
    
    <hr>
    <h2>Shared Data (from Leader via BroadcastChannel)</h2>
    <div *ngIf="currentSharedData(); else noSharedData">
      <p>Source Tab (Leader ID): <strong>{{ currentSharedData()?.sourceInstanceId }}</strong></p>
      <p>Data Timestamp: <strong>{{ currentSharedData()?.timestamp | date:'mediumTime' }}</strong></p>
      <div>
        <p>Value:</p>
        <pre>{{ currentSharedData()?.value | json }}</pre>
      </div>
    </div>
    <ng-template #noSharedData><p>No shared data received yet, or I am the leader initially not broadcasting to myself in this view.</p></ng-template>

    <hr>
    <h2>Shared Worker</h2>
    <p>Connection Status: <strong>{{ workerStatus() }}</strong></p>
    <button (click)="connectWorker()" [disabled]="workerStatus() === 'connected' || workerStatus() === 'connecting' || workerStatus() === 'unsupported'">Connect SharedWorker</button>
    <button (click)="disconnectWorker()" [disabled]="workerStatus() === 'disconnected' || workerStatus() === 'unsupported'">Disconnect SharedWorker</button>
    
    <div>
      <h4>Send Message to Worker:</h4>
      <input type="text" [(ngModel)]="messageText" placeholder="Enter message content">
      <button (click)="sendMessageToWorker('CUSTOM_MESSAGE', { text: messageText })">Send Custom Message</button>
      <button (click)="sendMessageToWorker('INCREMENT_COUNTER')">Increment Shared Counter</button>
      <button (click)="sendMessageToWorker('GET_COUNTER')">Get Shared Counter</button>
    </div>

    <div *ngIf="lastWorkerMessage()">
      <h4>Last Message from SharedWorker:</h4>
      <pre>{{ lastWorkerMessage() | json }}</pre>
    </div>
  `,
  styles: [`
    h1, h2, p { margin-bottom: 10px; }
    h4 { margin-top: 15px; margin-bottom: 5px;}
    button { margin-right: 5px; margin-bottom: 5px;}
    input[type="text"] { margin-right: 5px; padding: 4px; }
    pre { background-color: #f0f0f0; padding: 10px; border-radius: 3px; white-space: pre-wrap; }
    hr { margin: 20px 0; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'file-storage-app';
  
  public leaderElectionService = inject(LeaderElectionService);
  public sharedWorkerService = inject(SharedWorkerService);
  public sharedDataService = inject(SharedDataService); // <-- Inject SharedDataService

  isLeader = this.leaderElectionService.isLeader;
  workerStatus = this.sharedWorkerService.connectionStatus;
  lastWorkerMessage = this.sharedWorkerService.receivedMessage;
  currentSharedData = this.sharedDataService.sharedData; // <-- Expose sharedData signal

  messageText: string = '';

  constructor() {
    console.log('[AppComponent] Constructor - My Tab ID:', this.leaderElectionService.instanceId);

    effect(() => {
      const currentIsLeader = this.isLeader();
      console.log(`[AppComponent] Leadership status changed: ${currentIsLeader}. My ID: ${this.leaderElectionService.instanceId}`);
      
      if (currentIsLeader) {
        console.log(`[AppComponent] This tab (${this.leaderElectionService.instanceId}) became LEADER.`);
        if (this.sharedWorkerService.connectionStatus() !== 'connected' &&
            this.sharedWorkerService.connectionStatus() !== 'connecting' &&
            this.sharedWorkerService.connectionStatus() !== 'unsupported') {
          this.sharedWorkerService.connect();
        }
        setTimeout(() => {
          if (this.sharedWorkerService.connectionStatus() === 'connected') {
            this.sharedWorkerService.sendMessage({ 
              action: 'LEADER_ANNOUNCEMENT', 
              leaderId: this.leaderElectionService.instanceId,
              timestamp: new Date().toISOString()
            });
          }
        }, 1000);
      } else {
        console.log(`[AppComponent] This tab (${this.leaderElectionService.instanceId}) is NOT leader.`);
      }
    });

    // Effect to log shared data changes for debugging
    effect(() => {
        const data = this.currentSharedData();
        if (data) {
            console.log(`[AppComponent-${this.leaderElectionService.instanceId}] Detected change in sharedData:`, data);
        }
    });
  }

  ngOnInit(): void {
    // Auto-connect SharedWorker for all tabs for this demo, leader specific messages are handled by effect.
     if (this.sharedWorkerService.connectionStatus() === 'disconnected') {
       this.sharedWorkerService.connect();
     }
  }

  connectWorker(): void {
    this.sharedWorkerService.connect();
  }

  disconnectWorker(): void {
    this.sharedWorkerService.disconnect();
  }

  sendMessageToWorker(actionType: string, data?: any): void {
    if (this.sharedWorkerService.connectionStatus() === 'connected') {
      const messagePayload: any = { action: actionType, clientId: this.leaderElectionService.instanceId };
      if (data) {
        messagePayload.data = data;
      }
      this.sharedWorkerService.sendMessage(messagePayload);
      if (actionType === 'CUSTOM_MESSAGE') {
        this.messageText = '';
      }
    } else {
      console.warn('[AppComponent] Cannot send message, SharedWorker not connected.');
    }
  }

  ngOnDestroy(): void {
    // Services should clean up themselves
  }
}
