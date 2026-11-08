import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { requestAssistantReply } from './chat-api.js';
import { sampleConversation, sources, starterQuestions } from './sources.js';
import './styles.css';

function Icon({ name, className = '' }) {
  const paths = {
    brand: <><path d="M4 5h16v4H14v10h-4V9H4z" /><path d="M17 15h3v4h-3z" /></>,
    document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    regenerate: <><path d="M20 7v5h-5" /><path d="M4.93 16A8 8 0 0 0 19 18l1-1M4 17v-5h5" /><path d="M5 6a8 8 0 0 1 14 2" /></>,
    send: <path d="M12 19V5m-7 7 7-7 7 7" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  };
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Citation({ citation }) {
  const source = sources[citation.sourceId];
  if (!source) return null;
  return <a className="source-citation" href={`/?source=${encodeURIComponent(source.id)}`} target="_blank" rel="noreferrer">
    <Icon name="document" /><span>{citation.label || source.label}</span><Icon name="external" className="external-icon" />
  </a>;
}

function AnswerText({ text }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part)}</>;
}

function AnswerActions({ onCopy, onRegenerate, latest }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <div className={`answer-actions${latest ? ' is-latest' : ''}`}>
    <button className={`icon-button${copied ? ' is-copied' : ''}`} type="button" onClick={copy} aria-label="Sao chép" title="Sao chép"><Icon name="copy" className="copy-icon" /><Icon name="check" className="check-icon" /></button>
    <button className="icon-button" type="button" onClick={onRegenerate} aria-label="Tạo lại" title="Tạo lại"><Icon name="regenerate" /></button>
  </div>;
}

function AssistantAnswer({ message, index, latest, onRetry, onRegenerate }) {
  if (message.status === 'error') return <div className="assistant-error" role="alert">
    <strong>Trợ lý chưa trả lời được</strong><p>{message.reason}</p>
    <button className="outline-button retry-button" type="button" onClick={onRetry}>Thử lại</button>
  </div>;
  if (message.status === 'loading') return <div className="answer-skeleton" role="status" aria-label="Đang soạn câu trả lời"><span /><span /><span /></div>;
  return <div className="assistant-answer">
    <div className="answer-copy">{(message.content || '').split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}><AnswerText text={paragraph} /></p>)}</div>
    {!!message.citations?.length && <div className="citation-list">{message.citations.map((citation, i) => <Citation citation={citation} key={`${citation.sourceId}-${i}`} />)}</div>}
    <AnswerActions latest={latest} onCopy={() => navigator.clipboard?.writeText(message.content || '')} onRegenerate={onRegenerate} data-index={index} />
    {latest && !!message.suggestions?.length && <div className="follow-up-list"><p className="section-label">Hỏi tiếp</p>{message.suggestions.map((question) => <button className="suggestion-button" type="button" key={question} onClick={() => onRegenerate(question)}>{question}</button>)}</div>}
  </div>;
}

