const state = {
  level: "level2",
  dateScope: "month",
  month: new Date().toISOString().slice(0, 7),
  year: String(new Date().getFullYear()),
  customStart: new Date().toISOString().slice(0, 10),
  customEnd: new Date().toISOString().slice(0, 10),
  dueRange: "tomorrow",
  importLevel: "level2",
  moduleMetric: "visits",
  ownerGroup: "",
  cGroup: "",
  cOwner: "",
  summary: null,
  options: null,
  customers: [],
  modalCustomers: [],
  activeCustomer: null,
  level1ConfirmedTransfers: [],
  editMode: false,
  targets: null,
};

const $ = (selector) => document.querySelector(selector);

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast ${isError ? "error" : ""}`;
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function fmt(value, fallback = "未标注") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function esc(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(value, fallback = "未记录") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function dateScopeLabel() {
  if (state.dateScope === "month") return state.month;
  if (state.dateScope === "year") return state.year;
  if (state.dateScope === "custom") return `${state.customStart} 至 ${state.customEnd}`;
  return "全部周期";
}

function scopeParams() {
  const params = new URLSearchParams();
  params.set("dateScope", state.dateScope);
  params.set("month", state.month);
  params.set("year", state.year);
  params.set("startDate", state.customStart);
  params.set("endDate", state.customEnd);
  params.set("dueRange", state.dueRange);
  return params;
}

function applyFilter(filter = {}) {
  if (filter.level) state.level = filter.level;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.level === state.level));
  $("#ownerFilter").value = filter.owner || "";
  $("#ratingFilter").value = filter.rating || "";
  $("#moduleFilter").value = filter.module || "";
  $("#purchaseFilter").value = filter.purchase || "";
  $("#salesFilter").value = filter.sales || "";
  $("#keywordInput").value = filter.keyword || "";
  $("#riskOnly").checked = Boolean(filter.risk);
  loadCustomers();
}

function paramsFromFilter(level, filter = {}) {
  const params = scopeParams();
  params.set("level", level);
  if (filter.owner) params.set("owner", filter.owner);
  if (filter.rating) params.set("rating", filter.rating);
  if (filter.module) params.set("module", filter.module);
  if (filter.purchase) params.set("purchase", filter.purchase);
  if (filter.sales) params.set("sales", filter.sales);
  if (filter.keyword) params.set("keyword", filter.keyword);
  if (filter.risk) params.set("risk", "1");
  if (filter.dueOnly) params.set("dueOnly", "1");
  if (filter.stage) params.set("stage", filter.stage);
  return params;
}

function kpi(label, value, sub, tone = "", filter = {}) {
  const encoded = encodeURIComponent(JSON.stringify(filter));
  return `
    <button class="kpi ${tone}" data-filter="${encoded}">
      <span>${label}</span>
      <strong>${value}</strong>
      <em>${sub}</em>
    </button>
  `;
}

function editInput(field, value, type = "text", placeholder = "") {
  return `<input class="cell-input" data-field="${field}" type="${type}" value="${esc(value || "")}" placeholder="${esc(placeholder)}" />`;
}

function editTextarea(field, value, placeholder = "") {
  return `<textarea class="cell-input cell-textarea" data-field="${field}" placeholder="${esc(placeholder)}">${esc(value || "")}</textarea>`;
}

function editSelect(field, value, options) {
  return `
    <select class="cell-input" data-field="${field}">
      ${options
        .map(([optionValue, label]) => `<option value="${esc(optionValue)}" ${String(value || "") === String(optionValue) ? "selected" : ""}>${esc(label)}</option>`)
        .join("")}
    </select>
  `;
}

const moduleColors = {
  销冠特工: "#2f80ed",
  花开富贵: "#1f9d6b",
  乘风破局: "#f2994a",
  KA: "#8b5cf6",
};

const moduleDisplayNames = {
  销冠特工: "线上-销冠特工队",
  花开富贵: "线上-花开富贵队",
  乘风破局: "线下-乘风破局队",
  KA: "KA组",
};

const moduleShortNames = {
  销冠特工: "销冠",
  花开富贵: "花开",
  乘风破局: "乘风",
  KA: "KA",
};

const blockerColors = {
  价格: "#205d8f",
  房源: "#1f9d6b",
  决策人: "#f2994a",
  距离: "#8b5cf6",
  观望: "#b33f42",
  待补充: "#9aa6b2",
};

const moduleMetricLabels = {
  visits: "到访量",
  effective: "有效到访量",
  closed: "成交量",
};

const level1ModuleMetricLabels = {
  value: "一级客储量",
  unconverted: "未转访",
  converted: "已转访",
};

function metricValue(item) {
  return Number(item[state.moduleMetric] ?? item.value ?? 0);
}

function currentModuleMetricLabels() {
  return state.level === "level1" ? level1ModuleMetricLabels : moduleMetricLabels;
}

function moduleLabel(name) {
  return moduleDisplayNames[name] || name;
}

function moduleShortLabel(name) {
  return moduleShortNames[name] || name;
}

function moduleLeader(name) {
  const owners = (state.summary?.ownerInsights || [])
    .filter((item) => item.module === name)
    .sort((a, b) => (b.value || 0) - (a.value || 0) || a.name.localeCompare(b.name, "zh-CN"));
  return owners[0]?.name || "待填写";
}

function customerType(item) {
  return item.isHouseTicket ? "房票" : "现金";
}

function targetNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function renderBlockers(item) {
  const blockers = item.blockers?.length ? item.blockers : ["待补充"];
  return `<span class="blocker-tags">${blockers.map((label) => `<b class="blocker-tag">${label}</b>`).join("")}</span>`;
}

function isVisitConfirmed(item) {
  return ["确认到访", "已到访", "已认购"].includes(item.followUp?.todayArrived);
}

function isClosedCustomer(item) {
  return item.rating === "A" || item.isClosed || item.sold || item.followUp?.todayArrived === "已认购";
}

function isLevel1Converted(item) {
  return item.level === "一级" && (item.visited || item.rating === "已转访" || isClosedCustomer(item));
}

function workflowCustomerLine(item) {
  const result = fmt(item.followUp?.todayArrived, "待跟进");
  return `${fmt(item.owner)}｜${fmt(item.port)}｜${fmt(item.expectedVisitDate, "未锚定")}｜${result}`;
}

function transferListItem(item, extraClass = "") {
  const isExpired = item.expectedVisitDate && item.expectedVisitDate < new Date().toISOString().slice(0, 10);
  const status = isExpired ? "已过期，需跟进" : fmt(item.followUp?.todayArrived, "待确认");
  return `
    <button class="due-item level1-due ${extraClass} ${isExpired ? "expired-transfer" : ""}" data-id="${item.recordId}">
      <span class="due-main">
        <strong>${fmt(item.expectedVisitDate, "未锚定")}｜一级｜${fmt(item.name)} · ${fmt(item.owner)}</strong>
        <span>${fmt(item.module)}｜${fmt(item.port)}｜${fmt(item.rating)}｜${status}</span>
      </span>
      <span class="due-note">${fmt(item.note || item.followUp?.latestSituation, "暂无客户情况")}</span>
    </button>
  `;
}

function findCustomerById(recordId) {
  return [
    ...(state.summary?.dueCustomers || []),
    ...(state.summary?.level1PendingTransferCustomers || []),
    ...(state.summary?.level1ConfirmedTransferCustomers || []),
    ...(state.level1ConfirmedTransfers || []),
    ...(state.customers || []),
    ...(state.modalCustomers || []),
  ].find((item) => item.recordId === recordId);
}

function phoneMatchKeys(item) {
  const values = [item.phone, item.displayPhone].filter(Boolean);
  const keys = new Set();
  values.forEach((value) => {
    const compact = String(value).replace(/\s+/g, "");
    const digits = compact.replace(/\D/g, "");
    if (compact) keys.add(compact.toLowerCase());
    if (digits.length >= 11) {
      keys.add(digits);
      keys.add(`${digits.slice(0, 3)}****${digits.slice(-4)}`.toLowerCase());
      keys.add(`${digits.slice(0, 3)}****${digits.slice(-2)}`.toLowerCase());
    } else if (digits.length >= 7) {
      keys.add(`${digits.slice(0, 3)}****${digits.slice(-2)}`.toLowerCase());
    }
  });
  return [...keys];
}

function ownerPhoneKeys(item) {
  return phoneMatchKeys(item).map((key) => `${item.owner || ""}|${key}`);
}

async function fetchAllCustomers(level, filter = {}) {
  const params = new URLSearchParams({ level, dateScope: "all", month: state.month, year: state.year });
  Object.entries(filter).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const data = await getJson(`/api/customers?${params.toString()}`, { cache: "no-store" });
  return data.data || [];
}

async function clientReconcileLevel1Transfers() {
  const [level1, level2] = await Promise.all([fetchAllCustomers("level1"), fetchAllCustomers("level2")]);
  const level2Keys = new Set(level2.flatMap(ownerPhoneKeys));
  const matches = level1.filter(
    (item) =>
      !isClosedCustomer(item) &&
      item.rating !== "已转访" &&
      ownerPhoneKeys(item).some((key) => level2Keys.has(key)),
  );
  if (!matches.length) return false;
  await Promise.all(
    matches.map((item) =>
      getJson(`/api/customers/${encodeURIComponent(item.recordId)}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todayArrived: "已到访",
          latestSituation: item.followUp?.latestSituation || "已在二级台账匹配到同号码同人员客户，自动标记已转访",
          nextVisitDate: item.followUp?.nextVisitDate || item.expectedVisitDate || "",
        }),
      }),
    ),
  );
  showToast(`已自动匹配并标记 ${matches.length} 组一级客户为已转访`);
  return true;
}

