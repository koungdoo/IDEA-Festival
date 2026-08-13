let adminDb = null;
const RAW_STORAGE_BUCKET = "idea-raw-files";
const PUBLISHED_STORAGE_BUCKET = "idea-published-files";

function initAdminSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    alert("config.sample.js 설정이 필요합니다.");
    return false;
  }

  adminDb = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

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

  if (!email || !password) {
    setAdminMessage("loginMsg", "이메일과 비밀번호를 입력하세요.", "error");
    return;
  }

  const { error } = await adminDb.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    setAdminMessage("loginMsg", "로그인 오류: " + error.message, "error");
    return;
  }

  setAdminMessage("loginMsg", "로그인되었습니다.", "success");
  await showAdminPanel();
}

async function adminLogout() {
  if (!adminDb && !initAdminSupabase()) return;

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
    .select(
      "id, submitter_name, employee_no, department, category, title, content, expected_effect, expected_appearance, attachment_files, status, created_at, published_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    setAdminMessage("adminMsg", "접수 목록 로딩 오류: " + error.message, "error");
    return;
  }

  renderRawIdeas(data || []);
}

function renderRawIdeas(rows) {
  const box = document.getElementById("rawList");

  if (!box) return;

  if (rows.length === 0) {
    box.innerHTML = `<div class="admin-card">접수된 아이디어가 없습니다.</div>`;
    return;
  }

  const activeRows = rows.filter((row) => row.status !== "게시완료");
  const completedRows = rows.filter((row) => row.status === "게시완료");

  box.innerHTML = `
    <section class="admin-section">
      <div class="section-title-row">
        <h2>진행중 아이디어 (${activeRows.length})</h2>
        <span class="section-chip">접수 / 보류 / 검토중</span>
      </div>
      <div id="activeIdeas">
        ${activeRows.length ? activeRows.map(renderActiveCard).join("") : `<div class="admin-card muted">진행중 아이디어가 없습니다.</div>`}
      </div>
    </section>

    <section class="admin-section completed-section">
      <div class="section-title-row">
        <h2>게시완료 아이디어 (${completedRows.length})</h2>
        <button class="small-button" onclick="toggleCompletedSection()">게시완료 전체 접기/펼치기</button>
      </div>
      <div id="completedIdeas">
        ${completedRows.length ? completedRows.map(renderCompletedCard).join("") : `<div class="admin-card muted">게시완료 아이디어가 없습니다.</div>`}
      </div>
    </section>
  `;

  activeRows.forEach((row) => renderRawFileLinks(row));
}

function renderActiveCard(row) {
  const files = Array.isArray(row.attachment_files) ? row.attachment_files : [];

  return `
    <article class="raw-card" id="raw-${row.id}">
      <div class="raw-head">
        <div>
          <strong>#${row.id}</strong>
          <span class="status">${escapeHtml(row.status || "접수")}</span>
        </div>
        <div class="muted">${new Date(row.created_at).toLocaleString()}</div>
      </div>

      <div class="submitter">
        <span>성명: ${escapeHtml(row.submitter_name || "")}</span>
        <span>사번: ${escapeHtml(row.employee_no || "")}</span>
        <span>부서: ${escapeHtml(row.department || "")}</span>
      </div>

      <label>익명번호
        <input id="anon-${row.id}" value="ID-${String(row.id).padStart(4, "0")}">
      </label>

      <label>종류
        <select id="cat-${row.id}">
          <option ${row.category === "LEVEL1" ? "selected" : ""}>LEVEL1</option>
          <option ${row.category === "LEVEL2" ? "selected" : ""}>LEVEL2</option>
          <option ${row.category === "LEVEL3" ? "selected" : ""}>LEVEL3</option>
        </select>
      </label>

      <label>게시 제목
        <input id="title-${row.id}" value="${escapeAttr(row.title || "")}">
      </label>

      <label>무엇이 문제인가?
        <textarea id="content-${row.id}" rows="5">${escapeHtml(row.content || "")}</textarea>
      </label>

      <label>해결 방안
        <textarea id="effect-${row.id}" rows="4">${escapeHtml(row.expected_effect || "")}</textarea>
      </label>

      <label>구현 예상 모습
        <textarea id="appearance-${row.id}" rows="4">${escapeHtml(row.expected_appearance || "")}</textarea>
      </label>

      <div class="file-section">
        <h3>원본 첨부파일 ${files.length}개</h3>
        <div id="files-${row.id}" class="file-list">
          ${files.length ? "원본 파일 링크 생성 중..." : "첨부파일 없음"}
        </div>
      </div>

      <div class="button-row">
        <button class="primary" onclick="publishIdea(${row.id})">게시하기</button>
        <button onclick="markStatus(${row.id}, '보류')">보류</button>
      </div>

      <p id="msg-${row.id}" class="message"></p>
    </article>
  `;
}

function renderCompletedCard(row) {
  const anonymousNo = `ID-${String(row.id).padStart(4, "0")}`;
  const publishedDate = row.published_at
    ? new Date(row.published_at).toLocaleString()
    : "게시일 미확인";
  const fileCount = Array.isArray(row.attachment_files)
    ? row.attachment_files.length
    : 0;

  return `
    <article class="completed-card" id="completed-card-${row.id}">
      <div class="completed-head">
        <div class="completed-summary">
          <strong>✅ ${escapeHtml(row.title || "제목 없음")}</strong>
          <div class="completed-meta">
            <span>${anonymousNo}</span>
            <span>${escapeHtml(row.category || "")}</span>
            <span>첨부 ${fileCount}개</span>
            <span>${publishedDate}</span>
          </div>
        </div>
        <button class="small-button" onclick="toggleCompleted(${row.id})">상세보기</button>
      </div>

      <div id="completed-${row.id}" class="completed-detail hidden-detail">
        <p><strong>상태:</strong> ${escapeHtml(row.status || "게시완료")}</p>
        <p><strong>제출자:</strong> ${escapeHtml(row.submitter_name || "")} / ${escapeHtml(row.employee_no || "")} / ${escapeHtml(row.department || "")}</p>
        <p><strong>무엇이 문제인가?</strong></p>
        <p class="preline">${escapeHtml(row.content || "")}</p>
        <p><strong>해결 방안</strong></p>
        <p class="preline">${escapeHtml(row.expected_effect || "미입력")}</p>
        <p><strong>아이디어가 구현되었을 때 예상되는 모습</strong></p>
        <p class="preline">${escapeHtml(row.expected_appearance || "미입력")}</p>
      </div>
    </article>
  `;
}

