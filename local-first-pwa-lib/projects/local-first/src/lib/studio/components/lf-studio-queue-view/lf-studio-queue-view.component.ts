import { Component, Input, computed, ChangeDetectionStrategy } from '@angular/core';
import { ListRef } from '../../../../types'; // Path to types.ts
import { ReplicationQueueItem } from '../../../services/replication.service'; // Path to replication.service.ts

@Component({
  selector: 'lf-studio-queue-view',
  templateUrl: './lf-studio-queue-view.component.html',
  styleUrls: ['./lf-studio-queue-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LfStudioQueueViewComponent {
  @Input({ required: true }) listRef!: ListRef<any, any>;

  readonly pushQueue = computed<ReplicationQueueItem[]>(() => {
    if (this.listRef && typeof this.listRef.getPushQueue === 'function') {
      return this.listRef.getPushQueue();
    }
    return [];
  });

  // For displaying a snippet of the data in the queue item
  getItemDataSnippet(queueItem: ReplicationQueueItem): string {
    if (!queueItem.data) return 'N/A';
    try {
        const dataStr = JSON.stringify(queueItem.data);
        return dataStr.length > 75 ? dataStr.substring(0, 75) + '...' : dataStr;
    } catch (e) {
        return '[Unserializable Data]';
    }
  }

  // Helper to display error message
  getErrorMessage(error: any): string {
    if (!error) return 'N/A';
    if (typeof error === 'string') return error;
    if (error.message && typeof error.message === 'string') return error.message;
    try {
      return JSON.stringify(error);
    } catch (e) {
      return '[Unserializable Error]';
    }
  }
}