async function loadLevel1ConfirmedTransfers() {
  const list = await fetchAllCustomers("level1");
  state.level1ConfirmedTransfers = list
    .filter((item) => item.expectedVisitDate && !isLevel1Converted(item))
    .sort((a, b) => (a.expectedVisitDate || "9999-99-99").localeCompare(b.expectedVisitDate || "9999-99-99") || a.owner.localeCompare(b.owner, "zh-CN"));
}

function ownerInitials(name = "") {
  return String(name).trim().slice(0, 2) || "客";
}

function renderKpis() {
  const s = state.level === "level2" ? state.summary.level2 : state.summary.level1;
  $("#kpiGrid").innerHTML =
    state.level === "level2"
      ? [
          kpi("二级客户池", s.total, "当前周期已到访", "accent-blue", {}),
          kpi("有效客户", s.effective, `有效率 ${s.effectiveRate}`, "accent-green", { rating: "C" }),
          kpi("已成交客户", s.closed, `转化率 ${s.closeRate}`, "accent-red", { rating: "A" }),
          kpi("C级意向客户", s.cLevel, "到访且意向度高", "accent-gold", { rating: "C" }),
          kpi("已锚定到访", s.duePinned, "已填写下次到访", "accent-blue", { dueOnly: true }),
          kpi("风险待跟进", s.riskCount, "未锚定/未复访/房票", "accent-red critical-risk", { risk: true }),
        ].join("")
      : [
          kpi("一级客户池", s.total, "当前周期首录", "accent-blue", {}),
          kpi("未锚定到访", s.unpinned, "无预计到访时间", "accent-gold", { stage: "unpinned" }),
          kpi("已锚定待确认", s.pendingConfirm, "需电话确认", "accent-blue", { stage: "pendingConfirm" }),
          kpi("确认到访", s.confirmed, "已确认能到访", "accent-green", { stage: "confirmed" }),
          kpi("已转访", s.converted, `转访率 ${s.visitRate}`, "accent-green", { stage: "converted" }),
          kpi("未到访待二约", s.revisit, "需重新约时间", "accent-gold", { stage: "revisit" }),
          kpi("风险待跟进", s.riskCount, "二约/超期/今日待确认", "accent-red critical-risk", { risk: true }),
        ].join("");
}

