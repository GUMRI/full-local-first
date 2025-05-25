import { Component, Input, OnInit, WritableSignal, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { ListRef, FieldType, Item, FilterArgs, CreateItemInput } from '../models/list.model';
import { ListImpl } from '../list/ListImpl'; 
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AddItemDialogComponent, AddItemDialogData } from './add-item-dialog.component';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator'; // <-- Import Paginator

// Define types for sort state
interface SortState {
  field: string;
  direction: 'asc' | 'desc';
}

// Pagination state per list
interface PaginatorState {
  pageIndex: number;
  pageSize: number;
  pageSizeOptions: number[];
}

@Component({
  selector: 'app-studio',
  standalone: true,
  imports: [
    CommonModule, 
    MatTableModule, 
    MatProgressSpinnerModule, 
    JsonPipe,
    MatTabsModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    FormsModule, 
    MatSelectModule,    
    MatFormFieldModule, 
    MatInputModule,      
    MatDialogModule,
    MatPaginatorModule // <-- Add PaginatorModule
  ],
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
    this.displayedColumnsCache.clear(); 
    this.currentSorts.set(new Map()); // Reset sorts on new listRefs
    this.paginatorSettings.set(new Map()); // Reset paginator settings
    console.log('StudioComponent: listRefs received, caches and states cleared.', value);
  }
  get listRefs(): ListRef<any>[] {
    return this._listRefs;
  }

  private displayedColumnsCache: Map<string, string[]> = new Map();
  private searchDebounceTimer: any; 
  
  public currentSorts: WritableSignal<Map<string, SortState>> = signal(new Map());
  public paginatorSettings: WritableSignal<Map<string, PaginatorState>> = signal(new Map()); // <-- New state

  constructor(
    public dialog: MatDialog 
  ) {} 

  ngOnInit(): void {
  }
  
  // --- Paginator Methods ---
  getPaginatorState(listName: string): PaginatorState {
    let state = this.paginatorSettings().get(listName);
    if (!state) {
      state = { pageIndex: 0, pageSize: 10, pageSizeOptions: [5, 10, 25, 100] }; // Default options
      // No need to update signal here, it's just providing a default if not found for the template
    }
    return state;
  }

  handlePageEvent(listRef: ListRef<any>, event: PageEvent): void {
    const listName = this.getListName(listRef);
    // Update the state in the signal
    this.paginatorSettings.update(map => {
      const newMap = new Map(map);
      const currentState = newMap.get(listName) || { pageIndex: 0, pageSize: 10, pageSizeOptions: [5, 10, 25, 100] };
      newMap.set(listName, {
        ...currentState,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      });
      return newMap;
    });

    console.info(`Paging event for list '${listName}': PageIndex=${event.pageIndex}, PageSize=${event.pageSize}`);

    const existingClientQuery = (listRef as ListImpl<any>).getClientQuery ?
                                (listRef as ListImpl<any>).getClientQuery() :
                                null;
    
    const newQueryArgs: FilterArgs<any> = {
      ...(existingClientQuery || {}),
      skip: event.pageIndex * event.pageSize,
      take: event.pageSize
    };
    
    if ((listRef as ListImpl<any>).setClientQuery) {
      (listRef as ListImpl<any>).setClientQuery(newQueryArgs);
    } else {
      console.error('setClientQuery method not found on ListRef. Cannot apply pagination.');
    }
  }
  // --- End Paginator Methods ---

  // --- Sorting Methods ---
  getSortableFields(listRef: ListRef<any>): string[] {
    const baseSortableFields = ['_id', 'createdAt', '_updatedAt'];
    if (!listRef.options || !listRef.options.fields) {
      return baseSortableFields;
    }
    return [...baseSortableFields, ...Object.keys(listRef.options.fields)];
  }

  getCurrentSort(listName: string): SortState | undefined {
    return this.currentSorts().get(listName);
  }

  applySort(listRef: ListRef<any>, field: string): void {
    const listName = this.getListName(listRef);
    const currentSort = this.currentSorts().get(listName);
    let newDirection: 'asc' | 'desc' = 'asc';

    if (currentSort && currentSort.field === field) {
      newDirection = currentSort.direction === 'asc' ? 'desc' : 'asc';
    }
    
    const newSortState: SortState = { field, direction: newDirection };
    this.currentSorts.update(sortsMap => {
      const newMap = new Map(sortsMap);
      newMap.set(listName, newSortState);
      return newMap;
    });

    console.info(`Applying sort for list '${listName}': Field='${field}', Direction='${newDirection}'`);

    const existingClientQuery = (listRef as ListImpl<any>).getClientQuery ?
                                (listRef as ListImpl<any>).getClientQuery() :
                                null;
    
    const newQueryArgs: FilterArgs<any> = {
      ...(existingClientQuery || {}),
      orderBy: {
        [field]: newDirection
      }
    };
    
    if ((listRef as ListImpl<any>).setClientQuery) {
      (listRef as ListImpl<any>).setClientQuery(newQueryArgs);
    } else {
      console.error('setClientQuery method not found on ListRef. Cannot apply sort.');
    }
  }

  clearSort(listRef: ListRef<any>): void {
    const listName = this.getListName(listRef);
    this.currentSorts.update(sortsMap => {
      const newMap = new Map(sortsMap);
      newMap.delete(listName);
      return newMap;
    });
    
    console.info(`Clearing sort for list '${listName}'`);

    const existingClientQuery = (listRef as ListImpl<any>).getClientQuery ?
                                (listRef as ListImpl<any>).getClientQuery() :
                                null;

    if (existingClientQuery) {
        const newQueryArgs = { ...existingClientQuery };
        delete newQueryArgs.orderBy;
        if (Object.keys(newQueryArgs).length === 0) {
            (listRef as ListImpl<any>).setClientQuery(null);
        } else {
            (listRef as ListImpl<any>).setClientQuery(newQueryArgs);
        }
    }
  }
  // End Sorting Methods

  // --- Cell Update Method ---
  onCellUpdate(
    item: Item<any>, 
    columnKey: string, 
    newValue: any, 
    listRef: ListRef<any>,
    fieldType: FieldType 
  ): void {
    const listName = this.getListName(listRef);
    console.log(`[Studio] Cell update for list '${listName}', item ID '${item._id}', column '${columnKey}', new value:`, newValue);

    let processedValue = newValue;
    if (fieldType === 'number') {
      processedValue = parseFloat(newValue);
      if (isNaN(processedValue)) {
        console.error(`Invalid number input for ${columnKey}: ${newValue}. Update aborted.`);
        return; 
      }
    }

    if (item[columnKey] === processedValue) {
      console.log('[Studio] Value unchanged, no update needed.');
      return;
    }

    const updateInput: UpdateItemInput<any> = {
      id: item._id,
      data: {
        [columnKey]: processedValue
      }
    };

    listRef.update(updateInput)
      .then(updatedItem => {
        console.log(`[Studio] Item ${updatedItem._id} updated successfully via inline edit.`);
      })
      .catch(error => {
        console.error(`[Studio] Error updating item ${item._id} via inline edit:`, error);
      });
  }

  trackById(index: number, item: Item<any>): string {
    return item._id;
  }
  // --- End Cell Update Method ---

  onSearchChanged(listRef: ListRef<any>, searchTerm: string): void {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.performSearch(listRef, searchTerm);
    }, 300); 
  }

  private performSearch(listRef: ListRef<any>, searchTerm: string): void {
    console.info(`Search for list '${this.getListName(listRef)}': ${searchTerm}`);

    const fieldsToSearch: (keyof any)[] = [];
    if (listRef.options && listRef.options.fields) {
      for (const fieldKey in listRef.options.fields) {
        const fieldType = listRef.options.fields[fieldKey];
        if (fieldType === 'text' || fieldType === 'longText') {
          fieldsToSearch.push(fieldKey);
        }
      }
    }

    if (fieldsToSearch.length === 0) {
      console.warn(`No text fields configured for searching in list ${this.getListName(listRef)}.`);
      if ((listRef as ListImpl<any>).setClientQuery) {
        const currentClientQuery = (listRef as ListImpl<any>).getClientQuery ? 
                                   (listRef as ListImpl<any>).getClientQuery() : 
                                   null;
        if (currentClientQuery?.search) {
          const newQueryArgs = { ...currentClientQuery };
          delete newQueryArgs.search;
          (listRef as ListImpl<any>).setClientQuery(Object.keys(newQueryArgs).length > 0 ? newQueryArgs : null);
        }
      }
      return;
    }
    
    const currentClientQuery = (listRef as ListImpl<any>).getClientQuery ? 
                                (listRef as ListImpl<any>).getClientQuery() : 
                                null; 

    let newQueryArgs: FilterArgs<any>;

    if (searchTerm.trim() !== '') {
      newQueryArgs = {
        ...(currentClientQuery || {}), 
        search: {
          fields: fieldsToSearch,
          value: searchTerm.trim()
        }
      };
    } else {
      newQueryArgs = { ...(currentClientQuery || {}) };
      delete newQueryArgs.search;
      if (Object.keys(newQueryArgs).length === 0) {
          if ((listRef as ListImpl<any>).setClientQuery) {
            (listRef as ListImpl<any>).setClientQuery(null);
          } else {
            console.error('setClientQuery method not found on ListRef. Cannot clear search.');
          }
          return;
      }
    }
    
    if ((listRef as ListImpl<any>).setClientQuery) {
      (listRef as ListImpl<any>).setClientQuery(newQueryArgs);
    } else {
      console.error('setClientQuery method not found on ListRef. Cannot apply search.');
    }
  }

   onAddNewItemClicked(listRef: ListRef<any>): void {
    const listName = this.getListName(listRef);
    console.log(`[Studio] Add new item clicked for list '${listName}'`);

    const dialogRef = this.dialog.open<AddItemDialogComponent, AddItemDialogData, any>(
      AddItemDialogComponent, {
      width: '500px', 
      data: { listOptions: listRef.options }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        console.log(`[Studio] Dialog closed, result:`, result);
        const createInput: CreateItemInput<any> = {
          data: result
        };
        listRef.create(createInput)
          .then(newItem => {
            console.log(`[Studio] Item created successfully:`, newItem);
          })
          .catch(error => {
            console.error(`[Studio] Error creating item for list '${listName}':`, error);
          });
      } else {
        console.log('[Studio] Add new item dialog cancelled.');
      }
    });
  }
  
  onFilterClicked(listRef: ListRef<any>): void {
    console.log(`Filter clicked for list '${this.getListName(listRef)}'`);
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
    const listCacheKey = listRef.options.name;
    let columns: string[];
    if (!listRef || !listRef.options || !listRef.options.fields) {
      columns = ['_id'];
    } else {
      const fieldKeys = Object.keys(listRef.options.fields);
      columns = ['_id', ...fieldKeys];
    }
    columns.push('actions'); 
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
          return new Date(value).toLocaleString(); 
        } catch {
          return String(value); 
        }
      case 'file':
        return `File ID: ${value}`; 
      case 'object':
      case 'array':
      case 'map':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }
}
