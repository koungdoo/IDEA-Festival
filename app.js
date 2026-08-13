let db = null;
let publishedCache = [];
let likeSummaryCache = new Map();

const RAW_STORAGE_BUCKET = "idea-raw-files";
const PUBLISHED_STORAGE_BUCKET = "idea-published-files";
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE = 6 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx"];
const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

/* =========================================================
   운영 일정 설정
   - 날짜만 바꾸면 아이디어 접수 기간과 공감 기간을 따로 제어할 수 있습니다.
   - 테스트 중에는 시작일을 현재 날짜보다 이전으로 설정하세요.
========================================================= */
const SCHEDULE_CONTROL_ENABLED = true;

const SUBMISSION_START = new Date("2026-08-24T00:00:00+09:00");
const SUBMISSION_END = new Date("2026-09-11T23:59:59+09:00");

const LIKE_START = new Date("2026-08-24T00:00:00+09:00");
const LIKE_END = new Date("2026-09-11T23:59:59+09:00");

const VIEWED_IDEAS_KEY = "ideaFestivalViewedIdeas";
const USER_HASH_KEY = "ideaFestivalUserHash";
const HASH_NAMESPACE = "ALPS_KOREA_IDEA_FESTIVAL_2026_V1";

function initSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
    alert("config.sample.js에 Supabase URL과 Publishable Key를 입력해야 합니다.");
    return false;
  }

  db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.ideaFestivalDb = db;
  return true;
}

function isNowBetween(startDate, endDate) {
  if (!SCHEDULE_CONTROL_ENABLED) return true;
  const now = new Date();
  return now >= startDate && now <= endDate;
}

function isSubmissionOpen() {
  return isNowBetween(SUBMISSION_START, SUBMISSION_END);
}

function isLikeOpen() {
  return isNowBetween(LIKE_START, LIKE_END);
}

function formatScheduleDate(date) {
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getSubmissionPeriodText() {
  return `${formatScheduleDate(SUBMISSION_START)} ~ ${formatScheduleDate(SUBMISSION_END)}`;
}

function getLikePeriodText() {
  return `${formatScheduleDate(LIKE_START)} ~ ${formatScheduleDate(LIKE_END)}`;
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  if (id === "submit") updateSubmissionUi();
  if (id === "board") loadBoard();
  if (id === "ranking") loadRanking();

  window.scrollTo(0, 0);
}

function value(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function setMessage(id, text, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "message " + type;
}

function updateSubmissionUi() {
  const submitButton = document.querySelector("#submit button.primary");
  const msg = document.getElementById("submitMsg");

  if (!submitButton) return;

  if (isSubmissionOpen()) {
    submitButton.disabled = false;
    submitButton.textContent = "제출";
    if (msg && !msg.textContent) {
      setMessage("submitMsg", `아이디어 접수 가능 기간입니다. 접수 기간: ${getSubmissionPeriodText()}`, "success");
    }
  } else {
    submitButton.disabled = true;
    submitButton.textContent = "접수 기간 아님";
    setMessage("submitMsg", `아이디어 접수 기간이 아닙니다. 접수 기간: ${getSubmissionPeriodText()}`, "error");
  }
}

function getSelectedFiles() {
  const files = [];

  for (let i = 1; i <= 5; i++) {
    const input = document.getElementById(`attachment_${i}`);
    if (input && input.files && input.files.length > 0) {
      files.push(input.files[0]);
    }
  }

  return files;
}

function getFileExtension(fileName) {
  const parts = String(fileName || "").split(".");
  if (parts.length < 2) return "";
  return parts.pop().toLowerCase();
}

function validateFiles(files) {
  if (!files || files.length === 0) return null;

  if (files.length > MAX_FILE_COUNT) {
    return `첨부파일은 최대 ${MAX_FILE_COUNT}개까지 등록할 수 있습니다.`;
  }

  for (const file of files) {
    const ext = getFileExtension(file.name);

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `허용되지 않는 파일 형식입니다: ${file.name}`;
    }

    if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
      return `허용되지 않는 파일 형식입니다: ${file.name}`;
    }

    if (file.size > MAX_FILE_SIZE) {
      return `파일 용량은 1개당 6MB 이하만 가능합니다: ${file.name}`;
    }
  }

  return null;
}

