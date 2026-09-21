/* ============================================================
   AI Scam Transaction Awareness System — Main JS
   ============================================================ */

"use strict";

// ─── Navigation ────────────────────────────────────────────────────────────

const pages   = document.querySelectorAll(".page");
const navItems = document.querySelectorAll(".nav-item");
const topbarTitle = document.getElementById("topbar-title");

const PAGE_TITLES = {
  dashboard: "Dashboard",
  analyze:   "Analyze Transaction",
  history:   "Transaction History",
  tips:      "Safety Tips & Awareness",
};

function navigate(id) {
  pages.forEach(p => p.classList.toggle("active", p.id === "page-" + id));
  navItems.forEach(n => n.classList.toggle("active", n.dataset.page === id));
  topbarTitle.textContent = PAGE_TITLES[id] || id;
  window.scrollTo(0, 0);
  // Lazy-load section data
  if (id === "dashboard") loadDashboard();
  if (id === "history")   loadHistory(1);
  closeSidebar();
}

navItems.forEach(n => n.addEventListener("click", () => navigate(n.dataset.page)));

// Sidebar mobile toggle
const sidebar   = document.getElementById("sidebar");
const hamburger = document.getElementById("hamburger");
function closeSidebar() { sidebar.classList.remove("open"); }
hamburger?.addEventListener("click", () => sidebar.classList.toggle("open"));
document.addEventListener("click", e => {
  if (!sidebar.contains(e.target) && !hamburger.contains(e.target))
    closeSidebar();
});

// ─── Toast ─────────────────────────────────────────────────────────────────

const toast = document.getElementById("toast");
let toastTimer;
function showToast(msg, dur = 3000) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), dur);
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

let trendChart;

async function loadDashboard() {
  try {
    const res  = await fetch("/api/dashboard");
    const data = await res.json();

    document.getElementById("stat-total").textContent = data.total;
    document.getElementById("stat-safe").textContent  = data.safe;
    document.getElementById("stat-susp").textContent  = data.suspicious;
    document.getElementById("stat-high").textContent  = data.high_risk;

    renderRecentTable(data.recent);
    renderTrendChart(data.chart);
  } catch {
    showToast("Failed to load dashboard data.");
  }
}

