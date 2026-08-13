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

function initSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
    alert("config.sample.js에 Supabase URL과 Publishable Key를 입력해야 합니다.");
    return false;
  }

  db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.ideaFestivalDb = db;
  return true;
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(id).classList.add("active");

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
  }
}

async function loadLikeSummary() {
  if (!db && !initSupabase()) return;

  const { data, error } = await db
    .from("likes")
    .select("published_id");

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
      <div class="board-simple-list">
        ${filtered.length ? filtered.map(renderBoardSimpleCard).join("") : '<div class="card">게시된 아이디어가 없습니다.</div>'}
      </div>
    </section>
  `;
}

function renderBoardSimpleCard(idea) {
  const fileCount = Array.isArray(idea.attachment_files) ? idea.attachment_files.length : 0;
  const publishedDate = idea.published_at ? new Date(idea.published_at).toLocaleDateString() : "게시일 미확인";

  return `
    <article class="board-simple-card" id="board-card-${idea.id}">
      <div class="board-simple-head">
        <div class="board-simple-summary">
          <strong>✅ ${escapeHtml(idea.title || "제목 없음")}</strong>
          <div class="board-simple-meta">
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
          <label>사번 입력
            <input id="likeEmp-${idea.id}" placeholder="중복 공감 방지용">
          </label>
          <button class="primary" onclick="likeIdea(${idea.id})">공감하기</button>
          <p id="likeMsg-${idea.id}" class="message"></p>
        </div>
      </div>
    </article>
  `;
}

function toggleBoardDetail(id) {
  const box = document.getElementById(`board-detail-${id}`);
  if (!box) return;
  box.classList.toggle("hidden-detail");
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
    }
  });
}

function openDetail(id) {
  toggleBoardDetail(id);
}

async function likeIdea(id) {
  if (!db && !initSupabase()) return;

  const employee_no = value(`likeEmp-${id}`) || value("likeEmp");
  const msgId = document.getElementById(`likeMsg-${id}`) ? `likeMsg-${id}` : "likeMsg";

  if (!employee_no) {
    setMessage(msgId, "사번을 입력해 주세요.", "error");
    return;
  }

  const { error } = await db.from("likes").insert({
    published_id: id,
    employee_no
  });

  if (error) {
    if (error.message.includes("duplicate") || error.code === "23505") {
      setMessage(msgId, "이미 이 아이디어에 공감하셨습니다.", "error");
    } else {
      setMessage(msgId, "공감 저장 오류: " + error.message, "error");
    }
    return;
  }

  setMessage(msgId, "공감이 등록되었습니다.", "success");
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
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[s];
  });
}

function escapeAttr(str) {
  return escapeHtml(str);
}

document.addEventListener("DOMContentLoaded", () => {
  initSupabase();

  for (let i = 1; i <= 5; i++) {
    const input = document.getElementById(`attachment_${i}`);

    if (input) {
      input.addEventListener("change", renderSelectedFileList);
    }
  }
});
