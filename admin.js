let adminDb = null;
const RAW_STORAGE_BUCKET = "idea-raw-files";
const PUBLISHED_STORAGE_BUCKET = "idea-published-files";

function initAdminSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    alert("config.sample.js 설정이 필요합니다.");
    return false;
  }
  adminDb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return true;
}

function setAdminMessage(id, text, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "message " + type;
}

async function adminLogin() {
  if (!adminDb && !initAdminSupabase()) return;
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  if (!email || !password) { setAdminMessage("loginMsg", "이메일과 비밀번호를 입력하세요.", "error"); return; }
  const { error } = await adminDb.auth.signInWithPassword({ email, password });
  if (error) { setAdminMessage("loginMsg", "로그인 오류: " + error.message, "error"); return; }
  setAdminMessage("loginMsg", "로그인되었습니다.", "success");
  await showAdminPanel();
}

async function adminLogout() {
  await adminDb.auth.signOut();
  document.getElementById("loginPanel").classList.remove("hidden");
  document.getElementById("adminPanel").classList.add("hidden");
}

async function showAdminPanel() {
  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("adminPanel").classList.remove("hidden");
  await loadRawIdeas();
}

async function loadRawIdeas() {
  if (!adminDb && !initAdminSupabase()) return;
  setAdminMessage("adminMsg", "");
  const { data, error } = await adminDb
    .from("raw_ideas")
    .select("id, submitter_name, employee_no, department, category, title, content, expected_effect, expected_appearance, attachment_files, status, created_at")
    .order("created_at", { ascending: false });
  if (error) { setAdminMessage("adminMsg", "접수 목록 로딩 오류: " + error.message, "error"); return; }
  renderRawIdeas(data || []);
}

function renderRawIdeas(rows) {
  const box = document.getElementById("rawList");
  if (rows.length === 0) { box.innerHTML = `<div class="admin-card">접수된 아이디어가 없습니다.</div>`; return; }
  box.innerHTML = rows.map(row => {
    const files = Array.isArray(row.attachment_files) ? row.attachment_files : [];
    return `
      <article class="raw-card" id="raw-${row.id}">
        <div class="raw-head">
          <div><strong>#${row.id}</strong> <span class="status">${escapeHtml(row.status || "접수")}</span></div>
          <div class="muted">${new Date(row.created_at).toLocaleString()}</div>
        </div>
        <div class="submitter">
          <span>성명: ${escapeHtml(row.submitter_name || "")}</span>
          <span>사번: ${escapeHtml(row.employee_no || "")}</span>
          <span>부서: ${escapeHtml(row.department || "")}</span>
        </div>
        <label>익명번호<input id="anon-${row.id}" value="ID-${String(row.id).padStart(4, "0")}"></label>
        <label>종류<select id="cat-${row.id}"><option ${row.category === "LEVEL1" ? "selected" : ""}>LEVEL1</option><option ${row.category === "LEVEL2" ? "selected" : ""}>LEVEL2</option><option ${row.category === "LEVEL3" ? "selected" : ""}>LEVEL3</option></select></label>
        <label>게시 제목<input id="title-${row.id}" value="${escapeAttr(row.title || "")}"></label>
        <label>무엇이 문제인가?<textarea id="content-${row.id}" rows="5">${escapeHtml(row.content || "")}</textarea></label>
        <label>해결 방안<textarea id="effect-${row.id}" rows="4">${escapeHtml(row.expected_effect || "")}</textarea></label>
        <label>구현 예상 모습<textarea id="appearance-${row.id}" rows="4">${escapeHtml(row.expected_appearance || "")}</textarea></label>
        <div class="file-section">
          <h3>원본 첨부파일 ${files.length}개</h3>
          <div id="files-${row.id}" class="file-list">${files.length ? "원본 파일 링크 생성 중..." : "첨부파일 없음"}</div>
        </div>
        <div class="button-row">
          <button class="primary" onclick="publishIdea(${row.id})">게시하기</button>
          <button onclick="markStatus(${row.id}, '보류')">보류</button>
        </div>
        <p id="msg-${row.id}" class="message"></p>
      </article>`;
  }).join("");
  rows.forEach(row => renderRawFileLinks(row));
}

