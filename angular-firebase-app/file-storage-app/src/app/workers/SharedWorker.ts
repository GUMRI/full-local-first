// Purpose: Manages communication with a SharedWorker for background tasks.
// Note: Actual SharedWorker script will be separate. This is for interacting with it.
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SharedWorkerService {
  constructor() { console.log('SharedWorkerService initialized'); }
  // SharedWorker communication methods will be added here
}
