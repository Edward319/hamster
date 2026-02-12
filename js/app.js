/**
 * 应用逻辑：导航、首页临期（按条 remindBeforeDays）、
 * 库存两级表格（SKU 聚合 + 按到期日展开）、用完了填数量、复制搜索、盖章
 */

(function () {
  const views = document.querySelectorAll(".view");
  const navItems = document.querySelectorAll(".nav-item");
  const modal = document.getElementById("modal-form");
  const form = document.getElementById("item-form");
  const formTitle = document.getElementById("form-title");
  const formClose = document.getElementById("form-close");
  const modalClose = document.getElementById("modal-close");
  const formCancel = document.getElementById("form-cancel");
  const btnAdd = document.getElementById("btn-add-item");
  const copySearch = document.getElementById("item-copy-search");
  const copyList = document.getElementById("item-copy-list");
  const stamp = document.getElementById("inventory-stamp");
  const filterBtns = document.querySelectorAll(".filter-btn");
  const modalUse = document.getElementById("modal-use");
  const useItemDesc = document.getElementById("use-item-desc");
  const useQuantityInput = document.getElementById("use-quantity");
  const useQuantityMax = document.getElementById("use-quantity-max");
  const useConfirm = document.getElementById("use-confirm");
  const useCancel = document.getElementById("use-cancel");
  const modalUseClose = document.getElementById("modal-use-close");
  const modalUseCloseBtn = document.getElementById("modal-use-close-btn");
  const modalNotionGuide = document.getElementById("modal-notion-guide");
  const modalNotionGuideClose = document.getElementById("modal-notion-guide-close");
  const modalNotionGuideCloseBtn = document.getElementById("modal-notion-guide-close-btn");
  const modalNotionGuideOk = document.getElementById("modal-notion-guide-ok");

  let currentInventoryStatus = "in_stock";
  let useTargetId = null;

  async function showView(viewName) {
    if (
      (viewName === "home" || viewName === "inventory") &&
      typeof isNotionSyncEnabled === "function" &&
      isNotionSyncEnabled() &&
      typeof isNotionCacheLoaded === "function" &&
      !isNotionCacheLoaded() &&
      typeof loadNotionCache === "function"
    ) {
      try {
        await loadNotionCache();
      } catch (e) {
        console.error(e);
        alert(e.message || "拉取 Notion 数据失败");
      }
    }
    views.forEach((v) => v.classList.toggle("view-active", v.dataset.view === viewName));
    navItems.forEach((n) => n.classList.toggle("active", n.dataset.nav === viewName));
    if (viewName === "home") renderHome();
    if (viewName === "inventory") renderInventory();
    if (viewName === "butler") renderButler();
    if (viewName === "settings") renderSettings();
  }

  navItems.forEach((btn) =>
    btn.addEventListener("click", () => {
      showView(btn.dataset.nav);
    })
  );

  // ---------- 首页：今日提醒（拟人化催促文案）+ 双周报 ----------
  function getUrgingText(count) {
    if (count === 0) return "";
    if (count <= 2) return "有几样快到期啦，记得先用哦～";
    if (count <= 5) return "快吃快用啊！别浪费！";
    return "到期的东西太多了，快吃快用啊！别浪费！";
  }

  function renderHome() {
    const list = document.getElementById("home-expiring-list");
    const emptyMsg = document.getElementById("home-empty-msg");
    const urgingMsg = document.getElementById("home-urging-msg");
    const items = getExpiringItems();
    list.innerHTML = "";
    emptyMsg.classList.add("hidden");
    urgingMsg.classList.add("hidden");
    if (items.length === 0) {
      emptyMsg.classList.remove("hidden");
      emptyMsg.textContent = "今天没有快过期的东西，真棒！";
    } else {
      const text = getUrgingText(items.length);
      if (text) {
        urgingMsg.textContent = text;
        urgingMsg.classList.remove("hidden");
      }
      items.forEach((i) => {
        const li = document.createElement("li");
        li.innerHTML =
          '<span class="item-name">' +
          escapeHtml(i.name) +
          "</span>" +
          '<span class="item-meta">' +
          escapeHtml(i.brand) +
          " · " +
          escapeHtml(i.category1) +
          "/" +
          escapeHtml(i.category2) +
          " · 到期 " +
          escapeHtml(i.expiryDate) +
          (i.remindBeforeDays ? "（提前 " + i.remindBeforeDays + " 天提醒）" : "") +
          "</span>";
        list.appendChild(li);
      });
    }
    renderBiweekly();
  }

  function buildTodayReportPayload() {
    const expiring = getExpiringItems();
    const urging = getUrgingText(expiring.length);
    const past = getPastMonthStatsByCategory1();
    return {
      urging,
      expiring: expiring.map((i) => ({
        name: i.name,
        brand: i.brand,
        category1: i.category1,
        category2: i.category2,
        expiryDate: i.expiryDate,
      })),
      summaryNew: past.newEntries.map((g) => ({ category1: g.category1, totalPrice: g.totalPrice })),
      summaryUsed: past.used.map((g) => ({ category1: g.category1, totalPrice: g.totalPrice })),
    };
  }

  async function sendReportToEmail() {
    const settings = getSettings();
    const to = (settings.notifyEmail || "").trim();
    if (!to) {
      alert("请先在「设置」中填写通知邮箱，再发送报告。");
      return;
    }
    const origin = window.location.origin;
    if (!origin || origin === "null" || origin === "file://") {
      alert("邮件功能需在部署后的网址使用（如 Vercel）。请先部署项目再试。");
      return;
    }
    const statusEl = document.getElementById("send-report-status");
    if (statusEl) {
      statusEl.textContent = "发送中…";
      statusEl.classList.remove("hidden");
      statusEl.classList.remove("error");
    }
    const report = buildTodayReportPayload();
    try {
      const res = await fetch(origin + "/api/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, report }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "发送失败");
      }
      if (statusEl) {
        statusEl.textContent = "已发送到 " + to;
        statusEl.classList.remove("error");
        setTimeout(() => statusEl.classList.add("hidden"), 3000);
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = e.message || "发送失败";
        statusEl.classList.add("error");
      }
    }
  }

  const btnSendReport = document.getElementById("btn-send-report");
  if (btnSendReport) btnSendReport.addEventListener("click", sendReportToEmail);

  function renderBiweekly() {
    const past = getPastMonthStatsByCategory1();
    renderBiweeklyBlock("biweekly-new", "进货", past.newEntries);
    renderBiweeklyBlock("biweekly-used", "消耗", past.used);
  }

  function renderBiweeklyBlock(containerId, title, list) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = "<h3 class=\"biweekly-subtitle\">" + escapeHtml(title) + "</h3><p class=\"empty-msg\">暂无数据</p>";
      return;
    }
    let html = "<h3 class=\"biweekly-subtitle\">" + escapeHtml(title) + "</h3>";
    list.forEach((g, idx) => {
      const id = containerId + "-cat-" + idx;
      html +=
        "<div class=\"biweekly-cat\">" +
        "<button type=\"button\" class=\"biweekly-cat-btn\" data-id=\"" + id + "\" aria-expanded=\"false\">" +
        "<span class=\"biweekly-cat-arrow\">▶</span> <span class=\"biweekly-cat-name\">" + escapeHtml(g.category1) + "</span> " +
        "<span class=\"biweekly-cat-price\">¥" + g.totalPrice + "</span>" +
        "</button>" +
        "<div id=\"" + id + "\" class=\"biweekly-cat-detail hidden\">" +
        "<ul class=\"biweekly-items\">" +
        g.items.map((i) => {
          const name = escapeHtml(i.name);
          const meta = escapeHtml((i.brand || "") + " " + (i.expiryDate || ""));
          const price = rowTotalPrice(i, i.status === "used_up");
          return "<li>" + name + " <span class=\"item-meta\">" + meta + " · ¥" + price + "</span></li>";
        }).join("") +
        "</ul></div></div>";
    });
    el.innerHTML = html;
    el.querySelectorAll(".biweekly-cat-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const detail = document.getElementById(id);
        if (!detail) return;
        detail.classList.toggle("hidden");
        const open = !detail.classList.contains("hidden");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        const arrow = btn.querySelector(".biweekly-cat-arrow");
        if (arrow) arrow.textContent = open ? "▼ " : "▶ ";
      });
    });
  }

  function renderButler() {}

  // ---------- 库存管理：按 SKU 分组 + 展开显示按到期日的底层；已使用完超 2 个月自动删除 ----------
  function renderInventory() {
    purgeUsedUpOlderThanTwoMonths();
    const tbody = document.getElementById("inventory-tbody");
    const groups = getInventoryGroups(currentInventoryStatus);
    tbody.innerHTML = "";

    if (groups.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td colspan="7" class="inventory-empty">' +
        (currentInventoryStatus === "used_up" ? "暂无已用完记录" : "暂无在库记录") +
        "</td>";
      tbody.appendChild(tr);
      return;
    }

    groups.forEach((g, idx) => {
      const expiryRange =
        g.expiryMin === g.expiryMax ? g.expiryMin : g.expiryMin + " ~ " + g.expiryMax;
      const skuId = "sku-" + idx;

      const tr1 = document.createElement("tr");
      tr1.className = "sku-row";
      tr1.dataset.skuId = skuId;
      tr1.innerHTML =
        '<td class="col-expand"><button type="button" class="expand-btn" aria-label="展开">▶</button></td>' +
        '<td class="cell-name">' +
        escapeHtml(g.name) +
        "</td>" +
        '<td class="cell-category">' +
        escapeHtml(g.category1) +
        " / " +
        escapeHtml(g.category2) +
        "</td>" +
        "<td>" +
        escapeHtml(g.brand) +
        "</td>" +
        "<td>" +
        escapeHtml(String(g.totalQty)) +
        "</td>" +
        "<td class=\"cell-total-price\">¥" + (g.totalPrice != null ? g.totalPrice : 0) + "</td>" +
        "<td>" +
        escapeHtml(expiryRange) +
        "</td>";
      tbody.appendChild(tr1);

      const tr2 = document.createElement("tr");
      tr2.className = "detail-row";
      tr2.dataset.skuId = skuId;
      let detailRows = "";
      g.rows.forEach((r) => {
        const qtyDisplay =
          currentInventoryStatus === "used_up"
            ? Math.abs(Number(r.quantity) || 0)
            : (Number(r.quantity) || 0);
        const rowPrice = rowTotalPrice(r, currentInventoryStatus === "used_up");
        detailRows +=
          "<tr data-id=\"" +
          escapeHtml(r.id) +
          "\">" +
          "<td>" +
          escapeHtml(r.expiryDate) +
          "</td>" +
          "<td>" +
          escapeHtml(String(qtyDisplay)) +
          "</td>" +
          "<td>¥" + rowPrice + "</td>" +
          "<td>" +
          (r.status === "in_stock" ? "在库" : "已用完") +
          "</td>" +
          "<td class=\"cell-actions\">" +
          (r.status === "in_stock"
            ? '<button type="button" class="btn-cell btn-use">用完了</button>'
            : "") +
          '<button type="button" class="btn-cell btn-edit">编辑</button>' +
          '<button type="button" class="btn-cell btn-del">删除</button>' +
          "</td></tr>";
      });
      tr2.innerHTML =
        '<td colspan="7"><div class="detail-inner">' +
        '<table class="detail-table"><thead><tr><th>到期日</th><th>数量</th><th>总价</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
        detailRows +
        "</tbody></table></div></td>";
      tbody.appendChild(tr2);
    });

    tbody.querySelectorAll(".sku-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".expand-btn")) return;
        const btn = row.querySelector(".expand-btn");
        const skuId = row.dataset.skuId;
        const detail = tbody.querySelector(".detail-row[data-sku-id=\"" + skuId + "\"]");
        if (!detail) return;
        const isOpen = detail.classList.toggle("visible");
        if (btn) btn.classList.toggle("expanded", isOpen);
      });
    });
    tbody.querySelectorAll(".expand-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = e.target.closest("tr");
        const skuId = row.dataset.skuId;
        const detail = tbody.querySelector(".detail-row[data-sku-id=\"" + skuId + "\"]");
        if (!detail) return;
        const isOpen = detail.classList.toggle("visible");
        btn.classList.toggle("expanded", isOpen);
      });
    });
    tbody.querySelectorAll(".detail-row .btn-use").forEach((b) => b.addEventListener("click", onUseClick));
    tbody.querySelectorAll(".detail-row .btn-edit").forEach((b) => b.addEventListener("click", onEdit));
    tbody.querySelectorAll(".detail-row .btn-del").forEach((b) => b.addEventListener("click", onDelete));
  }

  function onUseClick(e) {
    e.stopPropagation();
    const id = e.target.closest("tr").dataset.id;
    const items = getAllItems();
    const item = items.find((i) => i.id === id);
    if (!item || item.status !== "in_stock") return;
    useTargetId = id;
    useItemDesc.textContent = escapeHtml(item.name) + "（" + escapeHtml(item.expiryDate) + "）";
    useQuantityMax.textContent = String(item.quantity);
    useQuantityInput.max = item.quantity;
    useQuantityInput.value = Math.min(1, item.quantity);
    modalUse.classList.remove("hidden");
    modalUse.setAttribute("aria-hidden", "false");
  }

  function closeUseModal() {
    modalUse.classList.add("hidden");
    modalUse.setAttribute("aria-hidden", "true");
    useTargetId = null;
  }

  useConfirm.addEventListener("click", async () => {
    if (!useTargetId) return;
    const val = parseFloat(useQuantityInput.value, 10);
    if (Number.isNaN(val)) return;
    const item = getAllItems().find((i) => i.id === useTargetId);
    if (!item || val <= 0 || val > item.quantity) return;
    try {
      await useQuantity(useTargetId, val);
      closeUseModal();
      showStamp("已使用");
      renderInventory();
    } catch (err) {
      alert(err.message || "操作失败");
    }
  });
  useCancel.addEventListener("click", closeUseModal);
  modalUseClose.addEventListener("click", closeUseModal);
  modalUseCloseBtn.addEventListener("click", closeUseModal);

  function openNotionGuide() {
    if (!modalNotionGuide) return;
    modalNotionGuide.classList.remove("hidden");
    modalNotionGuide.setAttribute("aria-hidden", "false");
  }

  function closeNotionGuide() {
    if (!modalNotionGuide) return;
    modalNotionGuide.classList.add("hidden");
    modalNotionGuide.setAttribute("aria-hidden", "true");
  }

  function onEdit(e) {
    e.stopPropagation();
    const id = e.target.closest("tr").dataset.id;
    const item = getAllItems().find((i) => i.id === id);
    if (!item) return;
    openForm(item);
  }

  async function onDelete(e) {
    e.stopPropagation();
    const id = e.target.closest("tr").dataset.id;
    if (!id || !confirm("确定删除这条记录吗？（仅用于录错）")) return;
    try {
      await deleteItem(id);
      renderInventory();
    } catch (err) {
      alert(err.message || "删除失败");
    }
  }

  function showStamp(text) {
    if (!stamp) return;
    stamp.textContent = text || "已登记";
    stamp.classList.remove("hidden");
    setTimeout(() => stamp.classList.add("hidden"), 1200);
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentInventoryStatus = btn.dataset.status;
      renderInventory();
    });
  });

  // ---------- 添加/编辑表单：remindBeforeDays、复制（按 SKU + 搜索）----------
  function openForm(existingItem) {
    formTitle.textContent = existingItem ? "编辑货物" : "登记新货物";
    document.getElementById("item-id").value = existingItem ? existingItem.id : "";
    document.getElementById("item-name").value = existingItem ? existingItem.name : "";
    document.getElementById("item-category1").value = existingItem ? existingItem.category1 : "";
    document.getElementById("item-category2").value = existingItem ? existingItem.category2 : "";
    document.getElementById("item-brand").value = existingItem ? existingItem.brand : "";
    document.getElementById("item-quantity").value = existingItem ? existingItem.quantity : "";
    document.getElementById("item-unit-price").value = existingItem ? existingItem.unitPrice : "";
    document.getElementById("item-remind-days").value = existingItem ? (existingItem.remindBeforeDays || 30) : 30;
    document.getElementById("item-note").value = existingItem ? existingItem.note : "";
    if (existingItem) {
      document.getElementById("item-purchase-date").value = existingItem.purchaseDate;
      document.getElementById("item-expiry-date").value = existingItem.expiryDate;
    } else {
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById("item-purchase-date").value = today;
      document.getElementById("item-expiry-date").value = "";
    }
    copySearch.value = "";
    copyList.innerHTML = "";
    copyList.classList.add("hidden");
    fillDatalists();
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeForm() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    form.reset();
    document.getElementById("item-id").value = "";
    document.getElementById("item-remind-days").value = "30";
  }

  function showCopyDropdown(show) {
    if (show) copyList.classList.remove("hidden");
    else copyList.classList.add("hidden");
  }

  function fillCopyList(keyword) {
    const k = keyword != null ? String(keyword).trim() : "";
    copyList.innerHTML = "";
    if (!k) {
      showCopyDropdown(false);
      return;
    }
    const items = getItemsForCopy(k);
    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "copy-item";
      p.style.color = "var(--color-text-muted)";
      p.textContent = "没有匹配的录入记录";
      copyList.appendChild(p);
      showCopyDropdown(true);
      return;
    }
    items.forEach((i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-item";
      btn.textContent = i.name + " · " + i.brand + " · " + i.category1 + "/" + i.category2;
      btn.dataset.name = i.name;
      btn.dataset.category1 = i.category1;
      btn.dataset.category2 = i.category2;
      btn.dataset.brand = i.brand;
      btn.dataset.unitPrice = i.unitPrice;
      btn.dataset.note = i.note;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("item-name").value = i.name;
        document.getElementById("item-category1").value = i.category1;
        document.getElementById("item-category2").value = i.category2;
        document.getElementById("item-brand").value = i.brand;
        document.getElementById("item-unit-price").value = i.unitPrice;
        document.getElementById("item-note").value = i.note || "";
        copySearch.value = "";
        copyList.innerHTML = "";
        showCopyDropdown(false);
      });
      copyList.appendChild(btn);
    });
    showCopyDropdown(true);
  }

  copySearch.addEventListener("input", () => fillCopyList(copySearch.value));
  copySearch.addEventListener("focus", () => {
    if (copySearch.value.trim()) fillCopyList(copySearch.value);
  });
  copySearch.addEventListener("blur", () => {
    setTimeout(() => showCopyDropdown(false), 200);
  });

  function fillDatalists() {
    const cat = getCategories();
    const list1 = document.getElementById("list-category1");
    const list2 = document.getElementById("list-category2");
    list1.innerHTML = "";
    list2.innerHTML = "";
    Object.keys(cat).forEach((c1) => {
      const o1 = document.createElement("option");
      o1.value = c1;
      list1.appendChild(o1);
      (cat[c1] || []).forEach((c2) => {
        const o2 = document.createElement("option");
        o2.value = c2;
        list2.appendChild(o2);
      });
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("item-id").value;
    const existing = id ? getAllItems().find((i) => i.id === id) : null;
    const payload = {
      id: id || undefined,
      notionPageId: existing && existing.notionPageId,
      status: existing ? existing.status : "in_stock",
      name: document.getElementById("item-name").value.trim(),
      category1: document.getElementById("item-category1").value.trim(),
      category2: document.getElementById("item-category2").value.trim(),
      brand: document.getElementById("item-brand").value.trim(),
      quantity: document.getElementById("item-quantity").value,
      unitPrice: document.getElementById("item-unit-price").value,
      purchaseDate: document.getElementById("item-purchase-date").value,
      expiryDate: document.getElementById("item-expiry-date").value,
      note: document.getElementById("item-note").value.trim(),
      remindBeforeDays: parseInt(document.getElementById("item-remind-days").value, 10) || 30,
    };
    try {
      await saveItem(payload);
      closeForm();
      showStamp("已登记");
      renderInventory();
    } catch (err) {
      alert(err.message || "保存失败");
    }
  });

  btnAdd.addEventListener("click", () => openForm(null));
  formClose.addEventListener("click", closeForm);
  modalClose.addEventListener("click", closeForm);
  formCancel.addEventListener("click", closeForm);

  // ---------- 设置：提醒周期、通知邮箱、Notion 同步 ----------
  function renderSettings() {
    const s = getSettings();
    const cycleEl = document.getElementById("setting-remind-cycle");
    const emailEl = document.getElementById("setting-notify-email");
    const notionSyncEl = document.getElementById("setting-notion-sync");
    const notionTokenEl = document.getElementById("setting-notion-token");
    const notionDbIdEl = document.getElementById("setting-notion-database-id");
    const notionParentEl = document.getElementById("setting-notion-parent-page-id");
    if (cycleEl) cycleEl.value = String(s.remindCycleDays);
    if (emailEl) emailEl.value = s.notifyEmail || "";
    if (notionSyncEl) notionSyncEl.checked = !!s.notionSync;
    if (notionTokenEl) notionTokenEl.value = s.notionToken || "";
    if (notionDbIdEl) notionDbIdEl.value = s.notionDatabaseId || "";
    if (notionParentEl) notionParentEl.value = "";
    const statusEl = document.getElementById("notion-create-db-status");
    if (statusEl) statusEl.textContent = "";
  }

  (function initSettingsListeners() {
    const cycleEl = document.getElementById("setting-remind-cycle");
    const emailEl = document.getElementById("setting-notify-email");
    const notionSyncEl = document.getElementById("setting-notion-sync");
    const notionTokenEl = document.getElementById("setting-notion-token");
    const notionDbIdEl = document.getElementById("setting-notion-database-id");
    const btnCreateDb = document.getElementById("btn-notion-create-db");
    const notionParentEl = document.getElementById("setting-notion-parent-page-id");
    const statusEl = document.getElementById("notion-create-db-status");

    function saveNotionSettings() {
      const s = getSettings();
      s.notionSync = notionSyncEl ? notionSyncEl.checked : false;
      s.notionToken = notionTokenEl ? (notionTokenEl.value || "").trim() : "";
      s.notionDatabaseId = notionDbIdEl ? (notionDbIdEl.value || "").trim() : "";
      saveSettings(s);
      if (typeof clearNotionCache === "function") clearNotionCache();
    }

    if (cycleEl) {
      cycleEl.addEventListener("change", () => {
        const s = getSettings();
        s.remindCycleDays = parseInt(cycleEl.value, 10) || 7;
        saveSettings(s);
      });
    }
    if (emailEl) {
      emailEl.addEventListener("blur", () => {
        const s = getSettings();
        s.notifyEmail = (emailEl.value || "").trim();
        saveSettings(s);
      });
    }
    if (notionSyncEl) {
      notionSyncEl.addEventListener("change", () => {
        const before = !!getSettings().notionSync;
        saveNotionSettings();
        const after = !!getSettings().notionSync;
        // 第一次从未开启切换到开启时，弹出新手引导
        if (!before && after) {
          openNotionGuide();
        }
      });
    }
    if (notionTokenEl) notionTokenEl.addEventListener("blur", saveNotionSettings);
    if (notionDbIdEl) notionDbIdEl.addEventListener("blur", saveNotionSettings);

    if (btnCreateDb && notionParentEl && notionTokenEl && notionDbIdEl && statusEl && typeof createNotionDatabase === "function") {
      btnCreateDb.addEventListener("click", async () => {
        const token = (notionTokenEl.value || "").trim();
        const parentId = (notionParentEl.value || "").trim().replace(/-/g, "");
        if (!token || !parentId) {
          statusEl.textContent = "请先填写集成密钥和父页面 ID，并确保该页面已共享给集成。";
          return;
        }
        statusEl.textContent = "创建中…";
        try {
          const databaseId = await createNotionDatabase(token, parentId);
          notionDbIdEl.value = databaseId;
          saveNotionSettings();
          statusEl.textContent = "已创建，请在该数据库中点击「连接」并选择你的集成。";
        } catch (e) {
          statusEl.textContent = e.message || "创建失败";
        }
      });
    }

    if (modalNotionGuideClose) modalNotionGuideClose.addEventListener("click", closeNotionGuide);
    if (modalNotionGuideCloseBtn) modalNotionGuideCloseBtn.addEventListener("click", closeNotionGuide);
    if (modalNotionGuideOk) modalNotionGuideOk.addEventListener("click", closeNotionGuide);
  })();

  function escapeHtml(s) {
    if (s == null) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  showView("home");
})();
