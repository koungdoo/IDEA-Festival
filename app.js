let db = null;
let publishedCache = [];

const RAW_STORAGE_BUCKET = "idea-raw-files";
const PUBLISHED_STORAGE_BUCKET = "idea-published-files";

const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE = 6 * 1024 * 1024; // 6MB

const ALLOWED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "pdf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "doc",
  "docx"
];

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
  if (
    !window.SUPABASE_URL ||
    !window.SUPABASE_ANON_KEY ||
    window.SUPABASE_URL.includes("YOUR_PROJECT_ID")
  ) {
    alert("config.sample.js에 Supabase URL과 Publishable Key를 입력해야 합니다.");
    return false;
  }

  db = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  return true;
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });

  document.getElementById(id).classList.add("active");

  if (id === "board") {
    loadBoard();
  }

  if (id === "ranking") {
    loadRanking();
  }

  window.scrollTo(0, 0);
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function setMessage(id, text, type = "") {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "message " + type;
}

async function submitIdea() {
  if (!db && !initSupabase()) return;

  const title = value("title");
  const content = value("content");

  if (!title || !content) {
    setMessage(
      "submitMsg",
      "아이디어명과 무엇이 문제인가? 항목은 필수입니다.",
      "error"
    );
    return;
  }

  const payload = {
    submitter_name: value("submitter_name"),
    employee_no: value("employee_no"),
    department: value("department"),
    category: value("category") || "LEVEL1",
    title: title,
    content: content,
    expected_effect: value("expected_effect"),
    expected_appearance: value("expected_appearance")
  };

  const { error } = await db.from("raw_ideas").insert(payload);

  if (error) {
    setMessage(
      "submitMsg",
      "저장 중 오류가 발생했습니다: " + error.message,
      "error"
    );
    return;
  }

  [
    "submitter_name",
    "employee_no",
    "department",
    "title",
    "content",
    "expected_effect",
    "expected_appearance"
  ].forEach((id) => {
    document.getElementById(id).value = "";
  });

  setMessage(
    "submitMsg",
    "아이디어가 접수되었습니다. 관리자 익명화 후 게시됩니다.",
    "success"
  );
}

async function loadBoard() {
  if (!db && !initSupabase()) return;

  const { data: ideas, error } = await db
    .from("published_ideas")
    .select(
      "id, anonymous_no, category, title, content, expected_effect, expected_appearance, published_at, likes(id)"
    )
    .eq("is_visible", true)
    .order("published_at", { ascending: false });

  if (error) {
    document.getElementById("boardList").innerHTML = `
      <div class="card error">
        게시판 로딩 오류: ${error.message}
      </div>
    `;
    return;
  }

  publishedCache = (ideas || []).map((idea) => {
    return {
      ...idea,
      like_count: idea.likes ? idea.likes.length : 0
    };
  });

  renderBoard();
}

function renderBoard() {
  const q = (document.getElementById("search")?.value || "").toLowerCase();
  const f = document.getElementById("filter")?.value || "";

  const filtered = publishedCache.filter((idea) => {
    const matchCategory = !f || idea.category === f;
    const matchSearch =
      !q ||
      idea.title.toLowerCase().includes(q) ||
      idea.content.toLowerCase().includes(q);

    return matchCategory && matchSearch;
  });

  document.getElementById("boardList").innerHTML =
    filtered
      .map((idea) => {
        return `
          <div class="idea-card" onclick="openDetail(${idea.id})">
            <div class="meta">
              <span>${escapeHtml(idea.anonymous_no)}</span>
              <span>${escapeHtml(idea.category)}</span>
            </div>

            <h2>${escapeHtml(idea.title)}</h2>

            <p>
              ${escapeHtml(idea.content).slice(0, 110)}
              ${idea.content.length > 110 ? "..." : ""}
            </p>

            <div class="bottom">
              <span>${new Date(idea.published_at).toLocaleDateString()}</span>
              <strong>♥ ${idea.like_count}</strong>
            </div>
          </div>
        `;
      })
      .join("") || '<div class="card">게시된 아이디어가 없습니다.</div>';
}

function openDetail(id) {
  const idea = publishedCache.find((idea) => idea.id === id);

  if (!idea) return;

  document.getElementById("detailBox").innerHTML = `
    <div class="meta">
      <span>${escapeHtml(idea.anonymous_no)}</span>
      <span>${escapeHtml(idea.category)}</span>
    </div>

    <h1>${escapeHtml(idea.title)}</h1>

    <h3>무엇이 문제인가?</h3>
    <p>${escapeHtml(idea.content)}</p>

    <h3>해결 방안</h3>
    <p>${escapeHtml(idea.expected_effect || "미입력")}</p>

    <h3>아이디어가 구현되었을 때 예상되는 모습</h3>
    <p>${escapeHtml(idea.expected_appearance || "미입력")}</p>

    <div class="likebox">
      <div class="likecount">♥ ${idea.like_count}</div>

      <label>
        사번 입력
        <input id="likeEmp" placeholder="중복 공감 방지용">
      </label>

      <button class="primary" onclick="likeIdea(${idea.id})">
        공감하기
      </button>

      <p id="likeMsg" class="message"></p>
    </div>
  `;

  showPage("detail");
}

async function likeIdea(id) {
  if (!db && !initSupabase()) return;

  const employee_no = value("likeEmp");

  if (!employee_no) {
    setMessage("likeMsg", "사번을 입력해 주세요.", "error");
    return;
  }

  const { error } = await db.from("likes").insert({
    published_id: id,
    employee_no: employee_no
  });

  if (error) {
    if (error.message.includes("duplicate") || error.code === "23505") {
      setMessage("likeMsg", "이미 이 아이디어에 공감하셨습니다.", "error");
    } else {
      setMessage("likeMsg", "공감 저장 오류: " + error.message, "error");
    }

    return;
  }

  setMessage("likeMsg", "공감이 등록되었습니다.", "success");

  await loadBoard();
  openDetail(id);
}

async function loadRanking() {
  if (!db && !initSupabase()) return;

  const { data: ideas, error } = await db
    .from("published_ideas")
    .select("id, anonymous_no, category, title, published_at, likes(id)")
    .eq("is_visible", true);

  if (error) {
    document.getElementById("rankList").innerHTML =
      "순위 로딩 오류: " + error.message;
    return;
  }

  const rows = (ideas || [])
    .map((idea) => {
      return {
        ...idea,
        like_count: idea.likes ? idea.likes.length : 0
      };
    })
    .sort((a, b) => {
      return (
        b.like_count - a.like_count ||
        new Date(b.published_at) - new Date(a.published_at)
      );
    });

  document.getElementById("rankList").innerHTML =
    rows
      .map((idea, index) => {
        return `
          <div class="rank-row">
            <div class="rank">${index + 1}</div>

            <div>
              <strong>${escapeHtml(idea.title)}</strong>
              <br>
              <span class="muted">
                ${escapeHtml(idea.anonymous_no)} · ${escapeHtml(idea.category)}
              </span>
            </div>

            <strong>♥ ${idea.like_count}</strong>
          </div>
        `;
      })
      .join("") || "순위 데이터가 없습니다.";
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

document.addEventListener("DOMContentLoaded", () => {
  initSupabase();
});
