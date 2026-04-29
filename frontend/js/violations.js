(function () {
    const API_URL = window.AppAuth?.getApiUrl?.("/api/violations") || "/api/violations";

    const STATUS_META = {
        critical: {
            label: "Критично",
            className: "violations-status violations-status--critical",
        },
        open: {
            label: "Открыто",
            className: "violations-status violations-status--open",
        },
        in_progress: {
            label: "В работе",
            className: "violations-status violations-status--progress",
        },
        closed: {
            label: "Закрыто",
            className: "violations-status violations-status--closed",
        },
    };

    const MOCK_VIOLATIONS = [
        {
            date: "2026-04-29T06:18:00+07:00",
            batch: "Замес №2419",
            group: "Группа 12",
            component: "Кукурузный силос",
            violationType: "Недовложение",
            plan: 820,
            fact: 768,
            deviation: -52,
            status: "critical",
        },
        {
            date: "2026-04-29T07:42:00+07:00",
            batch: "Замес №2420",
            group: "Группа 7",
            component: "Жом свекловичный",
            violationType: "Перевложение",
            plan: 160,
            fact: 183,
            deviation: 23,
            status: "open",
        },
        {
            date: "2026-04-29T08:10:00+07:00",
            batch: "Замес №2420",
            group: "Группа 7",
            component: "Премикс",
            violationType: "Пропуск компонента",
            plan: 12,
            fact: 0,
            deviation: -12,
            status: "critical",
        },
        {
            date: "2026-04-28T16:25:00+07:00",
            batch: "Замес №2417",
            group: "Группа 4",
            component: "Сенаж люцерновый",
            violationType: "Недовложение",
            plan: 540,
            fact: 521,
            deviation: -19,
            status: "in_progress",
        },
        {
            date: "2026-04-28T15:54:00+07:00",
            batch: "Замес №2416",
            group: "Группа 2",
            component: "Комбикорм",
            violationType: "Перевложение",
            plan: 210,
            fact: 216,
            deviation: 6,
            status: "closed",
        },
        {
            date: "2026-04-27T18:04:00+07:00",
            batch: "Замес №2410",
            group: "Группа 9",
            component: "Минеральная добавка",
            violationType: "Ошибка выбора группы",
            plan: 25,
            fact: 25,
            deviation: 0,
            status: "closed",
        },
    ];

    const state = {
        items: [],
        filteredItems: [],
        usingMock: false,
        lastError: "",
    };

    const elements = {
        tableBody: document.getElementById("violationsTableBody"),
        panelMeta: document.getElementById("violationsPanelMeta"),
        sourceBanner: document.getElementById("violationsSourceBanner"),
        sourceBadge: document.getElementById("violationsSourceBadge"),
        dateFilter: document.getElementById("violationsDateFilter"),
        typeFilter: document.getElementById("violationsTypeFilter"),
        groupFilter: document.getElementById("violationsGroupFilter"),
        componentFilter: document.getElementById("violationsComponentFilter"),
        scopeFilter: document.getElementById("violationsScopeFilter"),
        reloadButton: document.getElementById("violationsReloadButton"),
        criticalCount: document.getElementById("violationsCriticalCount"),
        openCount: document.getElementById("violationsOpenCount"),
        progressCount: document.getElementById("violationsProgressCount"),
        closedCount: document.getElementById("violationsClosedCount"),
    };

    const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function parseNumber(value) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === "string" && value.trim()) {
            const normalized = Number(value.replace(",", "."));
            return Number.isFinite(normalized) ? normalized : null;
        }

        return null;
    }

    function formatWeight(value) {
        if (!Number.isFinite(value)) {
            return "—";
        }

        return `${new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
        }).format(value)} кг`;
    }

    function formatDeviation(value) {
        if (!Number.isFinite(value)) {
            return '<span class="violations-number">—</span>';
        }

        const sign = value > 0 ? "+" : "";
        const className = value > 0
            ? "violations-number violations-number--positive"
            : value < 0
                ? "violations-number violations-number--negative"
                : "violations-number";

        return `<span class="${className}">${sign}${escapeHtml(formatWeight(value))}</span>`;
    }

    function formatDate(value) {
        if (!value) {
            return "—";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return escapeHtml(value);
        }

        return dateTimeFormatter.format(date);
    }

    function getDateKey(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value).slice(0, 10);
        }

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
        ].join("-");
    }

    function normalizeStatus(value) {
        const normalized = String(value || "").trim().toLowerCase();

        if (normalized === "critical" || normalized === "критично") {
            return "critical";
        }

        if (normalized === "in_progress" || normalized === "in progress" || normalized === "processing" || normalized === "в работе") {
            return "in_progress";
        }

        if (normalized === "closed" || normalized === "resolved" || normalized === "закрыто") {
            return "closed";
        }

        return "open";
    }

    function inferViolationType(plan, fact, deviation, fallback) {
        if (fallback) {
            return fallback;
        }

        if (Number.isFinite(plan) && Number.isFinite(fact) && plan > 0 && fact === 0) {
            return "Пропуск компонента";
        }

        if (Number.isFinite(deviation) && deviation < 0) {
            return "Недовложение";
        }

        if (Number.isFinite(deviation) && deviation > 0) {
            return "Перевложение";
        }

        return "Нарушение рецепта";
    }

    function normalizeItem(item) {
        const plan = parseNumber(item.plan ?? item.planned ?? item.planWeight ?? item.target);
        const fact = parseNumber(item.fact ?? item.actual ?? item.factWeight ?? item.actualWeight);
        const deviation = parseNumber(
            item.deviation ?? item.delta ?? (Number.isFinite(plan) && Number.isFinite(fact) ? fact - plan : null)
        );
        const type = inferViolationType(plan, fact, deviation, item.violationType ?? item.type ?? item.reason ?? "");

        return {
            date: item.date ?? item.createdAt ?? item.timestamp ?? item.eventTime ?? "",
            batch: item.batch ?? item.batchName ?? item.mix ?? item.mixName ?? "—",
            group: item.group ?? item.groupName ?? "—",
            component: item.component ?? item.componentName ?? "—",
            type,
            violationType: type,
            plan,
            fact,
            deviation,
            status: normalizeStatus(item.status ?? item.state),
        };
    }

    function getStatusMeta(status) {
        return STATUS_META[status] || STATUS_META.open;
    }

    function isOpenStatus(status) {
        return status !== "closed";
    }

    function buildUniqueValues(items, fieldName) {
        return Array.from(new Set(
            items
                .map((item) => String(item?.[fieldName] ?? "").trim())
                .filter(Boolean)
                .filter((value) => value !== "—")
        )).sort((left, right) => left.localeCompare(right, "ru"));
    }

    function syncFilterSelectOptions(select, values, defaultLabel) {
        if (!select) {
            return;
        }

        const previousValue = select.value;
        const options = [`<option value="">${escapeHtml(defaultLabel)}</option>`]
            .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));

        select.innerHTML = options.join("");
        if (values.includes(previousValue)) {
            select.value = previousValue;
        }
    }

    function renderFilterOptions() {
        syncFilterSelectOptions(elements.typeFilter, buildUniqueValues(state.items, "type"), "Все типы");
        syncFilterSelectOptions(elements.groupFilter, buildUniqueValues(state.items, "group"), "Все группы");
        syncFilterSelectOptions(elements.componentFilter, buildUniqueValues(state.items, "component"), "Все компоненты");
    }

    function getVisibleItems() {
        const dateFilter = elements.dateFilter?.value || "";
        const typeFilter = elements.typeFilter?.value || "";
        const groupFilter = elements.groupFilter?.value || "";
        const componentFilter = elements.componentFilter?.value || "";
        const scopeFilter = elements.scopeFilter?.value || "all";

        return state.items.filter((item) => {
            if (dateFilter && getDateKey(item.date) !== dateFilter) {
                return false;
            }

            if (typeFilter && item.type !== typeFilter) {
                return false;
            }

            if (groupFilter && item.group !== groupFilter) {
                return false;
            }

            if (componentFilter && item.component !== componentFilter) {
                return false;
            }

            if (scopeFilter === "open" && !isOpenStatus(item.status)) {
                return false;
            }

            return true;
        });
    }

    function renderSummary() {
        const counts = {
            critical: 0,
            open: 0,
            in_progress: 0,
            closed: 0,
        };

        state.items.forEach((item) => {
            counts[item.status] = (counts[item.status] || 0) + 1;
        });

        elements.criticalCount.textContent = String(counts.critical || 0);
        elements.openCount.textContent = String(counts.open || 0);
        elements.progressCount.textContent = String(counts.in_progress || 0);
        elements.closedCount.textContent = String(counts.closed || 0);
    }

    function renderBanner() {
        if (!elements.sourceBanner || !elements.sourceBadge) {
            return;
        }

        if (state.usingMock) {
            elements.sourceBanner.className = "alert alert-light border-left-warning shadow-sm mb-4";
            elements.sourceBanner.textContent = "API /api/violations пока не ответил, поэтому показан макет с тестовыми данными.";
            elements.sourceBadge.textContent = "Источник: mock";
            elements.sourceBadge.className = "violations-source-badge violations-source-badge--mock mr-2";
            return;
        }

        elements.sourceBanner.className = "alert alert-light border-left-success shadow-sm mb-4";
        elements.sourceBanner.textContent = "Данные загружены из /api/violations.";
        elements.sourceBadge.textContent = "Источник: API";
        elements.sourceBadge.className = "violations-source-badge mr-2";
    }

    function renderMeta() {
        if (!elements.panelMeta) {
            return;
        }

        const shownCount = state.filteredItems.length;
        const totalCount = state.items.length;
        const sourceLabel = state.usingMock ? "mock" : "API";

        elements.panelMeta.textContent = `Показано ${shownCount} из ${totalCount} · источник: ${sourceLabel}`;
    }

    function renderTable() {
        if (!elements.tableBody) {
            return;
        }

        if (!state.filteredItems.length) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="violations-empty-state">По текущим фильтрам записи не найдены.</td>
                </tr>
            `;
            return;
        }

        elements.tableBody.innerHTML = state.filteredItems.map((item) => {
            const statusMeta = getStatusMeta(item.status);

            return `
                <tr>
                    <td>
                        <div class="violations-cell-primary">${escapeHtml(formatDate(item.date))}</div>
                        <div class="violations-cell-secondary">${escapeHtml(getDateKey(item.date) || "—")}</div>
                    </td>
                    <td class="violations-cell-primary">${escapeHtml(item.batch)}</td>
                    <td>${escapeHtml(item.group)}</td>
                    <td>${escapeHtml(item.component)}</td>
                    <td>${escapeHtml(item.violationType)}</td>
                    <td><span class="violations-number">${escapeHtml(formatWeight(item.plan))}</span></td>
                    <td><span class="violations-number">${escapeHtml(formatWeight(item.fact))}</span></td>
                    <td>${formatDeviation(item.deviation)}</td>
                    <td><span class="${statusMeta.className}">${escapeHtml(statusMeta.label)}</span></td>
                </tr>
            `;
        }).join("");
    }

    function render() {
        renderFilterOptions();
        state.filteredItems = getVisibleItems();
        renderSummary();
        renderBanner();
        renderMeta();
        renderTable();
    }

    async function loadViolations() {
        if (elements.panelMeta) {
            elements.panelMeta.textContent = "Загрузка...";
        }

        if (elements.tableBody) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="violations-empty-state">Загрузка нарушений...</td>
                </tr>
            `;
        }

        try {
            const response = await fetch(API_URL, {
                headers: window.AppAuth?.getAuthHeaders?.() || {},
                credentials: "same-origin",
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            const items = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.items)
                    ? payload.items
                    : [];

            state.items = items.map(normalizeItem);
            state.usingMock = false;
            state.lastError = "";
        } catch (error) {
            state.items = MOCK_VIOLATIONS.map((item) => ({ ...item }));
            state.usingMock = true;
            state.lastError = error?.message || "Не удалось загрузить API";
        }

        render();
    }

    function bindEvents() {
        [
            elements.dateFilter,
            elements.typeFilter,
            elements.groupFilter,
            elements.componentFilter,
            elements.scopeFilter,
        ].forEach((control) => {
            control?.addEventListener("change", render);
        });

        elements.reloadButton?.addEventListener("click", loadViolations);
    }

    function init() {
        bindEvents();
        loadViolations();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