function renderTargets() {
  const targets = state.targets || {};
  const achieved = targets.achieved || {};
  const items = [
    { key: "visits", label: "到访", target: targetNumber(targets.visits), value: targetNumber(achieved.visits) },
    { key: "effective", label: "有效", target: targetNumber(targets.effective), value: targetNumber(achieved.effective) },
    { key: "closed", label: "成交", target: targetNumber(targets.closed), value: targetNumber(achieved.closed) },
  ];
  $("#targetVisits").value = targets.visits || "";
  $("#targetEffective").value = targets.effective || "";
  $("#targetClosed").value = targets.closed || "";
  $("#targetMeta").textContent = targets.updatedAt ? `本月指标｜已保存 ${fmtTime(targets.updatedAt)}` : "固定显示本月";
  $("#targetDialogMeta").textContent = `${targets.month || state.month || "本月"}｜到访、有效到访、成交套数`;
  const bars = items
    .map((item) => {
      const rate = item.target ? Math.min(100, Math.round((item.value / item.target) * 100)) : 0;
      return `
        <div class="target-item">
          <strong>${item.label}</strong>
          <i class="target-track"><i style="--progress:${rate}%"></i></i>
          <span>${item.value}/${item.target || "未填"}</span>
        </div>
      `;
    })
    .join("");
  const donut = (item, title) => {
    const rate = item.target ? Math.min(100, Math.round((item.value / item.target) * 100)) : 0;
    return `
      <div class="target-donut-card">
        <div class="target-donut" style="--target-rate:${rate}%">
          <strong>${rate}%</strong>
          <span>${item.value}/${item.target || "未填"}</span>
        </div>
        <b>${title}</b>
      </div>
    `;
  };
  $("#targetProgress").innerHTML = `
    <div class="target-bars">${bars}</div>
    <div class="target-donuts">
      ${donut(items[0], "总到访达成")}
      ${donut(items[2], "成交达成")}
    </div>
  `;
}

function renderModuleCards(items = []) {
  const labels = currentModuleMetricLabels();
  if (!labels[state.moduleMetric]) state.moduleMetric = Object.keys(labels)[0];
  const max = Math.max(...items.map(metricValue), 1);
  const total = items.reduce((sum, item) => sum + metricValue(item), 0);
  let cursor = 0;
  const pieStops = items
    .map((item) => {
      const value = metricValue(item);
      const start = total ? (cursor / total) * 100 : 0;
      cursor += value;
      const end = total ? (cursor / total) * 100 : 0;
      return `${moduleColors[item.name] || "#9aa6b2"} ${start}% ${end}%`;
    })
    .join(", ");
  const bars = items
    .map((item) => {
      const value = metricValue(item);
      const height = Math.max(14, Math.round((value / max) * 94));
      return `
        <button class="module-card" data-module="${item.name}">
          <div class="module-top">
            <strong>${moduleLabel(item.name)}</strong>
            <span>组长：${moduleLeader(item.name)}</span>
            <em>${item.share}</em>
          </div>
          <div class="module-visual">
            <i style="height:${height}px; --module-color:${moduleColors[item.name] || "#2e6fba"}"></i>
          </div>
          <div class="module-bottom">
            <b>${value}</b>
            <span>${state.level === "level1" ? `未转访 ${item.unconverted}｜已转访 ${item.converted}` : `总量 ${item.value}｜C级 ${item.cLevel}`}</span>
          </div>
        </button>
      `;
    })
    .join("");
  const legend = items
    .map((item) => {
      const value = metricValue(item);
      return `
        <span>
          <i style="background:${moduleColors[item.name] || "#9aa6b2"}"></i>
          ${moduleShortLabel(item.name)}<b>${value}</b>
        </span>
      `;
    })
    .join("");
  const sliceLabels = items
    .map((item, index) => {
      const value = metricValue(item);
      return `
        <span class="slice-label-${index}" style="--slice-color:${moduleColors[item.name] || "#9aa6b2"}">
          <i></i>${moduleShortLabel(item.name)} ${value}
        </span>
      `;
    })
    .join("");
  $("#moduleChart").innerHTML = `
    <div class="module-bars">${bars}</div>
    <div class="module-pie-wrap">
      <div class="module-metric-tabs">
        ${Object.entries(labels)
          .map(
            ([key, label]) =>
              `<button class="${state.moduleMetric === key ? "active" : ""}" data-metric="${key}">${label}</button>`,
          )
          .join("")}
      </div>
      <div class="module-pie-stage">
        <div class="module-pie" style="background: conic-gradient(${pieStops || "#d9e2ec 0 100%"});">
          <strong>${total}</strong>
          <span>${labels[state.moduleMetric]}</span>
        </div>
        <div class="module-slice-labels">${sliceLabels}</div>
      </div>
      <div class="module-legend">${legend}</div>
    </div>
  `;
}

function renderOwnerCards(items = []) {
  const filtered = (items || []).filter((item) => !state.ownerGroup || item.module === state.ownerGroup);
  $("#ownerChart").innerHTML = filtered.length
    ? filtered
        .map(
          (item) => `
            <button class="owner-chip ${item.tags.includes("低活跃") || item.tags.includes("一转二低") ? "watch" : ""}" data-owner="${item.name}" data-module="${item.module}" style="--owner-color:${moduleColors[item.module] || "#9aa6b2"}">
              <strong>${item.name}</strong>
              <em>${item.tags.map((tag) => `<b>${tag}</b>`).join("")}</em>
              <dl>
                <div><dt>成交</dt><dd>${item.closed}</dd></div>
                <div><dt>到访</dt><dd>${item.visits}</dd></div>
                <div><dt>有效</dt><dd>${item.effective}</dd></div>
              </dl>
            </button>
          `,
        )
        .join("")
    : `<div class="empty">暂无人员数据</div>`;
}

