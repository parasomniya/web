$(document).ready(function () {
    const query = new URLSearchParams(window.location.search);
    const batchId = parsePositiveInteger(query.get("id"));
    const returnDate = normalizeDateValue(query.get("date"));

    const detailsTitle = document.getElementById("batchDetailsTitle");
    const detailsPageTitle = document.getElementById("batchDetailsPageTitle");
    const rationName = document.getElementById("batchDetailsRationName");
    const startTime = document.getElementById("batchDetailsStartTime");
    const endTime = document.getElementById("batchDetailsEndTime");
    const barnName = document.getElementById("batchDetailsBarnName");
    const remainingWeight = document.getElementById("batchDetailsRemainingWeight");
    const backLink = document.getElementById("batchDetailsBackLink");
    const ingredientListBody = document.getElementById("batchIngredientsTableBody");
    const planFactBody = document.getElementById("batchPlanFactTableBody");
    const planTotal = document.getElementById("batchPlanTotal");
    const factTotal = document.getElementById("batchFactTotal");
    const deviationTotal = document.getElementById("batchDeviationTotal");
    const telemetryEmpty = document.getElementById("batchTelemetryEmpty");
    const telemetryCanvas = document.getElementById("batchTelemetryChart");

    const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    const weightFormatter = new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    });

    let telemetryChart = null;

    function parsePositiveInteger(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function normalizeDateValue(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
    }

    function buildBackLink() {
        const url = new URL("tables.html", window.location.href);

        if (returnDate) {
            url.searchParams.set("date", returnDate);
        }

        return url.toString();
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function asBoolean(value) {
        if (typeof value === "boolean") {
            return value;
        }

        if (typeof value === "number") {
            return value !== 0;
        }

        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            return normalized === "true" || normalized === "1" || normalized === "yes";
        }

        return false;
    }

    function toNumber(value) {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function formatDateTime(value) {
        if (!value) {
            return "--";
        }

        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
            return "--";
        }

        return dateTimeFormatter.format(parsedDate);
    }

    function formatTime(value) {
        if (!value) {
            return "--";
        }

        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
            return "--";
        }

        return timeFormatter.format(parsedDate);
    }

    function formatWeight(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "--";
        }

        return `${weightFormatter.format(numericValue)} кг`;
    }

    function formatSignedWeight(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "--";
        }

        const prefix = numericValue > 0 ? "+" : "";
        return `${prefix}${weightFormatter.format(numericValue)} кг`;
    }

    function renderViolationBadge(value) {
        return `
            <span class="dashboard-bool-badge ${value ? "is-yes" : "is-no"}">
                ${value ? "Да" : "Нет"}
            </span>
        `;
    }

    function setText(element, value) {
        if (!element) {
            return;
        }

        element.textContent = value ?? "--";
    }

    function setLoadingState() {
        setText(detailsTitle, "Загрузка...");
        setText(detailsPageTitle, "Детали замеса");
        setText(rationName, "--");
        setText(startTime, "--");
        setText(endTime, "--");
        setText(barnName, "--");
        setText(remainingWeight, "--");
        setText(planTotal, "--");
        setText(factTotal, "--");
        setText(deviationTotal, "--");

        if (ingredientListBody) {
            ingredientListBody.innerHTML = '<tr><td colspan="4" class="batch-detail-empty">Загрузка...</td></tr>';
        }

        if (planFactBody) {
            planFactBody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">Загрузка...</td></tr>';
        }
    }

    function renderBatchSummary(batch) {
        const title = batch?.id ? `Замес #${batch.id}` : "Замес";
        document.title = `${title} | Детали`;

        setText(detailsTitle, title);
        setText(detailsPageTitle, title);
        setText(rationName, batch?.rationName || "Без рациона");
        setText(startTime, formatDateTime(batch?.startTime));
        setText(endTime, batch?.endTime ? formatDateTime(batch.endTime) : "В процессе");
        setText(barnName, batch?.unloadingInfo?.barnName || "Коровник не выбран");
        setText(remainingWeight, formatWeight(batch?.unloadingInfo?.remainingWeight));
    }

    function renderIngredientList(rows) {
        if (!ingredientListBody) {
            return;
        }

        if (!rows.length) {
            ingredientListBody.innerHTML = '<tr><td colspan="4" class="batch-detail-empty">По этому замесу нет загруженных ингредиентов</td></tr>';
            return;
        }

        ingredientListBody.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(formatTime(row?.time))}</td>
                <td><strong>${escapeHtml(row?.name || "Без названия")}</strong></td>
                <td>${escapeHtml(formatWeight(row?.fact))}</td>
                <td>${renderViolationBadge(asBoolean(row?.isViolation))}</td>
            </tr>
        `).join("");
    }

    function renderPlanFact(rows) {
        if (!planFactBody) {
            return;
        }

        if (!rows.length) {
            planFactBody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">Нет данных по плану и факту</td></tr>';
            setText(planTotal, "--");
            setText(factTotal, "--");
            setText(deviationTotal, "--");
            return;
        }

        const totals = rows.reduce((acc, row) => {
            acc.plan += toNumber(row?.plan);
            acc.fact += toNumber(row?.fact);
            acc.deviation += toNumber(row?.deviation);
            return acc;
        }, { plan: 0, fact: 0, deviation: 0 });

        setText(planTotal, formatWeight(totals.plan));
        setText(factTotal, formatWeight(totals.fact));
        setText(deviationTotal, formatSignedWeight(totals.deviation));

        planFactBody.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(row?.name || "Без названия")}</td>
                <td>${escapeHtml(formatWeight(row?.plan))}</td>
                <td>${escapeHtml(formatWeight(row?.fact))}</td>
                <td>${escapeHtml(formatSignedWeight(row?.deviation))}</td>
                <td>${renderViolationBadge(asBoolean(row?.isViolation))}</td>
            </tr>
        `).join("");
    }

    function destroyTelemetryChart() {
        if (!telemetryChart) {
            return;
        }

        telemetryChart.destroy();
        telemetryChart = null;
    }

    function renderTelemetry(points) {
        if (!telemetryCanvas || !telemetryEmpty) {
            return;
        }

        const rows = Array.isArray(points) ? points : [];

        if (!rows.length) {
            destroyTelemetryChart();
            telemetryCanvas.classList.add("d-none");
            telemetryEmpty.classList.remove("d-none");
            return;
        }

        telemetryCanvas.classList.remove("d-none");
        telemetryEmpty.classList.add("d-none");
        destroyTelemetryChart();

        const context = telemetryCanvas.getContext("2d");
        telemetryChart = new Chart(context, {
            type: "line",
            data: {
                labels: rows.map((point) => formatTime(point?.timestamp)),
                datasets: [
                    {
                        label: "Вес, кг",
                        data: rows.map((point) => toNumber(point?.weight)),
                        borderColor: "#4e73df",
                        backgroundColor: "rgba(78, 115, 223, 0.12)",
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        lineTension: 0.18,
                        fill: true,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                legend: {
                    display: false,
                },
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem) {
                            return `Вес: ${weightFormatter.format(tooltipItem.yLabel)} кг`;
                        },
                    },
                },
                scales: {
                    xAxes: [
                        {
                            gridLines: {
                                display: false,
                            },
                            ticks: {
                                maxTicksLimit: 8,
                            },
                        },
                    ],
                    yAxes: [
                        {
                            ticks: {
                                callback: function (value) {
                                    return `${weightFormatter.format(value)} кг`;
                                },
                            },
                        },
                    ],
                },
            },
        });
    }

    async function readErrorMessage(response) {
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            try {
                const payload = await response.json();
                return payload?.error || payload?.message || "";
            } catch (error) {
                return "";
            }
        }

        try {
            return (await response.text()).trim();
        } catch (error) {
            return "";
        }
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            method: "GET",
            headers: window.AppAuth?.getAuthHeaders?.() || {},
        });

        if (!response.ok) {
            const message = await readErrorMessage(response);
            throw new Error(message || "Не удалось загрузить данные");
        }

        return response.json();
    }

    async function loadBatchDetails() {
        if (!batchId) {
            setText(detailsTitle, "Замес не найден");
            setText(detailsPageTitle, "Детали замеса");
            window.AppAuth?.showAlert?.("Не указан идентификатор замеса", "danger");
            return;
        }

        setLoadingState();

        try {
            const [batch, telemetry] = await Promise.all([
                fetchJson(window.AppAuth?.getApiUrl?.(`/api/batches/${batchId}`) || `/api/batches/${batchId}`),
                fetchJson(window.AppAuth?.getApiUrl?.(`/api/batches/${batchId}/telemetry`) || `/api/batches/${batchId}/telemetry`),
            ]);

            const rows = Array.isArray(batch?.ingredients) ? batch.ingredients : [];

            renderBatchSummary(batch);
            renderIngredientList(rows);
            renderPlanFact(rows);
            renderTelemetry(telemetry);
        } catch (error) {
            console.error("Ошибка загрузки деталей замеса:", error);
            setText(detailsTitle, batchId ? `Замес #${batchId}` : "Замес");
            window.AppAuth?.showAlert?.(error.message || "Не удалось загрузить детали замеса", "danger");

            if (ingredientListBody) {
                ingredientListBody.innerHTML = '<tr><td colspan="4" class="batch-detail-empty">Не удалось загрузить данные</td></tr>';
            }

            if (planFactBody) {
                planFactBody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">Не удалось загрузить данные</td></tr>';
            }

            renderTelemetry([]);
        }
    }

    if (backLink) {
        backLink.href = buildBackLink();
    }

    loadBatchDetails();
});
