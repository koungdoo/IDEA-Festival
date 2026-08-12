let db = null;
let publishedCache = [];

function initSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    alert('config.sample.js에 Supabase URL과 anon key를 입력해야 합니다.');
    return false;
  }
  db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return true;
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'board') loadBoard();
  if (id === 'ranking') loadRanking();
  window.scrollTo(0, 0);
}

function value(id) { return document.getElementById(id).value.trim(); }
function setMessage(id, text, type='') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'message ' + type;
}

async function submitIdea() {
  if (!db && !initSupabase()) return;
  const title = value('title');
  const content = value('content');
  if (!title || !content) {
    setMessage('submitMsg', '제목과 내용은 필수입니다.', 'error');
    return;
  }
  const payload = {
    submitter_name: value('submitter_name'),
    employee_no: value('employee_no'),
    department: value('department'),
    category: value('category') || '기타',
    title,
    content,
    expected_effect: value('expected_effect')
  };
  const { error } = await db.from('raw_ideas').insert(payload);
  if (error) {
    setMessage('submitMsg', '저장 중 오류가 발생했습니다: ' + error.message, 'error');
    return;
  }
  ['submitter_name','employee_no','department','title','content','expected_effect'].forEach(id => document.getElementById(id).value = '');
  setMessage('submitMsg', '아이디어가 접수되었습니다. 관리자 익명화 후 게시됩니다.', 'success');
}

async function loadBoard() {
  if (!db && !initSupabase()) return;
  const { data: ideas, error } = await db
    .from('published_ideas')
    .select('id, anonymous_no, category, title, content, expected_effect, published_at, likes(id)')
    .eq('is_visible', true)
    .order('published_at', { ascending: false });
  if (error) {
    document.getElementById('boardList').innerHTML = `<div class="card error">게시판 로딩 오류: ${error.message}</div>`;
    return;
  }
  publishedCache = (ideas || []).map(i => ({...i, like_count: i.likes ? i.likes.length : 0}));
  renderBoard();
}

function renderBoard() {
  const q = (document.getElementById('search')?.value || '').toLowerCase();
  const f = document.getElementById('filter')?.value || '';
  const filtered = publishedCache.filter(i => (!f || i.category === f) && (!q || i.title.toLowerCase().includes(q) || i.content.toLowerCase().includes(q)));
  document.getElementById('boardList').innerHTML = filtered.map(i => `
    <div class="idea-card" onclick="openDetail(${i.id})">
      <div class="meta"><span>${escapeHtml(i.anonymous_no)}</span><span>${escapeHtml(i.category)}</span></div>
      <h2>${escapeHtml(i.title)}</h2>
      <p>${escapeHtml(i.content).slice(0, 110)}${i.content.length > 110 ? '...' : ''}</p>
      <div class="bottom"><span>${new Date(i.published_at).toLocaleDateString()}</span><strong>♥ ${i.like_count}</strong></div>
    </div>
  `).join('') || '<div class="card">게시된 아이디어가 없습니다.</div>';
}

function openDetail(id) {
  const idea = publishedCache.find(i => i.id === id);
  if (!idea) return;
  document.getElementById('detailBox').innerHTML = `
    <div class="meta"><span>${escapeHtml(idea.anonymous_no)}</span><span>${escapeHtml(idea.category)}</span></div>
    <h1>${escapeHtml(idea.title)}</h1>
    <h3>아이디어 내용</h3><p>${escapeHtml(idea.content)}</p>
    <h3>기대효과</h3><p>${escapeHtml(idea.expected_effect || '미입력')}</p>
    <div class="likebox">
      <div class="likecount">♥ ${idea.like_count}</div>
      <label>사번 입력<input id="likeEmp" placeholder="중복 공감 방지용"></label>
      <button class="primary" onclick="likeIdea(${idea.id})">공감하기</button>
      <p id="likeMsg" class="message"></p>
    </div>`;
  showPage('detail');
}

async function likeIdea(id) {
  if (!db && !initSupabase()) return;
  const employee_no = value('likeEmp');
  if (!employee_no) {
    setMessage('likeMsg', '사번을 입력해 주세요.', 'error');
    return;
  }
  const { error } = await db.from('likes').insert({ published_id: id, employee_no });
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      setMessage('likeMsg', '이미 이 아이디어에 공감하셨습니다.', 'error');
    } else {
      setMessage('likeMsg', '공감 저장 오류: ' + error.message, 'error');
    }
    return;
  }
  setMessage('likeMsg', '공감이 등록되었습니다.', 'success');
  await loadBoard();
  openDetail(id);
}

async function loadRanking() {
  if (!db && !initSupabase()) return;
  const { data: ideas, error } = await db
    .from('published_ideas')
    .select('id, anonymous_no, category, title, published_at, likes(id)')
    .eq('is_visible', true);
  if (error) {
    document.getElementById('rankList').innerHTML = '순위 로딩 오류: ' + error.message;
    return;
  }
  const rows = (ideas || []).map(i => ({...i, like_count: i.likes ? i.likes.length : 0})).sort((a,b) => b.like_count - a.like_count || new Date(b.published_at) - new Date(a.published_at));
  document.getElementById('rankList').innerHTML = rows.map((i,n) => `
    <div class="rank-row"><div class="rank">${n+1}</div><div><strong>${escapeHtml(i.title)}</strong><br><span class="muted">${escapeHtml(i.anonymous_no)} · ${escapeHtml(i.category)}</span></div><strong>♥ ${i.like_count}</strong></div>
  `).join('') || '순위 데이터가 없습니다.';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s]));
}

document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
});
