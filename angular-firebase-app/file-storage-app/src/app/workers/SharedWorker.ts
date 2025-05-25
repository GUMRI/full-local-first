import { Injectable, OnDestroy, signal, WritableSignal, Signal } from '@angular/core';

export type SharedWorkerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'unsupported';

@Injectable({
  providedIn: 'root'
})
export class SharedWorkerService implements OnDestroy {
  private worker?: SharedWorker;
  // private workerPort?: MessagePort; // This is typically worker.port, not a separate MessagePort
  // Clarification: The example uses worker.port correctly. The comment might be a leftover from a previous thought.
  
  // Path to the worker script, assuming it's copied to assets by angular.json configuration
  private readonly workerPath = 'assets/shared-worker.js'; 
  private readonly workerName = 'appSharedWorker';

  private readonly _receivedMessage: WritableSignal<any | null> = signal(null);
  public readonly receivedMessage: Signal<any | null> = this._receivedMessage.asReadonly();

  private readonly _connectionStatus: WritableSignal<SharedWorkerStatus> = signal('disconnected');
  public readonly connectionStatus: Signal<SharedWorkerStatus> = this._connectionStatus.asReadonly();

  constructor() {
    console.log('[SharedWorkerService] Initialized.');
    // Optional: Auto-connect on service instantiation, or require explicit connect() call.
    // this.connect(); 
  }

  public connect(): void {
    if (typeof SharedWorker === 'undefined') {
      console.warn('[SharedWorkerService] SharedWorker is not supported in this browser.');
      this._connectionStatus.set('unsupported');
      return;
    }

    if (this.worker && (this._connectionStatus() === 'connected' || this._connectionStatus() === 'connecting')) {
      console.log('[SharedWorkerService] Already connected or connecting.');
      return;
    }

    console.log(`[SharedWorkerService] Attempting to connect to SharedWorker at ${this.workerPath}`);
    this._connectionStatus.set('connecting');

    try {
      this.worker = new SharedWorker(this.workerPath, { name: this.workerName, type: 'module' }); // type: 'module' for ES module support in worker
      
      // The port is directly on the worker instance for the first connection.
      // Subsequent connections in other tabs will trigger 'onconnect' in the worker itself.
      this.worker.port.onmessage = (event: MessageEvent) => {
        console.log('[SharedWorkerService] Message received from worker:', event.data);
        this._receivedMessage.set(event.data);
      };

      this.worker.port.onmessageerror = (event: MessageEvent) => {
        console.error('[SharedWorkerService] Error receiving message from worker:', event);
        this._receivedMessage.set({ error: 'MessageError', data: event.data });
        // Optionally update status if message errors are critical
      };
      
      // For SharedWorker, an error event on the worker itself can indicate issues.
      this.worker.onerror = (event: Event | ErrorEvent) => {
        console.error('[SharedWorkerService] Error with SharedWorker:', event);
        this._connectionStatus.set('error');
        // Try to get more details if it's an ErrorEvent
        if (event instanceof ErrorEvent && event.message) {
            this._receivedMessage.set({ error: 'WorkerError', message: event.message, filename: event.filename, lineno: event.lineno });
        } else {
            this._receivedMessage.set({ error: 'WorkerError', message: 'An unspecified error occurred with the SharedWorker.'});
        }
        this.disconnectInternal(); // Clean up
      };

      this.worker.port.start(); // Start receiving messages.
      this._connectionStatus.set('connected');
      console.log('[SharedWorkerService] Connected to SharedWorker. Port started.');

    } catch (error) {
      console.error('[SharedWorkerService] Failed to connect to SharedWorker:', error);
      this._connectionStatus.set('error');
      this._receivedMessage.set({ error: 'ConnectionError', details: error });
      this.worker = undefined; // Ensure worker is undefined on error
    }
  }

  public sendMessage(message: any): void {
    if (this._connectionStatus() !== 'connected' || !this.worker?.port) {
      console.warn('[SharedWorkerService] Cannot send message: Not connected to SharedWorker or port is not available.');
      return;
    }

    try {
      console.log('[SharedWorkerService] Sending message to worker:', message);
      this.worker.port.postMessage(message);
    } catch (error) {
      console.error('[SharedWorkerService] Error sending message to SharedWorker:', error);
       this._receivedMessage.set({ error: 'PostMessageError', details: error });
    }
  }
  
  private disconnectInternal(): void { // Internal method to handle cleanup
    if (this.worker?.port) {
        // No explicit close for the worker's own port from client side in this manner.
        // SharedWorker lifecycle is different. Client closes its end.
        // this.worker.port.close(); // This would be for a MessageChannel port, not worker.port itself.
    }
    this.worker = undefined;
  }

  public disconnect(): void { // Public method for explicit disconnect by app
    if (this._connectionStatus() === 'disconnected' || this._connectionStatus() === 'unsupported') {
      return;
    }
    console.log('[SharedWorkerService] Disconnecting from SharedWorker.');
    this.disconnectInternal();
    this._connectionStatus.set('disconnected');
    this._receivedMessage.set(null);
  }

  ngOnDestroy(): void {
    console.log('[SharedWorkerService] Destroying. Disconnecting from SharedWorker.');
    this.disconnect();
  }
}