function makeRawFilePath(file, index) {
  const ext = getFileExtension(file.name);
  const uuid = crypto.randomUUID();
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `raw/${yyyy}${mm}${dd}/${uuid}_${index + 1}.${ext}`;
}

async function uploadRawAttachments(files) {
  if (!files || files.length === 0) return [];

  const fileError = validateFiles(files);
  if (fileError) throw new Error(fileError);

  const uploadedFiles = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = makeRawFilePath(file, i);

    const { data, error } = await db.storage.from(RAW_STORAGE_BUCKET).upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
    });

    if (error) throw new Error(`첨부파일 업로드 오류: ${file.name} / ${error.message}`);

    uploadedFiles.push({
      name: file.name,
      bucket: RAW_STORAGE_BUCKET,
      path: data.path,
      type: file.type || "",
      size: file.size
    });
  }

  return uploadedFiles;
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderSelectedFileList() {
  const files = getSelectedFiles();
  const box = document.getElementById("selectedFileList");

  if (!box) return;

  if (files.length === 0) {
    box.innerHTML = "";
    return;
  }

  const fileError = validateFiles(files);

  box.innerHTML = `
    <div class="selected-files-box ${fileError ? "file-error" : ""}">
      <strong>선택된 첨부파일: ${files.length}개</strong>
      <ul>
        ${files.map((file) => `<li>${escapeHtml(file.name)} <span>${formatFileSize(file.size)}</span></li>`).join("")}
      </ul>
      ${fileError ? `<p class="message error">${escapeHtml(fileError)}</p>` : ""}
    </div>
  `;
}

async function submitIdea() {
  if (!db && !initSupabase()) return;

  if (!isSubmissionOpen()) {
    setMessage("submitMsg", `아이디어 접수 기간이 아닙니다. 접수 기간: ${getSubmissionPeriodText()}`, "error");
    updateSubmissionUi();
    return;
  }

  const title = value("title");
  const content = value("content");

  if (!title || !content) {
    setMessage("submitMsg", "아이디어명과 무엇이 문제인가? 항목은 필수입니다.", "error");
    return;
  }

  const files = getSelectedFiles();
  const fileError = validateFiles(files);

  if (fileError) {
    setMessage("submitMsg", fileError, "error");
    return;
  }

  const submitButton = document.querySelector("#submit button.primary");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "제출 중...";
  }

  try {
    const attachmentFiles = await uploadRawAttachments(files);

    const payload = {
      submitter_name: value("submitter_name"),
      employee_no: value("employee_no"),
      department: value("department"),
      category: value("category") || "LEVEL1",
      title,
      content,
      expected_effect: value("expected_effect"),
      expected_appearance: value("expected_appearance"),
      attachment_files: attachmentFiles
    };

    const { error } = await db.from("raw_ideas").insert(payload);

    if (error) throw new Error("아이디어 저장 오류: " + error.message);

    ["submitter_name", "employee_no", "department", "title", "content", "expected_effect", "expected_appearance"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    for (let i = 1; i <= 5; i++) {
      const input = document.getElementById(`attachment_${i}`);
      if (input) input.value = "";
    }

    const selectedFileList = document.getElementById("selectedFileList");
    if (selectedFileList) selectedFileList.innerHTML = "";

    setMessage("submitMsg", "아이디어와 첨부파일이 접수되었습니다. 첨부파일은 관리자 검토 후 공개됩니다.", "success");
  } catch (err) {
    setMessage("submitMsg", err.message, "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "제출";
    }
    updateSubmissionUi();
  }
}

async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeEmployeeNo(employeeNo) {
  return String(employeeNo || "").trim();
}

async function hashEmployeeNo(employeeNo) {
  const normalized = normalizeEmployeeNo(employeeNo);
  if (!normalized) return "";
  return await sha256Hex(`${HASH_NAMESPACE}:${normalized}`);
}

function getStoredUserHash() {
  return localStorage.getItem(USER_HASH_KEY) || "";
}

function setStoredUserHash(userHash) {
  if (userHash) localStorage.setItem(USER_HASH_KEY, userHash);
}

