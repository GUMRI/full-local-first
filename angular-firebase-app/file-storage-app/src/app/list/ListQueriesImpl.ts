// In ListQueriesImpl.ts
import { Item, FilterArgs, ListOptions, FieldType } from '../models/list.model'; // Keep FieldType for now
import { IndexedDBManager } from '../utils/IndexedDBManager.ts'; // <-- Import
import { LoggerService } from '../utils/Logger.ts';       // <-- Import

export interface QueryResult<T> { // Ensure this interface is here or imported
  items: Item<T>[];
  totalCount: number;
}

export class ListQueriesImpl<T extends Record<string, any>> {
  private indexedDBStoreName: string;
  private indexedFields: Set<string>;

  constructor(
    private listNameForLog: string, // Kept for logging continuity
    private listOptions: Readonly<ListOptions<T>>, // <-- For knowing indexed fields
    private indexedDBManager: IndexedDBManager,   // <-- Injected
    private logger: LoggerService                 // <-- Injected
  ) {
    this.indexedDBStoreName = `list_${this.listOptions.name}`;
    this.indexedFields = new Set(this.listOptions.indexing || []);
    this.logger.info(`[ListQueriesImpl-${this.listOptions.name}] Initialized. IndexedDB store: '${this.indexedDBStoreName}', Indexed fields: ${Array.from(this.indexedFields).join(', ')}`);
  }

  // filterByWhere, searchItems, sortItems methods remain largely the same,
  // but they will operate on data fetched from IDB or the input 'items' array.

  private filterByWhere(items: Readonly<Item<T>[]>, where: NonNullable<FilterArgs<T>['where']>): Item<T>[] {
    // This existing method can be used for in-memory filtering after IDB query
    return items.filter(item => { 
      for (const fieldKey in where) {
        const fieldCondition = where[fieldKey as keyof T];
        const itemValue = item[fieldKey as keyof T];
        if (fieldCondition === undefined) continue;
        // If itemValue is undefined, it should generally not match most conditions unless explicitly handled
        // e.g., { equals: undefined } or a 'notExists' operator. Current logic implies it won't match.
        for (const operator in fieldCondition) {
          const conditionValue = (fieldCondition as any)[operator];
          let match = true;
          switch (operator) {
            case 'equals': match = itemValue === conditionValue; break;
            case 'in': match = Array.isArray(conditionValue) && conditionValue.includes(itemValue); break;
            case 'not': match = itemValue !== conditionValue; break;
            case 'lt': match = itemValue !== undefined && itemValue < conditionValue; break;
            case 'lte': match = itemValue !== undefined && itemValue <= conditionValue; break;
            case 'gt': match = itemValue !== undefined && itemValue > conditionValue; break;
            case 'gte': match = itemValue !== undefined && itemValue >= conditionValue; break;
            case 'contains':
              match = typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().includes(conditionValue.toLowerCase());
              break;
            case 'startsWith':
              match = typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().startsWith(conditionValue.toLowerCase());
              break;
            case 'endsWith':
              match = typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().endsWith(conditionValue.toLowerCase());
              break;
            default: match = true; 
          }
          if (!match) return false; 
        }
      }
      return true; 
    });
  }

  private searchItems(items: Readonly<Item<T>[]>, search: NonNullable<FilterArgs<T>['search']>): Item<T>[] {
    // This existing method can be used for in-memory filtering
    const searchTerm = search.value.toLowerCase();
    return items.filter(item => { 
      return search.fields.some(fieldKey => {
        const itemValue = item[fieldKey as keyof T];
        return typeof itemValue === 'string' && itemValue.toLowerCase().includes(searchTerm);
      });
    });
  }

