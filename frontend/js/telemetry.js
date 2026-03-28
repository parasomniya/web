const POLL_INTERVAL_MS = 5000;
const HISTORY_LIMIT = 20;

const endpoints = {
    host: {
        latest: "/api/telemetry/host/latest",
        history: `/api/telemetry/host/history?limit=${HISTORY_LIMIT}`,
    },
    events: {
        history: "/api/events?limit=500",
    },
    rtk: {
        latest: "/api/telemetry/rtk/latest",
        history: `/api/telemetry/rtk/history?limit=${HISTORY_LIMIT}`,
    },
};

function getHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDateTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("ru-RU");
}

function formatNumber(value, digits = 5) {
    if (value === null || value === undefined || value === "") return "--";
    const number = Number(value);
    return Number.isNaN(number) ? "--" : number.toFixed(digits);
}

function formatShortNumber(value, digits = 1) {
    if (value === null || value === undefined || value === "") return "--";
    const number = Number(value);
    return Number.isNaN(number) ? "--" : number.toFixed(digits);
}

function boolBadge(value) {
    const enabled = value === true || value === 1 || value === "true";
    return `<span class="telemetry-badge ${enabled ? "ok" : "warn"}">${enabled ? "Да" : "Нет"}</span>`;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function setStatus(id, label, mode) {
    const element = document.getElementById(id);
    if (element) {
        element.innerHTML = `<span class="telemetry-badge ${mode}">${label}</span>`;
    }
}

function formatWifiClients(value) {
    if (!value) return "--";
    if (Array.isArray(value)) return `${value.length} шт`;
    if (typeof value === "string" && value.startsWith("[")) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.join(", ") || "[]" : value;
        } catch (error) {
            return value;
        }
    }
    if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}...` : value;
    return "--";
}

function formatExtra(row) {
    const parts = [];
    if (row.speed != null) parts.push(`speed:${formatShortNumber(row.speed, 1)}`);
    if (row.course != null) parts.push(`course:${formatShortNumber(row.course, 0)}`);
    if (row.supplyVoltage != null) parts.push(`voltage:${formatShortNumber(row.supplyVoltage, 1)}`);
    return parts.length ? parts.join(", ") : "--";
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: getHeaders() });

    if (response.status === 404) {
        return { missing: true };
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

function renderHostSummary(latest) {
    setText("hostStatus", latest ? "Онлайн" : "Нет данных");
    setText("hostDevice", latest?.deviceId || "--");
    setText("hostTemperature", latest?.cpuTempC != null ? `${formatShortNumber(latest.cpuTempC, 1)} °C` : "--");
    setText("hostWeight", latest?.weight != null ? `${formatShortNumber(latest.weight, 1)} кг` : "--");
    setText("hostSatellites", latest?.gpsSatellites != null ? String(latest.gpsSatellites) : "--");
    setText("hostCoordinates", latest ? `${formatNumber(latest.lat)}, ${formatNumber(latest.lon)}` : "--");
}

function renderHostTable(rows) {
    const tbody = document.getElementById("hostTelemetryTable");
    if (!tbody) return;

    if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="telemetry-empty-state">По host пока нет записей.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((row) => `
        <tr>
            <td>${row.id ?? "--"}</td>
            <td>${formatDateTime(row.timestamp)}</td>
            <td>${formatNumber(row.lat)}</td>
            <td>${formatNumber(row.lon)}</td>
            <td>${boolBadge(row.gpsValid)}</td>
            <td>${row.gpsSatellites ?? "--"}</td>
            <td>${row.weight != null ? formatShortNumber(row.weight, 1) : "--"}</td>
            <td>${boolBadge(row.weightValid)}</td>
            <td>${row.gpsQuality ?? "--"}</td>
            <td>${formatWifiClients(row.wifiClients)}</td>
            <td>${row.cpuTempC != null ? formatShortNumber(row.cpuTempC, 1) : "--"}</td>
            <td>${row.lteRssiDbm ?? "--"}</td>
            <td>${row.lteAccessTech || "--"}</td>
            <td>${boolBadge(row.eventsReaderOk)}</td>
        </tr>
    `).join("");
}

function renderLatestSms(event) {
    setText("latestSmsTimestamp", formatDateTime(event?.timestamp));
    setText("latestSmsFrom", event?.fromNumber || "--");
    setText("latestSmsType", event?.type || "--");
    setText("latestSmsText", event?.text || "--");
}

function renderEventsTable(events) {
    const tbody = document.getElementById("eventsTable");
    if (!tbody) return;

    if (!Array.isArray(events) || events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="telemetry-empty-state">За последний месяц событий нет.</td></tr>';
        return;
    }

    tbody.innerHTML = events.map((event) => `
        <tr>
            <td>${event.id ?? "--"}</td>
            <td>${event.type || "--"}</td>
            <td>${formatDateTime(event.timestamp)}</td>
            <td>${event.fromNumber || "--"}</td>
            <td class="telemetry-extra">${event.text || "--"}</td>
            <td>${formatDateTime(event.createdAt)}</td>
        </tr>
    `).join("");
}

async function loadEvents() {
    try {
        const events = await fetchJson(endpoints.events.history);
        const rows = Array.isArray(events) ? events : [];
        const monthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const monthEvents = rows.filter((event) => {
            const timestamp = new Date(event.timestamp).getTime();
            return !Number.isNaN(timestamp) && timestamp >= monthAgo;
        });
        const latestSms = monthEvents.find((event) => event.type === "sms") || null;

        renderLatestSms(latestSms);
        renderEventsTable(monthEvents);
        setStatus("eventsPanelStatus", monthEvents.length ? "События загружены" : "Событий нет", monthEvents.length ? "ok" : "warn");
    } catch (error) {
        renderLatestSms(null);
        renderEventsTable([]);
        setStatus("eventsPanelStatus", "Нет доступа к событиям", "offline");
    }
}

function renderRtkSummary(latest, missing) {
    setText("rtkStatus", missing ? "API не подключён" : latest ? "Онлайн" : "Нет данных");
    setText("rtkDevice", latest?.deviceId || "--");
    setText("rtkLastPacket", formatDateTime(latest?.timestamp));
    setText("rtkQuality", latest?.rtkQuality || latest?.gpsQuality || "--");
    setText("rtkAge", latest?.rtkAge != null ? `${formatShortNumber(latest.rtkAge, 1)} c` : "--");
    setText("rtkCoordinates", latest ? `${formatNumber(latest.lat)}, ${formatNumber(latest.lon)}` : "--");
}

function renderRtkTable(rows, missing) {
    const tbody = document.getElementById("rtkTelemetryTable");
    if (!tbody) return;

    if (missing) {
        tbody.innerHTML = '<tr><td colspan="10" class="telemetry-empty-state">В текущем backend нет отдельного RTK API, поэтому секция оставлена готовой под подключение.</td></tr>';
        return;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="telemetry-empty-state">По RTK пока нет записей.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((row) => `
        <tr>
            <td>${formatDateTime(row.timestamp)}</td>
            <td>${row.deviceId || "--"}</td>
            <td>${formatNumber(row.lat)}</td>
            <td>${formatNumber(row.lon)}</td>
            <td>${row.rtkQuality || row.gpsQuality || "--"}</td>
            <td>${row.rtkAge != null ? `${formatShortNumber(row.rtkAge, 1)} c` : "--"}</td>
            <td>${row.speed != null ? `${formatShortNumber(row.speed, 1)} км/ч` : "--"}</td>
            <td>${row.course != null ? `${formatShortNumber(row.course, 0)}°` : "--"}</td>
            <td>${row.supplyVoltage != null ? `${formatShortNumber(row.supplyVoltage, 1)} В` : "--"}</td>
            <td class="telemetry-extra">${formatExtra(row)}</td>
        </tr>
    `).join("");
}

async function loadHost() {
    try {
        const [latest, history] = await Promise.all([
            fetchJson(endpoints.host.latest),
            fetchJson(endpoints.host.history),
        ]);

        renderHostSummary(latest.missing ? null : latest);
        renderHostTable(Array.isArray(history) ? history : []);
        setStatus("hostPanelStatus", latest?.deviceId ? "Поток активен" : "Нет данных", latest?.deviceId ? "ok" : "warn");
    } catch (error) {
        renderHostSummary(null);
        renderHostTable([]);
        setStatus("hostPanelStatus", "Ошибка загрузки", "offline");
    }
}

async function loadRtk() {
    try {
        const [latest, history] = await Promise.all([
            fetchJson(endpoints.rtk.latest),
            fetchJson(endpoints.rtk.history),
        ]);

        const missing = Boolean(latest.missing || history.missing);
        renderRtkSummary(missing ? null : latest, missing);
        renderRtkTable(Array.isArray(history) ? history : [], missing);
        setStatus("rtkPanelStatus", missing ? "API не подключён" : "Поток активен", missing ? "warn" : "ok");
    } catch (error) {
        renderRtkSummary(null, true);
        renderRtkTable([], true);
        setStatus("rtkPanelStatus", "Нет связи", "offline");
    }
}

function bindTabs() {
    const buttons = document.querySelectorAll("[data-source]");
    const panels = document.querySelectorAll("[data-panel]");

    buttons.forEach((button) => {
        button.addEventListener("click", () => {
            const currentSource = button.dataset.source;
            buttons.forEach((item) => item.classList.toggle("active", item === button));
            panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === currentSource));
        });
    });
}

function updateSyncTime() {
    setText("telemetryLastSync", `Последняя синхронизация: ${new Date().toLocaleTimeString("ru-RU")}`);
}

async function refreshTelemetry() {
    await Promise.all([loadHost(), loadRtk(), loadEvents()]);
    updateSyncTime();
}

bindTabs();
refreshTelemetry();
setInterval(refreshTelemetry, POLL_INTERVAL_MS);
