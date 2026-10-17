/**
 * A lean stand-in for '@tensorflow/tfjs' (T23). vite.config.ts aliases '@tensorflow/tfjs' here,
 * so Basic Pitch gets the core ops, the graph-model loader and the WebGL and CPU backends,
 * without the layers and data packages it never uses (about 270 KB less, minified).
 * Only the audio worker imports this; it never reaches the main bundle.
 */
export * from '@tensorflow/tfjs-core';
export * from '@tensorflow/tfjs-converter';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
