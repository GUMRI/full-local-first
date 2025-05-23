/**
 * @file Barrel file for the local-first library's core functionalities.
 */

// Export all types
export * from './types';

// Export all services (which are already bundled by services/index.ts)
export * from './services';

// Export the list factory function
export * from './list.factory';

// Export any other standalone components, directives, or pipes if they exist
// For example, if local-first.component and local-first.service are meant to be public:
// export * from './local-first.component';
// export * from './local-first.service';
// However, the prompt focuses on the 'list' factory and its types/services.
// The original local-first.service and .component might be deprecated or refactored
// by the introduction of the list factory. For now, only exporting what's clearly part of the new system.

// Export the Studio Module
export * from './studio/studio.module';