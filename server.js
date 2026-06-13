const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 4184);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "customers.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DATABASE_URL = valueEnv("DATABASE_URL");
const APP_PASSWORD = valueEnv("APP_PASSWORD");
const APP_PASSWORD_HASH = valueEnv("APP_PASSWORD_HASH");
const FEISHU_APP_ID = valueEnv("FEISHU_APP_ID");
const FEISHU_APP_SECRET = valueEnv("FEISHU_APP_SECRET");
const FEISHU_AUTH_ENABLED = Boolean(FEISHU_APP_ID && FEISHU_APP_SECRET);
const PASSWORD_AUTH_ENABLED = Boolean(APP_PASSWORD || APP_PASSWORD_HASH);
const AUTH_ENABLED = FEISHU_AUTH_ENABLED || PASSWORD_AUTH_ENABLED;
const AUTH_MODE = FEISHU_AUTH_ENABLED && PASSWORD_AUTH_ENABLED
  ? "feishu-password"
  : FEISHU_AUTH_ENABLED
    ? "feishu"
    : PASSWORD_AUTH_ENABLED
      ? "password"
      : "disabled";
const SESSION_COOKIE = "yc_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const sessions = new Map();
let pgPool = null;
let pgReady = false;

function valueEnv(name) {
  return (process.env[name] || "").trim();
}

const GROUPS = {
  "销冠特工": ["章琛琛", "彭继亮", "王祥德", "潘永雷", "林斌", "刘燕"],
  "花开富贵": ["徐顺恒", "卢晓丹", "胡嘉伟", "雷武鹏", "蔡仁杰"],
  "乘风破局": ["连立辉", "姜凯强", "汤时达", "张琴", "关宇", "唐筱媛", "罗语宸", "魏方秋"],
  KA: ["谢晓静"],
};

const STAFF_ALIASES = {
  琛琛: "章琛琛",
  王翔德: "王祥德",
  张飞扬: "张飞洋",
};

const SALES_ADVISORS = ["张飞洋", "鄢梓豪", "王家培", "袁龙月", "冯博", "陈美渺", "王胜伯", "林建科", "刘良坝"];

const SALES_ALIASES = {
  飞洋: "张飞洋",
  张飞扬: "张飞洋",
  鄢孜豪: "鄢梓豪",
  孜豪: "鄢梓豪",
  梓豪: "鄢梓豪",
  佳培: "王家培",
  家培: "王家培",
  王佳培: "王家培",
  龙月: "袁龙月",
  美渺: "陈美渺",
  胜伯: "王胜伯",
  王胜: "王胜伯",
  良坝: "刘良坝",
  刘良: "刘良坝",
};

const LEVEL2_HEADERS = [
  "新/复访",
  "模块",
  "到访日期",
  "获客端口",
  "渠道归属",
  "客户姓名",
  "联系方式",
  "置业",
  "评级",
  "区域",
  "面积",
  "客户情况",
  "预计下次到访时间",
];

const LEVEL1_HEADERS = [
  "模块",
  "联系方式",
  "预计来访时间",
  "系统归属",
  "一级首录至今",
  "是否来访",
  "获客日期",
  "获客端口",
  "客户情况",
  "是否成交",
  "客户姓名",
];

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function unauthorized(res) {
  return sendJson(res, 401, { ok: false, message: "请先登录团队应用" });
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPassword(password) {
  const text = valueText(password);
  if (!AUTH_ENABLED) return true;
  if (APP_PASSWORD_HASH) return safeEqual(hashSecret(text), APP_PASSWORD_HASH.toLowerCase());
  return safeEqual(hashSecret(text), hashSecret(APP_PASSWORD));
}

function parseCookies(req) {
  return (req.headers.cookie || "").split(";").reduce((acc, item) => {
    const [rawKey, ...rawValue] = item.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function isAuthenticated(req) {
  if (!AUTH_ENABLED) return true;
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  return session && session.expiresAt >= Date.now() ? session : null;
}

function sessionActor(req) {
  const session = getSession(req);
  return session?.user?.name || session?.user?.openId || session?.authType || (AUTH_ENABLED ? "authenticated" : "local");
}

function setSession(res, user = {}) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, user, authType: user.authType || "password" });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

function clearSession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function authStatus(req) {
  const authenticated = isAuthenticated(req);
  const session = authenticated ? getSession(req) : null;
  return {
    enabled: AUTH_ENABLED,
    mode: AUTH_MODE,
    authenticated,
    feishuAppId: FEISHU_AUTH_ENABLED ? FEISHU_APP_ID : "",
    user: session?.user || null,
  };
}

async function feishuJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (typeof data.code === "number" && data.code !== 0)) {
    throw new Error(data.msg || data.message || `飞书接口调用失败：${response.status}`);
  }
  return data;
}

