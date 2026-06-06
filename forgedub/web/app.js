// ForgeDub frontend — talks to the FastAPI backend, drives the dubbing UI.
"use strict";

const $ = (sel) => document.querySelector(sel);
const api = (path, opts) => fetch(path, opts).then((r) => r.json());

const state = {
  tab: "upload",
  file: null,
  jobId: null,
  poll: null,
  segKey: null,
};

// ───────────────────────── init ─────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initUpload();
  initUrl();
  $("#start-btn").addEventListener("click", startDub);
  $("#rerender-btn").addEventListener("click", rerender);
  loadHealth();
  loadHistory();
});

async function loadHealth() {
  try {
    const h = await api("/api/health");
    const badge = $("#mode-badge");
    const real = h.mode === "real";
    badge.textContent = real ? "REAL engine" : "DEMO engine";
    badge.classList.add(real ? "real" : "mock");
    $("#lang-badge").textContent =
      `${(h.settings.source_lang || "en").toUpperCase()} → ${(h.settings.target_lang || "sv").toUpperCase()}`;
    if (!real) {
      const note = $("#mode-note");
      note.innerHTML =
        "⚠️ Running in <strong>demo mode</strong> — install the AI model pack " +
        "(see <code>requirements-ml.txt</code> + ffmpeg) to dub your real audio into Swedish.";
      note.classList.remove("hidden");
    }
  } catch (e) {
    /* health is best-effort */
  }
}

// ───────────────────────── tabs ─────────────────────────
function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".tab-panel").forEach((p) =>
        p.classList.toggle("hidden", p.dataset.panel !== state.tab));
      updateStartEnabled();
    });
  });
}

// ──────────────────────── upload ────────────────────────
function initUpload() {
  const input = $("#file-input");
  const dz = $("#dropzone");

  input.addEventListener("change", () => setFile(input.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
  });
}

function setFile(file) {
  state.file = file || null;
  $("#file-name").textContent = file ? file.name : "";
  updateStartEnabled();
}

// ────────────────────────── url ─────────────────────────
function initUrl() {
  $("#url-input").addEventListener("input", updateStartEnabled);
}

function updateStartEnabled() {
  const ready = state.tab === "upload" ? !!state.file : !!$("#url-input").value.trim();
  $("#start-btn").disabled = !ready;
}

// ─────────────────────── start dub ──────────────────────
async function startDub() {
  const fd = new FormData();
  if (state.tab === "upload") {
    if (!state.file) return;
    fd.append("file", state.file);
  } else {
    const url = $("#url-input").value.trim();
    if (!url) return;
    fd.append("url", url);
  }
  fd.append("voice_clone", $("#opt-clone").checked);
  fd.append("separate_background", $("#opt-bg").checked);
  fd.append("target_lang", "sv");

  setError("");
  $("#start-btn").disabled = true;
  try {
    const res = await fetch("/api/jobs", { method: "POST", body: fd });
    const job = await res.json();
    if (!res.ok) throw new Error(job.detail || "Failed to start");
    openJob(job.id);
    loadHistory();
  } catch (e) {
    setError(e.message);
  } finally {
    updateStartEnabled();
  }
}

function setError(msg) {
  const el = $("#form-error");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

// ─────────────────────── job polling ────────────────────
function openJob(jobId) {
  state.jobId = jobId;
  state.segKey = null;
  $("#empty-state").classList.add("hidden");
  $("#job-view").classList.remove("hidden");
  $("#result-box").classList.add("hidden");
  $("#segments-box").classList.add("hidden");
  if (state.poll) clearInterval(state.poll);
  pollOnce();
  state.poll = setInterval(pollOnce, 800);
}

async function pollOnce() {
  if (!state.jobId) return;
  let job;
  try {
    job = await api(`/api/jobs/${state.jobId}`);
  } catch (e) { return; }
  renderJob(job);
  if (job.status === "done" || job.status === "error") {
    clearInterval(state.poll);
    state.poll = null;
    loadHistory();
  }
}

function renderJob(job) {
  $("#job-title").textContent = job.title || job.source || "Dub";

  const status = $("#job-status");
  status.textContent = job.status;
  status.className = "badge " + job.status;

  const pct = Math.round((job.progress || 0) * 100);
  $("#progress-fill").style.width = pct + "%";
  $("#progress-pct").textContent = pct + "%";
  $("#stage-label").textContent = job.stage_label || job.stage || "";
  $("#progress-msg").textContent = job.error || job.message || "";
  $("#progress-box").classList.toggle("error", job.status === "error");

  if (job.segments && job.segments.length) renderSegments(job);

  if (job.status === "done" && job.has_output) showResult(job);
}

function renderSegments(job) {
  const key = job.id + ":" + job.segments.length;
  if (key === state.segKey) return; // avoid clobbering edits on every poll
  state.segKey = key;

  const box = $("#segments");
  box.innerHTML = "";
  job.segments.forEach((seg) => {
    const row = document.createElement("div");
    row.className = "seg-row";
    row.innerHTML = `
      <div class="seg-time">${fmt(seg.start)}<br>→ ${fmt(seg.end)}</div>
      <div class="seg-src">${escapeHtml(seg.text_src)}
        ${seg.speaker ? `<span class="seg-speaker">${escapeHtml(seg.speaker)}</span>` : ""}
      </div>
      <textarea class="seg-tgt" data-id="${seg.id}">${escapeHtml(seg.text_tgt || "")}</textarea>`;
    box.appendChild(row);
  });
  $("#segments-box").classList.remove("hidden");
}

function showResult(job) {
  const v = $("#player-video");
  const a = $("#player-audio");
  const src = `/api/jobs/${job.id}/preview?t=${job.updated_at}`;
  if (job.output_kind === "video") {
    v.src = src; v.classList.remove("hidden"); a.classList.add("hidden");
  } else {
    a.src = src; a.classList.remove("hidden"); v.classList.add("hidden");
  }
  $("#download-btn").href = `/api/jobs/${job.id}/download`;
  $("#result-box").classList.remove("hidden");
}

// ─────────────────────── re-render ──────────────────────
async function rerender() {
  if (!state.jobId) return;
  const edits = [...document.querySelectorAll(".seg-tgt")].map((t) => ({
    id: Number(t.dataset.id),
    text_tgt: t.value,
  }));
  $("#rerender-btn").disabled = true;
  try {
    const res = await fetch(`/api/jobs/${state.jobId}/rerender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: edits }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Re-render failed");
    }
    state.segKey = null;
    openJob(state.jobId);
  } catch (e) {
    setError(e.message);
  } finally {
    $("#rerender-btn").disabled = false;
  }
}

// ─────────────────────── history ────────────────────────
async function loadHistory() {
  let data;
  try { data = await api("/api/jobs"); } catch (e) { return; }
  const list = $("#history");
  if (!data.jobs || !data.jobs.length) {
    list.innerHTML = `<li class="muted">No dubs yet.</li>`;
    return;
  }
  list.innerHTML = "";
  data.jobs.forEach((job) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `
      <span class="h-title">${escapeHtml(job.title || job.source || "Dub")}</span>
      <span class="dot ${job.status}"></span>`;
    li.addEventListener("click", () => openJob(job.id));
    list.appendChild(li);
  });
}

// ─────────────────────── helpers ────────────────────────
function fmt(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
