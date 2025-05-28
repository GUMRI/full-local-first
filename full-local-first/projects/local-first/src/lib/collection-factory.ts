import { Signal, WritableSignal, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop'; // Add this import
import {
    RxCollection,
    RxDocument,
    MongoQuery
} from 'rxdb';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, distinctUntilChanged, startWith } from 'rxjs/operators';
import { BaseDoc, CollectionFactoryOptions, LogEntry, LogType } from '../../../types/types'; // Corrected path

// Helper function (can be in a utils file later, but placing here for now)
function ensurePrimary<T extends { id: string }>(docData: T): T & { _id: string } {
    return { ...docData, _id: docData.id };
}

export function collectionFactory<T_INPUT>(
    collection: RxCollection<T_INPUT & BaseDoc>,
    options?: CollectionFactoryOptions<T_INPUT & BaseDoc>
) {
    type DocType = T_INPUT & BaseDoc; // Full document type
    type RxDocType = RxDocument<DocType>; // RxDB document type

    // --- Reactive Signals ---
    const docs$: Observable<RxDocType[]> = collection.find().$.pipe(
        distinctUntilChanged((prev, curr) => prev.length === curr.length && prev.every((p, i) => p.revision === curr[i].revision))
    );

    const allDocs: WritableSignal<RxDocType[]> = signal([]);
    docs$.subscribe(allDocs.set);


    const deletedDocs$: Observable<RxDocType[]> = collection.find({ selector: { _deleted: true } }).$.pipe(
        distinctUntilChanged((prev, curr) => prev.length === curr.length && prev.every((p, i) => p.revision === curr[i].revision))
    );
    const deletedDocs: WritableSignal<RxDocType[]> = signal([]);
    deletedDocs$.subscribe(deletedDocs.set);
    

    const querySignal: Signal<MongoQuery<DocType>> = options?.queries ?? signal({});

    const filteredDocs$: Observable<RxDocType[]> = toObservable(querySignal).pipe(
        switchMap((query: MongoQuery<DocType>) => {
            // If query is empty or undefined, find all non-deleted documents
            if (!query || Object.keys(query).length === 0) {
                // By default, find() returns non-deleted items.
                // If you want to ensure no deleted items even with empty query:
                // return collection.find({ selector: { _deleted: { $ne: true } } }).$;
                return collection.find().$; // This correctly returns non-deleted items by default
            }
            return collection.find(query).$;
        }),
        distinctUntilChanged((prev, curr) => {
            if (prev === curr) return true; // Same observable instance
            if (!prev || !curr) return false; // One is undefined
            if (prev.length !== curr.length) return false;
            return prev.every((p, i) => p.revision === curr[i].revision && p.deleted === curr[i].deleted);
        }),
        startWith([])
    );

    const filteredDocs: WritableSignal<RxDocType[]> = signal([]);
    filteredDocs$.subscribe(docs => filteredDocs.set(docs));
    
    // --- Middleware Handler ---
    const middlewareHandler = (
        action: LogType,
        docId?: string, // Added docId for context
        actor?: string,
        note?: string,
        existingLog?: LogEntry[]
    ): { logEntry: LogEntry, auditFields: Partial<BaseDoc> } => {
        const timestamp = new Date().toISOString();
        const logEntry: LogEntry = { type: action, at: timestamp, by: actor, note };
        
        let auditFields: Partial<BaseDoc> = {
            log: existingLog ? [...existingLog, logEntry] : [logEntry]
        };

        if (action === 'create') {
            auditFields.createdAt = timestamp;
            auditFields.createdBy = actor;
            auditFields.updatedAt = timestamp; // Also set updatedAt on create
            auditFields.updatedBy = actor;   // Also set updatedBy on create
        } else if (action === 'update') {
            auditFields.updatedAt = timestamp;
            auditFields.updatedBy = actor;
        } else if (action === 'restore') {
            auditFields.updatedAt = timestamp; // Restoring is an update
            auditFields.updatedBy = actor;
            auditFields.deletedAt = undefined;
            auditFields.deletedBy = undefined;
            // _deleted: false will be handled by the restore method directly
        } else if (action === 'remove' && !note?.includes('permanent')) { // Soft delete
            auditFields.deletedAt = timestamp;
            auditFields.deletedBy = actor;
        }
        
        return { logEntry, auditFields };
    };

    // --- CRUD Methods ---
    const create = async (inputData: T_INPUT & { id?: string }, createdBy?: string): Promise<RxDocType | null> => {
        const docId = inputData.id || collection.database.tokenService.generateToken();
        
        const existingDoc = await collection.findOne(docId).exec();
        if (existingDoc) {
            console.warn(`Document with ID ${docId} already exists. Creation skipped.`);
            return existingDoc; // Or return null if strictly "insert if not exists" means no return on existing
        }

        const { auditFields } = middlewareHandler('create', docId, createdBy, 'Document created');
        
        const docToInsert: DocType = {
            ...inputData,
            id: docId, // Ensure id is set
            ...auditFields, // Includes log, createdAt, createdBy, updatedAt, updatedBy
        } as DocType;
        
        const finalDoc = ensurePrimary(docToInsert); // Maps id to _id
        return collection.insert(finalDoc);
    };
    
    
    // Placeholder for update, restore, remove
    const update = async (docId: string, patchData: Partial<T_INPUT>, updatedBy?: string): Promise<RxDocType | null> => {
        const doc = await collection.findOne(docId).exec();
        if (!doc) {
            console.warn(`Document with ID ${docId} not found for update.`);
            return null;
        }

        const { auditFields } = middlewareHandler('update', docId, updatedBy, 'Document updated', doc.get('log'));
        
        // Use incrementalModify to apply the patch
        return doc.incrementalModify((currentDocData: DocType) => {
            // It's important that currentDocData is treated as immutable within this function.
            // We construct the new state.
            const updatedDocData = {
                ...currentDocData,
                ...patchData, // Apply user-provided patch
                updatedAt: auditFields.updatedAt, // Apply audit fields
                updatedBy: auditFields.updatedBy,
                log: auditFields.log,
            };
            return updatedDocData;
        });
    };

    const restore = async (docId: string, restoredBy?: string): Promise<RxDocType | null> => {
        // FindOne should fetch the document even if it's marked as _deleted
        const doc = await collection.findOne(docId).exec(); 
        if (!doc) {
            console.warn(`Document with ID ${docId} not found for restore.`);
            return null;
        }
        if (!doc.get('_deleted')) {
            console.warn(`Document with ID ${docId} is not deleted. Restore operation skipped.`);
            return doc;
        }

        const { auditFields } = middlewareHandler('restore', docId, restoredBy, 'Document restored', doc.get('log'));
        
        // Use patch to update the document state
        return doc.patch({
            _deleted: false, // Key field for un-soft-deleting
            deletedAt: auditFields.deletedAt, // Should be undefined from middleware
            deletedBy: auditFields.deletedBy, // Should be undefined from middleware
            updatedAt: auditFields.updatedAt,
            updatedBy: auditFields.updatedBy,
            log: auditFields.log,
        });
    };

    const remove = async (docId: string, deletedBy?: string, permanent: boolean = false): Promise<boolean> => {
        const doc = await collection.findOne(docId).exec();
        if (!doc) {
            console.warn(`Document with ID ${docId} not found for removal.`);
            return false;
        }

        if (permanent) {
            try {
                // Consider adding a log entry of type 'remove' with a note 'permanent delete'
                // This log would ideally be stored outside the document itself, or this action implies no log on the doc.
                // For now, directly removing as requested.
                await doc.remove(); // This is the permanent delete
                return true;
            } catch (error) {
                console.error(`Error during permanent removal of document ${docId}:`, error);
                return false;
            }
        } else { // Soft delete
            if (doc.get('_deleted')) {
                console.warn(`Document with ID ${docId} is already soft-deleted.`);
                return true; // Or false if we expect a change
            }
            const { auditFields } = middlewareHandler('remove', docId, deletedBy, 'Document soft-deleted', doc.get('log'));
            try {
                await doc.patch({
                    _deleted: true,
                    deletedAt: auditFields.deletedAt,
                    deletedBy: auditFields.deletedBy,
                    updatedAt: auditFields.updatedAt, // A soft delete is also an update
                    updatedBy: auditFields.updatedBy, // Record who marked it for deletion
                    log: auditFields.log,
                });
                return true;
            } catch (error) {
                console.error(`Error during soft removal of document ${docId}:`, error);
                return false;
            }
        }
    };

    // --- File Attachment Preview URLs ---
    // The issue requests preview URLs for file attachments.
    // This would typically be handled by:
    // 1. Identifying fields that represent file attachments in the schema (e.g., using a custom schema property like 'isAttachment: true').
    // 2. When documents are retrieved, and if the attachment data is, for example, a base64 string,
    //    the `base64ToBlob` utility (to be created) would convert it to a Blob.
    // 3. `URL.createObjectURL(blob)` would then generate a preview URL.
    // 4. This preview URL could be added as a non-persistent property to the document.
    //
    // Implementation approaches:
    // - RxDB Hooks: Use `postFindOne`, `postFind`, `postCreate` hooks on the collection.
    //   When a document is processed by these hooks, check for attachment fields,
    //   perform the conversion, and add the temporary previewURL.
    //   Example:
    //   collection.postFind(function(data, doc) {
    //     if (data.myBase64AttachmentField && typeof data.myBase64AttachmentField === 'string') {
    //       const blob = base64ToBlob(data.myBase64AttachmentField, 'image/png'); // contentType might need to be stored or inferred
    //       doc.previewURL = URL.createObjectURL(blob);
    //     }
    //   }, false); // 'false' for not async, adjust if base64ToBlob is async
    //
    // - Wrapper around CRUD methods: Modify the returned documents from `create`, `update`, etc.,
    //   or the documents within the signals (`allDocs`, `filteredDocs`) to add these URLs.
    //   This is less clean if you want it to apply universally.
    //
    // For the scope of this factory, the `base64ToBlob` helper will be provided.
    // Actual integration of preview URL generation into RxDB's lifecycle would be an advanced step
    // potentially handled by the application consuming this factory or by extending the factory's capabilities.

    // --- Dynamic Population (Placeholder) ---
    const dynamicGetters: Record<string, Function> = {};
    const schemaProperties = collection.schema.jsonSchema.properties;

    for (const propName in schemaProperties) {
        const propDef = schemaProperties[propName] as any; // Using 'as any' for simpler access to 'ref' and 'items.ref'

        if (propDef.ref) { // Single reference
            const refCollectionName = propDef.ref;
            dynamicGetters[`${propName}_`] = (docId: string): Observable<RxDocument<any, any> | null> => {
                if (!collection.database.collections[refCollectionName]) {
                    console.warn(`Reference collection ${refCollectionName} not found in database.`);
                    return of(null);
                }
                return collection.database.collections[refCollectionName].findOne(docId).$;
            };
        } else if (propDef.type === 'array' && propDef.items && propDef.items.ref) { // Array of references
            const refCollectionName = propDef.items.ref;
            dynamicGetters[`${propName}_`] = (docIds: string[]): Observable<Map<string, RxDocument<any, any>>> => {
                if (!collection.database.collections[refCollectionName]) {
                    console.warn(`Reference collection ${refCollectionName} not found in database.`);
                    return of(new Map());
                }
                return collection.database.collections[refCollectionName].findByIds(docIds).$;
            };
        }
    }

    // --- Return Object ---
    return {
        docs: computed(() => allDocs()), // Expose as computed signal
        filteredDocs: computed(() => filteredDocs()), // Expose as computed signal
        deletedDocs: computed(() => deletedDocs()), // Expose as computed signal
        create,
        update,
        restore,
        remove,
        // middlewareHandler, // Usually not exposed directly
        ...dynamicGetters
    };
}