function renderCCustomers(list = []) {
  $("#cPanel").style.display = state.level === "level2" ? "" : "none";
  const ownerOptions = [...new Set((list || []).filter((item) => !state.cGroup || item.module === state.cGroup).map((item) => item.owner).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "zh-CN"),
  );
  if ($("#cOwnerFilter")) {
    setSelectOptions($("#cOwnerFilter"), ownerOptions, "全部人员");
    if (!ownerOptions.includes(state.cOwner)) state.cOwner = "";
    $("#cOwnerFilter").value = state.cOwner;
  }
  const filtered = (list || []).filter(
    (item) => (!state.cGroup || item.module === state.cGroup) && (!state.cOwner || item.owner === state.cOwner),
  );
  const target = filtered.filter((item) => !isClosedCustomer(item));
  const order = ["价格", "房源", "决策人", "距离", "观望", "待补充"];
  const stats = order
    .map((label) => {
      const customers = target.filter((item) => (item.blockers?.length ? item.blockers : ["待补充"]).includes(label));
      return { label, customers, count: customers.length };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || order.indexOf(a.label) - order.indexOf(b.label));
  const max = Math.max(...stats.map((item) => item.count), 1);
  let cursor = 0;
  const pieTotal = stats.reduce((sum, item) => sum + item.count, 0);
  const pieStops = stats
    .map((item) => {
      const start = pieTotal ? (cursor / pieTotal) * 100 : 0;
      cursor += item.count;
      const end = pieTotal ? (cursor / pieTotal) * 100 : 0;
      return `${blockerColors[item.label] || "#9aa6b2"} ${start}% ${end}%`;
    })
    .join(", ");
  const legend = stats
    .map(
      (item) => `
        <span>
          <i style="background:${blockerColors[item.label] || "#9aa6b2"}"></i>
          ${item.label}<b>${item.count}</b>
        </span>
      `,
    )
    .join("");
  const cards = stats
    .map(
      (item, index) => `
        <button class="resistance-card" data-blocker="${item.label}">
          <span>
            <strong>${item.label}</strong>
            <em>${pieTotal ? `${((item.count / pieTotal) * 100).toFixed(1)}%` : "0.0%"}</em>
          </span>
          <b>${item.count}</b>
          <i class="resistance-rank">TOP ${index + 1}</i>
          <i class="resistance-bar"><i style="width:${Math.max(8, Math.round((item.count / max) * 100))}%;background:${blockerColors[item.label] || "#9aa6b2"}"></i></i>
          <small>${item.customers.slice(0, 3).map((customer) => `${fmt(customer.name)}·${fmt(customer.owner)}`).join("、") || "暂无代表客户"}</small>
        </button>
      `,
    )
    .join("");
  $("#cCustomerList").innerHTML = stats.length
    ? `
      <div class="resistance-visual">
        <div class="resistance-pie" aria-label="客户抗性占比" style="background: conic-gradient(${pieStops || "#d9e2ec 0 100%"});"></div>
        <div class="resistance-legend">${legend}</div>
      </div>
      <div class="resistance-list">${cards}</div>
    `
    : `<div class="empty">当前周期暂无可统计抗性客户</div>`;
}

function renderLevel1Workflow() {
  const panel = $("#level1Workbench");
  if (!panel) return;
  panel.hidden = state.level !== "level1";
  if (state.level !== "level1") return;
  const workflow = state.summary?.level1?.workflow || [];
  $("#level1Workflow").innerHTML = workflow.length
    ? workflow
        .map(
          (stage) => `
            <button class="workflow-card stage-${stage.key}" data-stage="${stage.key}">
              <div class="workflow-card-head">
                <strong>${stage.label}</strong>
                <b>${stage.count}</b>
              </div>
              <div class="workflow-list">
                ${
                  stage.customers?.length
                    ? stage.customers
                        .map(
                          (item) => `
                            <span>
                              <strong>${fmt(item.name)} · ${fmt(item.owner)}</strong>
                              <em>${workflowCustomerLine(item)}</em>
                            </span>
                          `,
                        )
                        .join("")
                    : `<em class="workflow-empty">暂无客户</em>`
                }
              </div>
            </button>
          `,
        )
        .join("")
    : `<div class="empty">当前周期暂无一级客户</div>`;
}

function renderCharts() {
  const s = state.level === "level2" ? state.summary.level2 : state.summary.level1;
  $(".insight-layout")?.classList.toggle("level1-insights", state.level === "level1");
  renderModuleCards(s.module);
  renderOwnerCards(state.summary.ownerInsights || []);
  renderCCustomers(s.cCustomers || []);
  renderLevel1Workflow();
}

function renderDueCustomers() {
  const levelName = state.level === "level1" ? "一级" : "二级";
  const list = (state.summary.dueCustomers || []).filter((item) => item.level === levelName);
  const meta = state.dueMeta || {};
  $("#dueRange").style.display = "";
  $("#dueTitle").textContent = state.level === "level1" ? `${meta.label || "预计到访"}一级客户名单` : `${meta.label || "预计到访"}客户名单`;
  $("#todayLabel").textContent =
    state.level === "level1"
      ? `${meta.start || "全部"}${meta.end && meta.end !== meta.start ? ` 至 ${meta.end}` : ""}｜共 ${list.length} 组`
      : `${meta.start || "全部"}${meta.end && meta.end !== meta.start ? ` 至 ${meta.end}` : ""}｜共 ${list.length} 组`;
  $("#dueTodayList").innerHTML = list.length
    ? list
        .map(
          (item) => `
            <button class="due-item ${isVisitConfirmed(item) ? "confirmed" : ""} ${item.level === "一级" ? "level1-due" : ""}" data-id="${item.recordId}">
              <span class="due-main">
                <strong>${item.expectedVisitDate}｜${item.level === "二级" ? customerType(item) : item.level}｜${fmt(item.name)} · ${fmt(item.owner)}</strong>
                <span>${fmt(item.module)}｜${fmt(item.port)}｜${fmt(item.rating)}｜${fmt(item.followUp?.todayArrived, "待确认")}</span>
              </span>
              <span class="due-note">${fmt(item.note || item.followUp?.latestSituation, "暂无客户情况")}</span>
            </button>
          `,
        )
        .join("")
    : `<div class="empty">当前暂无${state.level === "level1" ? "待确认转访" : "已锚定到访"}客户</div>`;
}

function renderConfirmedTransfers() {
  const importPanel = $(".import-panel");
  const panel = $("#confirmedTransferPanel");
  if (!panel || !importPanel) return;
  const isLevel1 = state.level === "level1";
  importPanel.hidden = isLevel1;
  panel.hidden = !isLevel1;
  if (!isLevel1) return;
  const list = state.level1ConfirmedTransfers || state.summary?.level1ConfirmedTransferCustomers || [];
  $("#confirmedTransferMeta").textContent = `待确认转访时间｜共 ${list.length} 组`;
  $("#confirmedTransferList").innerHTML = list.length
    ? list.map((item) => transferListItem(item, "confirmed")).join("")
    : `<div class="empty">暂无待确认转访时间客户</div>`;
}

function setSelectOptions(select, values, allLabel) {
  select.innerHTML = [`<option value="">${allLabel}</option>`]
    .concat((values || []).map((value) => `<option value="${value}">${value}</option>`))
    .join("");
}

function renderOptions() {
  const options = state.options[state.level];
  setSelectOptions($("#ownerFilter"), options.owners, "全部人员");
  setSelectOptions($("#ratingFilter"), options.ratings, "全部评级/状态");
  setSelectOptions($("#moduleFilter"), options.modules, "全部小组");
  setSelectOptions($("#salesFilter"), options.sales, "全部置业");
  if ($("#cOwnerFilter")) {
    const cOwners = [...new Set((state.summary?.level2?.cCustomers || []).map((item) => item.owner).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "zh-CN"),
    );
    setSelectOptions($("#cOwnerFilter"), cOwners, "全部人员");
    $("#cOwnerFilter").value = state.cOwner;
  }
}

function tableColumns() {
  if (state.level === "level2") {
    return [
      ["客户", (i) => state.editMode ? `${editInput("name", i.name, "text", "客户姓名")}${editInput("phone", i.phone || i.displayPhone, "text", "手机号")}` : `<strong>${fmt(i.name)}</strong><span>${fmt(i.displayPhone || i.phone, "无电话")}</span>`],
      ["归属模块", (i) => state.editMode ? `${editInput("owner", i.owner, "text", "归属人员")}${editSelect("module", i.module, [["销冠特工", "销冠特工"], ["花开富贵", "花开富贵"], ["乘风破局", "乘风破局"], ["KA", "KA"]])}` : `<strong>${fmt(i.owner)}</strong><span>${fmt(i.module)}</span>`],
      ["拓客途径", (i) => state.editMode ? editInput("port", i.port, "text", "拓客途径") : `<strong>${fmt(i.port)}</strong>`],
      ["置业顾问", (i) => state.editMode ? editInput("sales", i.sales, "text", "置业顾问") : `<strong>${fmt(i.sales, "未标注")}</strong>`],
      ["评级", (i) => state.editMode ? editSelect("rating", i.rating, [["A", "A"], ["C", "C"], ["D", "D"], ["", "未标注"]]) : `<span class="rating rating-${fmt(i.rating)}">${fmt(i.rating)}</span>`],
      ["现金/房票", (i) => state.editMode ? editSelect("purchase", i.isHouseTicket ? "ticket" : "cash", [["cash", "现金"], ["ticket", "房票"]]) : `<span class="cash-type ${i.isHouseTicket ? "ticket" : ""}">${customerType(i)}</span>`],
      ["区域/面积", (i) => state.editMode ? `${editInput("region", i.region, "text", "区域")}${editInput("area", i.area, "text", "面积")}` : `<strong>${fmt(i.region, "")}</strong><span>${fmt(i.area, "")}</span>`],
      ["到访/下访", (i) => state.editMode ? `${editInput("visitDate", i.visitDate, "date")}${editInput("expectedVisitDate", i.expectedVisitDate, "date")}` : `<strong>${fmt(i.visitDate, "未填到访")}</strong><span>${fmt(i.expectedVisitDate, "未锚定下访")}</span>`],
      ["跟进状态", (i) => state.editMode ? `${editSelect("todayArrived", i.followUp?.todayArrived || "", [["", "待跟进"], ["确认到访", "确认到访"], ["已到访", "已到访"], ["未到访", "未到访"], ["已认购", "已认购"]])}${editInput("latestSituation", i.followUp?.latestSituation, "text", "最新跟进")}` : followCell(i)],
      ["客户卡点", renderBlockers],
      ["客户情况", (i) => state.editMode ? editTextarea("note", i.note, "客户情况") : `<span class="note-text">${fmt(i.note, "暂无客户情况")}</span>`],
      ["操作", actionCell],
    ];
  }
  return [
    ["客户", (i) => state.editMode ? `${editInput("name", i.name, "text", "客户姓名")}${editInput("phone", i.phone || i.displayPhone, "text", "手机号")}` : `<strong>${fmt(i.name)}</strong><span>${fmt(i.displayPhone || i.phone, "无电话")}</span>`],
    ["归属人员/小组", (i) => state.editMode ? `${editInput("owner", i.owner, "text", "归属人员")}${editSelect("module", i.module, [["销冠特工", "销冠特工"], ["花开富贵", "花开富贵"], ["乘风破局", "乘风破局"], ["KA", "KA"]])}` : `<strong>${fmt(i.owner)}</strong><span>${fmt(i.module)}</span>`],
    ["拓客途径", (i) => state.editMode ? `${editInput("port", i.port, "text", "拓客途径")}${editInput("rawModule", i.rawModule, "text", "原模块")}` : `<strong>${fmt(i.port)}</strong><span>${fmt(i.rawModule, "")}</span>`],
    ["获客日期", (i) => state.editMode ? editInput("acquiredAt", i.acquiredAt, "date") : `<strong>${fmt(i.acquiredAt, "未填获客")}</strong>`],
    ["预计到访", (i) => state.editMode ? editInput("expectedVisitDate", i.expectedVisitDate, "date") : `<strong>${fmt(i.expectedVisitDate, "未锚定到访")}</strong><span>首次 ${fmt(i.plannedVisit, "未记录")}</span>`],
    ["转访状态", (i) => state.editMode ? editSelect("rating", i.rating, [["未转访", "未转访"], ["确认到访", "确认到访"], ["未到访", "未到访"], ["已转访", "已转访"], ["A", "A"]]) : `<span class="rating level1-rating">${fmt(i.rating)}</span>`],
    ["跟进结果", (i) => state.editMode ? `${editSelect("todayArrived", i.followUp?.todayArrived || "", [["", "待跟进"], ["确认到访", "确认到访"], ["已到访", "已到访"], ["未到访", "未到访"], ["已认购", "已认购"]])}${editInput("latestSituation", i.followUp?.latestSituation, "text", "最新跟进")}` : followCell(i)],
    ["客户卡点", renderBlockers],
    ["客户情况", (i) => state.editMode ? editTextarea("note", i.note, "客户情况") : `<span class="note-text">${fmt(i.note, "暂无客户情况")}</span>`],
    ["操作", actionCell],
  ];
}

function followCell(item) {
  const arrived = fmt(item.followUp?.todayArrived, "待跟进");
  const latest = fmt(item.followUp?.latestSituation, "");
  return `<strong>${arrived}</strong><span>${latest}</span>`;
}

function actionCell(item) {
  if (state.editMode) {
    return `
      <div class="row-actions">
        <button class="row-button" data-action="save-row" data-id="${item.recordId}">保存</button>
        <button class="row-button danger" data-action="delete" data-id="${item.recordId}">删除</button>
      </div>
    `;
  }
  const followAction = isClosedCustomer(item) || isLevel1Converted(item)
    ? `<span class="settled-label">无需跟进</span>`
    : `<button class="row-button" data-action="follow" data-id="${item.recordId}">跟进</button>`;
  return `
    <div class="row-actions">
      ${followAction}
      <button class="row-button danger" data-action="delete" data-id="${item.recordId}">删除</button>
    </div>
  `;
}

function renderTable() {
  const columns = tableColumns();
  $("#tableTitle").textContent = state.level === "level2" ? "二级客户明细" : "一级转访明细";
  $("#tableHead").innerHTML = `<tr>${columns.map(([name]) => `<th>${name}</th>`).join("")}</tr>`;
  $("#tableCount").textContent = `共 ${state.customers.length} 条`;
  $("#toggleEditBtn").textContent = state.editMode ? "完成编辑" : "编辑表格";
  $("#customerTable").innerHTML = state.customers.length
    ? state.customers
        .map((item) => `<tr data-id="${item.recordId}">${columns.map(([, render]) => `<td>${render(item)}</td>`).join("")}</tr>`)
        .join("")
    : `<tr><td colspan="${columns.length}" class="empty">当前筛选条件下暂无客户</td></tr>`;
}

function modalRow(item) {
  const followAction = isClosedCustomer(item)
    ? `<span class="settled-label">无需跟进</span>`
    : `<button class="row-button modal-follow" data-id="${item.recordId}">跟进</button>`;
  return `
    <tr>
      <td>${item.level}</td>
      <td><strong>${fmt(item.name)}</strong><span>${fmt(item.displayPhone || item.phone, "无电话")}</span></td>
      <td><strong>${fmt(item.owner)}</strong><span>${fmt(item.module)}</span></td>
      <td><strong>${fmt(item.port)}</strong><span>${fmt(item.rating)}</span></td>
      <td><strong>${fmt(item.expectedVisitDate, "未锚定")}</strong><span>${fmt(item.followUp?.todayArrived, "待跟进")}</span></td>
      <td><span class="note-text">${fmt(item.note, "暂无客户情况")}</span></td>
      <td>${followAction}</td>
    </tr>
  `;
}

async function fetchCustomers(level, filter = {}) {
  const data = await getJson(`/api/customers?${paramsFromFilter(level, filter).toString()}`, { cache: "no-store" });
  return data.data || [];
}

async function openListModal(title, filter = {}, options = {}) {
  const levels = options.levels || [filter.level || state.level];
  const lists = await Promise.all(levels.map((level) => fetchCustomers(level, { ...filter, level: undefined })));
  const rows = lists.flat();
  openRowsModal(title, rows);
}

function openRowsModal(title, rows = []) {
  state.modalCustomers = rows;
  $("#listTitle").textContent = title;
  $("#listMeta").textContent = `${rows.length}组客户｜${dateScopeLabel()}`;
  $("#listTable").innerHTML = rows.length ? rows.map(modalRow).join("") : `<tr><td colspan="7" class="empty">当前条件下暂无客户</td></tr>`;
  $("#listDialog").showModal();
}

function queryString() {
  const params = scopeParams();
  params.set("level", state.level);
  const owner = $("#ownerFilter").value;
  const rating = $("#ratingFilter").value;
  const moduleName = $("#moduleFilter").value;
  const purchase = $("#purchaseFilter").value;
  const sales = $("#salesFilter").value;
  const keyword = $("#keywordInput").value.trim();
  if (owner) params.set("owner", owner);
  if (rating) params.set("rating", rating);
  if (moduleName) params.set("module", moduleName);
  if (purchase) params.set("purchase", purchase);
  if (sales) params.set("sales", sales);
  if (keyword) params.set("keyword", keyword);
  if ($("#riskOnly").checked) params.set("risk", "1");
  return params.toString();
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "操作失败");
  return data;
}

