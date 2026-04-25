(function () {
    async function readDashboardErrorMessage(response) {
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

    renderUnloadProgress = function (mode, unloadProgress) {
        const isVisible = getModeLabel(mode) === "Выгрузка";
        const bar = document.getElementById("dashboardUnloadProgressBar");
        const targetValue = parseNumber(unloadProgress?.target_weight);
        const factValue = parseNumber(unloadProgress?.unloaded_fact);
        const hasProgressData = targetValue !== null || factValue !== null;

        setSectionVisible("dashboardUnloadProgressCard", Boolean(isVisible));

        if (!bar) {
            return;
        }

        if (!isVisible) {
            bar.style.width = "0%";
            bar.classList.remove("is-over");
            setText("dashboardUnloadProgressMeta", "--");
            return;
        }

        if (!hasProgressData) {
            bar.style.width = "0%";
            bar.classList.remove("is-over");
            setText("dashboardUnloadProgressMeta", "--");
            return;
        }

        const target = Math.max(targetValue ?? 0, 0);
        const fact = Math.max(factValue ?? 0, 0);
        const progress = target > 0 ? (fact / target) * 100 : 0;
        const fillPercent = Math.max(Math.min(progress, 100), 0);

        bar.style.width = `${fillPercent}%`;
        bar.classList.toggle("is-over", progress > 100);
        setText(
            "dashboardUnloadProgressMeta",
            `${formatMetric(fact, 1)} / ${formatMetric(target, 1)} кг (${progress.toFixed(0)}%)`
        );
    };

    renderActiveBatch = function (batch) {
        const tbody = document.getElementById("dashboardActiveBatchTableBody");
        if (!tbody) {
            return;
        }

        const rows = Array.isArray(batch?.ingredients) ? batch.ingredients : [];
        const isVisible = rows.length > 0;

        setSectionVisible("dashboardActiveBatchCard", isVisible);

        if (!isVisible) {
            setText("dashboardActiveBatchMeta", "--");
            tbody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">--</td></tr>';
            return;
        }

        const metaParts = [];
        if (batch?.id != null) {
            metaParts.push(`Замес #${batch.id}`);
        }
        metaParts.push(`Компонентов: ${rows.length}`);

        setText("dashboardActiveBatchMeta", metaParts.join(" | "));

        tbody.innerHTML = rows.map((row) => {
            const name = escapeHtml(row?.name ?? "--");
            const plan = formatMetric(row?.plan, 1);
            const fact = formatMetric(row?.fact, 1);
            const deviation = formatSignedPercent(row?.deviation_percent, 1);
            const isViolation = asBoolean(row?.is_violation);

            return `
                <tr>
                    <td>${name}</td>
                    <td>${plan}</td>
                    <td>${fact}</td>
                    <td>${deviation}</td>
                    <td>
                        <span class="dashboard-bool-badge ${isViolation ? "is-yes" : "is-no"}">
                            ${isViolation ? "Да" : "Нет"}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");
    };

    renderDashboard = function (data) {
        updateCurrentStateNotice(data);

        if (isEmptyTelemetry(data)) {
            resetTelemetryActivity();
            setVehicleStatus(false);
            setText("dashboardCurrentZone", "--");
            renderModeBadge(data?.mode);
            setText("dashboardCurrentWeight", "--");
            setText(
                "dashboardLastPacketTime",
                latestFetchState.status === "loading" && !latestFetchState.hasLoadedAtLeastOnce
                    ? "Загрузка..."
                    : "--"
            );
            renderUnloadProgress(data?.mode, data?.unload_progress);
            renderActiveBatch(data?.active_batch);
            hidePlacemark();
            hasLiveCoordinates = false;
            syncMapActionButtons();
            return;
        }

        const isOnline = isTelemetryOnline(data);
        const hasCoordinates = hasValidCoordinates(data.lat, data.lon);
        const parsedLat = Number(data.lat);
        const parsedLon = Number(data.lon);
        const zoneName = hasCoordinates
            ? (getCurrentZoneName(parsedLat, parsedLon) || data?.banner?.zoneName || "Вне зоны")
            : "--";

        setVehicleStatus(isOnline);
        setText("dashboardCurrentZone", zoneName);
        renderModeBadge(data?.mode);
        setText("dashboardCurrentWeight", data.weight != null ? `${formatMetric(data.weight, 1)} кг` : "--");
        setText("dashboardLastPacketTime", formatDateTime(data.timestamp));
        renderUnloadProgress(data?.mode, data?.unload_progress);
        renderActiveBatch(data?.active_batch);

        updateMapPosition(data, isOnline);
    };

    fetchLatest = async function () {
        try {
            const response = await fetch(getLatestApiUrl(), { headers: getHeaders() });
            if (!response.ok) {
                const errorMessage = await readDashboardErrorMessage(response);
                latestFetchState.status = !isEmptyTelemetry(latestTelemetry) ? "stale" : "error";
                latestFetchState.errorMessage = errorMessage || "Не удалось обновить текущее состояние.";
                renderDashboard(latestTelemetry);
                return;
            }

            latestTelemetry = await response.json();
            latestFetchState.hasLoadedAtLeastOnce = true;
            latestFetchState.status = isEmptyTelemetry(latestTelemetry) ? "empty" : "ready";
            latestFetchState.errorMessage = "";

            noteTelemetryActivity(latestTelemetry);
            if (latestTelemetry.banner) {
                showBanner(latestTelemetry.banner);
            } else if (currentBannerType && currentBannerType !== "zone_enter") {
                showBanner(null);
            }

            renderDashboard(latestTelemetry);
        } catch (error) {
            console.error("Error fetching latest:", error);
            latestFetchState.status = !isEmptyTelemetry(latestTelemetry) ? "stale" : "error";
            latestFetchState.errorMessage = "Не удалось обновить текущее состояние.";
            renderDashboard(latestTelemetry);
        }
    };

    renderDashboard(latestTelemetry);
})();
