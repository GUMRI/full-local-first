import { Component, Input, Output, EventEmitter, signal, computed, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { ListRef, Item } from '../../../../types'; // Adjust path if needed

@Component({
  selector: 'lf-studio-list-view',
  templateUrl: './lf-studio-list-view.component.html',
  styleUrls: ['./lf-studio-list-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LfStudioListViewComponent implements OnChanges {
  @Input({ required: true }) listRef!: ListRef<any, any>;
  @Output() viewItemDetail = new EventEmitter<Item<any, any>>();

  // Actual items from the listRef's signal
  private readonly _items = computed(() => this.listRef.items());

  // Pagination
  readonly currentPage = signal(1);
  readonly itemsPerPage = signal(10);
  readonly totalItems = computed(() => this._items().length);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.itemsPerPage()));
  readonly paginatedItems = computed(() => {
    const items = this._items();
    const page = this.currentPage();
    const perPage = this.itemsPerPage();
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    return items.slice(startIndex, endIndex);
  });

  // Columns
  readonly displayedColumns = computed(() => {
    const items = this._items();
    if (!items || items.length === 0) {
      return ['_id', '_updatedAt']; // Default if no items
    }
    const firstItem = items[0];
    // Assuming Item<T> is T & BaseItem, so properties of T are at top level
    const dataKeys = Object.keys(firstItem).filter(k => !['_id', '_updatedAt', '_createdAt', '_deleted', '_deletedAt', 'createdBy', 'deletedBy', 'updatedBy', 'updates', '_replicationHash', '_lastSynced'].includes(k));
    return ['_id', ...dataKeys.slice(0, 4), '_updatedAt']; // Show _id, first 4 data keys, _updatedAt
  });
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['listRef']) {
       this.currentPage.set(1); // Reset to first page when listRef changes
    }
  }

  onViewJson(item: Item<any, any>): void {
    this.viewItemDetail.emit(item);
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

  // Helper to get a specific value from an item, handling potential nested objects for display
  getItemValue(item: any, column: string): string {
    if (column.includes('.')) { // Basic support for one level deep
       const parts = column.split('.');
       let value = item;
       for (const part of parts) {
           if (value && typeof value === 'object' && part in value) {
               value = value[part];
           } else {
               return 'N/A';
           }
       }
       return String(value);
    }
    const val = item[column];
    if (typeof val === 'object' && val !== null) { // Check for null objects
        try {
            const jsonString = JSON.stringify(val);
            return jsonString.substring(0, 50) + (jsonString.length > 50 ? '...' : ''); // Truncate objects
        } catch (e) {
            return '[Unserializable Object]';
        }
    }
    return String(val !== undefined && val !== null ? val : 'N/A');
  }
}
