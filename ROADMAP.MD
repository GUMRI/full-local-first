# ROADMAP

## Local-First Angular PWA Management Library  
**Version:** 0.1.0 (Work In Progress)

---

## Core Goals:
- [x] **LocalForage Adapter** with CRUD operations  
- [x] **Angular Signals-based State Management**
- [x] **File Upload & Download Handling** via Firebase Storage
- [x] **Replication Engine** for syncing with Firestore & Storage
- [x] **RxJS Event Bus** for replication and data lifecycle events
- [x] **Prisma-like Filtering and Querying System**
- [x] **Soft Delete / Restore / Purge APIs**
- [x] **Unique and Searchable Fields Config**
- [x] **Full CRUD + Upsert + Multi-Item Operations**

---

## In Progress:
- [ ] **Leader Election System** for multi-tab/shared worker replication
- [ ] **Conflict Resolution Rules** based on `updatedAt` or custom logic
- [ ] **Auto-Increment Field Support**
- [ ] **Full-Text Search Indexing**
- [ ] **Population / Relations (One-To-One, Many-To-One)**
- [ ] **Custom Logger Service**
- [ ] **Background Replication via SharedWorker**
- [ ] **Encrypted Local Storage Support**
- [ ] **Key Compression for Local Data Optimization**

---

## Planned Features:
- [ ] **Angular Signals DevTools Adapter**
- [ ] **Auto Backup Scheduler & Restore**
- [ ] **JSON Patch-based Sync Optimization**
- [ ] **GraphQL Integration Layer**
- [ ] **WebSocket-based Real-Time Sync Alternative**
- [ ] **Blob Storage Size Management and Cleanup**
- [ ] **Replication Debug UI**
- [ ] **Data Schema Versioning & Migration Engine**
- [ ] **Remote Firestore Data Hooks for Sync Control**
- [ ] **Test Suite and E2E Demos for Angular & Ionic PWAs**

---

## Future Ideas:
- [ ] **Offline Notification System for Sync Failures**
- [ ] **Replication Conflict History & Audit Trail**
- [ ] **Multi-List Transaction Support**
- [ ] **Shared Cache via Service Worker**
- [ ] **Optimistic Updates with Rollback**

---

## Notes:
- Designed for **Angular 16+** with **Signals**, **Ionic 7+ PWAs**, and **RxJS 7+**
- LocalForage acts as the primary local DB; Firestore/Storage for replication targets.
- Replication protocol inspired by **RxDB**, adapted for **Angular Signals**.

---

> Maintained by: [Your Name or Team Name]  
> License: MIT  
> Initial Release Target: Q3 2025
