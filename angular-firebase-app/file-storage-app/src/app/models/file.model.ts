import { Signal } from '@angular/core';
import { Observable } from 'rxjs';

export interface FileInput { name: string; data: Blob; }
export interface FileRead { id: string; name: string; data?: Blob; type: string; size: number; previewURL?: string; isLoading?: boolean; progress?: number; }
export interface FileReplicationMeta { id: string; name: string; path: string; }
export type FileReplicationInput = { id: string; name: string; data: Blob | File | string; listName: string; itemId: string; };
export type FileResult = { id: string; name: string; isLoading?: boolean; progress?: number; syncState: 'synced' | 'pending' | 'syncing' | 'error' | 'conflict' | ''; error: any };
export type FileReplicationResult = Observable<FileResult>;
