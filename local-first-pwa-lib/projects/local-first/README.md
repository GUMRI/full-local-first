# Local-First Angular Library (`local-first-angular`)

## Overview

`local-first-angular` is a powerful Angular library designed to simplify the development of local-first Progressive Web Applications (PWAs). It provides robust data management capabilities using LocalForage for local storage, Angular Signals for reactive data handling, and an RxJS-based event bus for inter-service communication. Additionally, it includes a (currently placeholder) real-time replication engine for synchronizing data with a Firebase Firestore backend and managing file attachments with Firebase Storage.

The primary goal is to enable applications to function seamlessly offline and to ensure data consistency and resilience through effective local storage strategies and optional real-time cloud synchronization.

## Core Features

*   **Local-First Storage**: Leverages `LocalForage` (IndexedDB, WebSQL, localStorage fallbacks) to store data locally, making your application offline-capable by default.
*   **Reactive Data Model**: Utilizes Angular Signals for a highly reactive and efficient data layer. Changes to your data are automatically reflected in the UI.
*   **Real-Time Replication (Placeholder)**: Includes a replication engine designed for two-way data synchronization with Firebase Firestore. (Currently, the Firestore interaction logic is a placeholder).
*   **File Management (Placeholder for Replication)**: Supports associating file attachments with data items, including local storage of files and planned replication via Firebase Storage. (Local storage of files is implemented; replication is a placeholder).
*   **Advanced Filtering & Sorting**: Provides flexible query capabilities to filter and sort data locally.
*   **Soft Deletes**: Built-in support for soft-deleting items, allowing for data recovery and audit trails.
*   **Conflict Resolution (Conceptual)**: The architecture is designed with conflict resolution in mind for replicated data, though the specific strategies are currently placeholders in the replication engine.
*   **Typed API**: Strongly-typed interfaces and services for better development experience and code quality.

## Installation

```bash
npm install local-first-angular # Replace 'local-first-angular' with the actual package name on npm
```

### Peer Dependencies

Ensure these peer dependencies are installed in your host Angular project:

```bash
npm install localforage firebase rxjs @angular/core @angular/fire
# For Firebase v9+ modular API (used by this library for replication parts)
```

## Setup

### 1. Import and Provide Core Services

In your Angular application's module (e.g., `app.module.ts` or a core module), you'll typically provide `LocalForageService` and `EventBusService` if you intend to use them as singletons or pass them to the `list` factory. However, the `list` factory can also accept direct instantiations if preferred for specific use cases.

```typescript
// Example: app.module.ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent }_from_ './app.component'; // Your AppComponent

// If you plan to use LocalForageService and EventBusService as injectable singletons
// (though the 'list' factory can also accept direct instances)
// import { LocalForageService } from 'local-first-angular'; // Adjust path
// import { EventBusService } from 'local-first-angular';    // Adjust path

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule
  ],
  providers: [
    // LocalForageService, // Provide if used as singleton
    // EventBusService,    // Provide if used as singleton
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
```

### 2. Firebase Setup (for Replication)

If you plan to use the real-time replication features with Firebase:

1.  Install Firebase and AngularFire:
    ```bash
    npm install firebase @angular/fire
    ```
2.  Initialize Firebase in your main application module (e.g., `app.module.ts`):

    ```typescript
    // app.module.ts
    import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
    import { provideFirestore, getFirestore } from '@angular/fire/firestore';
    import { provideStorage, getStorage } from '@angular/fire/storage';
    // ... other imports

    // Your Firebase config
    const firebaseConfig = {
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_AUTH_DOMAIN",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_STORAGE_BUCKET",
      messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
      appId: "YOUR_APP_ID"
    };

    @NgModule({
      // ...
      imports: [
        // ... other imports
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideFirestore(() => getFirestore()),
        provideStorage(() => getStorage()),
      ],
      // ...
    })
    export class AppModule { }
    ```

## Basic Usage

### 1. Define Your Data Type

Create an interface for the data items you want to manage.

```typescript
import { StoredFile } from 'local-first-angular'; // Adjust path

interface Task {
  id?: string; // Optional: _id will be generated by the library
  title: string;
  completed: boolean;
  description?: string;
  dueDate?: string; // Consider ISO date string
  attachment?: StoredFile; // For file uploads
}
```

### 2. Configure List Options

Define `ListOptions` for your data type.

```typescript
import { ListOptions, LocalForageService, EventBusService } from 'local-first-angular'; // Adjust path
// If using replication:
// import { Firestore, getFirestore } from '@angular/fire/firestore';
// import { FirebaseStorage, getStorage } from '@angular/fire/storage';

const taskOptions: ListOptions<Task> = {
  name: 'tasks', // Unique name for this list (collection name)
  fields: {
    title: 'text',
    completed: 'boolean',
    description: 'longText',
    dueDate: 'dateTime',
    attachment: 'file', // Mark the field as a file type
  },
  uniqueFields: [['title']], // Example: Ensure task titles are unique
  searchFields: [['title'], ['description']], // Fields to be indexed for search
  // Optional: Configure replication
  // replication: {
  //   firestore: getFirestore(), // Pass Firestore instance
  //   firebaseStorage: getStorage() // Pass Firebase Storage instance
  // }
};
```

### 3. Initialize the List

In your component or service, instantiate `LocalForageService` and `EventBusService` (or inject them if provided globally), and then call the `list` factory.

