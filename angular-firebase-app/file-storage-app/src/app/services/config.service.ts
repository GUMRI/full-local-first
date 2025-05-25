import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
// Assuming LocalForage types will be added later or are globally available
// import * as LocalForage from 'localforage';

export interface AdapterConfig {
  localForage?: any; // Replace 'any' with LocalForage specific types if available
  firestore?: Firestore;
  firebaseStorage?: Storage;
}

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private globalConfig: AdapterConfig = {};

  constructor() { }

  setConfig(config: AdapterConfig): void {
    this.globalConfig = { ...this.globalConfig, ...config };
  }

  getConfig(): AdapterConfig {
    return this.globalConfig;
  }

  // Specific getters for convenience
  getLocalForageInstance(): any {
    return this.globalConfig.localForage;
  }

  getFirestoreInstance(): Firestore | undefined {
    return this.globalConfig.firestore;
  }

  getFirebaseStorageInstance(): Storage | undefined {
    return this.globalConfig.firebaseStorage;
  }
}
