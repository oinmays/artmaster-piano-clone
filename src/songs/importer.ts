/** The app-wide import queue: one per page, so imports keep running between screens. */
import { createQueue, type ImportQueue } from './queue';
import { importFile } from './mine';

let queue: ImportQueue | null = null;
export const importQueue = (): ImportQueue => (queue ??= createQueue(importFile));
