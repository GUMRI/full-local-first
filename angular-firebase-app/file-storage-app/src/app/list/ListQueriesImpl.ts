import { Item, FilterArgs } from '../models/list.model';

export interface QueryResult<T> {
  items: Item<T>[];
  totalCount: number;
}

export class ListQueriesImpl<T extends Record<string, any>> {

  constructor(private listName: string) {
    console.log(`ListQueriesImpl for ${this.listName} initialized`);
  }

  public query(items: Readonly<Item<T>[]>, filterArgs?: Readonly<FilterArgs<T>>): QueryResult<T> { // <-- Return QueryResult
    let processedItems = [...items];

    if (filterArgs) {
      if (filterArgs.where) {
        processedItems = this.filterByWhere(processedItems, filterArgs.where);
      }
      if (filterArgs.search && filterArgs.search.value && filterArgs.search.fields.length > 0) {
        processedItems = this.searchItems(processedItems, filterArgs.search);
      }
      // This is the count *after* filtering and searching, but *before* sorting and pagination.
      // Sorting doesn't change the count.
    }
    
    const countAfterFiltering = processedItems.length;

    if (filterArgs && filterArgs.orderBy) {
      processedItems = this.sortItems(processedItems, filterArgs.orderBy);
    }

    if (filterArgs) {
      const skip = filterArgs.skip ?? 0;
      const take = filterArgs.take;

      if (take !== undefined) {
        processedItems = processedItems.slice(skip, skip + take);
      } else if (skip > 0) {
        processedItems = processedItems.slice(skip);
      }
    }
    
    return { items: processedItems, totalCount: countAfterFiltering }; // <-- Return object
  }

  private filterByWhere(items: Readonly<Item<T>[]>, where: NonNullable<FilterArgs<T>['where']>): Item<T>[] {
    return items.filter(item => {
      for (const fieldKey in where) {
        const fieldCondition = where[fieldKey as keyof T];
        const itemValue = item[fieldKey as keyof T];

        if (fieldCondition === undefined || itemValue === undefined) { // Check if itemValue is undefined
            // Special handling for 'not' undefined, or 'equals' undefined
            if (fieldCondition && typeof fieldCondition === 'object') {
                 if ('not' in fieldCondition && (fieldCondition as any).not === undefined && itemValue !== undefined) {
                    continue; // Condition "not: undefined" passes if itemValue is not undefined
                 } else if ('equals' in fieldCondition && (fieldCondition as any).equals === undefined && itemValue === undefined) {
                    continue; // Condition "equals: undefined" passes if itemValue is undefined
                 } else if (('equals' in fieldCondition && (fieldCondition as any).equals !== undefined) || ('not' in fieldCondition && (fieldCondition as any).not !== undefined)) {
                    // If other specific conditions like equals: value or not: value are set for an undefined itemValue, they should fail unless it's specific undefined check
                    return false; 
                 }
            }
            // If itemValue is undefined and no specific undefined check matches, it generally shouldn't pass other conditions.
            // However, if the condition itself is just `undefined` (e.g. `where: { field: undefined }`), skip this field.
            // This path is primarily for when `itemValue` is undefined.
             if (fieldCondition === undefined) continue; // if the condition object for the field is undefined, skip.
             // If itemValue is undefined and condition is not, most ops below will result in `match = false` correctly.
        }


        for (const operator in fieldCondition) {
          const conditionValue = (fieldCondition as any)[operator];
          let match = true;

          // Ensure itemValue is not null or undefined for most operations,
          // unless the operation specifically handles null/undefined (e.g., 'equals', 'not').
          if (itemValue === null || itemValue === undefined) {
            if (operator === 'equals') match = itemValue === conditionValue;
            else if (operator === 'not') match = itemValue !== conditionValue;
            else { // For other operators, if itemValue is null/undefined, it doesn't match.
                match = false;
            }
          } else { // itemValue is not null or undefined
            switch (operator) {
                case 'equals': match = itemValue === conditionValue; break;
                case 'in': match = Array.isArray(conditionValue) && conditionValue.includes(itemValue); break;
                case 'not': match = itemValue !== conditionValue; break;
                case 'lt': match = itemValue < conditionValue; break;
                case 'lte': match = itemValue <= conditionValue; break;
                case 'gt': match = itemValue > conditionValue; break;
                case 'gte': match = itemValue >= conditionValue; break;
                case 'contains':
                match = typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().includes(conditionValue.toLowerCase());
                break;
                case 'startsWith':
                match = typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().startsWith(conditionValue.toLowerCase());
                break;
                case 'endsWith':
                match = typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().endsWith(conditionValue.toLowerCase());
                break;
                default: match = true; // Unknown operator, don't filter
            }
          }
          if (!match) return false; // If any condition for a field fails, the item is out
        }
      }
      return true; // All conditions for all fields passed
    });
  }

  private searchItems(items: Readonly<Item<T>[]>, search: NonNullable<FilterArgs<T>['search']>): Item<T>[] {
    const searchTerm = search.value.toLowerCase();
    if (!searchTerm) return [...items]; // No search term, return all items

    return items.filter(item => {
      return search.fields.some(fieldKey => {
        const itemValue = item[fieldKey as keyof T];
        // Ensure itemValue is a string before calling toLowerCase and includes
        return typeof itemValue === 'string' && itemValue.toLowerCase().includes(searchTerm);
      });
    });
  }

  private sortItems(items: Item<T>[], orderBy: NonNullable<FilterArgs<T>['orderBy']>): Item<T>[] {
    // Create a shallow copy to sort, preserving the original array if it's from a signal.
    const itemsToSort = [...items];
    const fieldKeys = Object.keys(orderBy) as (keyof T)[];

    itemsToSort.sort((a, b) => {
      for (const fieldKey of fieldKeys) {
        const direction = orderBy[fieldKey];
        const valA = a[fieldKey];
        const valB = b[fieldKey];

        // Handle undefined or null values by treating them as "lesser"
        if (valA === undefined || valA === null) return (valB === undefined || valB === null) ? 0 : (direction === 'asc' ? -1 : 1);
        if (valB === undefined || valB === null) return direction === 'asc' ? 1 : -1;
        
        // Basic comparison, can be enhanced for different types
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
      }
      return 0; // Equal
    });
    return itemsToSort;
  }
}
