import { migrateStorage } from './rename';

// Imported first by main.tsx, so saved state is renamed before any store reads it.
try {
  migrateStorage(localStorage);
} catch {
  // Storage is blocked: there is nothing saved to rename.
}
