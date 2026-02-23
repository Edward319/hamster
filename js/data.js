/**
 * 数据层：货物 CRUD、品类、临期按条 remindBeforeDays、同 SKU+到期日合并、
 * 用完了按数量扣减、按 SKU 分组展示
 */

const STORAGE_ITEMS = "vibecoding_items";
const STORAGE_CATEGORIES = "vibecoding_categories";
const STORAGE_SETTINGS = "vibecoding_settings";
const DEFAULT_REMIND_DAYS = 30;

/** 读取所有货物（Notion 同步开启时从内存缓存读，否则从 localStorage；兼容旧数据） */
function getAllItems() {
  if (isNotionSyncEnabled()) {
    return getNotionCache().slice();
  }
  try {
    const raw = localStorage.getItem(STORAGE_ITEMS);
    const items = raw ? JSON.parse(raw) : [];
    return items.map((i) => ({
      ...i,
      remindBeforeDays: typeof i.remindBeforeDays === "number" ? i.remindBeforeDays : DEFAULT_REMIND_DAYS,
    }));
  } catch {
    return [];
  }
}

/** 写入所有货物（不自动补全，由调用方保证结构） */
function saveAllItems(items) {
  localStorage.setItem(STORAGE_ITEMS, JSON.stringify(items));
}

/** 读取品类结构 */
function getCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_CATEGORIES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCategory(category1, category2) {
  const cat = getCategories();
  if (!cat[category1]) cat[category1] = [];
  if (category2 && !cat[category1].includes(category2)) cat[category1].push(category2);
  localStorage.setItem(STORAGE_CATEGORIES, JSON.stringify(cat));
}

