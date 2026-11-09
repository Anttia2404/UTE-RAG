import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './chat-api.js';
import { App, SourceReader, ThemeToggle } from './main.jsx';
import './styles.css';

const THEME_STORAGE_KEY = 'tro-ly-hoc-phi:theme:v1';

function useColorTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111214' : '#f4f4f6');
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); }
    catch { /* Keep the selected theme for this page even if storage is unavailable. */ }
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  return { theme, toggleTheme };
}

function AuthGate({ theme, onToggleTheme }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/api/auth/me').then((data) => setUser(data.user || data)).catch(() => {}).finally(() => setReady(true)); }, []);

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const body = { email: form.get('email'), password: form.get('password') };
    if (register) { body.fullName = form.get('fullName'); body.studentCode = form.get('studentCode') || null; }
    try {
      const authenticated = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      const legacy = JSON.parse(localStorage.getItem('tro-ly-hoc-phi:chat-history:v1') || '[]');
      if (Array.isArray(legacy) && legacy.length) {
        try { await api('/api/chats/import', { method: 'POST', body: JSON.stringify({ conversations: legacy }) }); localStorage.removeItem('tro-ly-hoc-phi:chat-history:v1'); }
        catch { /* Keep the browser copy if migration fails. */ }
      }
      setUser(authenticated.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!ready) return <main className="auth-screen"><ThemeToggle theme={theme} onToggle={onToggleTheme} floating /><p>Đang kết nối máy chủ…</p></main>;
  if (!user) return <main className="auth-screen"><ThemeToggle theme={theme} onToggle={onToggleTheme} floating /><form className="auth-card" onSubmit={submit}>
    <div className="auth-brand"><span className="brand-mark">T</span><span>Trợ lý học phí</span></div>
    <p className="section-label">CỔNG THÔNG TIN SINH VIÊN</p><h1>{register ? 'Tạo tài khoản' : 'Đăng nhập'}</h1>
    <p className="auth-description">Tra cứu thông tin học phí chính thức và theo dõi các cuộc trò chuyện của bạn.</p>
    {register && <><label>Họ và tên<input name="fullName" required minLength="2" autoComplete="name" /></label><label>Mã sinh viên <span className="optional-label">(không bắt buộc)</span><input name="studentCode" autoComplete="off" /></label></>}
    <label>Email<input name="email" type="email" required autoComplete="email" /></label>
    <label>Mật khẩu<input name="password" type="password" required minLength={register ? 10 : 1} autoComplete={register ? 'new-password' : 'current-password'} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy}>{busy ? 'Đang xử lý…' : register ? 'Tạo tài khoản sinh viên' : 'Đăng nhập'}</button>
    <button className="link-button" type="button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Đã có tài khoản? Đăng nhập' : 'Sinh viên mới? Tạo tài khoản'}</button>
  </form></main>;
  return <Portal user={user} theme={theme} onToggleTheme={onToggleTheme} onLogout={async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); }} />;
}

function Filters({ onChange }) {
  return <div className="filter-grid">
    {[['cohort', 'Khóa'], ['major', 'Ngành'], ['semester', 'Học kỳ'], ['academicYear', 'Năm học'], ['feeType', 'Loại học phí']].map(([name, label]) => <label key={name}>{label}<input name={name} placeholder="Tất cả" onChange={(e) => onChange(name, e.target.value)} /></label>)}
  </div>;
}

function StudentSearch() {
  const [query, setQuery] = useState(''); const [filters, setFilters] = useState({}); const [results, setResults] = useState([]); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false);
  const search = async (event) => { event?.preventDefault(); if (query.trim().length < 2) return; setBusy(true); setSearched(true);
    try { const params = new URLSearchParams({ q: query, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }); const data = await api(`/api/search?${params}`); setResults(data.results || []); }
    catch (error) { setResults([]); window.alert(error.message); } finally { setBusy(false); }
  };
  return <section className="portal-page"><div className="page-heading"><div><p className="section-label">TRA CỨU CÓ LỌC</p><h1>Tìm trong tài liệu học phí</h1><p>Tìm câu trả lời trong các văn bản đã được nhà trường công bố.</p></div></div>
    <form className="portal-card search-form" onSubmit={search}><label>Từ khóa<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ví dụ: thời hạn đóng học phí học kỳ I" /></label><Filters onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))} /><button className="primary-button" disabled={busy || query.trim().length < 2}>{busy ? 'Đang tìm…' : 'Tìm tài liệu'}</button></form>
    <div className="search-results">{results.map((item, i) => <article className="portal-card result-card" key={`${item.documentId || item.sourceTitle}-${i}`}><div><p className="section-label">{item.section || 'Tài liệu nguồn'}</p><h2>{item.sourceTitle || item.title || 'Tài liệu học phí'}</h2></div><p>{item.text}</p>{item.documentId && <a className="text-link" href={`/?document=${encodeURIComponent(item.documentId)}`} target="_blank" rel="noreferrer">Mở tài liệu <span>↗</span></a>}</article>)}
      {searched && !busy && !results.length && <div className="portal-card empty-results">Không tìm thấy đoạn phù hợp. Hãy đổi từ khóa hoặc bỏ bớt bộ lọc.</div>}
    </div>
  </section>;
}