function App() {
  const [messages, setMessages] = useState(() => new URLSearchParams(location.search).get('demo') === '1' ? [...sampleConversation] : []);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const abortRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, pending]);

  const askLatestQuestion = async (history = messages) => {
    const question = [...history].reverse().find((message) => message.role === 'user')?.content;
    if (!question || pending) return;
    const base = history.at(-1)?.role === 'assistant' ? history.slice(0, -1) : history;
    const next = [...base, { role: 'assistant', status: 'loading' }];
    setMessages(next);
    setPending(true);
    abortRef.current = new AbortController();
    try {
      const result = await requestAssistantReply({
        messages: base,
        sourceIds: Object.keys(sources),
        signal: abortRef.current.signal,
      });
      setMessages([...base, { role: 'assistant', content: result.answer, citations: result.citations || [], suggestions: result.suggestions || [] }]);
    } catch (error) {
      if (error.name === 'AbortError') setMessages([...base, { role: 'assistant', content: 'Đã dừng giữa chừng.' }]);
      else setMessages([...base, { role: 'assistant', status: 'error', reason: error.message || 'Backend không xử lý được yêu cầu.' }]);
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  };

  const submitQuestion = (question) => {
    const content = question.trim();
    if (!content || pending) return;
    const history = [...messages.filter((message) => !(message.role === 'assistant' && message.status === 'error')), { role: 'user', content }];
    setMessages(history);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    void askLatestQuestion(history);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (pending) abortRef.current?.abort();
    else submitQuestion(input);
  };

  const onInput = (event) => {
    setInput(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 240)}px`;
  };

  const regenerate = (question) => {
    if (pending) return;
    if (typeof question === 'string') { submitQuestion(question); return; }
    const history = messages.at(-1)?.role === 'assistant' ? messages.slice(0, -1) : messages;
    void askLatestQuestion(history);
  };

  const retry = () => {
    if (pending) return;
    const history = messages.at(-1)?.role === 'assistant' ? messages.slice(0, -1) : messages;
    void askLatestQuestion(history);
  };

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Trợ lý học phí, trang chính"><span className="brand-mark"><Icon name="brand" /></span><span>Trợ lý học phí</span></a>
      <div className="header-meta" aria-label="Có bốn tài liệu nguồn"><span className="status-dot" /><span>Tài liệu học phí · 4 nguồn</span></div>
    </header>
    <main className="layout">
      <section className="chat-column" aria-label="Trò chuyện với trợ lý học phí">
        <div id="conversation" className="thread" role="log" aria-live="polite" aria-relevant="additions text" ref={threadRef}>
          {messages.length === 0 ? <div className="starter-panel">
            <p className="section-label">Thử hỏi</p>
            <div className="starter-list">{starterQuestions.map((question) => <button className="suggestion-button" type="button" key={question} onClick={() => submitQuestion(question)}>{question}</button>)}</div>
          </div> : messages.map((message, i) => {
            if (message.role !== 'user') return null;
            const answer = messages[i + 1];
            const answerIndex = i + 1;
            return <article className="thread-turn" key={`${i}-${message.content}`}>
              <p className="user-message">{message.content}</p>
              {answer?.role === 'assistant' && <AssistantAnswer message={answer} index={answerIndex} latest={answerIndex === messages.length - 1} onRetry={retry} onRegenerate={regenerate} />}
            </article>;
          })}
        </div>
        <form className="composer" autoComplete="off" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="message-input">Câu hỏi của bạn</label>
          <textarea id="message-input" name="message" rows="1" placeholder="Hỏi về học phí hoặc thời hạn" aria-describedby="composer-hint" ref={inputRef} value={input} onChange={onInput} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (pending) abortRef.current?.abort(); else submitQuestion(input); }
          }} />
          <button className={`send-button${pending ? ' is-pending' : ''}`} type="submit" aria-label={pending ? 'Dừng trả lời' : 'Gửi'} disabled={!input.trim() && !pending}>
            <Icon name="send" className="send-icon" /><Icon name="stop" className="stop-icon" />
          </button>
        </form>
        <p id="composer-hint" className="sr-only">Nhấn Enter để gửi, Shift cộng Enter để xuống dòng.</p>
      </section>
    </main>
  </div>;
}

function SourceReader({ sourceId }) {
  const source = sources[sourceId];
  const [state, setState] = useState({ status: 'loading', html: '' });

  useEffect(() => {
    let active = true;
    fetch(source.href)
      .then((response) => {
        if (!response.ok) throw new Error('Không tải được tài liệu nguồn.');
        return response.text();
      })
      .then((markdown) => {
        const rendered = marked.parse(markdown, { gfm: true, breaks: false });
        const safeHtml = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
        const documentFragment = document.createElement('template');
        documentFragment.innerHTML = safeHtml;
        documentFragment.content.querySelectorAll('table').forEach((table) => {
          const scroller = document.createElement('div');
          scroller.className = 'markdown-table-scroll';
          table.replaceWith(scroller);
          scroller.append(table);
        });
        if (active) setState({ status: 'ready', html: DOMPurify.sanitize(documentFragment.innerHTML, { USE_PROFILES: { html: true } }) });
      })
      .catch(() => {
        if (active) setState({ status: 'error', html: '' });
      });
    return () => { active = false; };
  }, [source.href]);

  return <div className="source-page">
    <header className="source-header">
      <a className="brand" href="/" aria-label="Quay lại Trợ lý học phí"><span className="brand-mark"><Icon name="brand" /></span><span>Trợ lý học phí</span></a>
      <a className="source-back" href="/">Về cuộc trò chuyện</a>
    </header>
    <main className="source-reader">
      <div className="source-reader-meta"><Icon name="document" /><span>{source.label}</span></div>
      <h1>{source.title}</h1>
      {state.status === 'loading' && <p className="source-reader-status" role="status">Đang mở tài liệu…</p>}
      {state.status === 'error' && <p className="source-reader-status" role="alert">Không tải được tài liệu. Hãy thử mở lại từ trích dẫn.</p>}
      {state.status === 'ready' && <article className="markdown-document" dangerouslySetInnerHTML={{ __html: state.html }} />}
    </main>
  </div>;
}

function Root() {
  const sourceId = new URLSearchParams(location.search).get('source');
  return sourceId && sources[sourceId] ? <SourceReader sourceId={sourceId} /> : <App />;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