function renderRecentTable(rows) {
  const tbody = document.getElementById("recent-tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 17v-2m3 2v-4m3 4v-6M5 20h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/>
        </svg>
        <p>No transactions yet. Start by analyzing one!</p>
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>#${r.id}</td>
      <td>₹${Number(r.amount).toLocaleString()}</td>
      <td>${r.payment_method || "—"}</td>
      <td>${r.recipient || "—"}</td>
      <td><span class="risk-score-chip">${r.risk_score}</span></td>
      <td>${badgeHTML(r.label)}</td>
    </tr>`).join("");
}

function renderTrendChart(chart) {
  const ctx = document.getElementById("trend-chart").getContext("2d");
  const labels = chart.map(c => {
    const d = new Date(c.date);
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  });
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Safe",       data: chart.map(c => c.safe),       backgroundColor: "#4ade80" },
        { label: "Suspicious", data: chart.map(c => c.suspicious),  backgroundColor: "#fbbf24" },
        { label: "High Risk",  data: chart.map(c => c.high_risk),   backgroundColor: "#f87171" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } } },
      },
    },
  });
}

// ─── Analyze Form ──────────────────────────────────────────────────────────

const analyzeForm = document.getElementById("analyze-form");
const resultPanel = document.getElementById("result-panel");

analyzeForm.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("analyze-btn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Analyzing…`;

  const fd = new FormData(analyzeForm);
  const payload = Object.fromEntries(fd.entries());

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed");
    renderResult(data);
    resultPanel.style.display = "block";
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Analysis complete ✓");
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Analyze Transaction`;
  }
});

function renderResult(data) {
  const { risk_score, label, color, reasons, tips, feature_scores } = data;

  // Big label
  const labelEl = document.getElementById("result-label");
  labelEl.textContent = (label === "Safe" ? "🟢 " : label === "Suspicious" ? "🟡 " : "🔴 ") + label;
  labelEl.className = "risk-label-big " + color;

  // Score text
  document.getElementById("result-score-text").textContent =
    `Risk Score: ${risk_score} / 100`;

  // Meter bar
  const bar = document.getElementById("result-bar");
  bar.style.width = risk_score + "%";
  bar.className = "meter-bar-inner " + color;

  // Feature breakdown
  const featDiv = document.getElementById("feature-breakdown");
  featDiv.innerHTML = Object.entries(feature_scores).map(([k, v]) => `
    <div class="feat-row">
      <span class="feat-label">${k}</span>
      <div class="feat-bar-outer">
        <div class="feat-bar-inner" style="width:${v}%;background:${featureColor(v)}"></div>
      </div>
      <span class="feat-val">${v}</span>
    </div>`).join("");

  // Reasons
  const reasonList = document.getElementById("reason-list");
  reasonList.className = "reason-list " + color;
  reasonList.innerHTML = reasons.map(r => `<li>${r}</li>`).join("");

  // Tips
  document.getElementById("tip-list").innerHTML =
    tips.map(t => `<li>${t}</li>`).join("");
}

function featureColor(v) {
  if (v >= 65) return "#dc2626";
  if (v >= 35) return "#d97706";
  return "#16a34a";
}

// Reset form
document.getElementById("reset-btn").addEventListener("click", () => {
  analyzeForm.reset();
  resultPanel.style.display = "none";
});

// ─── History ───────────────────────────────────────────────────────────────

let currentPage = 1;
let historySearchQ = "";
let historyLabelFilter = "";

document.getElementById("history-search").addEventListener("input", e => {
  historySearchQ = e.target.value;
  loadHistory(1);
});
document.getElementById("history-label-filter").addEventListener("change", e => {
  historyLabelFilter = e.target.value;
  loadHistory(1);
});

async function loadHistory(page) {
  currentPage = page;
  const params = new URLSearchParams({ page });
  if (historySearchQ)   params.set("q", historySearchQ);
  if (historyLabelFilter) params.set("label", historyLabelFilter);

  try {
    const res  = await fetch("/api/history?" + params);
    const data = await res.json();
    renderHistoryTable(data.records);
    renderPagination(data.page, data.pages);
    document.getElementById("history-count").textContent =
      `${data.total} record${data.total !== 1 ? "s" : ""} found`;
  } catch {
    showToast("Failed to load history.");
  }
}

function renderHistoryTable(records) {
  const tbody = document.getElementById("history-tbody");
  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 17v-2m3 2v-4m3 4v-6M5 20h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/>
        </svg>
        <p>No matching transactions found.</p>
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = records.map(r => `
    <tr>
      <td>#${r.id}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td>₹${Number(r.amount).toLocaleString()}</td>
      <td>${r.payment_method || "—"}</td>
      <td>${r.recipient || "—"}</td>
      <td>${r.txn_location || "—"}</td>
      <td>${badgeHTML(r.label)} <small class="text-muted">${r.risk_score}</small></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="showDetail(${r.id})">View</button>
        <button class="btn btn-sm btn-danger" onclick="deleteRecord(${r.id})">Delete</button>
      </td>
    </tr>`).join("");
}

function renderPagination(page, pages) {
  const el = document.getElementById("pagination");
  if (pages <= 1) { el.innerHTML = ""; return; }
  let html = "";
  for (let i = 1; i <= pages; i++) {
    html += `<button class="${i === page ? "active" : ""}" onclick="loadHistory(${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

// ─── Detail modal ──────────────────────────────────────────────────────────

let historyCache = {};

async function showDetail(id) {
  if (!historyCache[id]) {
    // Fetch full record from history
    const res  = await fetch(`/api/history?q=`);
    const data = await res.json();
    data.records.forEach(r => { historyCache[r.id] = r; });
  }
  // Second attempt: targeted fetch via broader page
  if (!historyCache[id]) {
    for (let p = 1; p <= 50; p++) {
      const res  = await fetch(`/api/history?page=${p}`);
      const data = await res.json();
      data.records.forEach(r => { historyCache[r.id] = r; });
      if (historyCache[id] || data.page >= data.pages) break;
    }
  }
  const r = historyCache[id];
  if (!r) { showToast("Record not found."); return; }

  document.getElementById("modal-title").textContent = `Transaction #${r.id}`;
  document.getElementById("modal-body").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;font-size:.875rem;margin-bottom:16px">
      <div><span style="color:var(--muted);font-size:.75rem">Date</span><br>${fmtDate(r.created_at)}</div>
      <div><span style="color:var(--muted);font-size:.75rem">Amount</span><br>₹${Number(r.amount).toLocaleString()}</div>
      <div><span style="color:var(--muted);font-size:.75rem">Method</span><br>${r.payment_method || "—"}</div>
      <div><span style="color:var(--muted);font-size:.75rem">Recipient</span><br>${r.recipient || "—"}</div>
      <div><span style="color:var(--muted);font-size:.75rem">User Location</span><br>${r.user_location || "—"}</div>
      <div><span style="color:var(--muted);font-size:.75rem">Txn Location</span><br>${r.txn_location || "—"}</div>
      <div><span style="color:var(--muted);font-size:.75rem">Risk Score</span><br><strong>${r.risk_score}/100</strong></div>
      <div><span style="color:var(--muted);font-size:.75rem">Label</span><br>${badgeHTML(r.label)}</div>
    </div>
    <p style="font-weight:700;margin-bottom:8px;font-size:.85rem">⚠️ Why was this flagged?</p>
    <ul class="reason-list ${labelColor(r.label)}" style="margin-bottom:14px">
      ${r.reasons.map(x => `<li>${x}</li>`).join("")}
    </ul>
    <p style="font-weight:700;margin-bottom:8px;font-size:.85rem">💡 Safety Tips</p>
    <ul class="tip-list">${r.tips.map(t => `<li>${t}</li>`).join("")}</ul>
  `;
  document.getElementById("detail-modal").style.display = "flex";
}

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("detail-modal").addEventListener("click", e => {
  if (e.target === document.getElementById("detail-modal")) closeModal();
});
function closeModal() { document.getElementById("detail-modal").style.display = "none"; }

async function deleteRecord(id) {
  if (!confirm("Delete this transaction record?")) return;
  await fetch(`/api/history/${id}`, { method: "DELETE" });
  delete historyCache[id];
  loadHistory(currentPage);
  showToast("Record deleted.");
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function badgeHTML(label) {
  if (label === "Safe")      return `<span class="badge badge-safe">Safe</span>`;
  if (label === "Suspicious") return `<span class="badge badge-suspicious">Suspicious</span>`;
  return `<span class="badge badge-high">High Risk</span>`;
}

function labelColor(label) {
  if (label === "Safe") return "success";
  if (label === "Suspicious") return "warning";
  return "danger";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("Z") ? "" : "Z"));
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

navigate("dashboard");
