
import { Signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { Observable } from 'rxjs';




/** input أثناء create/update localForage */
export interface FileInput {
    name: string;
    data: Blob;
}


/** عند القراءة من list factory */
export interface FileRead {
    id: string;
    name: string;
    data?: Blob;
    type: string;
    size: number;
    previewURL?: string;
    isLoading?: boolean;
    progress?: number;
}


/** لحفظ meta في remote db*/
export interface FileReplicationMeta {
    id: string;
    name: string;
    path: string;
}


export type FileReplicationInput = {
    id: string;
    name: string;
    data: Blob;
    listName: string;
    itemId: string;
};


export type FileResult = {
    id: string;
    name: string;
    isLoading?: boolean;
    progress?: number;
};
export type FileReplicationResult = Observable<FileResult>






/** العنصر داخل list item */
export type fieldsKeys<T> = keyof T;


export interface BaseItem<T, U = any> {
    _id: string; // by default _id is a primary and added by default to uniqueFields
    createdAt: string;
    createdBy: string | U | null;
    _updatedAt: string;
    updates?: {
        by: string | U | null;
        at: string;
        before: Partial<T>;
        after: Partial<T>;
    }[];
    _deleted: boolean;
    _deletedAt?: string;
    deletedBy?: string | U | null;
    avatar: FileRead; // this exmple for read file "avatar" PROP is exmple, lib user use any prop has type FileRead
}


export type Item<T, U = any> = T & BaseItem<T, U>;


export interface CreateItemInput<T, U = any> {
    createdBy?: string | null;
    files?: FileInput[];
    data: T;
}


export interface UpdateItemInput<T, U = any> {
    id: string;
    updatedBy: string | U | null;
    data: Partial<T>;
}


export type FilterArgs<T> = {
    where?: {
        [K in keyof T]?: {
            equals?: T[K];
            in?: T[K][];
            not?: T[K];
            lt?: T[K];
            lte?: T[K];
            gt?: T[K];
            gte?: T[K];
            contains?: string;
            startsWith?: string;
            endsWith?: string;
        };
    };


    orderBy?: { [K in keyof T]?: 'asc' | 'desc' };
    skip?: number;
    take?: number;
};
export type FieldType =
    'text'
    | 'longText'  // long string
    | 'number'
    | 'boolean'
    | 'dateTime'
    | 'file' // save as attachments, and updoad and download in firebsea Stoarge in replication push, pull
    | 'object'
    | 'array'
    | 'map'
    | 'autoIncriment' // index, no,
    | 'population' // one to one
    | 'populations'  // many to one


export interface ListOptions<T> {
    name: string;
    fields: Record<keyof T, FieldType>;
    uniqueFields: [keyof T][];
    searchFields: [keyof T][];
    replication?: {
        firestore?: Firestore;
        firebaseStorage?: Storage;
    };
}






export interface ManyResult extends Map<string, boolean> { }


export interface ListState<T, U = any> {
    items: Signal<Item<T, U>[]>
    status: Signal<'idle' | 'loading' | 'error' | 'success'>;
    isloading:Signal<Boolean>
    hasValue:Signal<Boolean>
    error: Signal<string | null>;
    filteredItems: Signal<Item<T, U>[]>;
    deletedItems: Signal<Item<T, U>[]>;
    count: Signal<number>;
    filesState: Signal<FileResult>
}



// listCRUD interface as class structure
export interface ListCRUD<T, U = any> {
    findFirst(args: FilterArgs<T>): { item: Signal<Item<T, U> | null> };
    findUniqe(id: string): { item: Signal<Item<T, U> | null> };
    filter(args: FilterArgs<T>): ManyResult[]
    create(data: CreateItemInput<T, U>): Item<T, U>;
    createMany(data: CreateItemInput<T, U>[]): boolean[];


    update(input: UpdateItemInput<T, U>): Item<T, U> | null;
    updateMany(input: UpdateItemInput<T, U>[]): ManyResult[];


    upsert(input: UpdateItemInput<T, U>): Item<T, U>;
    upsertMany(input: UpdateItemInput<T, U>[]): ManyResult[];


    remove(id: string, deletedBy: string | U, soft?: boolean): boolean;
    removeMany(ids: string[], deletedBy: string | U, soft?: boolean): ManyResult[];
    restore(id: string): boolean;
    restoreMany(ids: string[]): ManyResult[];
    purgeDeleted(): number;
    purgeOldDeleted(olderThanDate: string): number;
}


export type ListRef<T, U = any> = ListState<T, U> & ListCRUD<T, U>;




// factory interface
export declare function list<T, U = any>(optios: ListOptions<T>): ListRef<T, U>
