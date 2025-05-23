# Local-First App Management Library for Angular PWAs

A modern, reactive **Local-First management library** for Angular PWA apps — using **Angular Signals**, **RxJS event-driven replication**, and **LocalForage-based offline storage**.  
Built for offline-first workflows with real-time replication to Firestore and Firebase Storage.

---

## Features

- Reactive State using **Angular Signals**
- Prisma-like CRUD API (filter, orderBy, take, skip)
- **LocalForage Adapter** for local IndexedDB storage
- **File Attachments** support (with Firebase Storage replication)
- **Soft Delete / Restore / Purge**
- Searchable and Unique Field Constraints
- **Real-time Replication Engine**
- RxJS-powered **Event Bus for CRUD actions**
- Planned:
  - FullText Search
  - Population Relations
  - Leader Election & Background Sync
  - Encrypted Local Storage
  - DevTools Support
  - Multi-tab Conflict Detection

---

## Installation

```bash
npm install localforage @angular/fire firebase rxjs


---

Quick Example

import { list } from 'your-library-path';
import { Firestore } from '@angular/fire/firestore';

interface Contact {
  name: string;
  phone: string;
  email: string;
}

const contacts = list<Contact>({
  name: 'contacts',
  fields: {
    name: 'text',
    phone: 'text',
    email: 'text'
  },
  uniqueFields: [['email']],
  searchFields: ['name', 'email'],
  replication: {
    firestore: yourFirestoreInstance as Firestore
  }
});


---

API Reference

ListOptions<T>

Property	Description

name	Unique collection name.
fields	Field names and types.
uniqueFields	List of field combinations that must be unique.
searchFields	List of fields for text search.
replication	Optional Firestore and Storage for replication.



---

ListCRUD<T>

Method	Description

create()	Create a new local record.
createMany()	Create many records at once.
findFirst()	Find first item matching a filter.
findUniqe()	Find by unique _id.
update()	Update a record by _id.
updateMany()	Update multiple records by _id.
upsert()	Create or update by _id.
upsertMany()	Create or update multiple records.
remove()	Soft-delete a record.
removeMany()	Soft-delete multiple records.
restore()	Restore a soft-deleted record.
restoreMany()	Restore multiple soft-deleted records.
purgeDeleted()	Permanently remove soft-deleted records.
purgeOldDeleted()	Permanently remove soft-deleted records older than a date.



---

Data Structure: Item<T>

Each record includes system metadata:

{
  _id: string;
  createdAt: string;
  createdBy: string | null;
  _updatedAt: string;
  _deleted: boolean;
  _deletedAt?: string;
  deletedBy?: string | null;
  updates?: {
    by: string | null;
    at: string;
    before: Partial<T>;
    after: Partial<T>;
  }[];
  avatar?: FileRead; // example file property
}


---

Replication Engine

Two-way real-time sync between LocalForage and Firestore

File attachments sync with Firebase Storage

Conflict resolution based on updatedAt timestamps

Soft delete replication support

Event-driven replication with RxJS



---

Planned Features

FullText Search with indexing

Population Relations (one-to-one, one-to-many)

Leader Election for multi-tab sync coordination

Background sync with Shared Workers

Encrypted local storage for sensitive data

Key compression for storage optimization

Debug Logger and DevTools integration

Multi-tab conflict detection and resolution



---

License

MIT License


---

Maintained by

Your Name / Team
Crafted for scalable, reactive, Local-First Angular PWA applications