async function getUserHashForLike(ideaId) {
  const existingHash = getStoredUserHash();
  if (existingHash) return existingHash;

  const inputValue = value(`likeEmp-${ideaId}`) || value("likeEmp");
  if (!inputValue) return "";

  const userHash = await hashEmployeeNo(inputValue);
  setStoredUserHash(userHash);
  return userHash;
}

function getViewedIdeaIds() {
  try {
    const raw = localStorage.getItem(VIEWED_IDEAS_KEY) || "[]";
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id)) : [];
  } catch (err) {
    return [];
  }
}

function saveViewedIdeaIds(ids) {
  const uniqueIds = Array.from(new Set((ids || []).map((id) => Number(id))));
  localStorage.setItem(VIEWED_IDEAS_KEY, JSON.stringify(uniqueIds));
}

function isIdeaViewed(id) {
  return getViewedIdeaIds().includes(Number(id));
}

function markIdeaViewed(id) {
  const targetId = Number(id);
  const viewed = getViewedIdeaIds();
  if (!viewed.includes(targetId)) {
    viewed.push(targetId);
    saveViewedIdeaIds(viewed);
  }
}

function updateViewBadge(id) {
  const badge = document.getElementById(`view-badge-${id}`);
  if (!badge) return;
  badge.textContent = "✅ 읽음";
  badge.classList.remove("view-new");
  badge.classList.add("view-read");
}

async function loadLikeSummary() {
  if (!db && !initSupabase()) return;

  const { data, error } = await db.from("likes").select("published_id");

  if (error) {
    console.error("likes 조회 오류:", error);
    likeSummaryCache = new Map();
    return;
  }

  const counts = {};
  (data || []).forEach((row) => {
    counts[row.published_id] = (counts[row.published_id] || 0) + 1;
  });

  likeSummaryCache = new Map();
  Object.keys(counts).forEach((key) => {
    likeSummaryCache.set(Number(key), counts[key]);
  });

  window.likeSummaryCache = likeSummaryCache;
}

async function loadBoard() {
  if (!db && !initSupabase()) return;

  await loadLikeSummary();

  const { data: ideas, error } = await db
    .from("published_ideas")
    .select("id, anonymous_no, category, title, content, expected_effect, expected_appearance, attachment_files, published_at")
    .eq("is_visible", true)
    .order("published_at", { ascending: false });

  if (error) {
    document.getElementById("boardList").innerHTML = `<div class="card error">게시판 로딩 오류: ${escapeHtml(error.message)}</div>`;
    return;
  }

  publishedCache = (ideas || []).map((idea) => ({
    ...idea,
    like_count: likeSummaryCache.get(Number(idea.id)) || 0
  }));

  window.publishedCache = publishedCache;
  renderBoard();
}

function renderBoard() {
  const q = (document.getElementById("search")?.value || "").toLowerCase();
  const f = document.getElementById("filter")?.value || "";

  const filtered = publishedCache.filter((idea) => {
    const title = String(idea.title || "").toLowerCase();
    const content = String(idea.content || "").toLowerCase();
    const effect = String(idea.expected_effect || "").toLowerCase();
    const appearance = String(idea.expected_appearance || "").toLowerCase();
    const matchCategory = !f || idea.category === f;
    const matchSearch = !q || title.includes(q) || content.includes(q) || effect.includes(q) || appearance.includes(q);
    return matchCategory && matchSearch;
  });

  document.getElementById("boardList").innerHTML = `
    <section class="board-section">
      <div class="board-title-row">
        <h2>게시된 아이디어 (${filtered.length})</h2>
        <button class="small-button" onclick="toggleAllBoardDetails()">전체 접기/펼치기</button>
      </div>
      <div class="schedule-info-box">
        <strong>공감 가능 기간</strong> ${getLikePeriodText()}
      </div>
      <div class="board-simple-list">
        ${filtered.length ? filtered.map(renderBoardSimpleCard).join("") : '<div class="card">게시된 아이디어가 없습니다.</div>'}
      </div>
    </section>
  `;
}