function StudentTickets() {
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState('');
  const refresh = () => api('/api/tickets').then(setTickets).catch((err) => setError(err.message));
  useEffect(() => { refresh(); }, []);
  const close = async (ticket) => {
    try { await api(`/api/tickets/${ticket.id}/close`, { method: 'POST' }); await refresh(); }
    catch (err) { setError(err.message); }
  };
  const statusLabel = { open: 'Đang chờ cán bộ', answered: 'Đã có phản hồi', closed: 'Đã đóng' };
  return <section className="portal-page"><div className="page-heading"><div><p className="section-label">HỖ TRỢ TỪ CÁN BỘ</p><h1>Yêu cầu hỗ trợ của bạn</h1><p>Câu hỏi và phản hồi được lưu cùng lịch sử trò chuyện.</p></div><button className="outline-button" onClick={refresh}>Làm mới</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="ticket-list">{tickets.map((ticket) => <article className="portal-card ticket-card" key={ticket.id}><div className="announcement-top"><span className={`pill ticket-status-${ticket.status}`}>{statusLabel[ticket.status] || ticket.status}</span><time>{new Date(ticket.createdAt).toLocaleString('vi-VN')}</time></div><h2>{ticket.question}</h2>{ticket.note && <p className="ticket-note">Ghi chú: {ticket.note}</p>}{ticket.answer && <div className="ticket-answer"><strong>Phản hồi của cán bộ</strong><p>{ticket.answer}</p></div>}{ticket.status !== 'closed' && <button className="outline-button" onClick={() => close(ticket)}>Đóng yêu cầu</button>}</article>)}{!tickets.length && !error && <div className="portal-card empty-results">Bạn chưa gửi câu hỏi nào cho cán bộ.</div>}</div>
  </section>;
}

function TicketInbox() {
  const [tickets, setTickets] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const refresh = () => api('/api/tickets').then(setTickets).catch((err) => setError(err.message));
  useEffect(() => { refresh(); }, []);
  const reply = async (event, ticket) => {
    event.preventDefault();
    const answer = drafts[ticket.id]?.trim();
    if (!answer) return;
    try { await api(`/api/tickets/${ticket.id}/reply`, { method: 'POST', body: JSON.stringify({ answer }) }); setDrafts((items) => ({ ...items, [ticket.id]: '' })); await refresh(); }
    catch (err) { setError(err.message); }
  };
  return <div className="portal-card notice-manager"><div className="announcement-top"><div><p className="section-label">HỖ TRỢ SINH VIÊN</p><h2>Yêu cầu cần trả lời</h2></div><button className="outline-button" onClick={refresh}>Làm mới</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="ticket-list">{tickets.map((ticket) => <article className="ticket-card staff-ticket-card" key={ticket.id}><div className="announcement-top"><span className={`pill ticket-status-${ticket.status}`}>{ticket.status === 'open' ? 'Đang chờ' : ticket.status === 'answered' ? 'Đã trả lời' : 'Đã đóng'}</span><small>{ticket.student} · {ticket.studentEmail}</small></div><h3>{ticket.question}</h3>{ticket.note && <p className="ticket-note">Ghi chú: {ticket.note}</p>}{ticket.answer && <p className="ticket-answer"><strong>Đã trả lời:</strong> {ticket.answer}</p>}{ticket.status !== 'closed' && <form className="ticket-reply-form" onSubmit={(event) => reply(event, ticket)}><label htmlFor={`ticket-reply-${ticket.id}`}>Phản hồi</label><textarea id={`ticket-reply-${ticket.id}`} rows="3" value={drafts[ticket.id] || ''} onChange={(event) => setDrafts((items) => ({ ...items, [ticket.id]: event.target.value }))} placeholder="Nhập câu trả lời cho sinh viên" /><button className="primary-button" disabled={!drafts[ticket.id]?.trim()}>Gửi phản hồi</button></form>}</article>)}{!tickets.length && !error && <p className="form-hint">Chưa có yêu cầu hỗ trợ.</p>}</div>
  </div>;
}

