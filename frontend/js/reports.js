(function () {
    const API_URL = window.AppAuth?.getApiUrl?.("/api/reports") || "/api/reports";

    const MOCK_REPORT = {
        batches: [
            {
                id: 2420,
                date: "2026-04-29T07:42:00+07:00",
                rationName: "Рацион для группы 7",
                groupName: "Группа 7",
                planTotal: 992,
                factTotal: 963,
                violationsCount: 2,
            },
            {
                id: 2419,
                date: "2026-04-29T06:18:00+07:00",
                rationName: "Рацион для группы 12",
                groupName: "Группа 12",
                planTotal: 1380,
                factTotal: 1328,
                violationsCount: 1,
            },
            {
                id: 2417,
                date: "2026-04-28T16:25:00+07:00",
                rationName: "Лактация 2",
                groupName: "Группа 4",
                planTotal: 1210,
                factTotal: 1191,
                violationsCount: 1,
            },
            {
                id: 2416,
                date: "2026-04-28T15:54:00+07:00",
                rationName: "Откорм 1",
                groupName: "Группа 2",
                planTotal: 810,
                factTotal: 816,
                violationsCount: 0,
            },
            {
                id: 2410,
                date: "2026-04-27T18:04:00+07:00",
                rationName: "Сухостой",
                groupName: "Группа 9",
                planTotal: 605,
                factTotal: 605,
                violationsCount: 1,
            },
            {
                id: 2408,
                date: "2026-04-27T11:10:00+07:00",
                rationName: "Лактация 1",
                groupName: "Группа 5",
                planTotal: 1280,
                factTotal: 1283,
                violationsCount: 0,
            },
        ],
        violations: [
            {
                batchId: 2420,
                date: "2026-04-29T07:42:00+07:00",
                batchLabel: "Замес #2420",
                groupName: "Группа 7",
                component: "Жом свекловичный",
                type: "Перевложение",
                plan: 160,
                fact: 183,
                deviation: 23,
            },
            {
                batchId: 2420,
                date: "2026-04-29T08:10:00+07:00",
                batchLabel: "Замес #2420",
                groupName: "Группа 7",
                component: "Премикс",
                type: "Пропуск компонента",
                plan: 12,
                fact: 0,
                deviation: -12,
            },
            {
                batchId: 2419,
                date: "2026-04-29T06:18:00+07:00",
                batchLabel: "Замес #2419",
                groupName: "Группа 12",
                component: "Кукурузный силос",
                type: "Недовложение",
                plan: 820,
                fact: 768,
                deviation: -52,
            },
            {
                batchId: 2417,
                date: "2026-04-28T16:25:00+07:00",
                batchLabel: "Замес #2417",
                groupName: "Группа 4",
                component: "Сенаж люцерновый",
                type: "Недовложение",
                plan: 540,
                fact: 521,
                deviation: -19,
            },
            {
                batchId: 2410,
                date: "2026-04-27T18:04:00+07:00",
                batchLabel: "Замес #2410",
                groupName: "Группа 9",
                component: "Минеральная добавка",
                type: "Ошибка выбора группы",
                plan: 25,
                fact: 25,
                deviation: 0,
            },
        ],
    };

    const state = {
        batches: [],
        violations: [],
        filteredBatches: [],
        filteredViolations: [],
        fromDate: "",
        toDate: "",
        usingMock: false,
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
        violationRate: document.getElementById("reportsViolationRate"),
        batchesMeta: document.getElementById("reportsBatchesMeta"),
        violationsMeta: document.getElementById("reportsViolationsMeta"),
        batchesTableBody: document.getElementById("reportsBatchesTableBody"),
        violationsTableBody: document.getElementById("reportsViolationsTableBody"),
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

    function sortByDateDesc(left, right) {
        const leftTime = parseDate(left.date)?.getTime() ?? 0;
        const rightTime = parseDate(right.date)?.getTime() ?? 0;
        return rightTime - leftTime;
    }

    function buildDefaultPeriod() {
        const allDates = state.batches
            .concat(state.violations)
            .map((item) => parseDate(item.date))
            .filter(Boolean)
            .sort((left, right) => right.getTime() - left.getTime());

        const latestDate = allDates[0] || new Date();
        const startDate = new Date(latestDate);
        startDate.setDate(startDate.getDate() - 6);

        state.fromDate = formatDateValue(startDate);
        state.toDate = formatDateValue(latestDate);
    }

    function isWithinRange(dateKey) {
        if (!dateKey) {
            return false;
        }

        if (state.fromDate && dateKey < state.fromDate) {
            return false;
        }

        if (state.toDate && dateKey > state.toDate) {
            return false;
        }

        return true;
    }

    function filterData() {
        state.filteredBatches = state.batches.filter((item) => isWithinRange(item.dateKey));
        state.filteredViolations = state.violations.filter((item) => isWithinRange(item.dateKey));
    }

    function renderSummary() {
        const totalBatches = state.filteredBatches.length;
        const problemBatches = state.filteredBatches.filter((item) => item.hasViolations).length;
        const totalViolations = state.filteredViolations.length;
        const rate = totalBatches > 0 ? (problemBatches / totalBatches) * 100 : 0;

        elements.batchesCount.textContent = String(totalBatches);
        elements.problemBatchesCount.textContent = String(problemBatches);
        elements.violationsCount.textContent = String(totalViolations);
        elements.violationRate.textContent = formatPercent(Math.round(rate * 10) / 10);
        elements.quickStats.textContent = `${totalBatches} замесов · ${totalViolations} нарушений`;
    }

    function renderSourceState() {
        if (state.usingMock) {
            elements.sourceBanner.className = "alert alert-light border-left-warning shadow-sm mb-4";
            elements.sourceBanner.textContent = "Бэкенд для /api/reports пока не подключен, поэтому страница показывает фронтовый mock-отчет.";
            elements.sourceBadge.textContent = "Источник: mock";
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
        elements.batchesMeta.textContent = `Показано ${state.filteredBatches.length} замесов`;
        elements.violationsMeta.textContent = `Показано ${state.filteredViolations.length} нарушений`;
    }

    function renderBatchesTable() {
        if (!state.filteredBatches.length) {
            elements.batchesTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="reports-empty-state">За выбранный период замесы не найдены.</td>
                </tr>
            `;
            return;
        }

        elements.batchesTableBody.innerHTML = state.filteredBatches.map((item) => {
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
        if (!state.filteredViolations.length) {
            elements.violationsTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="reports-empty-state">За выбранный период нарушений не найдено.</td>
                </tr>
            `;
            return;
        }

        elements.violationsTableBody.innerHTML = state.filteredViolations.map((item) => {
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
        filterData();
        renderSourceState();
        renderPeriodMeta();
        renderSummary();
        renderBatchesTable();
        renderViolationsTable();
    }

    function syncFilterInputs() {
        if (elements.fromDate) {
            elements.fromDate.value = state.fromDate;
        }

        if (elements.toDate) {
            elements.toDate.value = state.toDate;
        }
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

        return {
            batches: batches.map(normalizeBatch).sort(sortByDateDesc),
            violations: violations.map(normalizeViolation).sort(sortByDateDesc),
        };
    }

    function applyReportData(reportData, usingMock) {
        state.batches = reportData.batches.map(normalizeBatch).sort(sortByDateDesc);
        state.violations = reportData.violations.map(normalizeViolation).sort(sortByDateDesc);
        state.usingMock = usingMock;
        buildDefaultPeriod();
        syncFilterInputs();
        render();
    }

    async function loadReports() {
        elements.periodMeta.textContent = "Загрузка...";
        elements.batchesMeta.textContent = "Загрузка...";
        elements.violationsMeta.textContent = "Загрузка...";

        try {
            const response = await fetch(API_URL, {
                headers: window.AppAuth?.getAuthHeaders?.() || {},
                credentials: "same-origin",
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            const normalized = normalizeApiPayload(payload);

            if (!normalized.batches.length && !normalized.violations.length) {
                throw new Error("EMPTY_PAYLOAD");
            }

            applyReportData(normalized, false);
        } catch (error) {
            applyReportData(MOCK_REPORT, true);
        }
    }

    function buildExportRows() {
        const summary = [
            ["Показатель", "Значение"],
            ["Период с", state.fromDate || ""],
            ["Период по", state.toDate || ""],
            ["Замесов", String(state.filteredBatches.length)],
            ["Замесов с нарушениями", String(state.filteredBatches.filter((item) => item.hasViolations).length)],
            ["Нарушений", String(state.filteredViolations.length)],
        ];

        const batches = [
            ["Дата", "Замес", "Рацион", "Группа", "План", "Факт", "Нарушения", "Статус"],
            ...state.filteredBatches.map((item) => [
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
            ...state.filteredViolations.map((item) => [
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
        render();
    }

    function bindEvents() {
        elements.fromDate?.addEventListener("change", handleDateChange);
        elements.toDate?.addEventListener("change", handleDateChange);
        elements.reloadButton?.addEventListener("click", loadReports);
        elements.exportButton?.addEventListener("click", exportToExcel);
    }

    function init() {
        bindEvents();
        loadReports();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
