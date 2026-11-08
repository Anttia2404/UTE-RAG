import { retrieveRelevantChunks } from '../src/knowledge-base.node.js';
const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Cách dùng: npm run kb:search -- "câu hỏi cần tìm"');
  process.exit(1);
}

const ranked = await retrieveRelevantChunks(query);

for (const { chunk, score, semantic, lexical } of ranked) {
  console.log(`\n[${score.toFixed(3)} | ngữ nghĩa ${semantic.toFixed(3)} | từ khóa ${lexical.toFixed(3)}] ${chunk.sourceTitle} · ${chunk.section}`);
  console.log(chunk.text.slice(0, 500).replace(/\s+/g, ' '));
}