async function exchangeFeishuUser(code) {
  const tokenData = await feishuJson("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method: "POST",
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: FEISHU_APP_ID,
      client_secret: FEISHU_APP_SECRET,
      code,
    }),
  });
  const accessToken = tokenData.data?.access_token || tokenData.access_token;
  if (!accessToken) throw new Error("飞书免登未返回用户访问令牌");
  const userData = await feishuJson("https://open.feishu.cn/open-apis/authen/v1/user_info", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = userData.data || userData;
  return {
    authType: "feishu",
    openId: user.open_id || "",
    unionId: user.union_id || "",
    userId: user.user_id || "",
    name: user.name || user.en_name || "飞书用户",
    email: user.email || "",
    avatarUrl: user.avatar_url || "",
  };
}

function valueText(value) {
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join("、");
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeStaff(value) {
  const text = valueText(value).replace(/\s+/g, "");
  return STAFF_ALIASES[text] || text;
}

function normalizeSalesAdvisor(value) {
  const text = valueText(value).replace(/\s+/g, "");
  if (!text) return "无";
  const normalized = SALES_ALIASES[text] || text;
  return SALES_ADVISORS.includes(normalized) ? normalized : "无";
}

function groupByStaff(owner, sourceModule = "") {
  const staff = normalizeStaff(owner);
  for (const [group, names] of Object.entries(GROUPS)) {
    if (names.includes(staff)) return group;
  }
  const moduleText = valueText(sourceModule);
  if (/KA|推荐/.test(moduleText)) return "KA";
  if (/富贵|线上/.test(moduleText)) return "花开富贵";
  if (/破局|乘风/.test(moduleText)) return "乘风破局";
  if (/销冠|特工|线下|外拓|客储/.test(moduleText)) return "销冠特工";
  return "未分组";
}

function normalizeRating(value) {
  const text = valueText(value).toUpperCase();
  if (["A", "B", "C", "D"].includes(text)) return text;
  if (/无效/.test(text)) return "无效";
  return text || "未评级";
}

function parseDate(value) {
  const text = valueText(value);
  if (!text) return "";
  const normalized = text.replace(/\//g, "-").replace(/\./g, "-").slice(0, 10);
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return normalized;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDate(dateText) {
  const parsed = parseDate(dateText);
  if (!parsed) return null;
  const date = new Date(`${parsed}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayText() {
  return formatDate(new Date());
}

function addDays(dateText, days) {
  const date = toDate(dateText) || new Date();
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function weekRange(dateText = todayText()) {
  const date = toDate(dateText) || new Date();
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(date.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: formatDate(start), end: formatDate(end) };
}

function daysSince(dateText) {
  const date = toDate(dateText);
  if (!date) return null;
  const today = toDate(todayText());
  return Math.floor((today - date) / 86400000);
}

function maskPhone(value) {
  const raw = valueText(value);
  if (!raw) return "";
  if (raw.includes("*")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 11) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
  return raw.replace(/\d/g, "*");
}

function makeId(prefix = "local") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function recordKey(item) {
  return [
    item.level,
    normalizeStaff(item.owner),
    item.name,
    valueText(item.phone).replace(/\D|\*/g, ""),
    item.visitDate || item.acquiredAt || item.plannedVisit || "",
  ]
    .join("|")
    .toLowerCase();
}

function phoneMatchKeys(item) {
  const values = [item.phone, item.displayPhone].map(valueText).filter(Boolean);
  const keys = new Set();
  values.forEach((value) => {
    const compact = value.replace(/\s+/g, "");
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
  const owner = normalizeStaff(item.owner);
  return phoneMatchKeys(item).map((key) => `${owner}|${key}`);
}

function reconcileLevel1Transfers(store) {
  const level2Keys = new Set((store.level2 || []).flatMap(ownerPhoneKeys));
  store.level1 = (store.level1 || []).map((item) => {
    const matched = ownerPhoneKeys(item).some((key) => level2Keys.has(key));
    return normalizeLevel1({
      ...item,
      autoTransferred: matched,
      autoTransferMatchedAt: matched ? item.autoTransferMatchedAt || new Date().toISOString() : "",
    });
  });
  return store;
}

function emptyStore() {
  return { version: 3, updatedAt: new Date().toISOString(), source: DATABASE_URL ? "postgres-manual" : "local-manual", level1: [], level2: [], importBatches: [], auditLogs: [] };
}

function normalizeStore(parsed = {}) {
  return reconcileLevel1Transfers({
    version: 3,
    updatedAt: parsed.updatedAt || "",
    source: parsed.source || (DATABASE_URL ? "postgres-manual" : "local-manual"),
    level1: (parsed.level1 || []).map(normalizeLevel1),
    level2: (parsed.level2 || []).map(normalizeLevel2),
    importBatches: parsed.importBatches || [],
    auditLogs: parsed.auditLogs || [],
  });
}

async function readLocalStoreRaw() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(emptyStore(), null, 2), "utf-8");
  }
  const raw = (await fs.readFile(DATA_FILE, "utf-8")).replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

async function ensurePg() {
  if (!DATABASE_URL) return null;
  if (pgReady) return pgPool;
  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    throw new Error("已配置 DATABASE_URL，但未安装 pg 依赖。请先运行 npm install。");
  }
  pgPool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false } });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS app_store (
      id integer PRIMARY KEY DEFAULT 1,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT app_store_singleton CHECK (id = 1)
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS app_backups (
      id bigserial PRIMARY KEY,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const existing = await pgPool.query("SELECT id FROM app_store WHERE id = 1");
  if (!existing.rowCount) {
    const local = await readLocalStoreRaw();
    await pgPool.query("INSERT INTO app_store (id, payload, updated_at) VALUES (1, $1::jsonb, now())", [JSON.stringify(normalizeStore(local))]);
  }
  pgReady = true;
  return pgPool;
}

async function loadStore() {
  const pool = await ensurePg();
  if (pool) {
    const result = await pool.query("SELECT payload FROM app_store WHERE id = 1");
    return normalizeStore(result.rows[0]?.payload || emptyStore());
  }
  return normalizeStore(await readLocalStoreRaw());
}

async function saveStore(store) {
  const normalized = normalizeStore(store);
  const payload = {
    version: 3,
    updatedAt: new Date().toISOString(),
    source: DATABASE_URL ? "postgres-manual" : "local-manual",
    level1: normalized.level1 || [],
    level2: normalized.level2 || [],
    importBatches: normalized.importBatches || [],
    auditLogs: normalized.auditLogs || [],
  };
  const pool = await ensurePg();
  if (pool) {
    await pool.query(
      "INSERT INTO app_store (id, payload, updated_at) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
      [JSON.stringify(payload)],
    );
    return payload;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
}

function appendAudit(store, action, detail = {}, actor = AUTH_ENABLED ? "authenticated" : "local") {
  store.auditLogs = [
    ...(store.auditLogs || []),
    {
      id: makeId("audit"),
      action,
      detail,
      actor,
      createdAt: new Date().toISOString(),
    },
  ].slice(-1000);
}

async function createBackup(reason = "manual") {
  const store = await loadStore();
  const payload = { ...store, backupReason: reason, backupAt: new Date().toISOString() };
  const pool = await ensurePg();
  if (pool) {
    await pool.query("INSERT INTO app_backups (payload, created_at) VALUES ($1::jsonb, now())", [JSON.stringify(payload)]);
    return { type: "postgres", createdAt: payload.backupAt };
  }
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `customers-${payload.backupAt.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
  return { type: "file", file, createdAt: payload.backupAt };
}

function normalizeFollowUp(item) {
  return {
    todayArrived: valueText(item.followUp?.todayArrived || item.todayArrived || ""),
    latestSituation: valueText(item.followUp?.latestSituation || item.latestSituation || ""),
    nextVisitDate: parseDate(item.followUp?.nextVisitDate || item.nextFollowVisitDate || ""),
    updatedAt: valueText(item.followUp?.updatedAt || item.followUpdatedAt || ""),
  };
}

function normalizeLevel2(item) {
  const owner = normalizeStaff(item.owner || item["渠道归属"]);
  const sourceModule = valueText(item.rawModule || item.module || item["模块"]);
  let rating = normalizeRating(item.rating || item["评级"]);
  const visitDate = parseDate(item.visitDate || item["到访日期"]);
  const nextVisitDate = parseDate(item.nextVisitDate || item["预计下次到访时间"]);
  const note = valueText(item.note || item["客户情况"]);
  const followUp = normalizeFollowUp(item);
  if (followUp.todayArrived === "已认购") rating = "A";
  const effectiveNextVisitDate = followUp.nextVisitDate || nextVisitDate;
  const days = daysSince(visitDate);

  return {
    level: "二级",
    recordId: valueText(item.recordId) || makeId("level2"),
    name: valueText(item.name || item["客户姓名"]) || "未留名",
    phone: valueText(item.phone || item["联系方式"]),
    displayPhone: maskPhone(item.phone || item["联系方式"]),
    owner: owner || "未分配",
    sales: normalizeSalesAdvisor(item.sales || item["置业"]),
    module: groupByStaff(owner, sourceModule),
    rawModule: sourceModule,
    port: valueText(item.port || item["获客端口"]) || "未标注",
    rating,
    region: valueText(item.region || item["区域"]),
    area: valueText(item.area || item["面积"]),
    visitType: valueText(item.visitType || item["新/复访"]) || "未标注",
    visitDate,
    nextVisitDate,
    expectedVisitDate: effectiveNextVisitDate,
    daysSinceVisit: days,
    isClosed: rating === "A",
    isEffective: ["A", "C"].includes(rating),
    isHighIntent: rating === "C",
    isHouseTicket: /房票|拆迁/.test(`${note}${valueText(item.port || item["获客端口"])}`),
    note,
    followUp,
  };
}

function normalizeLevel1(item) {
  const owner = normalizeStaff(item.owner || item["系统归属"]);
  const sourceModule = valueText(item.rawModule || item.module || item["模块"]);
  const acquiredAt = parseDate(item.acquiredAt || item["获客日期"]);
  const plannedVisit = parseDate(item.plannedVisit || item["预计来访时间"]);
  const followUp = normalizeFollowUp(item);
  const followResult = followUp.todayArrived;
  const expectedVisitDate = followResult === "未到访" ? followUp.nextVisitDate : followUp.nextVisitDate || plannedVisit;
  const manualVisited =
    item.manualVisited !== undefined
      ? valueText(item.manualVisited) === "是" || item.manualVisited === true
      : valueText(item.visited ?? item["是否来访"]) === "是" || (item.visited === true && !item.autoTransferred);
  const autoTransferred = item.autoTransferred === true;
  const visited = manualVisited || autoTransferred || followResult === "已到访";
  const sold = valueText(item.sold ?? item["是否成交"]) === "是" || item.sold === true || followUp.todayArrived === "已认购";
  const note = valueText(item.note || item["客户情况"]);
  const port = valueText(item.port || item["获客端口"]) || "未标注";
  const rating = sold ? "A" : visited ? "已转访" : followResult === "确认到访" ? "确认到访" : followResult === "未到访" ? "未到访" : "未转访";

  return {
    level: "一级",
    recordId: valueText(item.recordId) || makeId("level1"),
    name: valueText(item.name || item["客户姓名"]) || "未留名",
    phone: valueText(item.phone || item["联系方式"]),
    displayPhone: maskPhone(item.phone || item["联系方式"]),
    owner: owner || "未分配",
    sales: "",
    module: groupByStaff(owner, sourceModule),
    rawModule: sourceModule,
    port,
    rating,
    acquiredAt,
    plannedVisit,
    expectedVisitDate,
    daysSinceAcquire: daysSince(acquiredAt),
    manualVisited,
    autoTransferred,
    autoTransferMatchedAt: valueText(item.autoTransferMatchedAt),
    visited,
    sold,
    isHouseTicket: /房票|拆迁/.test(`${note}${port}`),
    note,
    followUp,
  };
}

function splitRows(text) {
  return valueText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const normalized = line.replace(/\\t/g, "\t");
      return normalized.includes("\t") ? normalized.split("\t") : normalized.split(",");
    });
}

function hasHeader(row, level) {
  const joined = row.join("|").replace(/[\s"'“”]/g, "");
  const headers = level === "level2" ? LEVEL2_HEADERS : LEVEL1_HEADERS;
  return headers.filter((name) => joined.includes(name.replace(/[\s"'“”]/g, ""))).length >= 2;
}

function parseImport(text, level) {
  const rows = splitRows(text);
  if (!rows.length) return [];
  const headerRow = hasHeader(rows[0], level) ? rows.shift().map((cell) => cell.trim()) : null;
  const headers = headerRow || (level === "level2" ? LEVEL2_HEADERS : LEVEL1_HEADERS);

  return rows.map((row) => {
    const raw = headers.reduce((acc, header, index) => {
      acc[header] = valueText(row[index]);
      return acc;
    }, {});
    return level === "level2" ? normalizeLevel2(raw) : normalizeLevel1(raw);
  });
}

function mergeRecords(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.recordId, item]));
  const byKey = new Map(existing.map((item) => [recordKey(item), item]));
  let inserted = 0;
  let updated = 0;

  incoming.forEach((item) => {
    const old = byId.get(item.recordId) || byKey.get(recordKey(item));
    if (old) {
      const merged = {
        ...old,
        ...item,
        recordId: old.recordId,
        followUp: item.followUp?.updatedAt ? item.followUp : old.followUp || item.followUp,
      };
      byId.set(old.recordId, merged);
      updated += 1;
    } else {
      byId.set(item.recordId, item);
      inserted += 1;
    }
  });

  return { records: [...byId.values()], inserted, updated };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "未标注";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function topEntries(map, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

function percent(numerator, denominator) {
  if (!denominator) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function basisDate(item) {
  return item.level === "二级" ? item.visitDate : item.acquiredAt || item.plannedVisit;
}

function inDateScope(item, params) {
  const scope = params.get("dateScope") || "month";
  const date = basisDate(item);
  if (!date || scope === "all") return scope === "all" || false;
  if (scope === "month") return date.slice(0, 7) === (params.get("month") || todayText().slice(0, 7));
  if (scope === "year") return date.slice(0, 4) === (params.get("year") || todayText().slice(0, 4));
  return true;
}

function dueRangeMeta(params) {
  const range = params.get("dueRange") || "tomorrow";
  const today = todayText();
  if (range === "today") return { key: range, label: "预计今日到访", start: today, end: today };
  if (range === "week") {
    const week = weekRange(today);
    return { key: range, label: "预计本周到访", start: week.start, end: week.end };
  }
  if (range === "all") return { key: range, label: "全部已锚定到访", start: "", end: "" };
  const tomorrow = addDays(today, 1);
  return { key: "tomorrow", label: "预计明日到访", start: tomorrow, end: tomorrow };
}

function isDueInRange(item, meta) {
  if (item.isClosed || item.sold || item.rating === "A" || item.followUp?.todayArrived === "已认购") return false;
  const date = parseDate(item.expectedVisitDate);
  if (!date) return false;
  if (meta.key === "all") return true;
  return date >= meta.start && date <= meta.end;
}

function riskForLevel2(item) {
  if (item.isClosed || item.rating === "A" || item.followUp?.todayArrived === "已认购") return "";
  if (item.followUp?.todayArrived === "未到访") return "已标记未到访，需二次锚定";
  if (item.isHighIntent && !item.expectedVisitDate) return "C级客户未锚定下次到访";
  if (item.daysSinceVisit !== null && item.daysSinceVisit >= 14 && !item.expectedVisitDate) return "超14天未复访计划";
  if (item.isHouseTicket) return "房票储备客户";
  return "";
}

function riskForLevel1(item) {
  if (item.sold || item.visited || item.rating === "A" || item.followUp?.todayArrived === "已认购") return "";
  if (item.followUp?.todayArrived === "未到访" && !item.expectedVisitDate) return "未到访待二次约访";
  if (!item.visited && item.daysSinceAcquire !== null && item.daysSinceAcquire >= 7 && !item.expectedVisitDate) {
    return "首录超7天未锚定到访";
  }
  if (!item.visited && item.followUp?.todayArrived !== "确认到访" && item.expectedVisitDate === todayText()) return "今日预计到访待确认";
  return "";
}

function customerBlockers(item) {
  const text = [item.note, item.followUp?.latestSituation, item.port, item.rawModule]
    .filter(Boolean)
    .join(" ");
  const rules = [
    ["价格", /价格|单价|总价|太贵|贵了|预算|首付|月供|折扣|优惠|便宜|付款|贷|按揭/],
    ["房源", /房源|楼层|户型|面积|朝向|采光|楼栋|房号|商铺|铺|位置|面宽|进深|107|128|143/],
    ["决策人", /决策|老婆|老公|夫妻|家人|父母|妈妈|爸爸|儿子|女儿|领导|合伙|股东|商量/],
    ["距离", /距离|太远|远了|通勤|交通|上班|学校|学区|配套|周边|附近/],
    ["观望", /观望|考虑|再看|对比|竞品|绿城|保利|万科|滨江|暂时|不急|等等|等一等|以后|后面|有时间/],
  ];
  const blockers = rules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  if (item.isHouseTicket && !blockers.includes("价格")) blockers.push("价格");
  return blockers.length ? blockers : ["待补充"];
}

function withRisk(item) {
  const risk = item.level === "二级" ? riskForLevel2(item) : riskForLevel1(item);
  return { ...item, risk, blockers: customerBlockers(item) };
}

function level1Stage(item) {
  if (item.sold || item.visited || item.rating === "A" || item.followUp?.todayArrived === "已认购") return "converted";
  if (item.followUp?.todayArrived === "未到访" && !item.expectedVisitDate) return "revisit";
  if (item.followUp?.todayArrived === "确认到访") return "confirmed";
  if (item.expectedVisitDate) return "pendingConfirm";
  return "unpinned";
}

function buildLevel1Workflow(items) {
  const stages = [
    ["unpinned", "待锚定"],
    ["pendingConfirm", "待确认"],
    ["confirmed", "确认到访"],
    ["revisit", "未到访二约"],
    ["converted", "已转访"],
  ];
  return stages.map(([key, label]) => {
    const list = items.filter((item) => level1Stage(item) === key);
    return {
      key,
      label,
      count: list.length,
      customers: list
        .sort((a, b) => (a.expectedVisitDate || "9999-99-99").localeCompare(b.expectedVisitDate || "9999-99-99") || a.owner.localeCompare(b.owner, "zh-CN"))
        .slice(0, 8),
    };
  });
}

function buildModuleCards(items) {
  const total = items.length || 1;
  return ["销冠特工", "花开富贵", "乘风破局", "KA"].map((name) => {
    const list = items.filter((item) => item.module === name);
    const converted = list.filter((item) => item.level === "一级" && level1Stage(item) === "converted").length;
    return {
      name,
      value: list.length,
      visits: list.filter((item) => item.level === "二级" || item.visited).length,
      effective: list.filter((item) => item.isEffective || item.rating === "C" || item.rating === "A").length,
      closed: list.filter((item) => item.isClosed || item.sold || item.rating === "A").length,
      converted,
      unconverted: list.filter((item) => item.level === "一级").length - converted,
      share: percent(list.length, total),
      cLevel: list.filter((item) => item.rating === "C").length,
      due: list.filter((item) => item.expectedVisitDate).length,
    };
  });
}

function buildOwnerCards(items) {
  const counts = topEntries(countBy(items, "owner"), 200);
  const values = counts.map((item) => item.value);
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return counts.map((item) => ({
    ...item,
    status: item.value <= Math.max(2, Math.floor(avg * 0.55)) ? "重点观察" : item.value >= avg * 1.35 ? "高活跃" : "稳定",
  }));
}

function buildOwnerInsights(level1, level2) {
  const ownerNames = [...new Set([...level1, ...level2].map((item) => item.owner).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  const totalValues = ownerNames.map(
    (owner) => level1.filter((item) => item.owner === owner).length + level2.filter((item) => item.owner === owner).length,
  );
  const avg = totalValues.length ? totalValues.reduce((sum, value) => sum + value, 0) / totalValues.length : 0;

  return ownerNames
    .map((owner) => {
      const l1 = level1.filter((item) => item.owner === owner);
      const l2 = level2.filter((item) => item.owner === owner);
      const all = [...l1, ...l2];
      const module = all[0]?.module || groupByStaff(owner);
      const cLevel = l2.filter((item) => item.rating === "C").length;
      const pinned = all.filter((item) => item.expectedVisitDate).length;
      const total = all.length;
      const closed = l2.filter((item) => item.rating === "A").length + l1.filter((item) => item.sold).length;
      const visits = l2.length + l1.filter((item) => item.visited).length;
      const effective = l2.filter((item) => item.isEffective).length + l1.filter((item) => item.sold).length;
      const tags = [];
      if (total <= Math.max(2, Math.floor(avg * 0.55))) tags.push("低活跃");
      if (l1.length >= 3 && l2.length === 0) tags.push("一转二低");
      if (cLevel > 0 && pinned < cLevel) tags.push("C级待锚定");
      if (pinned === 0 && total > 0) tags.push("跟进不足");
      if (!tags.length) tags.push(total >= avg * 1.35 ? "高活跃" : "稳定");
      return {
        name: owner,
        value: total,
        level1: l1.length,
        level2: l2.length,
        cLevel,
        pinned,
        closed,
        visits,
        effective,
        module,
        tags,
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN"));
}

function buildLevelSummary(level, items) {
  const withRisks = items.map(withRisk);
  if (level === "level2") {
    const effective = items.filter((item) => item.isEffective);
    const cLevel = items.filter((item) => item.rating === "C");
    const closed = items.filter((item) => item.rating === "A");
    return {
      total: items.length,
      effective: effective.length,
      effectiveRate: percent(effective.length, items.length),
      closed: closed.length,
      cLevel: cLevel.length,
      lowIntent: items.filter((item) => item.rating === "D").length,
      houseTicket: items.filter((item) => item.isHouseTicket).length,
      duePinned: items.filter((item) => item.expectedVisitDate).length,
      riskCount: withRisks.filter((item) => item.risk).length,
      rating: topEntries(countBy(items, "rating")),
      module: buildModuleCards(items),
      owner: buildOwnerCards(items),
      cCustomers: withRisks,
    };
  }
  const unpinned = items.filter((item) => level1Stage(item) === "unpinned");
  const pendingConfirm = items.filter((item) => level1Stage(item) === "pendingConfirm");
  const confirmed = items.filter((item) => level1Stage(item) === "confirmed");
  const revisit = items.filter((item) => level1Stage(item) === "revisit");
  const converted = items.filter((item) => level1Stage(item) === "converted");
  return {
    total: items.length,
    notVisited: items.filter((item) => !item.visited && !item.sold).length,
    unpinned: unpinned.length,
    pendingConfirm: pendingConfirm.length,
    confirmed: confirmed.length,
    revisit: revisit.length,
    converted: converted.length,
    visited: converted.length,
    visitRate: percent(converted.length, items.length),
    sold: items.filter((item) => item.sold).length,
    duePinned: items.filter((item) => item.expectedVisitDate).length,
    riskCount: withRisks.filter((item) => item.risk).length,
    module: buildModuleCards(items),
    owner: buildOwnerCards(items),
    workflow: buildLevel1Workflow(withRisks),
  };
}

function filterRecords(items, params) {
  return items
    .map(withRisk)
    .filter((item) => {
      const owner = params.get("owner") || "";
      const rating = params.get("rating") || "";
      const moduleName = params.get("module") || "";
      const purchase = params.get("purchase") || "";
      const sales = params.get("sales") || "";
      const keyword = (params.get("keyword") || "").trim().toLowerCase();
      const onlyRisk = params.get("risk") === "1";
      const dueOnly = params.get("dueOnly") === "1";
      const stage = params.get("stage") || "";

      if (!inDateScope(item, params)) return false;
      if (owner && item.owner !== owner) return false;
      if (rating && item.rating !== rating) return false;
      if (moduleName && item.module !== moduleName) return false;
      if (purchase === "ticket" && !item.isHouseTicket) return false;
      if (purchase === "cash" && item.isHouseTicket) return false;
      if (sales && item.sales !== sales) return false;
      if (onlyRisk && !item.risk) return false;
      if (dueOnly && !item.expectedVisitDate) return false;
      if (stage && item.level === "一级" && level1Stage(item) !== stage) return false;
      if (keyword) {
        const haystack = [
          item.recordId,
          item.name,
          item.phone,
          item.owner,
          item.sales,
          item.module,
          item.rawModule,
          item.port,
          item.rating,
          item.region,
          item.area,
          item.note,
          item.risk,
          item.blockers?.join(" "),
          item.followUp?.latestSituation,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
}

function optionsFor(items) {
  const unique = (key) =>
    [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const sales = SALES_ADVISORS.concat(items.some((item) => item.sales === "无") ? ["无"] : []);
  return {
    owners: unique("owner"),
    ratings: unique("rating"),
    modules: ["乘风破局", "花开富贵", "销冠特工", "KA"],
    sales,
  };
}

function filterByDateScope(items, params) {
  return items.filter((item) => inDateScope(item, params));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rawPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : ext === ".png"
            ? "image/png"
            : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/auth/status") {
      return sendJson(res, 200, { ok: true, ...authStatus(req) });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      if (!PASSWORD_AUTH_ENABLED) return sendJson(res, 400, { ok: false, message: "未配置团队访问密码" });
      if (!verifyPassword(body.password)) return sendJson(res, 403, { ok: false, message: "密码不正确" });
      setSession(res, { authType: "password", name: "共享账号" });
      return sendJson(res, 200, { ok: true, authenticated: true });
    }

    if (url.pathname === "/api/feishu-login" && req.method === "POST") {
      if (!FEISHU_AUTH_ENABLED) return sendJson(res, 400, { ok: false, message: "未配置飞书免登参数" });
      const body = await readBody(req);
      const code = valueText(body.code);
      if (!code) return sendJson(res, 400, { ok: false, message: "缺少飞书免登授权码" });
      const user = await exchangeFeishuUser(code);
      setSession(res, user);
      return sendJson(res, 200, { ok: true, authenticated: true, user });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      clearSession(req, res);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        mode: DATABASE_URL ? "postgres-manual" : "local-manual",
        source: DATABASE_URL ? "云端手动台账" : "本机手动台账",
        auth: AUTH_MODE,
      });
    }

    if (url.pathname.startsWith("/api/") && !isAuthenticated(req)) return unauthorized(res);

    if (url.pathname === "/api/summary") {
      const store = await loadStore();
      const level1All = store.level1.map(withRisk);
      const level2All = store.level2.map(withRisk);
      const level1 = filterByDateScope(level1All, url.searchParams);
      const level2 = filterByDateScope(level2All, url.searchParams);
      const dueMeta = dueRangeMeta(url.searchParams);
      const level1PendingTransferCustomers = level1All
        .map(withRisk)
        .filter((item) => level1Stage(item) === "pendingConfirm")
        .sort((a, b) => (a.expectedVisitDate || "9999-99-99").localeCompare(b.expectedVisitDate || "9999-99-99") || a.owner.localeCompare(b.owner, "zh-CN"));
      const level1ConfirmedTransferCustomers = level1All
        .map(withRisk)
        .filter((item) => item.expectedVisitDate && level1Stage(item) !== "converted")
        .sort((a, b) => (a.expectedVisitDate || "9999-99-99").localeCompare(b.expectedVisitDate || "9999-99-99") || a.owner.localeCompare(b.owner, "zh-CN"));
      const dueCustomers = [...level1All, ...level2All]
        .map(withRisk)
        .filter((item) => isDueInRange(item, dueMeta))
        .sort((a, b) => a.expectedVisitDate.localeCompare(b.expectedVisitDate) || a.owner.localeCompare(b.owner, "zh-CN"));

      return sendJson(res, 200, {
        ok: true,
        updatedAt: store.updatedAt,
        today: todayText(),
        dateScope: {
          scope: url.searchParams.get("dateScope") || "month",
          month: url.searchParams.get("month") || todayText().slice(0, 7),
          year: url.searchParams.get("year") || todayText().slice(0, 4),
        },
        dueMeta,
        summary: {
          level1: buildLevelSummary("level1", level1),
          level2: buildLevelSummary("level2", level2),
          level1PendingTransferCustomers,
          level1ConfirmedTransferCustomers,
          dueCustomers,
          ownerInsights: buildOwnerInsights(level1, level2),
        },
        options: {
          level1: optionsFor(level1All),
          level2: optionsFor(level2All),
        },
      });
    }

    if (url.pathname === "/api/customers") {
      const level = url.searchParams.get("level") === "level1" ? "level1" : "level2";
      const store = await loadStore();
      const items = filterRecords(store[level], url.searchParams);
      return sendJson(res, 200, { ok: true, level, total: items.length, data: items.slice(0, 800) });
    }

    if (url.pathname === "/api/import" && req.method === "POST") {
      const body = await readBody(req);
      const level = body.level === "level1" ? "level1" : "level2";
      const incoming = parseImport(body.text || "", level);
      const store = await loadStore();
      const merged = mergeRecords(store[level], incoming);
      store[level] = merged.records.map(level === "level1" ? normalizeLevel1 : normalizeLevel2);
      reconcileLevel1Transfers(store);
      store.importBatches = [
        ...(store.importBatches || []),
        {
          id: makeId("batch"),
          level,
          inserted: merged.inserted,
          updated: merged.updated,
          total: store[level].length,
        actor: sessionActor(req),
        createdAt: new Date().toISOString(),
      },
    ].slice(-300);
      appendAudit(store, "import", { level, inserted: merged.inserted, updated: merged.updated, total: store[level].length }, sessionActor(req));
      const saved = await saveStore(store);
      return sendJson(res, 200, {
        ok: true,
        level,
        inserted: merged.inserted,
        updated: merged.updated,
        total: store[level].length,
        updatedAt: saved.updatedAt,
      });
    }

    const followMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/followup$/);
    if (followMatch && req.method === "POST") {
      const recordId = decodeURIComponent(followMatch[1]);
      const body = await readBody(req);
      const store = await loadStore();
      const levelKey = store.level1.some((item) => item.recordId === recordId) ? "level1" : "level2";
      const list = store[levelKey];
      const index = list.findIndex((item) => item.recordId === recordId);
      if (index < 0) return sendJson(res, 404, { ok: false, message: "客户不存在" });
      list[index].followUp = {
        todayArrived: valueText(body.todayArrived),
        latestSituation: valueText(body.latestSituation),
        nextVisitDate: parseDate(body.nextVisitDate),
        updatedAt: new Date().toISOString(),
      };
      list[index] = levelKey === "level1" ? normalizeLevel1(list[index]) : normalizeLevel2(list[index]);
      appendAudit(store, "followup", { level: levelKey, recordId, name: list[index].name, result: list[index].followUp.todayArrived }, sessionActor(req));
      await saveStore(store);
      return sendJson(res, 200, { ok: true, data: withRisk(list[index]) });
    }

    const deleteMatch = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (deleteMatch && req.method === "DELETE") {
      const recordId = decodeURIComponent(deleteMatch[1]);
      const store = await loadStore();
      const levelKey = store.level1.some((item) => item.recordId === recordId) ? "level1" : "level2";
      const list = store[levelKey];
      const index = list.findIndex((item) => item.recordId === recordId);
      if (index < 0) return sendJson(res, 404, { ok: false, message: "客户不存在" });
      const [removed] = list.splice(index, 1);
      appendAudit(store, "delete", { level: levelKey, recordId, name: removed.name, owner: removed.owner }, sessionActor(req));
      const saved = await saveStore(store);
      return sendJson(res, 200, {
        ok: true,
        level: levelKey,
        removed: { recordId, name: removed.name, owner: removed.owner },
        total: list.length,
        updatedAt: saved.updatedAt,
      });
    }

    if (url.pathname === "/api/backup" && req.method === "POST") {
      const backup = await createBackup("api");
      return sendJson(res, 200, { ok: true, backup });
    }

    if (url.pathname === "/api/restore" && req.method === "POST") {
      const body = await readBody(req);
      const incoming = body.store || body;
      if (!Array.isArray(incoming.level1) || !Array.isArray(incoming.level2)) {
        return sendJson(res, 400, { ok: false, message: "备份文件格式不正确，缺少一级或二级客户数据" });
      }
      const beforeBackup = await createBackup("before-restore");
      const restored = normalizeStore({
        ...incoming,
        source: DATABASE_URL ? "postgres-manual" : "local-manual",
      });
      appendAudit(restored, "restore", { level1: restored.level1.length, level2: restored.level2.length, beforeBackup }, sessionActor(req));
      const saved = await saveStore(restored);
      return sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
        backup: beforeBackup,
        totals: {
          level1: saved.level1.length,
          level2: saved.level2.length,
        },
      });
    }

    if (AUTH_ENABLED && !isAuthenticated(req)) {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        req.url = "/login.html";
        return serveStatic(req, res);
      }
      if (!url.pathname.startsWith("/assets/") && !["/styles.css", "/login.html", "/login.js"].includes(url.pathname)) {
        res.writeHead(302, { Location: "/login.html" });
        return res.end();
      }
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      message: error.message,
      hint: "当前版本读取本机手动台账，不读取或修改飞书原表。",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`云创客户跟进 App 已启动：http://${HOST}:${PORT}`);
  console.log(`数据模式：${DATABASE_URL ? "PostgreSQL 云端手动台账" : "本机手动台账"}；飞书原表：不读取、不修改。`);
  console.log(`访问控制：${AUTH_ENABLED ? "统一密码登录" : "未启用，本机开发模式"}`);
});

let lastBackupDate = "";
setInterval(() => {
  const now = new Date();
  const date = formatDate(now);
  if (now.getHours() !== 23 || lastBackupDate === date) return;
  lastBackupDate = date;
  createBackup("daily").catch((error) => console.error(`自动备份失败：${error.message}`));
}, 30 * 60 * 1000);

