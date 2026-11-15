import type { AdapterRegistration } from '../types';

/**
 * Every feed the hub runs, in routing priority order. Adding a feed is one adapter file plus one
 * entry here. The crypto adapters arrive in T6, the equity adapters in T13.
 */
export const registrations: AdapterRegistration[] = [];