async function renderRawFileLinks(row) {
  const files = Array.isArray(row.attachment_files) ? row.attachment_files : [];
  const box = document.getElementById(`files-${row.id}`);
  if (!box || files.length === 0) return;
  const paths = files.map(file => file.path).filter(Boolean);
  const { data, error } = await adminDb.storage.from(RAW_STORAGE_BUCKET).createSignedUrls(paths, 600);
  if (error) { box.innerHTML = `<span class="error">파일 링크 생성 오류: ${escapeHtml(error.message)}</span>`; return; }
  box.innerHTML = files.map((file, index) => {
    const signedUrl = data?.[index]?.signedUrl || "";
    return `<a class="file-link" href="${escapeAttr(signedUrl)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(file.name || file.path)} ${file.size ? `(${formatFileSize(file.size)})` : ""}</a>`;
  }).join("");
}

async function publishIdea(rawId) {
  setAdminMessage(`msg-${rawId}`, "게시 처리 중입니다.");
  const { data: raw, error: rawError } = await adminDb.from("raw_ideas").select("*").eq("id", rawId).single();
  if (rawError) { setAdminMessage(`msg-${rawId}`, "원본 조회 오류: " + rawError.message, "error"); return; }

  const anonymousNo = document.getElementById(`anon-${rawId}`).value.trim() || `ID-${String(rawId).padStart(4, "0")}`;
  const category = document.getElementById(`cat-${rawId}`).value;
  const title = document.getElementById(`title-${rawId}`).value.trim();
  const content = document.getElementById(`content-${rawId}`).value.trim();
  const expected_effect = document.getElementById(`effect-${rawId}`).value.trim();
  const expected_appearance = document.getElementById(`appearance-${rawId}`).value.trim();

  if (!title || !content) { setAdminMessage(`msg-${rawId}`, "게시 제목과 내용은 필수입니다.", "error"); return; }

  try {
    const publishedFiles = await copyFilesToPublished(raw.attachment_files || [], anonymousNo);
    const payload = { raw_id: rawId, anonymous_no: anonymousNo, category, title, content, expected_effect, expected_appearance, attachment_files: publishedFiles, is_visible: true };
    const { error } = await adminDb.from("published_ideas").upsert(payload, { onConflict: "anonymous_no" });
    if (error) throw error;
    await adminDb.from("raw_ideas").update({ status: "게시완료", published_at: new Date().toISOString() }).eq("id", rawId);
    setAdminMessage(`msg-${rawId}`, "게시가 완료되었습니다.", "success");
    await loadRawIdeas();
  } catch (err) {
    setAdminMessage(`msg-${rawId}`, "게시 오류: " + err.message, "error");
  }
}

async function copyFilesToPublished(files, anonymousNo) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const publishedFiles = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.path) continue;
    const ext = getFileExtension(file.name || file.path);
    const safeName = `file_${i + 1}.${ext}`;
    const targetPath = `published/${anonymousNo}/${String(i + 1).padStart(2, "0")}_${safeName}`;
    const { error } = await adminDb.storage.from(RAW_STORAGE_BUCKET).copy(file.path, targetPath, { destinationBucket: PUBLISHED_STORAGE_BUCKET });
    if (error) throw new Error(`${file.name || file.path} 복사 실패: ${error.message}`);
    publishedFiles.push({ name: file.name || safeName, bucket: PUBLISHED_STORAGE_BUCKET, path: targetPath, type: file.type || "", size: file.size || null });
  }
  return publishedFiles;
}

async function markStatus(rawId, status) {
  const { error } = await adminDb.from("raw_ideas").update({ status }).eq("id", rawId);
  if (error) setAdminMessage(`msg-${rawId}`, "상태 변경 오류: " + error.message, "error");
  else { setAdminMessage(`msg-${rawId}`, "상태가 변경되었습니다.", "success"); await loadRawIdeas(); }
}

function getFileExtension(fileName) { const parts = String(fileName || "").split("."); return parts.length < 2 ? "" : parts.pop().toLowerCase(); }
function makeSafeFileName(name) { return String(name || "file").replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_").replace(/\s+/g, "_"); }
function formatFileSize(bytes) { if (!bytes && bytes !== 0) return ""; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function escapeHtml(str) { return String(str ?? "").replace(/[&<>'"]/g, s => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[s])); }
function escapeAttr(str) { return escapeHtml(str); }

document.addEventListener("DOMContentLoaded", async () => {
  if (!initAdminSupabase()) return;
  const { data } = await adminDb.auth.getSession();
  if (data.session) await showAdminPanel();
});
