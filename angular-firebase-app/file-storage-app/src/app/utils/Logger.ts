import { Injectable } from '@angular/core';
import { LoggerOptions } from '../models/common.model';

const LOG_LEVELS: Record<LoggerOptions['level'], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private currentLogLevel: LoggerOptions['level'] = 'info';

  constructor() {
    // Optional: Log initial level
    // Using a direct console.info here to ensure this message always appears,
    // regardless of the initial currentLogLevel, for bootstrap diagnostics.
    console.info(`[${this.getTimestamp()}] [INFO] LoggerService initialized. Initial log level: ${this.currentLogLevel}`);
  }

  setConfig(options: Partial<LoggerOptions>): void {
    if (options.level) {
      const oldLevel = this.currentLogLevel;
      this.currentLogLevel = options.level;
      // Use the new level for this message, but log it as 'info' severity
      if (this.canLog('info')) {
         console.info(`[${this.getTimestamp()}] [INFO] Logger level changed from ${oldLevel} to: ${this.currentLogLevel}`);
      }
    }
  }

  private getTimestamp(): string {
    // Simple timestamp format: YYYY-MM-DD HH:mm:ss
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private canLog(level: LoggerOptions['level']): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.currentLogLevel];
  }

  debug(message: string, ...optionalParams: any[]): void {
    if (this.canLog('debug')) {
      const logFn = console.debug || console.log; // Fallback for console.debug
      logFn(`[${this.getTimestamp()}] [DEBUG] ${message}`, ...optionalParams);
    }
  }

  info(message: string, ...optionalParams: any[]): void {
    if (this.canLog('info')) {
      console.info(`[${this.getTimestamp()}] [INFO] ${message}`, ...optionalParams);
    }
  }

  warn(message: string, ...optionalParams: any[]): void {
    if (this.canLog('warn')) {
      console.warn(`[${this.getTimestamp()}] [WARN] ${message}`, ...optionalParams);
    }
  }

  error(message: string, ...optionalParams: any[]): void {
    if (this.canLog('error')) {
      console.error(`[${this.getTimestamp()}] [ERROR] ${message}`, ...optionalParams);
    }
  }
}
