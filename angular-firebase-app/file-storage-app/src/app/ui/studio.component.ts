import { Component, Input, OnInit, WritableSignal, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ListRef, FieldType, Item } from '../models/list.model';

@Component({
  selector: 'app-studio',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatProgressSpinnerModule, JsonPipe],
  templateUrl: './studio.component.html',
  styleUrls: ['./studio.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioComponent implements OnInit {
  private _listRefs: ListRef<any>[] = [];
  listRefsSignal: WritableSignal<ListRef<any>[]> = signal([]);

  @Input()
  set listRefs(value: ListRef<any>[]) {
    this._listRefs = value;
    this.listRefsSignal.set(value);
    this.displayedColumnsCache.clear(); // Clear cache when input changes
    console.log('StudioComponent: listRefs received', value);
  }
  get listRefs(): ListRef<any>[] {
    return this._listRefs;
  }

  private displayedColumnsCache: Map<string, string[]> = new Map();

  constructor() {}

  ngOnInit(): void {
    // Initial console log if needed
  }

  getListName(listRef: ListRef<any>): string {
    return listRef.options.name;
  }

  getDynamicColumnKeys(listRef: ListRef<any>): string[] {
    if (!listRef || !listRef.options || !listRef.options.fields) {
      return [];
    }
    return Object.keys(listRef.options.fields);
  }
  
  getDisplayedColumns(listRef: ListRef<any>): string[] {
    // Use a unique key for the cache, e.g., listRef.options.name
    // This assumes list names are unique for the component's lifetime with these refs
    const listCacheKey = listRef.options.name; 
    if (this.displayedColumnsCache.has(listCacheKey)) {
        return this.displayedColumnsCache.get(listCacheKey)!;
    }

    if (!listRef || !listRef.options || !listRef.options.fields) {
      // Default to only _id if no fields are defined
      this.displayedColumnsCache.set(listCacheKey, ['_id']);
      return ['_id'];
    }
    const fieldKeys = Object.keys(listRef.options.fields);
    const columns = ['_id', ...fieldKeys]; // Ensure _id is always first
    
    this.displayedColumnsCache.set(listCacheKey, columns);
    return columns;
  }

  renderCell(element: Item<any>, columnKey: string, fieldType?: FieldType): string {
    const value = element[columnKey];

    if (value === undefined || value === null) return '';

    switch (fieldType) {
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'dateTime':
        try {
          return new Date(value).toLocaleString(); // Format date and time
        } catch {
          return String(value); // Fallback if not a valid date
        }
      case 'file':
        return `File ID: ${value}`; // Or some other representation
      case 'object':
      case 'array':
      case 'map':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }
}