```typescript
import { Component, OnInit, Signal } from '@angular/core';
import { list, ListRef, Item, LocalForageService, EventBusService } from 'local-first-angular'; // Adjust path

@Component({
  selector: 'app-tasks',
  template: `<!-- Your component template -->`
})
export class TasksComponent implements OnInit {
  tasksList!: ListRef<Task>;
  activeTasks: Signal<Item<Task>[]>;

  // For simplicity, newing up services. In a larger app, use Angular's DI.
  private localForageService = new LocalForageService();
  private eventBusService = new EventBusService();

  ngOnInit() {
    this.tasksList = list<Task>(taskOptions, this.localForageService, this.eventBusService);
    this.activeTasks = this.tasksList.items; // Signal of active items

    console.log('Initial tasks:', this.activeTasks());
    this.exampleUsage();
  }

  async exampleUsage() {
    // Create a new task
    try {
      const newTask = await this.tasksList.create({
        data: { title: 'My First Task', completed: false, description: 'Details about the task.' },
        createdBy: 'user123'
      });
      console.log('Created Task:', newTask);

      // Update a task
      const updatedTask = await this.tasksList.update({
        id: newTask._id,
        data: { completed: true },
        updatedBy: 'user123'
      });
      console.log('Updated Task:', updatedTask);

      // Find a unique task
      const foundTask = this.tasksList.findUnique(newTask._id).item();
      console.log('Found Task:', foundTask);

      // Filter tasks (example: find completed tasks)
      const completedTasks = this.tasksList.filter({ where: { completed: { equals: true } } })();
      console.log('Completed Tasks:', completedTasks);
      
      // Remove a task (soft delete by default)
      // await this.tasksList.remove(newTask._id, 'user123');
      // console.log('Task removed (soft delete)');

    } catch (error) {
      console.error('Error during example usage:', error);
    }
  }

  // Example: File Handling
  async addTaskWithFile(taskData: Task, file: File, fieldName: keyof Task) {
    if (this.tasksList.listOptions.fields[fieldName] !== 'file') {
        console.error(`Field ${String(fieldName)} is not configured as a file type.`);
        return;
    }
    try {
      const newTodoWithFile = await this.tasksList.create({
        data: taskData,
        files: [{ fieldName: String(fieldName), data: file, name: file.name }],
        createdBy: 'user-file-uploader'
      });
      console.log('Added todo with file:', newTodoWithFile);
    } catch (e) {
      console.error('Error adding todo with file:', e);
    }
  }
}
```

### 4. Working with Signals

The `ListRef` object exposes data as Angular Signals:

*   `tasksList.items()`: A signal emitting an array of current active items (`Item<Task>[]`).
*   `tasksList.deletedItems()`: A signal emitting an array of soft-deleted items.
*   `tasksList.isLoading()`: A boolean signal indicating if a CRUD operation is in progress.
*   `tasksList.status()`: A signal indicating the current status ('idle', 'loading', 'error', 'success').
*   `tasksList.error()`: A signal emitting the last error message, or null.
*   `tasksList.count()`: A signal for the number of active items.
*   `tasksList.filesState()`: A signal emitting a map of file states for ongoing file operations.

Use these signals in your component templates (e.g., with `*ngFor`) or with `computed` and `effect` for reactive logic.

## Replication

To enable real-time two-way synchronization with Firebase:

1.  Ensure you have completed the Firebase Setup steps.
2.  Provide the Firestore and Firebase Storage instances in the `ListOptions`:

    ```typescript
    import { getFirestore } from '@angular/fire/firestore';
    import { getStorage } from '@angular/fire/storage';

    const taskOptions: ListOptions<Task> = {
      name: 'tasks', // This will be the Firestore collection name
      fields: { /* ... */ },
      uniqueFields: [/* ... */],
      searchFields: [/* ... */],
      replication: {
        firestore: getFirestore(),     // Get Firestore instance
        firebaseStorage: getStorage()  // Get Firebase Storage instance
      }
    };
    ```

When replication is configured, the `list` factory will automatically initialize the `ReplicationEngine`. Local changes (creates, updates, deletes) will be queued and pushed to Firestore. Remote changes from Firestore will be pulled and applied to the local store, updating the relevant signals. File attachments will also be synchronized with Firebase Storage.

(Note: The replication engine's Firestore interaction logic is currently a placeholder in the library and needs to be fully implemented for production use.)

## Public API Summary

*   **`list<T, U>(options: ListOptions<T>, localForageService: LocalForageService, eventBusService: EventBusService): ListRef<T, U>`**: The main factory function to create and manage a list.
*   **`ListRef<T, U>`**: The object returned by the `list` factory, providing:
    *   State signals (`items`, `isLoading`, `status`, `error`, `deletedItems`, `count`, `filesState`).
    *   CRUD methods (`create`, `update`, `remove`, `findUnique`, `findFirst`, `filter`, `restore`, etc.).
    *   Replication control methods (`pauseReplication`, `resumeReplication`) and status (`replicationStatus$`, `getPushQueue`).
*   **Services**:
    *   `LocalForageService`: Wrapper for LocalForage.
    *   `EventBusService`: For subscribing to library events (e.g., `replicationState$`, `syncError$`, `itemChanged$`).
    *   `SignalStateService` (internal, managed by `list` factory).
    *   `ReplicationEngine` (internal, managed by `list` factory).
*   **Types**: Core interfaces like `Item`, `ListOptions`, `FileInput`, `StoredFile`, `BaseItem`, etc., are exported from the library.

## Contributing (Optional Placeholder)

Contributions are welcome! Please open an issue or submit a pull request.

## License (Placeholder)

MIT License