function nextId() {
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

/** 归一化一条记录（含 remindBeforeDays、usedUpAt；保留 notionPageId 供同步用） */
function normalizeRecord(item) {
  const status = item.status === "used_up" ? "used_up" : "in_stock";
  const usedUpAt =
    status === "used_up"
      ? (item.usedUpAt || new Date().toISOString().slice(0, 10))
      : undefined;
  const out = {
    id: item.id || nextId(),
    name: String(item.name).trim(),
    category1: String(item.category1).trim(),
    category2: String(item.category2).trim(),
    brand: String(item.brand).trim(),
    quantity: Number(item.quantity) || 0,
    purchaseDate: String(item.purchaseDate || ""),
    expiryDate: String(item.expiryDate || ""),
    unitPrice: Number(item.unitPrice) || 0,
    note: String(item.note || "").trim(),
    status,
    remindBeforeDays: typeof item.remindBeforeDays === "number" ? item.remindBeforeDays : DEFAULT_REMIND_DAYS,
    usedUpAt,
  };
  if (item.notionPageId) out.notionPageId = item.notionPageId;
  return out;
}

/**
 * 底层合并：同一 SKU + 到期日 + 同一状态 才合并（在库与已使用完分开，不混在一起）
 */
function mergeIdenticalItems() {
  const items = getAllItems();
  const map = new Map();
  items.forEach((i) => {
    const status = i.status === "used_up" ? "used_up" : "in_stock";
    const key = [i.name, i.category1, i.category2, i.brand, i.expiryDate, status].join("\n");
    if (!map.has(key)) {
      map.set(key, { ...i, quantity: 0, usedUpAt: undefined });
    }
    const m = map.get(key);
    m.quantity += Number(i.quantity) || 0;
    if (status === "used_up" && i.usedUpAt) {
      m.usedUpAt = !m.usedUpAt || i.usedUpAt > m.usedUpAt ? i.usedUpAt : m.usedUpAt;
    } else if (status === "used_up") {
      m.usedUpAt = m.usedUpAt || new Date().toISOString().slice(0, 10);
    }
  });
  const result = Array.from(map.values()).map((m) => ({
    ...m,
    quantity: m.quantity,
    usedUpAt: m.status === "used_up" ? (m.usedUpAt || new Date().toISOString().slice(0, 10)) : undefined,
  }));
  saveAllItems(result);
  return result;
}

/**
 * 新增或更新一条货物（Notion 同步时写 Notion 并更新缓存，否则写 localStorage 并合并）
 */
async function saveItemAsync(item) {
  const record = normalizeRecord({
    ...item,
    id: item.id,
    status: item.status,
    remindBeforeDays: item.remindBeforeDays,
  });
  saveCategory(record.category1, record.category2);

  if (isNotionSyncEnabled() && typeof createNotionPage !== "undefined" && typeof updateNotionPage !== "undefined") {
    const s = getSettings();
    const cache = getNotionCache();
    const idx = cache.findIndex((i) => i.id === record.id || (i.notionPageId && i.notionPageId === record.notionPageId));
    try {
      if (record.notionPageId && idx >= 0) {
        await updateNotionPage(s.notionToken, record.notionPageId, record);
        const out = { ...record, notionPageId: record.notionPageId };
        cache[idx] = out;
        setNotionCache(cache);
        return out;
      }
      const pageId = await createNotionPage(s.notionToken, s.notionDatabaseId, record);
      const newRecord = { ...record, id: record.id || pageId, notionPageId: pageId };
      if (idx >= 0) cache[idx] = newRecord;
      else cache.push(newRecord);
      setNotionCache(cache);
      return newRecord;
    } catch (e) {
      throw e;
    }
  }

  let items = getAllItems();
  const i = items.findIndex((x) => x.id === record.id);
  if (i >= 0) items[i] = record;
  else items.push(record);
  saveAllItems(items);
  mergeIdenticalItems();
  return record;
}

function saveItem(item) {
  return saveItemAsync(item);
}

async function deleteItemAsync(id) {
  if (isNotionSyncEnabled() && typeof archiveNotionPage !== "undefined") {
    const s = getSettings();
    const cache = getNotionCache();
    const one = cache.find((i) => i.id === id || i.notionPageId === id);
    if (one && one.notionPageId) {
      await archiveNotionPage(s.notionToken, one.notionPageId);
      setNotionCache(cache.filter((i) => i.id !== id && i.notionPageId !== id));
      return;
    }
  }
  const items = getAllItems().filter((i) => i.id !== id);
  saveAllItems(items);
}

function deleteItem(id) {
  return deleteItemAsync(id);
}

/**
 * 用完了：更新原条在库数量，并新建一条「已使用完」记录（Notion 同步时写 Notion 并更新缓存）
 */
async function useQuantityAsync(id, usedQuantity) {
  const items = getAllItems();
  const one = items.find((i) => i.id === id);
  if (!one || one.status !== "in_stock") return null;
  const used = Math.min(Math.max(0, Number(usedQuantity)), one.quantity);
  if (used <= 0) return one;

  const today = new Date().toISOString().slice(0, 10);
  const updated = { ...one, quantity: one.quantity - used };
  if (updated.quantity <= 0) {
    updated.quantity = 0;
    updated.status = "used_up";
    updated.usedUpAt = today;
  }
  const newRecord = {
    id: nextId(),
    name: one.name,
    category1: one.category1,
    category2: one.category2,
    brand: one.brand,
    quantity: used,
    purchaseDate: one.purchaseDate,
    expiryDate: one.expiryDate,
    unitPrice: one.unitPrice,
    note: one.note,
    status: "used_up",
    usedUpAt: today,
    remindBeforeDays: one.remindBeforeDays,
  };

  if (isNotionSyncEnabled() && typeof updateNotionPage !== "undefined" && typeof createNotionPage !== "undefined") {
    const s = getSettings();
    const cache = getNotionCache().slice();
    const idx = cache.findIndex((i) => i.id === id || i.notionPageId === id);
    if (idx >= 0) {
      await updateNotionPage(s.notionToken, cache[idx].notionPageId, updated);
      cache[idx] = { ...updated, id: cache[idx].id, notionPageId: cache[idx].notionPageId };
    }
    const pageId = await createNotionPage(s.notionToken, s.notionDatabaseId, newRecord);
    cache.push({ ...newRecord, notionPageId: pageId });
    setNotionCache(cache);
    return updated;
  }

  one.quantity -= used;
  if (one.quantity <= 0) {
    one.quantity = 0;
    one.status = "used_up";
    one.usedUpAt = today;
  }
  items.push(newRecord);
  saveAllItems(items);
  mergeIdenticalItems();
  return one;
}

function useQuantity(id, usedQuantity) {
  return useQuantityAsync(id, usedQuantity);
}

/** 按用户设置删除「已用完」且超过指定周数的数据（仅本地保存且已开启该选项时执行） */
function purgeUsedUpOlderThanTwoMonths() {
  if (isNotionSyncEnabled()) return 0;
  const s = getSettings();
  if (!s.purgeUsedUpEnabled) return 0;
  const weeks = s.purgeUsedUpWeeks || 8;
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  const cutoffStr = d.toISOString().slice(0, 10);
  const items = getAllItems();
  const kept = items.filter((i) => {
    if (i.status !== "used_up") return true;
    if (!i.usedUpAt) return true;
    return String(i.usedUpAt).slice(0, 10) > cutoffStr;
  });
  if (kept.length !== items.length) {
    saveAllItems(kept);
  }
  return items.length - kept.length;
}

/** 按状态筛选 */
function getItemsInStock() {
  return getAllItems().filter((i) => i.status === "in_stock");
}
function getItemsUsedUp() {
  return getAllItems().filter((i) => i.status === "used_up");
}

/**
 * 今日提醒：临期按每条「提前多少天」计算（每条可不同，默认 30 天）
 */
function getExpiringItems() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getItemsInStock().filter((i) => {
    const expiry = new Date(i.expiryDate);
    expiry.setHours(0, 0, 0, 0);
    const daysLeft = Math.floor((expiry - today) / 86400000);
    const before = typeof i.remindBeforeDays === "number" ? i.remindBeforeDays : DEFAULT_REMIND_DAYS;
    return daysLeft >= 0 && daysLeft <= before;
  });
}