function renderBoardSimpleCard(idea) {
  const fileCount = Array.isArray(idea.attachment_files) ? idea.attachment_files.length : 0;
  const publishedDate = idea.published_at ? new Date(idea.published_at).toLocaleDateString() : "게시일 미확인";
  const viewed = isIdeaViewed(idea.id);
  const viewLabel = viewed ? "✅ 읽음" : "🆕 NEW";
  const viewClass = viewed ? "view-read" : "view-new";
  const userHash = getStoredUserHash();
  const likeOpen = isLikeOpen();

  let likeAreaHtml = "";

  if (!likeOpen) {
    likeAreaHtml = `
      <div class="like-user-status like-closed">공감 가능 기간이 아닙니다.</div>
      <div class="like-action-row">
        <button class="primary" disabled>공감 종료</button>
      </div>
    `;
  } else if (userHash) {
    likeAreaHtml = `
      <div class="like-user-status">등록된 사용자 기준으로 공감합니다.</div>
      <div class="like-action-row">
        <button class="primary" onclick="likeIdea(${idea.id})">공감하기</button>
      </div>
    `;
  } else {
    likeAreaHtml = `
      <label>사번 입력
        <input id="likeEmp-${idea.id}" placeholder="최초 1회 사번 입력">
      </label>
      <div class="like-action-row">
        <button class="primary" onclick="likeIdea(${idea.id})">등록 및 공감하기</button>
      </div>
    `;
  }

  return `
    <article class="board-simple-card" id="board-card-${idea.id}">
      <div class="board-simple-head">
        <div class="board-simple-summary">
          <strong>${escapeHtml(idea.title || "제목 없음")}</strong>
          <div class="board-simple-meta">
            <span id="view-badge-${idea.id}" class="${viewClass}">${viewLabel}</span>
            <span>${escapeHtml(idea.anonymous_no || "")}</span>
            <span>${escapeHtml(idea.category || "")}</span>
            <span>📎 ${fileCount}</span>
            <span>♥ ${idea.like_count}</span>
            <span>${publishedDate}</span>
          </div>
        </div>
        <button class="small-button" onclick="toggleBoardDetail(${idea.id})">상세보기</button>
      </div>
      <div id="board-detail-${idea.id}" class="board-simple-detail hidden-detail">
        <h3>무엇이 문제인가?</h3>
        <p class="preline">${escapeHtml(idea.content || "")}</p>
        <h3>해결 방안</h3>
        <p class="preline">${escapeHtml(idea.expected_effect || "미입력")}</p>
        <h3>아이디어가 구현되었을 때 예상되는 모습</h3>
        <p class="preline">${escapeHtml(idea.expected_appearance || "미입력")}</p>
        ${renderPublishedAttachments(idea)}
        <div class="likebox simple-likebox">
          <div class="likecount">♥ ${idea.like_count}</div>
          <p class="muted small-note">사번은 브라우저에서 해시 처리된 값으로 저장됩니다. 원본 사번은 DB에 저장하지 않습니다.</p>
          ${likeAreaHtml}
          <p id="likeMsg-${idea.id}" class="message"></p>
        </div>
      </div>
    </article>
  `;
}

function toggleBoardDetail(id) {
  const box = document.getElementById(`board-detail-${id}`);
  if (!box) return;
  const willOpen = box.classList.contains("hidden-detail");
  box.classList.toggle("hidden-detail");
  if (willOpen) {
    markIdeaViewed(id);
    updateViewBadge(id);
  }
}

function toggleAllBoardDetails() {
  const details = document.querySelectorAll(".board-simple-detail");
  if (!details.length) return;
  const hasOpen = Array.from(details).some((detail) => !detail.classList.contains("hidden-detail"));
  details.forEach((detail) => {
    if (hasOpen) {
      detail.classList.add("hidden-detail");
    } else {
      detail.classList.remove("hidden-detail");
      const idText = detail.id.replace("board-detail-", "");
      markIdeaViewed(idText);
      updateViewBadge(idText);
    }
  });
}

function openDetail(id) {
  toggleBoardDetail(id);
}

