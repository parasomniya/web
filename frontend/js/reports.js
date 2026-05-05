(function () {
    const API_URL = window.AppAuth?.getApiUrl?.("/api/reports") || "/api/reports";
    const DEFAULT_LIMIT = 1000;

    const state = {
        batches: [],
        violations: [],
        summary: {
            counts: {
                batches: 0,
                batchesWithViolations: 0,
                violationsTotal: 0,
                violationsActive: 0,
                violationsResolved: 0,
            },
            topComponents: [],
            topGroups: [],
        },
        fromDate: "",
        toDate: "",
        usingMock: false,
        lastError: "",
    };

    const elements = {
        fromDate: document.getElementById("reportsFromDate"),
        toDate: document.getElementById("reportsToDate"),
        reloadButton: document.getElementById("reportsReloadButton"),
        exportButton: document.getElementById("reportsExportButton"),
        sourceBanner: document.getElementById("reportsSourceBanner"),
        sourceBadge: document.getElementById("reportsSourceBadge"),
        periodMeta: document.getElementById("reportsPeriodMeta"),
        quickStats: document.getElementById("reportsQuickStats"),
        batchesCount: document.getElementById("reportsBatchesCount"),
        problemBatchesCount: document.getElementById("reportsProblemBatchesCount"),
        violationsCount: document.getElementById("reportsViolationsCount"),
        openViolationsCount: document.getElementById("reportsOpenViolationsCount"),
        resolvedViolationsCount: document.getElementById("reportsResolvedViolationsCount"),
        violationRate: document.getElementById("reportsViolationRate"),
        batchesMeta: document.getElementById("reportsBatchesMeta"),
        violationsMeta: document.getElementById("reportsViolationsMeta"),
        batchesTableBody: document.getElementById("reportsBatchesTableBody"),
        violationsTableBody: document.getElementById("reportsViolationsTableBody"),
        topComponents: document.getElementById("reportsTopComponents"),
        topGroups: document.getElementById("reportsTopGroups"),
    };

    const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });

    const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    const numberFormatter = new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    });

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function toNumber(value) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === "string" && value.trim()) {
            const normalized = Number(value.replace(",", "."));
            return Number.isFinite(normalized) ? normalized : null;
        }

        return null;
    }

    function parseDate(value) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatDateValue(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return "";
        }

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
        ].join("-");
    }

    function getDateKey(value) {
        const parsed = parseDate(value);
        if (!parsed) {
            return "";
        }

        return [
            parsed.getFullYear(),
            String(parsed.getMonth() + 1).padStart(2, "0"),
            String(parsed.getDate()).padStart(2, "0"),
        ].join("-");
    }

    function formatDateTime(value) {
        const parsed = parseDate(value);
        if (!parsed) {
            return "—";
        }

        return dateTimeFormatter.format(parsed);
    }

    function formatDateOnly(value) {
        const parsed = parseDate(value);
        if (!parsed) {
            return "—";
        }

        return dateFormatter.format(parsed);
    }

    function formatWeight(value) {
        const numericValue = toNumber(value);
        if (!Number.isFinite(numericValue)) {
            return "—";
        }

        return `${numberFormatter.format(numericValue)} кг`;
    }

    function formatSignedWeight(value) {
        const numericValue = toNumber(value);
        if (!Number.isFinite(numericValue)) {
            return "—";
        }

        const sign = numericValue > 0 ? "+" : "";
        return `${sign}${numberFormatter.format(numericValue)} кг`;
    }

    function formatPercent(value) {
        const numericValue = toNumber(value);
        if (!Number.isFinite(numericValue)) {
            return "0%";
        }

        return `${numberFormatter.format(numericValue)}%`;
    }

    function normalizeBatch(item) {
        const batchId = item.id ?? item.batchId ?? null;
        const date = item.date ?? item.startTime ?? item.timestamp ?? "";
        const violationsCount = Number(item.violationsCount ?? item.violations ?? 0) || 0;

        return {
            id: batchId,
            date,
            dateKey: getDateKey(date),
            label: item.label ?? item.batchLabel ?? (batchId ? `Замес #${batchId}` : "Замес"),
            rationName: item.rationName ?? item.ration ?? "Без рациона",
            groupName: item.groupName ?? item.group ?? "Без группы",
            planTotal: toNumber(item.planTotal ?? item.plan ?? item.targetWeight) ?? 0,
            factTotal: toNumber(item.factTotal ?? item.fact ?? item.actualWeight) ?? 0,
            violationsCount,
            openViolationsCount: Number(item.openViolationsCount ?? 0) || 0,
            resolvedViolationsCount: Number(item.resolvedViolationsCount ?? 0) || 0,
            hasViolations: violationsCount > 0 || Boolean(item.hasViolations),
        };
    }

    function normalizeViolation(item) {
        const date = item.date ?? item.createdAt ?? item.timestamp ?? "";
        const batchId = item.batchId ?? item.id ?? null;
        const plan = toNumber(item.plan ?? item.planned ?? item.planWeight) ?? 0;
        const fact = toNumber(item.fact ?? item.actual ?? item.actualWeight) ?? 0;
        const deviation = toNumber(item.deviation ?? item.delta ?? (fact - plan)) ?? 0;

        return {
            batchId,
            date,
            dateKey: getDateKey(date),
            batchLabel: item.batchLabel ?? item.batch ?? (batchId ? `Замес #${batchId}` : "Замес"),
            groupName: item.groupName ?? item.group ?? "Без группы",
            component: item.component ?? item.componentName ?? "—",
            type: item.type ?? item.violationType ?? item.reason ?? "Нарушение",
            plan,
            fact,
            deviation,
        };
    }

    function normalizeTopItems(items) {
        if (!Array.isArray(items)) return [];
        return items
            .map((item) => ({
                name: String(item?.name || "—").trim() || "—",
                count: Number(item?.count || 0) || 0,
            }))
            .filter((item) => item.count > 0);
    }

    function normalizeSummary(summary) {
        const counts = summary?.counts || {};
        return {
            counts: {
                batches: Number(counts.batches || 0) || 0,
                batchesWithViolations: Number(counts.batchesWithViolations || 0) || 0,
                violationsTotal: Number(counts.violationsTotal || 0) || 0,
                violationsActive: Number(counts.violationsActive || 0) || 0,
                violationsResolved: Number(counts.violationsResolved || 0) || 0,
            },
            topComponents: normalizeTopItems(summary?.topComponents),
            topGroups: normalizeTopItems(summary?.topGroups),
        };
    }

    function sortByDateDesc(left, right) {
        const leftTime = parseDate(left.date)?.getTime() ?? 0;
        const rightTime = parseDate(right.date)?.getTime() ?? 0;
        return rightTime - leftTime;
    }

    function setDefaultPeriod() {
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 6);

        state.fromDate = formatDateValue(from);
        state.toDate = formatDateValue(today);
    }

    function syncFilterInputs() {
        if (elements.fromDate) {
            elements.fromDate.value = state.fromDate;
        }

        if (elements.toDate) {
            elements.toDate.value = state.toDate;
        }
    }

    function buildReportsUrl() {
        const url = new URL(API_URL, window.location.origin);
        if (state.fromDate) url.searchParams.set("from", state.fromDate);
        if (state.toDate) url.searchParams.set("to", state.toDate);
        url.searchParams.set("limit", String(DEFAULT_LIMIT));
        return url.toString();
    }

    function renderSourceState() {
        if (state.lastError) {
            elements.sourceBanner.className = "alert alert-light border-left-danger shadow-sm mb-4";
            elements.sourceBanner.textContent = `Не удалось загрузить данные из /api/reports: ${state.lastError}`;
            elements.sourceBadge.textContent = "Источник: API error";
            elements.sourceBadge.className = "reports-source-badge reports-source-badge--mock mr-2";
            return;
        }

        elements.sourceBanner.className = "alert alert-light border-left-success shadow-sm mb-4";
        elements.sourceBanner.textContent = "Данные загружены из /api/reports.";
        elements.sourceBadge.textContent = "Источник: API";
        elements.sourceBadge.className = "reports-source-badge mr-2";
    }

    function renderPeriodMeta() {
        const fromText = state.fromDate ? formatDateOnly(state.fromDate) : "—";
        const toText = state.toDate ? formatDateOnly(state.toDate) : "—";

        elements.periodMeta.textContent = `${fromText} - ${toText}`;
        elements.batchesMeta.textContent = `Показано ${state.batches.length} замесов`;
        elements.violationsMeta.textContent = `Показано ${state.violations.length} нарушений`;
    }

    function renderSummary() {
        const counts = state.summary.counts;
        const totalBatches = counts.batches;
        const problemBatches = counts.batchesWithViolations;
        const totalViolations = counts.violationsTotal;
        const openViolations = counts.violationsActive;
        const resolvedViolations = counts.violationsResolved;
        const rate = totalBatches > 0 ? (problemBatches / totalBatches) * 100 : 0;

        elements.batchesCount.textContent = String(totalBatches);
        elements.problemBatchesCount.textContent = String(problemBatches);
        elements.violationsCount.textContent = String(totalViolations);
        if (elements.openViolationsCount) elements.openViolationsCount.textContent = String(openViolations);
        if (elements.resolvedViolationsCount) elements.resolvedViolationsCount.textContent = String(resolvedViolations);
        elements.violationRate.textContent = formatPercent(Math.round(rate * 10) / 10);
        elements.quickStats.textContent = `${totalBatches} замесов · ${totalViolations} нарушений · ${openViolations} открыто`;
    }

    function renderTopList(container, items) {
        if (!container) return;
        if (!Array.isArray(items) || !items.length) {
            container.innerHTML = '<li class="text-muted">Нет данных за период</li>';
            return;
        }

        container.innerHTML = items.map((item) => (
            `<li><span class="font-weight-bold">${escapeHtml(item.name)}</span> · ${item.count}</li>`
        )).join("");
    }

    function renderTopProblems() {
        renderTopList(elements.topComponents, state.summary.topComponents);
        renderTopList(elements.topGroups, state.summary.topGroups);
    }

    function renderBatchesTable() {
        if (!state.batches.length) {
            elements.batchesTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="reports-empty-state">За выбранный период замесы не найдены.</td>
                </tr>
            `;
            return;
        }

        elements.batchesTableBody.innerHTML = state.batches.map((item) => {
            const statusClassName = item.hasViolations
                ? "reports-status reports-status--danger"
                : "reports-status reports-status--success";
            const statusLabel = item.hasViolations ? "Есть нарушения" : "Без нарушений";
            const batchHref = item.id
                ? `batch-details.html?id=${encodeURIComponent(item.id)}&date=${encodeURIComponent(item.dateKey)}`
                : "";
            const batchLabel = batchHref
                ? `<a class="reports-batch-link" href="${batchHref}">${escapeHtml(item.label)}</a>`
                : escapeHtml(item.label);

            return `
                <tr>
                    <td>
                        <div class="reports-cell-primary">${escapeHtml(formatDateTime(item.date))}</div>
                    </td>
                    <td>${batchLabel}</td>
                    <td>${escapeHtml(item.rationName)}</td>
                    <td>${escapeHtml(item.groupName)}</td>
                    <td><span class="reports-number">${escapeHtml(formatWeight(item.planTotal))}</span></td>
                    <td><span class="reports-number">${escapeHtml(formatWeight(item.factTotal))}</span></td>
                    <td><span class="reports-count-badge">${item.violationsCount}</span></td>
                    <td><span class="${statusClassName}">${statusLabel}</span></td>
                </tr>
            `;
        }).join("");
    }

    function renderViolationsTable() {
        if (!state.violations.length) {
            elements.violationsTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="reports-empty-state">За выбранный период нарушений не найдено.</td>
                </tr>
            `;
            return;
        }

        elements.violationsTableBody.innerHTML = state.violations.map((item) => {
            const deviationClassName = item.deviation > 0
                ? "reports-number reports-number--positive"
                : item.deviation < 0
                    ? "reports-number reports-number--negative"
                    : "reports-number";

            return `
                <tr>
                    <td>
                        <div class="reports-cell-primary">${escapeHtml(formatDateTime(item.date))}</div>
                    </td>
                    <td>${escapeHtml(item.batchLabel)}</td>
                    <td>${escapeHtml(item.groupName)}</td>
                    <td>${escapeHtml(item.component)}</td>
                    <td>${escapeHtml(item.type)}</td>
                    <td><span class="reports-number">${escapeHtml(formatWeight(item.plan))}</span></td>
                    <td><span class="reports-number">${escapeHtml(formatWeight(item.fact))}</span></td>
                    <td><span class="${deviationClassName}">${escapeHtml(formatSignedWeight(item.deviation))}</span></td>
                </tr>
            `;
        }).join("");
    }

    function render() {
        renderSourceState();
        renderPeriodMeta();
        renderSummary();
        renderTopProblems();
        renderBatchesTable();
        renderViolationsTable();
    }

    function normalizeApiPayload(payload) {
        const batches = Array.isArray(payload?.batches)
            ? payload.batches
            : Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload)
                    ? payload
                    : [];

        const violations = Array.isArray(payload?.violations) ? payload.violations : [];
        const summary = normalizeSummary(payload?.summary);

        if (!summary.counts.batches) summary.counts.batches = batches.length;
        if (!summary.counts.violationsTotal) summary.counts.violationsTotal = violations.length;
        if (!summary.counts.batchesWithViolations) {
            summary.counts.batchesWithViolations = batches.filter((item) => Number(item?.violationsCount || 0) > 0).length;
        }

        return {
            batches: batches.map(normalizeBatch).sort(sortByDateDesc),
            violations: violations.map(normalizeViolation).sort(sortByDateDesc),
            summary,
        };
    }

    function applyReportData(reportData, lastError = "") {
        state.batches = reportData.batches;
        state.violations = reportData.violations;
        state.summary = reportData.summary;
        state.lastError = lastError;
        render();
    }

    async function loadReports() {
        elements.periodMeta.textContent = "Загрузка...";
        elements.batchesMeta.textContent = "Загрузка...";
        elements.violationsMeta.textContent = "Загрузка...";

        try {
            const response = await fetch(buildReportsUrl(), {
                headers: window.AppAuth?.getAuthHeaders?.() || {},
                credentials: "same-origin",
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            const normalized = normalizeApiPayload(payload);
            applyReportData(normalized, "");
        } catch (error) {
            applyReportData({
                batches: [],
                violations: [],
                summary: {
                    counts: {
                        batches: 0,
                        batchesWithViolations: 0,
                        violationsTotal: 0,
                        violationsActive: 0,
                        violationsResolved: 0,
                    },
                    topComponents: [],
                    topGroups: [],
                },
            }, error?.message || "Не удалось загрузить API");
        }
    }

    function buildExportRows() {
        const summary = [
            ["Показатель", "Значение"],
            ["Период с", state.fromDate || ""],
            ["Период по", state.toDate || ""],
            ["Замесов", String(state.summary.counts.batches || 0)],
            ["Замесов с нарушениями", String(state.summary.counts.batchesWithViolations || 0)],
            ["Нарушений всего", String(state.summary.counts.violationsTotal || 0)],
            ["Открытых нарушений", String(state.summary.counts.violationsActive || 0)],
            ["Закрытых нарушений", String(state.summary.counts.violationsResolved || 0)],
        ];

        const batches = [
            ["Дата", "Замес", "Рацион", "Группа", "План", "Факт", "Нарушения", "Статус"],
            ...state.batches.map((item) => [
                formatDateTime(item.date),
                item.label,
                item.rationName,
                item.groupName,
                formatWeight(item.planTotal),
                formatWeight(item.factTotal),
                String(item.violationsCount),
                item.hasViolations ? "Есть нарушения" : "Без нарушений",
            ]),
        ];

        const violations = [
            ["Дата", "Замес", "Группа", "Компонент", "Тип", "План", "Факт", "Отклонение"],
            ...state.violations.map((item) => [
                formatDateTime(item.date),
                item.batchLabel,
                item.groupName,
                item.component,
                item.type,
                formatWeight(item.plan),
                formatWeight(item.fact),
                formatSignedWeight(item.deviation),
            ]),
        ];

        return { summary, batches, violations };
    }

    function buildExportTable(title, rows) {
        const body = rows.map((row, rowIndex) => {
            const cellTag = rowIndex === 0 ? "th" : "td";
            const cells = row.map((cell) => `<${cellTag}>${escapeHtml(cell)}</${cellTag}>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");

        return `
            <h2>${escapeHtml(title)}</h2>
            <table>
                <tbody>${body}</tbody>
            </table>
        `;
    }

    function exportToExcel() {
        const rows = buildExportRows();
        const html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office"
                  xmlns:x="urn:schemas-microsoft-com:office:excel"
                  xmlns="http://www.w3.org/TR/REC-html40">
                <head>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: Arial, sans-serif; }
                        h1, h2 { margin: 0 0 12px; }
                        h2 { margin-top: 24px; }
                        table { border-collapse: collapse; margin-bottom: 16px; width: 100%; }
                        th, td { border: 1px solid #cfd4dc; padding: 6px 8px; text-align: left; vertical-align: top; }
                        th { background: #eef3ff; }
                    </style>
                </head>
                <body>
                    <h1>Отчет по замесам и нарушениям</h1>
                    ${buildExportTable("Сводка", rows.summary)}
                    ${buildExportTable("Замесы", rows.batches)}
                    ${buildExportTable("Нарушения", rows.violations)}
                </body>
            </html>
        `;

        const blob = new Blob(["\ufeff", html], {
            type: "application/vnd.ms-excel;charset=utf-8;",
        });

        const fromPart = state.fromDate || "from";
        const toPart = state.toDate || "to";
        const fileName = `reports_${fromPart}_${toPart}.xls`;
        const link = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);

        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
    }

    function handleDateChange() {
        const nextFromDate = elements.fromDate?.value || "";
        const nextToDate = elements.toDate?.value || "";

        if (nextFromDate && nextToDate && nextFromDate > nextToDate) {
            window.AppAuth?.showAlert?.("Дата начала периода не может быть позже даты окончания.", "warning");
            syncFilterInputs();
            return;
        }

        state.fromDate = nextFromDate;
        state.toDate = nextToDate;
        loadReports();
    }

    function bindEvents() {
        elements.fromDate?.addEventListener("change", handleDateChange);
        elements.toDate?.addEventListener("change", handleDateChange);
        elements.reloadButton?.addEventListener("click", loadReports);
        elements.exportButton?.addEventListener("click", exportToExcel);
    }

    function init() {
        setDefaultPeriod();
        syncFilterInputs();
        bindEvents();
        loadReports();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