/** 未来 7 天内过期的在库货物（周报用） */
function getExpiringWithinWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 7);
  return getItemsInStock().filter((i) => {
    const d = new Date(i.expiryDate);
    d.setHours(0, 0, 0, 0);
    return d >= today && d <= end;
  });
}

function getWeeklySummary() {
  const expiring = getExpiringWithinWeek();
  const inStock = getItemsInStock();
  const usedUp = getItemsUsedUp();
  return {
    expiringCount: expiring.length,
    expiringItems: expiring,
    inStockCount: inStock.length,
    usedUpCount: usedUp.length,
  };
}

function getMonthlySummary() {
  const all = getAllItems();
  const inStock = all.filter((i) => i.status === "in_stock");
  const usedUp = all.filter((i) => i.status === "used_up");
  const now = new Date();
  const thisMonth = now.getFullYear() * 100 + (now.getMonth() + 1);
  const addedThisMonth = all.filter((i) => {
    const y = parseInt(i.purchaseDate.slice(0, 4), 10);
    const m = parseInt(i.purchaseDate.slice(5, 7), 10);
    return y * 100 + m === thisMonth;
  });
  const totalSpent = addedThisMonth.reduce((sum, i) => sum + (i.quantity * (i.unitPrice || 0)), 0);
  return {
    addedCount: addedThisMonth.length,
    inStockCount: inStock.length,
    usedUpCount: usedUp.length,
    totalSpent: Math.round(totalSpent * 100) / 100,
  };
}

/** SKU 键：物品+一级品类+二级品类+品牌 */
function skuKey(item) {
  return [item.name, item.category1, item.category2, item.brand].join("\n");
}

/**
 * 按 SKU 分组（展示用）：在库与已使用完分别统计，互不混合
 * - in_stock: 只统计并展示「在库」状态的行，同一 SKU 下只含 in_stock 行，总数量/到期范围仅按在库行计算
 * - used_up:  只统计并展示「已使用完」状态的行，同一 SKU 下只含 used_up 行，总数量/到期范围仅按已使用完行计算
 * 标记「用完了」后，该条从在库中扣除，只在已使用完表格中统计
 */
