const STOP_WORDS = new Set([
  'la', 'va', 'cua', 'cho', 'tu', 've', 'voi', 'theo', 'trong', 'tai', 'den', 'nao',
  'khi', 'gi', 'bao', 'nhieu', 'nhung', 'cac', 'mot', 'nhu', 'duoc', 'co', 'khong',
  'toi', 'hay', 'giup', 'xin', 'cho', 'hoi', 'toi', 'nam', 'ky', 'hoc', 'thu', 'ngay', 'tien',
]);

export function normalizeSearchText(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTerms(value) {
  return normalizeSearchText(value)
    .match(/\d{4}-\d{4}|[\p{L}\p{N}]+/gu)?.filter((term) => !STOP_WORDS.has(term) && term.length > 1) || [];
}

function tokenize(value) {
  return new Set(normalizeSearchText(value).match(/\d{4}-\d{4}|[\p{L}\p{N}]+/gu) || []);
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** Mix semantic similarity with rare exact terms so dates and document codes win. */
export function rankChunks(query, queryEmbedding, chunks, { sourceIds, limit = 5 } = {}) {
  const terms = [...new Set(queryTerms(query))];
  const normalizedQuery = normalizeSearchText(query);
  const candidates = chunks.filter((chunk) => !sourceIds?.length || sourceIds.includes(chunk.sourceId));
  const documentFrequency = new Map(terms.map((term) => [term, candidates.reduce((count, chunk) => count + (tokenize(chunk.text).has(term) ? 1 : 0), 0)]));
  const weights = new Map(terms.map((term) => [term, Math.log(1 + (candidates.length + 1) / (1 + (documentFrequency.get(term) || 0)))]));
  const totalWeight = [...weights.values()].reduce((sum, value) => sum + value, 0) || 1;

  return candidates.map((chunk) => {
    const normalizedText = normalizeSearchText(`${chunk.sourceTitle} ${chunk.section} ${chunk.text}`);
    const textTerms = tokenize(`${chunk.sourceTitle} ${chunk.section} ${chunk.text}`);
    const lexical = terms.reduce((sum, term) => sum + (textTerms.has(term) ? weights.get(term) : 0), 0) / totalWeight;
    const semantic = cosineSimilarity(queryEmbedding, chunk.embedding);
    const exactPhrase = normalizedQuery.length > 8 && normalizedText.includes(normalizedQuery) ? 1 : 0;
    const asksForDates = /\b(ngay|thoi gian|den khi nao|han nop|han dong|deadline)\b/.test(normalizedQuery);
    const hasDateRange = /\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}.{0,80}(?:đến|tới|[-–—])\s*(?:ngày\s*)?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}/iu.test(chunk.text);
    const directAnswer = asksForDates && hasDateRange ? 1 : 0;
    const score = semantic * 0.38 + lexical * 0.45 + exactPhrase * 0.05 + directAnswer * 0.12;
    return { chunk, score, semantic, lexical, directAnswer };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}
