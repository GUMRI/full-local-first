// Purpose: A simple event bus for decoupled communication between components/services.
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EventBusService {
  private eventSubject = new Subject<{eventName: string, payload?: any}>();
  public events$ = this.eventSubject.asObservable();

  constructor() { console.log('EventBusService initialized'); }

  publish(eventName: string, payload?: any) {
    this.eventSubject.next({ eventName, payload });
  }
}