function toggleCompleted(id) {
  const box = document.getElementById(`completed-${id}`);
  if (!box) return;
  box.classList.toggle("hidden-detail");
}

function toggleCompletedSection() {
  const cards = document.querySelectorAll(".completed-detail");
  if (!cards.length) return;

  const hasOpen = Array.from(cards).some((card) => !card.classList.contains("hidden-detail"));

  cards.forEach((card) => {
    if (hasOpen) {
      card.classList.add("hidden-detail");
    } else {
      card.classList.remove("hidden-detail");
    }
  });
}

async function renderRawFileLinks(row) {
  const files = Array.isArray(row.attachment_files) ? row.attachment_files : [];
  const box = document.getElementById(`files-${row.id}`);

  if (!box || files.length === 0) return;

  const paths = files.map((file) => file.path).filter(Boolean);

  const { data, error } = await adminDb.storage
    .from(RAW_STORAGE_BUCKET)
    .createSignedUrls(paths, 600);

  if (error) {
    box.innerHTML = `<span class="error">파일 링크 생성 오류: ${escapeHtml(error.message)}</span>`;
    return;
  }

  box.innerHTML = files
    .map((file, index) => {
      const signedUrl = data?.[index]?.signedUrl || "";
      return `
        <a class="file-link" href="${escapeAttr(signedUrl)}" target="_blank" rel="noopener noreferrer">
          📎 ${escapeHtml(file.name || file.path)} ${file.size ? `(${formatFileSize(file.size)})` : ""}
        </a>
      `;
    })
    .join("");
}

async function publishIdea(rawId) {
  setAdminMessage(`msg-${rawId}`, "게시 처리 중입니다.");

  const { data: raw, error: rawError } = await adminDb
    .from("raw_ideas")
    .select("*")
    .eq("id", rawId)
    .single();

  if (rawError) {
    setAdminMessage(`msg-${rawId}`, "원본 조회 오류: " + rawError.message, "error");
    return;
  }

  const anonymousNo =
    document.getElementById(`anon-${rawId}`).value.trim() ||
    `ID-${String(rawId).padStart(4, "0")}`;
  const category = document.getElementById(`cat-${rawId}`).value;
  const title = document.getElementById(`title-${rawId}`).value.trim();
  const content = document.getElementById(`content-${rawId}`).value.trim();
  const expected_effect = document.getElementById(`effect-${rawId}`).value.trim();
  const expected_appearance = document.getElementById(`appearance-${rawId}`).value.trim();

  if (!title || !content) {
    setAdminMessage(`msg-${rawId}`, "게시 제목과 내용은 필수입니다.", "error");
    return;
  }

  try {
    const publishedFiles = await copyFilesToPublished(raw.attachment_files || [], anonymousNo);

    const payload = {
      raw_id: rawId,
      anonymous_no: anonymousNo,
      category,
      title,
      content,
      expected_effect,
      expected_appearance,
      attachment_files: publishedFiles,
      is_visible: true
    };

    const { error } = await adminDb
      .from("published_ideas")
      .upsert(payload, { onConflict: "anonymous_no" });

    if (error) throw error;

    await adminDb
      .from("raw_ideas")
      .update({
        status: "게시완료",
        published_at: new Date().toISOString()
      })
      .eq("id", rawId);

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

    const ext = getFileExtension(file.name || file.path) || "file";
    const safeName = `${crypto.randomUUID()}.${ext}`;
    const targetPath = `published/${anonymousNo}/${String(i + 1).padStart(2, "0")}_${safeName}`;

    const { error } = await adminDb.storage
      .from(RAW_STORAGE_BUCKET)
      .copy(file.path, targetPath, {
        destinationBucket: PUBLISHED_STORAGE_BUCKET
      });

    if (error) {
      throw new Error(`${file.name || file.path} 복사 실패: ${error.message}`);
    }

    publishedFiles.push({
      name: file.name || safeName,
      bucket: PUBLISHED_STORAGE_BUCKET,
      path: targetPath,
      type: file.type || "",
      size: file.size || null
    });
  }

  return publishedFiles;
}

async function markStatus(rawId, status) {
  const { error } = await adminDb
    .from("raw_ideas")
    .update({ status })
    .eq("id", rawId);

  if (error) {
    setAdminMessage(`msg-${rawId}`, "상태 변경 오류: " + error.message, "error");
  } else {
    setAdminMessage(`msg-${rawId}`, "상태가 변경되었습니다.", "success");
    await loadRawIdeas();
  }
}

function getFileExtension(fileName) {
  const parts = String(fileName || "").split(".");
  return parts.length < 2 ? "" : parts.pop().toLowerCase();
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

document.addEventListener("DOMContentLoaded", async () => {
  if (!initAdminSupabase()) return;

  const { data } = await adminDb.auth.getSession();

  if (data.session) {
    await showAdminPanel();
  }
});
