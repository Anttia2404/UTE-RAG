import { retrieveRelevantChunks } from '../src/knowledge-base.node.js';
import { sources } from '../src/sources.js';

let input = '';
for await (const part of process.stdin) input += part;

try {
  const { query, sourceIds } = JSON.parse(input);
  const ranked = await retrieveRelevantChunks(query, { sourceIds, limit: 5 });
  const results = ranked.map(({ chunk, score }) => ({
    id: chunk.id,
    sourceId: chunk.sourceId,
    sourceTitle: chunk.sourceTitle,
    section: chunk.section,
    text: chunk.text,
    score,
    href: sources[chunk.sourceId]?.href,
  }));
  process.stdout.write(JSON.stringify(results));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