function Announcements() {
  const [items, setItems] = useState([]); const [filters, setFilters] = useState({}); const [query, setQuery] = useState('');
  const refresh = async () => { const params = new URLSearchParams({ q: query, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }); setItems(await api(`/api/announcements?${params}`)); };
  useEffect(() => { refresh().catch(() => {}); }, [query, filters]);
  return <section className="portal-page"><div className="page-heading"><div><p className="section-label">VĂN BẢN ĐÃ CÔNG BỐ</p><h1>Thông báo học phí</h1><p>Tra cứu thông báo và quy định được nhà trường đăng tải.</p></div></div>
    <div className="portal-card search-form"><label>Tìm thông báo<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nhập tên hoặc nội dung thông báo" /></label><Filters onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))} /></div>
    <div className="announcement-grid">{items.map((item) => <article className="portal-card announcement-card" key={item.id}><div className="announcement-top"><span className="pill">{item.category}</span><time>{new Date(item.updatedAt).toLocaleDateString('vi-VN')}</time></div><h2>{item.title}</h2><p>{item.content?.slice(0, 320)}{item.content?.length > 320 ? '…' : ''}</p><div className="announcement-tags">{[item.cohort, item.major, item.semester, item.academicYear, item.feeType].filter(Boolean).map((tag) => <span key={tag}>{tag}</span>)}</div>
      {item.documents?.map((doc) => <a className="text-link" key={doc.id} href={`/?document=${encodeURIComponent(doc.id)}`} target="_blank" rel="noreferrer">Đọc {doc.name} ↗</a>)}</article>)}{!items.length && <div className="portal-card empty-results">Chưa có thông báo phù hợp.</div>}</div>
  </section>;
}