function syncDateControls() {
  $("#monthPicker").value = state.month;
  $("#yearPicker").value = state.year;
  $("#customStartDate").value = state.customStart;
  $("#customEndDate").value = state.customEnd;
  $("#dateScope").value = state.dateScope;
  $("#monthWrap").style.display = state.dateScope === "month" ? "" : "none";
  $("#yearWrap").style.display = state.dateScope === "year" ? "" : "none";
  $("#customStartWrap").hidden = state.dateScope !== "custom";
  $("#customEndWrap").hidden = state.dateScope !== "custom";
}

async function loadSummary() {
  $("#sourceStatus").textContent = "读取本机台账中";
  const data = await getJson(`/api/summary?${scopeParams().toString()}`, { cache: "no-store" });
  state.summary = data.summary;
  state.options = data.options;
  state.dueMeta = data.dueMeta;
  state.targets = data.targets;
  if (state.level === "level1") {
    const reconciled = await clientReconcileLevel1Transfers();
    if (reconciled) {
      const refreshed = await getJson(`/api/summary?${scopeParams().toString()}`, { cache: "no-store" });
      state.summary = refreshed.summary;
      state.options = refreshed.options;
      state.dueMeta = refreshed.dueMeta;
      state.targets = refreshed.targets;
    }
    await loadLevel1ConfirmedTransfers();
  }
  $("#sourceStatus").textContent = `本机台账｜${new Date(data.updatedAt).toLocaleString("zh-CN", { hour12: false })}`;
  renderDueCustomers();
  renderConfirmedTransfers();
  renderTargets();
  renderOptions();
  renderKpis();
  renderCharts();
}