function getInventoryGroups(statusFilter) {
  const all = getAllItems();
  const isInStock = (r) => (r.status || "in_stock") === "in_stock";
  const isUsedUp = (r) => r.status === "used_up" || (Number(r.quantity) <= 0 && r.status !== "in_stock");

  const items =
    statusFilter === "in_stock"
      ? all.filter(isInStock)
      : statusFilter === "used_up"
        ? all.filter(isUsedUp)
        : all;

  const groups = new Map();
  items.forEach((i) => {
    const key = skuKey(i);
    if (!groups.has(key)) {
      groups.set(key, {
        name: i.name,
        category1: i.category1,
        category2: i.category2,
        brand: i.brand,
        rows: [],
      });
    }
    groups.get(key).rows.push(i);
  });

  return Array.from(groups.values()).map((g) => {
    const rows = g.rows.slice().sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const totalQty =
      statusFilter === "used_up"
        ? rows.reduce((s, r) => s + Math.abs(Number(r.quantity) || 0), 0)
        : rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const totalPrice = rows.reduce((s, r) => {
      const q = statusFilter === "used_up" ? Math.abs(Number(r.quantity) || 0) : (Number(r.quantity) || 0);
      return s + q * (Number(r.unitPrice) || 0);
    }, 0);
    const dates = rows.map((r) => r.expiryDate);
    const expiryMin = dates.length ? dates.reduce((a, b) => (a <= b ? a : b)) : "";
    const expiryMax = dates.length ? dates.reduce((a, b) => (a >= b ? a : b)) : "";
    return {
      ...g,
      totalQty,
      totalPrice: Math.round(totalPrice * 100) / 100,
      expiryMin,
      expiryMax,
      rows,
    };
  });
}

/** 单条总价：数量×单价 */
function rowTotalPrice(r, useAbsQty) {
  const q = useAbsQty ? Math.abs(Number(r.quantity) || 0) : (Number(r.quantity) || 0);
  return Math.round(q * (Number(r.unitPrice) || 0) * 100) / 100;
}

/**
 * 货单总结：过去 N 周（由设置 summaryWeeks 决定）按一级品类聚合（新录入、已使用）
 */
function getPastMonthStatsByCategory1() {
  const items = getAllItems();
  const now = new Date();
  const weeks = getSettings().summaryWeeks || 4;
  const start = new Date(now);
  start.setDate(start.getDate() - weeks * 7);
  const pastStr = start.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);
  const newByCat = new Map();
  const usedByCat = new Map();
  items.forEach((i) => {
    const c1 = i.category1 || "其他";
    const price = (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    if (i.purchaseDate && i.purchaseDate >= pastStr && i.purchaseDate <= todayStr) {
      if (!newByCat.has(c1)) newByCat.set(c1, { totalPrice: 0, items: [] });
      const g = newByCat.get(c1);
      g.totalPrice += price;
      g.items.push(i);
    }
    if (i.status === "used_up" && i.usedUpAt && i.usedUpAt >= pastStr) {
      if (!usedByCat.has(c1)) usedByCat.set(c1, { totalPrice: 0, items: [] });
      const g = usedByCat.get(c1);
      g.totalPrice += Math.abs(Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
      g.items.push(i);
    }
  });
  return {
    newEntries: Array.from(newByCat.entries()).map(([category1, v]) => ({
      category1,
      totalPrice: Math.round(v.totalPrice * 100) / 100,
      items: v.items,
    })),
    used: Array.from(usedByCat.entries()).map(([category1, v]) => ({
      category1,
      totalPrice: Math.round(v.totalPrice * 100) / 100,
      items: v.items,
    })),
  };
}

/** 双周报：未来一个月到期，按一级品类聚合 */
function getFutureMonthExpiringByCategory1() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 30);
  const inStock = getItemsInStock();
  const expiring = inStock.filter((i) => {
    const d = new Date(i.expiryDate);
    d.setHours(0, 0, 0, 0);
    return d >= today && d <= end;
  });
  const byCat = new Map();
  expiring.forEach((i) => {
    const c1 = i.category1 || "其他";
    if (!byCat.has(c1)) byCat.set(c1, { totalPrice: 0, items: [] });
    const g = byCat.get(c1);
    g.totalPrice += (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    g.items.push(i);
  });
  return Array.from(byCat.entries()).map(([category1, v]) => ({
    category1,
    totalPrice: Math.round(v.totalPrice * 100) / 100,
    items: v.items,
  }));
}