function StaffWorkspace({ isAdmin }) {
  const [overview, setOverview] = useState(null); const [announcements, setAnnouncements] = useState([]); const [feedback, setFeedback] = useState([]); const [users, setUsers] = useState([]); const [message, setMessage] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState(null);
  const refresh = async () => { const [stats, notices, reviews] = await Promise.all([api('/api/admin/overview'), api('/api/announcements'), api('/api/admin/feedback')]); setOverview(stats); setAnnouncements(notices); setFeedback(reviews); if (isAdmin) setUsers(await api('/api/users')); };
  useEffect(() => { refresh().catch((err) => setMessage(err.message)); }, []);
  const upload = async (event) => { event.preventDefault(); setMessage(''); const formElement = event.currentTarget; const form = new FormData(formElement); const file = form.get('file'); if (!file?.size) return;
    const params = new URLSearchParams(); for (const key of ['title','category','cohort','major','semester','academicYear','feeType']) if (form.get(key)) params.set(key, form.get(key));
    const uploadBody = new FormData(); uploadBody.set('file', file);
    try { const result = await api(`/api/documents/upload?${params}`, { method: 'POST', body: uploadBody }); setMessage(`Đã nhận tài liệu, tạo ${result.document.nodeCount} đoạn. Trạng thái tìm kiếm: ${result.document.status}.`); formElement.reset(); await refresh(); }
    catch (err) { setMessage(err.message); }
  };
  const publish = async (item) => { await api(`/api/announcements/${item.id}`, { method: 'PATCH', body: JSON.stringify({ ...item, status: item.status === 'published' ? 'draft' : 'published' }) }); await refresh(); };
  const remove = async (item) => { if (!window.confirm(`Xóa thông báo “${item.title}”?`)) return; await api(`/api/announcements/${item.id}`, { method: 'DELETE' }); await refresh(); };
  const saveAnnouncement = async (event) => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const path = announcementDraft.id ? `/api/announcements/${announcementDraft.id}` : '/api/announcements';
    try { await api(path, { method: announcementDraft.id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); setAnnouncementDraft(null); setMessage('Đã lưu thông báo.'); await refresh(); }
    catch (error) { setMessage(error.message); }
  };
  const createUser = async (event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); try { await api('/api/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); formElement.reset(); await refresh(); } catch (err) { setMessage(err.message); } };
  return <section className="portal-page workspace-page"><div className="page-heading"><div><p className="section-label">KHU VỰC {isAdmin ? 'QUẢN TRỊ' : 'NHÂN VIÊN'}</p><h1>Quản lý dữ liệu và hỗ trợ</h1><p>Tài liệu, thông báo và phản hồi của người học.</p></div><button className="outline-button" onClick={() => api('/api/admin/reindex', { method: 'POST' }).then((r) => setMessage(`Đã lập chỉ mục ${r.indexedNodes} đoạn.`)).catch((e) => setMessage(e.message))}>Đồng bộ chỉ mục</button></div>
    {message && <p className="workspace-message" role="status">{message}</p>}
    <div className="stats-grid">{overview && Object.entries({ 'Sinh viên': overview.students, 'Nhân viên': overview.staff, 'Thông báo': overview.announcements, 'Tài liệu': overview.documents, 'Cuộc trò chuyện': overview.chatSessions, 'Phản hồi mới': overview.newFeedback }).map(([label, value]) => <div className="portal-card stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="workspace-grid"><form className="portal-card staff-form" onSubmit={upload}><p className="section-label">NẠP TÀI LIỆU</p><h2>Tải thông báo hoặc quy định</h2><label>Tên hiển thị<input name="title" required minLength="3" /></label><div className="form-columns"><label>Danh mục<input name="category" defaultValue="Học phí" /></label><label>Loại học phí<input name="feeType" /></label><label>Khóa<input name="cohort" /></label><label>Ngành<input name="major" /></label><label>Học kỳ<input name="semester" /></label><label>Năm học<input name="academicYear" /></label></div><label>Tệp Word, PDF, Markdown hoặc TXT<input name="file" type="file" accept=".docx,.pdf,.md,.txt" required /></label><p className="form-hint">Tài liệu mới tạo thông báo ở trạng thái bản nháp. Hãy công bố bên dưới sau khi rà soát.</p><button className="primary-button">Tải lên và lập chỉ mục</button></form>
      <div className="portal-card staff-form"><p className="section-label">PHẢN HỒI NGƯỜI DÙNG</p><h2>Đánh giá câu trả lời</h2><div className="feedback-list">{feedback.map((item) => <article className="feedback-item" key={item.id}><div className="announcement-top"><span className={`pill ${item.rating === 'helpful' ? 'is-positive' : 'is-negative'}`}>{item.rating === 'helpful' ? 'Hữu ích' : 'Chưa hữu ích'}</span><select value={item.status} aria-label="Trạng thái phản hồi" onChange={(e) => api(`/api/admin/feedback/${item.id}?status=${e.target.value}`, { method: 'PATCH' }).then(refresh)}><option value="new">Mới</option><option value="reviewing">Đang xử lý</option><option value="resolved">Đã xử lý</option></select></div><p>{item.comment || item.answer.slice(0, 220)}</p><small>{item.user} · {new Date(item.createdAt).toLocaleString('vi-VN')}</small></article>)}{!feedback.length && <p className="form-hint">Chưa có phản hồi.</p>}</div></div></div>
    <TicketInbox />
    <div className="portal-card notice-manager"><div className="announcement-top"><div><p className="section-label">THÔNG BÁO</p><h2>Rà soát và công bố</h2></div><button className="outline-button" onClick={() => setAnnouncementDraft({ title: '', content: '', category: 'Học phí', status: 'draft' })}>Soạn thông báo</button></div>
      {announcementDraft && <form className="announcement-editor" onSubmit={saveAnnouncement}><h3>{announcementDraft.id ? 'Chỉnh sửa thông báo' : 'Thông báo mới'}</h3><label>Tiêu đề<input name="title" required minLength="3" defaultValue={announcementDraft.title} /></label><label>Nội dung<textarea name="content" rows="5" defaultValue={announcementDraft.content} /></label><div className="form-columns"><label>Danh mục<input name="category" defaultValue={announcementDraft.category || 'Học phí'} /></label><label>Khóa<input name="cohort" defaultValue={announcementDraft.cohort || ''} /></label><label>Ngành<input name="major" defaultValue={announcementDraft.major || ''} /></label><label>Học kỳ<input name="semester" defaultValue={announcementDraft.semester || ''} /></label><label>Năm học<input name="academicYear" defaultValue={announcementDraft.academicYear || ''} /></label><label>Loại học phí<input name="feeType" defaultValue={announcementDraft.feeType || ''} /></label><label>Trạng thái<select name="status" defaultValue={announcementDraft.status || 'draft'}><option value="draft">Bản nháp</option><option value="published">Công bố</option></select></label></div><div className="editor-actions"><button className="primary-button">Lưu thông báo</button><button className="outline-button" type="button" onClick={() => setAnnouncementDraft(null)}>Hủy</button></div></form>}
      {announcements.map((item) => <div className="manage-row" key={item.id}><div><strong>{item.title}</strong><small>{item.category} · {item.documents?.length || 0} tài liệu · {item.status === 'published' ? 'Đã công bố' : 'Bản nháp'}</small></div><button className="outline-button" onClick={() => setAnnouncementDraft(item)}>Sửa</button><button className="outline-button" onClick={() => publish(item)}>{item.status === 'published' ? 'Gỡ công bố' : 'Công bố'}</button><button className="danger-button" onClick={() => remove(item)}>Xóa</button></div>)}{!announcements.length && <p className="form-hint">Chưa có thông báo.</p>}</div>
    {isAdmin && <div className="portal-card notice-manager"><p className="section-label">TÀI KHOẢN</p><h2>Người dùng và vai trò</h2><form className="user-create-form" onSubmit={createUser}><input name="fullName" placeholder="Họ tên" required /><input name="email" type="email" placeholder="Email" required /><input name="password" type="password" placeholder="Mật khẩu (ít nhất 10 ký tự)" minLength="10" required /><select name="role"><option value="staff">Nhân viên</option><option value="admin">Quản trị viên</option><option value="student">Sinh viên</option></select><button className="primary-button">Tạo tài khoản</button></form>{users.map((item) => <div className="manage-row" key={item.id}><div><strong>{item.fullName}</strong><small>{item.email} · {item.role}{item.active ? '' : ' · Đã khóa'}</small></div><button className="outline-button" onClick={() => api(`/api/users/${item.id}`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) }).then(refresh)}>{item.active ? 'Khóa' : 'Mở khóa'}</button></div>)}</div>}
  </section>;
}

function Portal({ user, onLogout, theme, onToggleTheme }) {
  const [section, setSection] = useState('chat');
  const isStaff = ['staff', 'admin'].includes(user.role); const sourceId = new URLSearchParams(location.search).get('source'); const documentId = new URLSearchParams(location.search).get('document');
  if (sourceId || documentId) return <SourceReader sourceId={sourceId} documentId={documentId} theme={theme} onToggleTheme={onToggleTheme} />;
  return <div className={`portal-shell${section === 'chat' ? ' is-chat' : ''}`}><header className="portal-header"><a className="brand" href="#chat" onClick={(e) => { e.preventDefault(); setSection('chat'); }}><span className="brand-mark">T</span><span>Trợ lý học phí</span></a><nav className="portal-nav"><button className={section === 'chat' ? 'active' : ''} onClick={() => setSection('chat')}>Trò chuyện</button><button className={section === 'notices' ? 'active' : ''} onClick={() => setSection('notices')}>Thông báo</button><button className={section === 'search' ? 'active' : ''} onClick={() => setSection('search')}>Tra cứu</button>{user.role === 'student' && <button className={section === 'tickets' ? 'active' : ''} onClick={() => setSection('tickets')}>Hỗ trợ</button>}{isStaff && <button className={section === 'workspace' ? 'active' : ''} onClick={() => setSection('workspace')}>Quản lý</button>}</nav><div className="account-area"><ThemeToggle theme={theme} onToggle={onToggleTheme} /><span>{user.fullName}</span><button className="link-button" onClick={onLogout}>Đăng xuất</button></div></header>
    {section === 'chat' && <App key={user.id} user={user} onLogout={onLogout} onNavigate={setSection} currentSection={section} isStaff={isStaff} theme={theme} onToggleTheme={onToggleTheme} />}{section === 'notices' && <Announcements />}{section === 'search' && <StudentSearch />}{section === 'tickets' && user.role === 'student' && <StudentTickets />}{section === 'workspace' && isStaff && <StaffWorkspace isAdmin={user.role === 'admin'} />}
  </div>;
}

function Root() {
  const { theme, toggleTheme } = useColorTheme();
  const params = new URLSearchParams(location.search);
  const sourceId = params.get('source');
  const documentId = params.get('document');
  if (sourceId || documentId) return <SourceReader sourceId={sourceId} documentId={documentId} theme={theme} onToggleTheme={toggleTheme} />;
  return <AuthGate theme={theme} onToggleTheme={toggleTheme} />;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
