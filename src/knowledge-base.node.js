import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { EMBEDDING_DTYPE, EMBEDDING_MODEL } from './kb-config.js';
import { rankChunks } from './retrieval.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(projectRoot, 'public', 'kb', 'chunks.json');
env.cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'transformers');

let indexPromise;
let embedderPromise;

async function loadIndex() {
  indexPromise ||= fs.readFile(indexPath, 'utf8').then((text) => JSON.parse(text));
  const index = await indexPromise;
  if (index.embeddingModel !== EMBEDDING_MODEL || index.embeddingDtype !== EMBEDDING_DTYPE) {
    throw new Error('Embedding model không khớp public/kb/chunks.json. Chạy npm run kb:build lại.');
  }
  return index;
}

async function getEmbedder() {
  embedderPromise ||= pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE });
  return embedderPromise;
}

/** Get the best matching document chunks for a user query. */
export async function retrieveRelevantChunks(query, options = {}) {
  const text = String(query || '').trim();
  if (!text) return [];
  const [index, embedder] = await Promise.all([loadIndex(), getEmbedder()]);
  const queryEmbedding = (await embedder(text, { pooling: 'mean', normalize: true })).tolist().flat();
  if (queryEmbedding.length !== index.dimensions) {
    throw new Error(`Embedding query có ${queryEmbedding.length} chiều, index có ${index.dimensions}.`);
  }
  return rankChunks(text, queryEmbedding, index.chunks, options);
}