async function likeIdea(id) {
  if (!db && !initSupabase()) return;

  const msgId = document.getElementById(`likeMsg-${id}`) ? `likeMsg-${id}` : "likeMsg";

  if (!isLikeOpen()) {
    setMessage(msgId, `공감 가능한 기간이 아닙니다. 공감 기간: ${getLikePeriodText()}`, "error");
    return;
  }

  const existingHash = getStoredUserHash();
  const inputValue = value(`likeEmp-${id}`) || value("likeEmp");

  if (!existingHash && !inputValue) {
    setMessage(msgId, "최초 공감 시 사번을 입력해 주세요. 사번은 해시 처리되어 저장됩니다.", "error");
    return;
  }

  const userHash = await getUserHashForLike(id);
  if (!userHash) {
    setMessage(msgId, "사번 해시 처리 중 오류가 발생했습니다.", "error");
    return;
  }

  const { error } = await db.from("likes").insert({
    published_id: id,
    employee_no: userHash
  });

  if (error) {
    if (error.message.includes("duplicate") || error.code === "23505") {
      setMessage(msgId, "이미 이 아이디어에 공감하셨습니다.", "error");
    } else {
      setMessage(msgId, "공감 저장 오류: " + error.message, "error");
    }
    return;
  }

  setMessage(msgId, "공감이 등록되었습니다. 다음 공감부터 사번 입력 없이 사용할 수 있습니다.", "success");
  await loadBoard();
  const detail = document.getElementById(`board-detail-${id}`);
  if (detail) detail.classList.remove("hidden-detail");
}

async function loadRanking() {
  if (!db && !initSupabase()) return;
  await loadLikeSummary();
  const { data: ideas, error } = await db
    .from("published_ideas")
    .select("id, anonymous_no, category, title, published_at")
    .eq("is_visible", true);
  if (error) {
    document.getElementById("rankList").innerHTML = "순위 로딩 오류: " + escapeHtml(error.message);
    return;
  }
  const rows = (ideas || [])
    .map((idea) => ({ ...idea, like_count: likeSummaryCache.get(Number(idea.id)) || 0 }))
    .sort((a, b) => b.like_count - a.like_count || new Date(b.published_at) - new Date(a.published_at));

  document.getElementById("rankList").innerHTML = rows.map((idea, index) => `
    <div class="rank-row">
      <div class="rank">${index + 1}</div>
      <div>
        <strong>${escapeHtml(idea.title)}</strong>
        <br>
        <span class="muted">${escapeHtml(idea.anonymous_no)} · ${escapeHtml(idea.category)}</span>
      </div>
      <strong>♥ ${idea.like_count}</strong>
    </div>
  `).join("") || "순위 데이터가 없습니다.";
}

function getPublishedFileUrl(file) {
  if (!file || !file.path) return "";
  const { data } = db.storage.from(PUBLISHED_STORAGE_BUCKET).getPublicUrl(file.path);
  return data.publicUrl;
}

function renderPublishedAttachments(idea) {
  const files = Array.isArray(idea.attachment_files) ? idea.attachment_files : [];
  if (files.length === 0) return "";
  return `
    <div class="attachment-box">
      <h3>첨부파일</h3>
      <div class="attachment-list">
        ${files.map((file, index) => {
          const fileUrl = getPublishedFileUrl(file);
          const safeUrl = escapeAttr(fileUrl);
          const fileName = escapeHtml(file.name || `첨부파일 ${index + 1}`);
          const fileType = file.type || "";
          const fileSize = formatFileSize(file.size);
          const fileLabel = `${fileName}${fileSize ? ` (${fileSize})` : ""}`;
          if (fileType.startsWith("image/")) {
            return `
              <div class="attachment-item">
                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">
                  <img src="${safeUrl}" alt="${fileName}" class="attachment-preview">
                </a>
                <a class="file-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${fileLabel}</a>
              </div>
            `;
          }
          return `
            <div class="attachment-item">
              <a class="file-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">📎 ${fileLabel}</a>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>'"]/g, (s) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[s];
  });
}

function escapeAttr(str) {
  return escapeHtml(str);
}

document.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  for (let i = 1; i <= 5; i++) {
    const input = document.getElementById(`attachment_${i}`);
    if (input) input.addEventListener("change", renderSelectedFileList);
  }
  updateSubmissionUi();
});