/** 设置：提醒周期(天)、通知邮箱、进货总结周数、Notion 同步、本地自动清理已用完 */
function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    const o = raw ? JSON.parse(raw) : {};
    const summaryWeeks = parseInt(o.summaryWeeks, 10);
    const purgeWeeks = parseInt(o.purgeUsedUpWeeks, 10);
    return {
      remindCycleDays: typeof o.remindCycleDays === "number" ? o.remindCycleDays : 7,
      notifyEmail: String(o.notifyEmail || "").trim(),
      summaryWeeks: (summaryWeeks >= 1 && summaryWeeks <= 52) ? summaryWeeks : 4,
      notionSync: !!o.notionSync,
      notionToken: String(o.notionToken || "").trim(),
      notionDatabaseId: String(o.notionDatabaseId || "").trim(),
      purgeUsedUpEnabled: o.purgeUsedUpEnabled !== false,
      purgeUsedUpWeeks: (purgeWeeks >= 1 && purgeWeeks <= 52) ? purgeWeeks : 8,
      autoReportEnabled: !!o.autoReportEnabled,
    };
  } catch {
    return { remindCycleDays: 7, notifyEmail: "", summaryWeeks: 4, notionSync: false, notionToken: "", notionDatabaseId: "", purgeUsedUpEnabled: true, purgeUsedUpWeeks: 8, autoReportEnabled: false };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
}

/** Notion 同步开启时使用的内存缓存（数据仅存用户 Notion，此处仅当次会话缓存） */
let notionCache = [];
let notionCacheReady = false;

function isNotionSyncEnabled() {
  const s = getSettings();
  return !!(s.notionSync && s.notionToken && s.notionDatabaseId);
}

function getNotionCache() {
  return notionCache;
}

function setNotionCache(items) {
  notionCache = items || [];
  notionCacheReady = true;
}

function clearNotionCache() {
  notionCache = [];
  notionCacheReady = false;
}

/** 是否已加载过 Notion 缓存（用于显示加载中） */
function isNotionCacheLoaded() {
  return notionCacheReady;
}

/**
 * 从用户 Notion 拉取数据并写入缓存（仅当次请求经服务器代理，代理不存储）
 */
async function loadNotionCache() {
  const s = getSettings();
  if (!s.notionSync || !s.notionToken || !s.notionDatabaseId) {
    setNotionCache([]);
    return;
  }
  if (typeof fetchAllFromNotion !== "function") {
    setNotionCache([]);
    return;
  }
  try {
    const items = await fetchAllFromNotion(s.notionToken, s.notionDatabaseId);
    setNotionCache(items);
  } catch {
    setNotionCache([]);
    throw new Error("拉取 Notion 数据失败，请检查集成与数据库 ID");
  }
}

/**
 * 从已有复制：按 SKU 合并，仅在有 keyword 时返回模糊匹配结果；无 keyword 返回空（用于下拉仅搜索时展示）
 */
function getItemsForCopy(keyword) {
  const k = keyword != null ? String(keyword).trim() : "";
  if (!k) return [];
  const items = getAllItems();
  const bySku = new Map();
  items.forEach((i) => {
    const key = skuKey(i);
    if (!bySku.has(key)) bySku.set(key, i);
  });
  const list = Array.from(bySku.values());
  const lower = k.toLowerCase();
  return list.filter(
    (i) =>
      i.name.toLowerCase().includes(lower) ||
      i.category1.toLowerCase().includes(lower) ||
      i.category2.toLowerCase().includes(lower) ||
      i.brand.toLowerCase().includes(lower)
  );
}
