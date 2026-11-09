import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, requestAssistantReply } from './chat-api.js';
import { sampleConversation, sources, starterQuestions } from './sources.js';
import './styles.css';

function Icon({ name, className = '' }) {
  const paths = {
    brand: <><path d="M4 5h16v4H14v10h-4V9H4z" /><path d="M17 15h3v4h-3z" /></>,
    document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    messages: <><path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3v-6.5A7.5 7.5 0 1 1 21 11.5Z" /><path d="M8 9h8M8 13h5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.9 13.1A8.5 8.5 0 0 1 10.9 3.1 8.5 8.5 0 1 0 20.9 13.1Z" />,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    regenerate: <><path d="M20 7v5h-5" /><path d="M4.93 16A8 8 0 0 0 19 18l1-1M4 17v-5h5" /><path d="M5 6a8 8 0 0 1 14 2" /></>,
    send: <path d="M12 19V5m-7 7 7-7 7 7" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  };
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function ThemeToggle({ theme, onToggle, floating = false }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Chuyển sang giao diện ${nextTheme === 'dark' ? 'tối' : 'sáng'}`;
  return <button className={`theme-toggle${floating ? ' is-floating' : ''}`} type="button" onClick={onToggle} aria-label={label} aria-pressed={theme === 'dark'} title={label}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>;
}

const CHAT_HISTORY_KEY = 'tro-ly-hoc-phi:chat-history:v1';

function readChatHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .map((item) => ({
        ...item,
        title: typeof item.title === 'string' ? item.title : 'Cuộc trò chuyện mới',
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        messages: item.messages
          .filter((message) => message && ['user', 'assistant'].includes(message.role) && (typeof message.content === 'string' || message.status === 'error'))
          .map((message) => ({ ...message, content: message.content || '' })),
      }))
      .filter((item) => item.messages.some((message) => message.role === 'user'))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch {
    return [];
  }
}

function createInitialChatState() {
  const conversations = readChatHistory();
  if (new URLSearchParams(location.search).get('demo') === '1') {
    return { conversations, activeId: null, messages: [...sampleConversation] };
  }
  const active = conversations[0];
  return { conversations, activeId: active?.id || null, messages: active?.messages || [] };
}

function makeConversationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getConversationTitle(messages) {
  const latestQuestion = [...messages].reverse().find((message) => message.role === 'user')?.content;
  if (!latestQuestion) return 'Cuộc trò chuyện mới';
  const title = latestQuestion.replace(/\s+/g, ' ').trim();
  return title.length > 54 ? `${title.slice(0, 53).trimEnd()}…` : title;
}

function historyGroupLabel(updatedAt) {
  const date = new Date(updatedAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.floor((today - entryDay) / 86400000);
  if (daysAgo <= 0) return 'Hôm nay';
  if (daysAgo <= 7) return '7 ngày qua';
  return 'Trước đó';
}

function Citation({ citation }) {
  const source = sources[citation.sourceId];
  const href = source
    ? `/?source=${encodeURIComponent(source.id)}`
    : citation.documentId || citation.sourceId
      ? `/?document=${encodeURIComponent(citation.documentId || citation.sourceId)}`
      : citation.href || null;
  if (!href) return null;
  return <a className="source-citation" href={href} target="_blank" rel="noreferrer">
    <Icon name="document" /><span>{citation.label || source?.label || 'Tài liệu nguồn'}</span><Icon name="external" className="external-icon" />
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

function AssistantAnswer({ message, index, latest, onRetry, onRegenerate, onFeedback, onHandoff, canHandoff }) {
  if (message.status === 'error') return <div className="assistant-error" role="alert">
    <strong>Trợ lý chưa trả lời được</strong><p>{message.reason}</p>
    <button className="outline-button retry-button" type="button" onClick={onRetry}>Thử lại</button>
  </div>;
  if (message.status === 'loading') return <div className="answer-skeleton" role="status" aria-label="Đang soạn câu trả lời"><span /><span /><span /></div>;
  return <div className="assistant-answer">
    <div className="answer-copy">{(message.content || '').split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}><AnswerText text={paragraph} /></p>)}</div>
    {!!message.citations?.length && <div className="citation-list">{message.citations.map((citation, i) => <Citation citation={citation} key={`${citation.sourceId}-${i}`} />)}</div>}
    <AnswerActions latest={latest} onCopy={() => navigator.clipboard?.writeText(message.content || '')} onRegenerate={onRegenerate} data-index={index} />
    {message.id && <div className="feedback-actions" aria-label="Đánh giá câu trả lời"><span>Hữu ích?</span><button type="button" onClick={() => onFeedback(message.id, 'helpful')}>Có</button><button type="button" onClick={() => onFeedback(message.id, 'not_helpful')}>Chưa</button>{canHandoff && <button className="handoff-button" type="button" onClick={() => onHandoff(message)}>Hỏi cán bộ</button>}</div>}
    {latest && !!message.suggestions?.length && <div className="follow-up-list"><p className="section-label">Hỏi tiếp</p>{message.suggestions.map((question) => <button className="suggestion-button" type="button" key={question} onClick={() => onRegenerate(question)}>{question}</button>)}</div>}
  </div>;
}

function App({ user, onLogout, onNavigate, currentSection = 'chat', isStaff = false, theme, onToggleTheme }) {
  const [initialChatState] = useState(createInitialChatState);
  const [conversations, setConversations] = useState(initialChatState.conversations);
  const [activeConversationId, setActiveConversationId] = useState(initialChatState.activeId);
  const activeConversationIdRef = useRef(initialChatState.activeId);
  const [messages, setMessages] = useState(initialChatState.messages);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('demo') === '1') { setHistoryLoaded(true); return; }
    let active = true;
    api('/api/chats').then(async (items) => {
      if (!active) return;
      setConversations(items.map((item) => ({ ...item, messages: [] })));
      const first = items[0];
      if (first) {
        const detail = await api(`/api/chats/${encodeURIComponent(first.id)}`);
        if (!active) return;
        activeConversationIdRef.current = detail.id;
        setActiveConversationId(detail.id);
        setMessages(detail.messages || []);
      }
    }).catch(() => {}).finally(() => { if (active) setHistoryLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, pending]);

  const saveConversation = (id, nextMessages) => {
    const now = new Date().toISOString();
    const nextConversation = {
      id,
      title: getConversationTitle(nextMessages),
      messages: nextMessages,
      updatedAt: now,
    };
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === id);
      return [{ ...nextConversation, createdAt: existing?.createdAt || now }, ...current.filter((item) => item.id !== id)];
    });
  };

  const activateConversation = async (conversation) => {
    if (pending) return;
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages || []);
    try {
      const detail = await api(`/api/chats/${encodeURIComponent(conversation.id)}`);
      if (activeConversationIdRef.current === conversation.id) setMessages(detail.messages || []);
    } catch (error) { setMessages([{ role: 'assistant', status: 'error', reason: error.message }]); }
    setHistoryOpen(false);
  };

  const startNewConversation = () => {
    if (pending) return;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setHistoryQuery('');
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const deleteConversation = async (event, conversation) => {
    event.stopPropagation();
    if (pending || !window.confirm(`Xóa cuộc trò chuyện “${conversation.title}” khỏi lịch sử?`)) return;
    try { await api(`/api/chats/${encodeURIComponent(conversation.id)}`, { method: 'DELETE' }); }
    catch (error) { window.alert(error.message); return; }
    setConversations((current) => current.filter((item) => item.id !== conversation.id));
    if (activeConversationIdRef.current === conversation.id) {
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
      setMessages([]);
    }
  };

  const askLatestQuestion = async (history = messages, conversationId = activeConversationIdRef.current) => {
    const question = [...history].reverse().find((message) => message.role === 'user')?.content;
    if (!question || pending) return;
    const base = history.at(-1)?.role === 'assistant' ? history.slice(0, -1) : history;
    const next = [...base, { role: 'assistant', status: 'loading' }];
    setMessages(next);
    if (conversationId) saveConversation(conversationId, next);
    setPending(true);
    abortRef.current = new AbortController();
    try {
      const result = await requestAssistantReply({
        messages: base,
        signal: abortRef.current.signal,
        sessionId: conversationId,
      });
      const serverId = result.sessionId || conversationId;
      activeConversationIdRef.current = serverId;
      setActiveConversationId(serverId);
      const completed = [...base, { role: 'assistant', id: result.messageId, content: result.answer, citations: result.citations || [], suggestions: result.suggestions || [] }];
      setMessages(completed);
      if (serverId) saveConversation(serverId, completed);
      api('/api/chats').then((items) => setConversations(items.map((item) => ({ ...item, messages: [] })))).catch(() => {});
    } catch (error) {
      const failed = error.name === 'AbortError'
        ? [...base, { role: 'assistant', content: 'Đã dừng giữa chừng.' }]
        : [...base, { role: 'assistant', status: 'error', reason: error.message || 'Backend không xử lý được yêu cầu.' }];
      setMessages(failed);
      const serverId = error.sessionId || conversationId;
      if (serverId) { activeConversationIdRef.current = serverId; setActiveConversationId(serverId); saveConversation(serverId, failed); }
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  };

  const submitQuestion = (question) => {
    const content = question.trim();
    if (!content || pending) return;
    const history = [...messages.filter((message) => !(message.role === 'assistant' && message.status === 'error')), { role: 'user', content }];
    const conversationId = activeConversationIdRef.current;
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
    setMessages(history);
    if (conversationId) saveConversation(conversationId, history);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    void askLatestQuestion(history, conversationId);
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

  const submitFeedback = async (messageId, rating) => {
    try { await api('/api/feedback', { method: 'POST', body: JSON.stringify({ messageId, rating }) }); }
    catch (error) { window.alert(error.message); }
  };

  const handoffToStaff = async (message) => {
    const answerIndex = messages.findIndex((item) => item.id === message.id);
    const question = [...messages.slice(0, answerIndex)].reverse().find((item) => item.role === 'user')?.content;
    if (!question) return;
    try {
      await api('/api/tickets', { method: 'POST', body: JSON.stringify({ sessionId: activeConversationIdRef.current, messageId: message.id, question }) });
      window.alert('Đã chuyển câu hỏi cho cán bộ. Bạn có thể xem trạng thái trong mục “Yêu cầu hỗ trợ”.');
    } catch (error) { window.alert(error.message); }
  };

  const normalizedQuery = historyQuery.trim().toLocaleLowerCase('vi');
  const visibleConversations = conversations.filter((conversation) => {
    if (!normalizedQuery) return true;
    return `${conversation.title} ${conversation.messages.map((message) => message.content).join(' ')}`
      .toLocaleLowerCase('vi')
      .includes(normalizedQuery);
  });
  const historyGroups = ['Hôm nay', '7 ngày qua', 'Trước đó']
    .map((label) => ({ label, items: visibleConversations.filter((item) => historyGroupLabel(item.updatedAt) === label) }))
    .filter((group) => group.items.length > 0);
  const userInitials = user?.fullName?.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toLocaleUpperCase('vi') || 'SV';

  return <div className="app-shell">
    <header className="app-header">
      <div className="header-start">
        <button className="history-menu-button" type="button" aria-label={historyOpen ? 'Đóng lịch sử' : 'Mở lịch sử'} aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}><Icon name={historyOpen ? 'close' : 'menu'} /></button>
        <a className="brand" href="/" aria-label="Trợ lý học phí, trang chính"><span className="brand-mark"><Icon name="brand" /></span><span>Trợ lý học phí</span></a>
      </div>
      <div className="header-meta" aria-label="Có bốn tài liệu nguồn"><span className="status-dot" /><span>Tài liệu học phí · 4 nguồn</span></div>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </header>
    <div className={`layout${historyOpen ? ' is-history-open' : ''}`}>
      {historyOpen && <button className="history-backdrop" type="button" aria-label="Đóng lịch sử" onClick={() => setHistoryOpen(false)} />}
      <aside className="history-sidebar" aria-label="Lịch sử trò chuyện">
        <div className="history-sidebar-header">
          <a className="brand" href="/" aria-label="Trợ lý học phí, trang chính"><span className="brand-mark"><Icon name="brand" /></span><span>Trợ lý học phí</span></a>
          <div className="sidebar-header-actions">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button className="history-close-button" type="button" aria-label="Đóng lịch sử" onClick={() => setHistoryOpen(false)}><Icon name="close" /></button>
          </div>
        </div>
        <button className="new-chat-button" type="button" onClick={startNewConversation} disabled={pending}><Icon name="plus" /><span>Cuộc trò chuyện mới</span></button>
        <label className="history-search">
          <Icon name="search" />
          <input type="search" placeholder="Tìm cuộc trò chuyện" aria-label="Tìm trong lịch sử trò chuyện" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
          {historyQuery && <button type="button" aria-label="Xóa nội dung tìm kiếm" onClick={() => setHistoryQuery('')}><Icon name="close" /></button>}
        </label>
        <div className="history-list" aria-live="polite">
          {historyGroups.map((group) => <section className="history-group" key={group.label}>
            <h3>{group.label}</h3>
            {group.items.map((conversation) => <div className={`history-row${conversation.id === activeConversationId ? ' is-selected' : ''}`} key={conversation.id}>
              <button className="history-item" type="button" onClick={() => activateConversation(conversation)} disabled={pending} aria-current={conversation.id === activeConversationId ? 'page' : undefined}>
                <span>{conversation.title}</span>
              </button>
              <button className="history-delete" type="button" aria-label={`Xóa ${conversation.title}`} title="Xóa cuộc trò chuyện" onClick={(event) => deleteConversation(event, conversation)} disabled={pending}><Icon name="trash" /></button>
            </div>)}
          </section>)}
          {!visibleConversations.length && <div className="history-empty" role="status">
            <span className="history-empty-icon"><Icon name={normalizedQuery ? 'search' : 'document'} /></span>
            <p>{normalizedQuery ? 'Không tìm thấy cuộc trò chuyện phù hợp.' : 'Các câu hỏi trước sẽ xuất hiện ở đây.'}</p>
            {normalizedQuery && <button className="history-clear-search" type="button" onClick={() => setHistoryQuery('')}>Xóa tìm kiếm</button>}
          </div>}
        </div>
        <nav className="sidebar-nav" aria-label="Điều hướng">
          <button className={currentSection === 'chat' ? 'is-active' : ''} type="button" aria-current={currentSection === 'chat' ? 'page' : undefined} onClick={() => onNavigate?.('chat')}><Icon name="messages" /><span>Trò chuyện</span></button>
          <button className={currentSection === 'notices' ? 'is-active' : ''} type="button" aria-current={currentSection === 'notices' ? 'page' : undefined} onClick={() => onNavigate?.('notices')}><Icon name="bell" /><span>Thông báo</span></button>
          <button className={currentSection === 'search' ? 'is-active' : ''} type="button" aria-current={currentSection === 'search' ? 'page' : undefined} onClick={() => onNavigate?.('search')}><Icon name="search" /><span>Tra cứu</span></button>
          {user?.role === 'student' && <button className={currentSection === 'tickets' ? 'is-active' : ''} type="button" aria-current={currentSection === 'tickets' ? 'page' : undefined} onClick={() => onNavigate?.('tickets')}><Icon name="messages" /><span>Yêu cầu hỗ trợ</span></button>}
          {isStaff && <button className={currentSection === 'workspace' ? 'is-active' : ''} type="button" aria-current={currentSection === 'workspace' ? 'page' : undefined} onClick={() => onNavigate?.('workspace')}><Icon name="document" /><span>Quản lý</span></button>}
        </nav>
        <div className="sidebar-footer">
          <p className="history-storage-note">{historyLoaded ? 'Lịch sử được lưu an toàn trên máy chủ' : 'Đang tải lịch sử…'}</p>
          <div className="sidebar-account">
            <span className="account-avatar" aria-hidden="true">{userInitials}</span>
            <span className="sidebar-account-name">{user?.fullName || 'Sinh viên'}</span>
            <button className="sidebar-logout-button" type="button" aria-label="Đăng xuất" title="Đăng xuất" onClick={onLogout}><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      <section className="chat-column" aria-label="Trò chuyện với trợ lý học phí">
        <div className="current-chat-heading">
          <span className="desktop-chat-name">Trợ lý học phí</span>
          <span className="mobile-chat-name">{messages.length ? getConversationTitle(messages) : 'Cuộc trò chuyện mới'}</span>
          <span className="current-chat-meta">Tra cứu từ 4 tài liệu chính thức</span>
        </div>
        <div id="conversation" className="thread" role="log" aria-live="polite" aria-relevant="additions text" ref={threadRef}>
          {messages.length === 0 ? <div className="starter-panel">
            <h1 className="starter-title">Xin chào, bạn muốn tìm hiểu gì?</h1>
            <p className="starter-description">Mình có thể giúp bạn tra cứu học phí từ tài liệu của trường.</p>
            <p className="section-label">Thử hỏi</p>
            <div className="starter-list">{starterQuestions.map((question) => <button className="suggestion-button" type="button" key={question} onClick={() => submitQuestion(question)}>{question}</button>)}</div>
          </div> : messages.map((message, i) => {
            if (message.role !== 'user') return null;
            const answer = messages[i + 1];
            const answerIndex = i + 1;
            return <article className="thread-turn" key={`${i}-${message.content}`}>
              <p className="user-message">{message.content}</p>
              {answer?.role === 'assistant' && <AssistantAnswer message={answer} index={answerIndex} latest={answerIndex === messages.length - 1} onRetry={retry} onRegenerate={regenerate} onFeedback={submitFeedback} onHandoff={handoffToStaff} canHandoff={user?.role === 'student'} />}
            </article>;
          })}
        </div>
        <form className="composer" autoComplete="off" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="message-input">Câu hỏi của bạn</label>
          <textarea id="message-input" name="message" rows="1" placeholder="Hỏi về học phí hoặc thời hạn" aria-describedby="composer-hint" ref={inputRef} value={input} onChange={onInput} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (pending) abortRef.current?.abort(); else submitQuestion(input); }
          }} />
          <div className="composer-footer">
            <span className="composer-context"><Icon name="document" />Trả lời từ nguồn học phí chính thức</span>
            <button className={`send-button${pending ? ' is-pending' : ''}`} type="submit" aria-label={pending ? 'Dừng trả lời' : 'Gửi'} disabled={!input.trim() && !pending}>
              <Icon name="send" className="send-icon" /><Icon name="stop" className="stop-icon" />
            </button>
          </div>
        </form>
        <p id="composer-hint" className="sr-only">Nhấn Enter để gửi, Shift cộng Enter để xuống dòng.</p>
      </section>
    </div>
  </div>;
}

function SourceReader({ sourceId, documentId, theme, onToggleTheme }) {
  const source = sources[sourceId];
  const [state, setState] = useState({ status: 'loading', html: '' });
  const [documentMeta, setDocumentMeta] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch(documentId ? `/api/documents/${encodeURIComponent(documentId)}` : source.href, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Không tải được tài liệu nguồn.');
      if (documentId) {
        const data = await response.json();
        if (active) setDocumentMeta(data);
        return data.text;
      }
      return response.text();
    };
    load().then((markdown) => {
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
      }).catch(() => {
        if (active) setState({ status: 'error', html: '' });
      });
    return () => { active = false; };
  }, [source?.href, documentId]);

  if (!documentId && !source) return <p className="source-reader-status">Không tìm thấy tài liệu.</p>;

  return <div className="source-page">
    <header className="source-header">
      <a className="brand" href="/" aria-label="Quay lại Trợ lý học phí"><span className="brand-mark"><Icon name="brand" /></span><span>Trợ lý học phí</span></a>
      <div className="source-header-actions"><ThemeToggle theme={theme} onToggle={onToggleTheme} /><a className="source-back" href="/">Về cuộc trò chuyện</a></div>
    </header>
    <main className="source-reader">
      <div className="source-reader-meta"><Icon name="document" /><span>{documentMeta?.name || source?.label}</span></div>
      <h1>{documentMeta?.title || source?.title}</h1>
      {state.status === 'loading' && <p className="source-reader-status" role="status">Đang mở tài liệu…</p>}
      {state.status === 'error' && <p className="source-reader-status" role="alert">Không tải được tài liệu. Hãy thử mở lại từ trích dẫn.</p>}
      {state.status === 'ready' && <article className="markdown-document" dangerouslySetInnerHTML={{ __html: state.html }} />}
    </main>
  </div>;
}

export { App, SourceReader, ThemeToggle };