  private sortItems(items: Item<T>[], orderBy: NonNullable<FilterArgs<T>['orderBy']>): Item<T>[] {
    // This existing method can be used for in-memory sorting
    const itemsToSort = [...items];
    const fieldKeys = Object.keys(orderBy) as (keyof T)[];
    itemsToSort.sort((a, b) => { 
      for (const fieldKey of fieldKeys) {
        const direction = orderBy[fieldKey];
        const valA = a[fieldKey]; const valB = b[fieldKey];
        if (valA === undefined || valA === null) return direction === 'asc' ? -1 : 1; // Consistent null/undefined sort
        if (valB === undefined || valB === null) return direction === 'asc' ? 1 : -1;
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return itemsToSort;
  }

  public async query(
    // itemsFromState: Readonly<Item<T>[]>, // Fallback or for comparison, not primary source
    filterArgs?: Readonly<FilterArgs<T>>
  ): Promise<QueryResult<T>> {
    this.logger.debug(`[ListQueriesImpl-${this.listOptions.name}] Executing query with args:`, filterArgs);
    let baseItems: Item<T>[] = [];
    let canUseIndex = false;
    let inMemoryFilteringRequired = true; // Assume true unless a perfect index hit happens

    if (filterArgs?.where) {
      // Try to find a single, simple indexed condition to use first
      // Example: where: { status: { equals: 'active' } }
      for (const fieldKey in filterArgs.where) {
        if (this.indexedFields.has(fieldKey)) {
          const fieldCondition = filterArgs.where[fieldKey as keyof T];
          if (fieldCondition && 'equals' in fieldCondition && Object.keys(fieldCondition).length === 1) {
            const valueToQuery = (fieldCondition as any)['equals'];
            this.logger.info(`[ListQueriesImpl-${this.listOptions.name}] Using index '${fieldKey}' for 'equals' query with value:`, valueToQuery);
            try {
              baseItems = await this.indexedDBManager.getAllByIndex<T>(this.indexedDBStoreName, fieldKey, valueToQuery);
              canUseIndex = true;
              // If this was the *only* where clause, further in-memory 'where' filtering might not be needed on this set.
              if (Object.keys(filterArgs.where).length === 1) {
                inMemoryFilteringRequired = false; 
              }
              break; // Use the first suitable index found for simplicity
            } catch (idbError) {
              this.logger.error(`[ListQueriesImpl-${this.listOptions.name}] Error querying IndexedDB by index '${fieldKey}':`, idbError);
              // Fallback to full scan if indexed query fails
              baseItems = await this.indexedDBManager.getAllItems<T>(this.indexedDBStoreName);
            }
          }
          // TODO: Add support for range queries (lt, lte, gt, gte) using getItemsByRange
          // This would involve checking operator type and using IDBKeyRange.
        }
      }
    }

    if (!canUseIndex) {
      this.logger.info(`[ListQueriesImpl-${this.listOptions.name}] No suitable index found or used. Fetching all items from IDB store '${this.indexedDBStoreName}'.`);
      try {
        baseItems = await this.indexedDBManager.getAllItems<T>(this.indexedDBStoreName);
      } catch (idbError) {
        this.logger.error(`[ListQueriesImpl-${this.listOptions.name}] Error fetching all items from IDB store:`, idbError);
        // Consider fallback to itemsFromState if passed and IDB fails catastrophically.
        // For now, return empty on error.
        return { items: [], totalCount: 0 };
      }
    }
    
    let processedItems = [...baseItems]; // Operate on a copy

    // Apply 'where' filtering in-memory if:
    // 1. No index was used (processedItems is all items from store)
    // 2. An index was used, but there are other 'where' clauses not covered by that index query.
    if (filterArgs?.where && inMemoryFilteringRequired) {
        this.logger.debug(`[ListQueriesImpl-${this.listOptions.name}] Applying in-memory 'where' filtering.`);
        processedItems = this.filterByWhere(processedItems, filterArgs.where);
    }

    // Apply 'search' filtering in-memory
    if (filterArgs?.search && filterArgs.search.value && filterArgs.search.fields.length > 0) {
        this.logger.debug(`[ListQueriesImpl-${this.listOptions.name}] Applying in-memory 'search' filtering.`);
        processedItems = this.searchItems(processedItems, filterArgs.search);
    }
    
    const countAfterFiltering = processedItems.length; // This is the total count for pagination

    // Apply 'orderBy' sorting in-memory
    if (filterArgs?.orderBy) {
        this.logger.debug(`[ListQueriesImpl-${this.listOptions.name}] Applying in-memory 'orderBy' sorting.`);
        processedItems = this.sortItems(processedItems, filterArgs.orderBy);
    }

    // Apply pagination in-memory
    if (filterArgs) {
      const skip = filterArgs.skip ?? 0;
      const take = filterArgs.take;
      if (take !== undefined) {
        processedItems = processedItems.slice(skip, skip + take);
      } else if (skip > 0) {
        processedItems = processedItems.slice(skip);
      }
    }
    
    this.logger.debug(`[ListQueriesImpl-${this.listOptions.name}] Query completed. Returning ${processedItems.length} items out of ${countAfterFiltering} matched.`);
    return { items: processedItems, totalCount: countAfterFiltering };
  }
}
