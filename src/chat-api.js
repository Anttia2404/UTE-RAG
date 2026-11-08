export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(payload?.detail || payload?.error?.message || payload || 'Yêu cầu chưa thành công.');
    error.code = payload?.error?.code || 'API_ERROR';
    error.sessionId = response.headers.get('x-session-id');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function requestAssistantReply({ messages, sourceIds, signal, sessionId }) {
  const payload = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, sourceIds, sessionId }),
    signal,
  });
  if (typeof payload.answer !== 'string' || !payload.answer.trim()) throw new Error('Backend chưa trả về câu trả lời hợp lệ.');
  return payload;
}
