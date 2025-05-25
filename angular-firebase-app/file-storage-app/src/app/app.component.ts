import { Component, OnInit, OnDestroy, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common'; // Import CommonModule
import { RouterOutlet } from '@angular/router';
import { LeaderElectionService } from './workers/LeaderElection.ts'; // Adjusted path to .ts
import { SharedWorkerService, SharedWorkerStatus } from './workers/SharedWorker.ts'; // Adjusted path to .ts
import { FormsModule } from '@angular/forms'; // For ngModel if using input for messages

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule], // Add CommonModule & FormsModule
  template: `
    <h1>App Component - Leader Election & SharedWorker Demo</h1>
    <p>My Tab ID: <strong>{{ leaderElectionService.instanceId }}</strong></p>
    <p>Am I Leader? <strong>{{ isLeader() }}</strong></p>
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
    
    <!-- Studio Component can be here if needed -->
    <!-- <app-studio [listRefs]="listRefsSignal()"></app-studio> -->
  `,
  styles: [`
    h1, h2, p { margin-bottom: 10px; }
    h4 { margin-top: 15px; margin-bottom: 5px;}
    button { margin-right: 5px; margin-bottom: 5px;}
    input[type="text"] { margin-right: 5px; padding: 4px; }
    pre { background-color: #f0f0f0; padding: 10px; border-radius: 3px; }
    hr { margin: 20px 0; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'file-storage-app'; // Default from Angular new
  
  // Injected services
  public leaderElectionService = inject(LeaderElectionService); // Use inject for cleaner DI
  public sharedWorkerService = inject(SharedWorkerService);

  // Signals for template binding
  isLeader = this.leaderElectionService.isLeader;
  workerStatus = this.sharedWorkerService.connectionStatus;
  lastWorkerMessage = this.sharedWorkerService.receivedMessage;

  messageText: string = ''; // For custom message input

  constructor() {
    console.log('[AppComponent] Constructor - My Tab ID:', this.leaderElectionService.instanceId);

    // Effect for leader-specific actions
    effect(() => {
      const currentIsLeader = this.isLeader();
      console.log(`[AppComponent] Leadership status changed: ${currentIsLeader}. My ID: ${this.leaderElectionService.instanceId}`);
      
      if (currentIsLeader) {
        console.log(`[AppComponent] This tab (${this.leaderElectionService.instanceId}) became LEADER.`);
        // Ensure worker is connected if this tab is leader
        if (this.sharedWorkerService.connectionStatus() !== 'connected' &&
            this.sharedWorkerService.connectionStatus() !== 'connecting' &&
            this.sharedWorkerService.connectionStatus() !== 'unsupported') {
          this.sharedWorkerService.connect();
        }
        
        // Send a leader announcement message to the worker
        // Adding a slight delay to allow connection to establish if just connected.
        setTimeout(() => {
          if (this.sharedWorkerService.connectionStatus() === 'connected') {
            this.sharedWorkerService.sendMessage({ 
              action: 'LEADER_ANNOUNCEMENT', 
              leaderId: this.leaderElectionService.instanceId,
              timestamp: new Date().toISOString()
            });
          }
        }, 1000); // 1 sec delay
      } else {
        console.log(`[AppComponent] This tab (${this.leaderElectionService.instanceId}) is NOT leader.`);
        // Optionally, if non-leaders should disconnect or behave differently with SharedWorker.
        // For this demo, all tabs can remain connected if they choose to.
      }
    });
  }

  ngOnInit(): void {
    // Manually connect if not leader, or if auto-connect is not in SharedWorkerService constructor
    // For this demo, any tab can try to connect. Leader effect handles specific leader actions.
    // if (this.sharedWorkerService.connectionStatus() === 'disconnected') {
    //  this.sharedWorkerService.connect();
    // }
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
        this.messageText = ''; // Clear input after sending custom message
      }
    } else {
      console.warn('[AppComponent] Cannot send message, SharedWorker not connected.');
      // Optionally, try to connect: this.sharedWorkerService.connect();
    }
  }

  ngOnDestroy(): void {
    // Services should clean up themselves (LeaderElectionService and SharedWorkerService have ngOnDestroy)
  }
}
