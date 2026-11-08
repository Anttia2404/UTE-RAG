/** Same-origin API adapter. The LLM credential stays in the Node backend. */
export async function requestAssistantReply({ messages, sourceIds, signal }) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, sourceIds }),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Backend không xử lý được yêu cầu.');
    error.code = payload.error?.code || 'API_ERROR';
    throw error;
  }
  if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new Error('Backend chưa trả về câu trả lời hợp lệ.');
  }
  return payload;
}
