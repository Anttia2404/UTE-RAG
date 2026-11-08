import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { sources } from '../src/sources.js';
import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS, EMBEDDING_DTYPE, EMBEDDING_MODEL } from '../src/kb-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(root, 'public', 'kb', 'chunks.json');
env.cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'transformers');

function cleanMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function splitLongBlock(text, maxChars) {
  const parts = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('\n'));
    if (cut < maxChars * 0.55) cut = window.lastIndexOf(' ', maxChars);
    if (cut < 1) cut = maxChars;
    else if (remaining[cut] === '.' || remaining[cut] === ';' || remaining[cut] === '?' || remaining[cut] === '!') cut += 1;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function makeChunks(markdown, source) {
  const blocks = markdown.replace(/\r/g, '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const headingPath = [];
  const chunks = [];
  let currentSection = 'Toàn văn';
  let currentText = '';

  const pushChunk = () => {
    const body = currentText.trim();
    const cleanedBody = cleanMarkdown(body);
    if (!cleanedBody || cleanedBody === currentSection) {
      currentText = '';
      return;
    }
    chunks.push({
      id: `${source.id}-${String(chunks.length + 1).padStart(4, '0')}`,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceHref: source.href,
      section: currentSection,
      text: cleanedBody,
    });
    currentText = '';
  };

  for (const block of blocks) {
    const heading = block.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      pushChunk();
      const level = heading[1].length;
      headingPath[level - 1] = cleanMarkdown(heading[2]);
      headingPath.length = level;
      currentSection = headingPath.filter(Boolean).join(' › ');
      currentText = `${currentSection}\n`;
      continue;
    }

    const text = cleanMarkdown(block);
    if (!text) continue;
    for (const part of splitLongBlock(text, CHUNK_MAX_CHARS)) {
      const candidate = currentText ? `${currentText}\n\n${part}` : `${currentSection}\n${part}`;
      if (candidate.length > CHUNK_MAX_CHARS && currentText.trim()) {
        const previousTail = currentText.slice(-CHUNK_OVERLAP_CHARS).trim();
        pushChunk();
        currentText = `${currentSection}\n${previousTail ? `${previousTail}\n\n` : ''}${part}`;
      } else {
        currentText = candidate;
      }
      if (currentText.length >= CHUNK_MAX_CHARS) {
        const previousTail = currentText.slice(-CHUNK_OVERLAP_CHARS).trim();
        pushChunk();
        currentText = `${currentSection}\n${previousTail}`;
      }
    }
  }
  pushChunk();
  return chunks;
}

const records = [];
for (const source of Object.values(sources)) {
  const filename = path.basename(source.href);
  const markdown = await fs.readFile(path.join(root, filename), 'utf8');
  await fs.mkdir(path.join(root, 'public', 'sources'), { recursive: true });
  await fs.copyFile(path.join(root, filename), path.join(root, 'public', 'sources', filename));
  records.push(...makeChunks(markdown, source));
}

if (!records.length) throw new Error('Không tạo được chunk nào từ tài liệu nguồn.');
console.log(`Đã chia ${Object.keys(sources).length} tài liệu thành ${records.length} chunk.`);
console.log(`Đang tải model embedding ${EMBEDDING_MODEL} (lần đầu có thể mất vài phút)...`);

const embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE });
for (let index = 0; index < records.length; index += 1) {
  const output = await embedder(records[index].text, { pooling: 'mean', normalize: true });
  records[index].embedding = output.tolist().flat();
  if ((index + 1) % 20 === 0 || index + 1 === records.length) {
    console.log(`Embedding ${index + 1}/${records.length}`);
  }
}

const dimensions = records[0].embedding.length;
await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify({
  schemaVersion: 1,
  embeddingModel: EMBEDDING_MODEL,
  embeddingDtype: EMBEDDING_DTYPE,
  dimensions,
  chunking: { maxChars: CHUNK_MAX_CHARS, overlapChars: CHUNK_OVERLAP_CHARS },
  generatedAt: new Date().toISOString(),
  chunkCount: records.length,
  chunks: records,
}, null, 2)}\n`, 'utf8');

console.log(`Đã lưu ${records.length} vector ${dimensions} chiều tại ${path.relative(root, outputFile)}.`);