async function loadCustomers() {
  const data = await getJson(`/api/customers?${queryString()}`, { cache: "no-store" });
  state.customers = data.data;
  renderTable();
}

async function refreshAll() {
  try {
    $("#refreshBtn").disabled = true;
    syncDateControls();
    await loadSummary();
    await loadCustomers();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    $("#refreshBtn").disabled = false;
  }
}

function resetFilters() {
  $("#ownerFilter").value = "";
  $("#ratingFilter").value = "";
  $("#moduleFilter").value = "";
  $("#purchaseFilter").value = "";
  $("#salesFilter").value = "";
  $("#keywordInput").value = "";
  $("#riskOnly").checked = false;
}

async function switchLevel(level) {
  state.level = level;
  state.moduleMetric = level === "level1" ? "value" : "visits";
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.level === level));
  resetFilters();
  if (level === "level1") await loadLevel1ConfirmedTransfers();
  renderDueCustomers();
  renderConfirmedTransfers();
  renderOptions();
  renderKpis();
  renderCharts();
  await loadCustomers();
}

function openFollow(customer) {
  state.activeCustomer = customer;
  $("#followTitle").textContent = `${customer.level}｜${customer.name}`;
  const isLevel1 = customer.level === "一级";
  const phone = fmt(customer.phone || customer.displayPhone, "无电话");
  $("#followMeta").textContent = isLevel1
    ? `${customer.owner}｜${customer.module}｜${customer.port}｜电话：${phone}`
    : `${customer.owner}｜${customer.module}｜${customer.port}｜置业顾问：${fmt(customer.sales, "无")}｜电话：${phone}`;
  $("#firstVisitLabel").textContent = isLevel1 ? "第一次客户预计到访时间" : "第一次客户到访时间";
  $("#firstVisitDate").textContent = fmt(customer.visitDate || customer.plannedVisit, "未记录");
  $("#lastFollowTime").textContent = fmtTime(customer.followUp?.updatedAt);
  $("#lastFollowNote").textContent = fmt(customer.followUp?.latestSituation, "暂无上次跟进描摹");
  $("#acquiredDateLabel").textContent = isLevel1 ? "获客日期" : "到访日期";
  $("#acquiredDate").textContent = fmt(isLevel1 ? customer.acquiredAt : customer.visitDate, "未记录");
  $("#followResultLabel").textContent = isLevel1 ? "转访确认/今日结果" : "到访确认/今日结果";
  $("#latestSituationLabel").textContent = isLevel1 ? "未到访/转访复盘最新情况" : "未到访/复盘最新情况";
  $("#nextVisitLabel").textContent = isLevel1 ? "下次预计转访时间" : "下次预计到访时间";
  $("#todayArrived").value = customer.followUp?.todayArrived || "";
  $("#latestSituation").value = customer.followUp?.latestSituation || "";
  $("#nextVisitDate").value = customer.followUp?.nextVisitDate || customer.expectedVisitDate || "";
  $("#followDialog").showModal();
}

async function saveFollow() {
  if (!state.activeCustomer) return;
  const payload = {
    todayArrived: $("#todayArrived").value,
    latestSituation: $("#latestSituation").value,
    nextVisitDate: $("#nextVisitDate").value,
  };
  await getJson(`/api/customers/${encodeURIComponent(state.activeCustomer.recordId)}/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  $("#followDialog").close();
  showToast("跟进已保存");
  await refreshAll();
}

function collectRowData(row) {
  const data = {};
  row.querySelectorAll("[data-field]").forEach((field) => {
    data[field.dataset.field] = field.value;
  });
  return data;
}

async function saveTableRow(recordId, row) {
  const data = collectRowData(row);
  await getJson(`/api/customers/${encodeURIComponent(recordId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  showToast("客户信息已保存");
  await refreshAll();
}

async function addManualCustomer() {
  const name = window.prompt("请输入客户姓名");
  if (name === null) return;
  const phone = window.prompt("请输入客户手机号（可不填）") || "";
  const data = {
    name: name.trim() || "未留名",
    phone: phone.trim(),
    owner: $("#ownerFilter").value || "",
    module: $("#moduleFilter").value || "",
    rating: state.level === "level1" ? "未转访" : "C",
    port: "手动录入",
    visitDate: state.level === "level2" ? new Date().toISOString().slice(0, 10) : "",
    acquiredAt: state.level === "level1" ? new Date().toISOString().slice(0, 10) : "",
  };
  await getJson("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: state.level, data }),
  });
  state.editMode = true;
  showToast("已新增客户，可在表格中继续补全字段");
  resetFilters();
  await refreshAll();
}

async function saveTargets() {
  const payload = {
    visits: targetNumber($("#targetVisits").value),
    effective: targetNumber($("#targetEffective").value),
    closed: targetNumber($("#targetClosed").value),
  };
  await getJson("/api/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  $("#targetDialog").close();
  showToast("指标已保存");
  await loadSummary();
}

function openTargetEditor() {
  renderTargets();
  $("#targetDialog").showModal();
}

async function dedupeCustomers() {
  const ok = window.confirm("确认一键剔除重复客户吗？\n规则：同一台账内，手机号和归属渠道姓名都相同，则保留第一条，删除后续重复记录。");
  if (!ok) return;
  const data = await getJson("/api/customers/dedupe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: state.level }),
  });
  showToast(data.removed ? `已剔除 ${data.removed} 条重复客户` : "未发现重复客户");
  await refreshAll();
}

async function deleteCustomer(customer) {
  const ok = window.confirm(`确认删除「${customer.name}」吗？\n仅删除本机台账记录，不会修改飞书原表。`);
  if (!ok) return;
  await getJson(`/api/customers/${encodeURIComponent(customer.recordId)}`, {
    method: "DELETE",
  });
  showToast("客户已从本机台账删除");
  await refreshAll();
}

async function importRows(level) {
  const textarea = $("#importText");
  const text = textarea.value.trim();
  if (!text) {
    showToast(`请先粘贴${level === "level2" ? "二级" : "一级"}客户表格内容`, true);
    return;
  }
  const data = await getJson("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, text }),
  });
  textarea.value = "";
  showToast(`导入完成：新增 ${data.inserted} 条，更新 ${data.updated} 条，当前 ${data.total} 条`);
  await switchLevel(level);
  await refreshAll();
}

function bindEvents() {
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#toggleEditBtn").addEventListener("click", () => {
    state.editMode = !state.editMode;
    renderTable();
  });
  $("#addCustomerBtn").addEventListener("click", () => addManualCustomer().catch((error) => showToast(error.message, true)));
  $("#dedupeBtn").addEventListener("click", () => dedupeCustomers().catch((error) => showToast(error.message, true)));
  $("#editTargetsBtn").addEventListener("click", () => openTargetEditor());
  $("#saveTargetsBtn").addEventListener("click", (event) => {
    event.preventDefault();
    saveTargets().catch((error) => showToast(error.message, true));
  });
  $("#importLevelSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-import-level]");
    if (!button) return;
    state.importLevel = button.dataset.importLevel;
    document.querySelectorAll("#importLevelSwitch button").forEach((item) => item.classList.toggle("active", item === button));
    $("#importText").placeholder = `粘贴${state.importLevel === "level2" ? "二级" : "一级"}客户表格内容`;
    $("#importHint").textContent =
      state.importLevel === "level2"
        ? "已到访客户，重点维护评级、客户情况、下次预计到访"
        : "一级首录客户，重点维护预计来访、转访确认和未到访二约";
  });
  $("#importBtn").addEventListener("click", () => importRows(state.importLevel));
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchLevel(tab.dataset.level)));

  $("#dateScope").addEventListener("change", async () => {
    state.dateScope = $("#dateScope").value;
    resetFilters();
    await refreshAll();
  });
  $("#monthPicker").addEventListener("change", async () => {
    state.month = $("#monthPicker").value || state.month;
    resetFilters();
    await refreshAll();
  });
  $("#yearPicker").addEventListener("change", async () => {
    state.year = $("#yearPicker").value || state.year;
    resetFilters();
    await refreshAll();
  });
  $("#customStartDate").addEventListener("change", async () => {
    state.customStart = $("#customStartDate").value || state.customStart;
    if (state.customEnd < state.customStart) state.customEnd = state.customStart;
    resetFilters();
    await refreshAll();
  });
  $("#customEndDate").addEventListener("change", async () => {
    state.customEnd = $("#customEndDate").value || state.customEnd;
    if (state.customEnd < state.customStart) state.customStart = state.customEnd;
    resetFilters();
    await refreshAll();
  });
  $("#dueRange").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    state.dueRange = button.dataset.range;
    document.querySelectorAll("#dueRange button").forEach((item) => item.classList.toggle("active", item === button));
    await loadSummary();
  });

  ["ownerFilter", "ratingFilter", "moduleFilter", "purchaseFilter", "salesFilter", "riskOnly"].forEach((id) =>
    $(`#${id}`).addEventListener("change", loadCustomers),
  );
  let timer = null;
  $("#keywordInput").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadCustomers, 250);
  });
  $("#kpiGrid").addEventListener("click", (event) => {
    const card = event.target.closest(".kpi");
    if (!card) return;
    const filter = JSON.parse(decodeURIComponent(card.dataset.filter || "%7B%7D"));
    openListModal(`${card.querySelector("span")?.textContent || "客户"}名单`, { ...filter, level: state.level });
  });
  $("#moduleChart").addEventListener("click", (event) => {
    const metricButton = event.target.closest("button[data-metric]");
    if (metricButton) {
      state.moduleMetric = metricButton.dataset.metric;
      renderCharts();
      return;
    }
    const card = event.target.closest(".module-card");
    if (card) openListModal(`${card.dataset.module}客户名单`, { module: card.dataset.module, level: state.level });
  });
  $("#level1Workbench").addEventListener("click", (event) => {
    const card = event.target.closest(".workflow-card[data-stage]");
    if (!card) return;
    const title = card.querySelector("strong")?.textContent || "一级转访";
    openListModal(`${title}客户名单`, { level: "level1", stage: card.dataset.stage });
  });
  $("#ownerChart").addEventListener("click", (event) => {
    const chip = event.target.closest(".owner-chip");
    if (chip) openListModal(`${chip.dataset.owner}客户名单`, { owner: chip.dataset.owner }, { levels: ["level1", "level2"] });
  });
  $("#ownerGroupFilter").addEventListener("change", () => {
    state.ownerGroup = $("#ownerGroupFilter").value;
    renderCharts();
  });
  $("#cGroupFilter").addEventListener("change", () => {
    state.cGroup = $("#cGroupFilter").value;
    state.cOwner = "";
    $("#cOwnerFilter").value = "";
    renderCharts();
  });
  $("#cOwnerFilter").addEventListener("change", () => {
    state.cOwner = $("#cOwnerFilter").value;
    renderCharts();
  });
  $("#showCBtn").addEventListener("click", () =>
    openListModal("客户抗性明细", { level: "level2", module: state.cGroup, owner: state.cOwner }),
  );
  $("#cCustomerList").addEventListener("click", (event) => {
    const card = event.target.closest(".resistance-card[data-blocker]");
    if (!card) return;
    const blocker = card.dataset.blocker;
    const rows = (state.summary.level2.cCustomers || []).filter(
      (item) =>
        (!state.cGroup || item.module === state.cGroup) &&
        (!state.cOwner || item.owner === state.cOwner) &&
        !isClosedCustomer(item) &&
        (item.blockers?.length ? item.blockers : ["待补充"]).includes(blocker),
    );
    openRowsModal(`${blocker}卡点客户`, rows);
  });
  $("#customerTable").addEventListener("click", (event) => {
    const button = event.target.closest(".row-button");
    if (!button) return;
    const customer = state.customers.find((item) => item.recordId === button.dataset.id);
    if (!customer) return;
    if (button.dataset.action === "delete") {
      deleteCustomer(customer).catch((error) => showToast(error.message, true));
      return;
    }
    if (button.dataset.action === "save-row") {
      const row = button.closest("tr");
      saveTableRow(customer.recordId, row).catch((error) => showToast(error.message, true));
      return;
    }
    openFollow(customer);
  });
  $("#dueTodayList").addEventListener("click", async (event) => {
    const button = event.target.closest(".due-item");
    if (!button) return;
    const customer = findCustomerById(button.dataset.id);
    if (customer) openFollow(customer);
  });
  $("#confirmedTransferList").addEventListener("click", async (event) => {
    const button = event.target.closest(".due-item");
    if (!button) return;
    const customer = findCustomerById(button.dataset.id);
    if (customer) openFollow(customer);
  });
  $("#closeListBtn").addEventListener("click", () => $("#listDialog").close());
  $("#listTable").addEventListener("click", (event) => {
    const button = event.target.closest(".modal-follow");
    if (!button) return;
    const customer = state.modalCustomers.find((item) => item.recordId === button.dataset.id);
    if (customer) {
      $("#listDialog").close();
      openFollow(customer);
    }
  });
  $("#saveFollowBtn").addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await saveFollow();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

syncDateControls();
bindEvents();
refreshAll();

