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
        const isVisible = isUnloadMode(mode) && unloadProgress;
        const bar = document.getElementById("dashboardUnloadProgressBar");

        setSectionVisible("dashboardUnloadProgressCard", Boolean(isVisible));

        if (!bar) {
            return;
        }

        if (!isVisible) {
            bar.style.width = "0%";
            setText("dashboardUnloadProgressMeta", "--");
            return;
        }

        const target = Math.max(parseNumber(unloadProgress?.target_weight) ?? 0, 0);
        const fact = Math.max(parseNumber(unloadProgress?.unloaded_fact) ?? 0, 0);
        const progress = target > 0 ? Math.min((fact / target) * 100, 100) : 0;

        bar.style.width = `${progress}%`;
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

        const rows = getActiveBatchRows(batch);
        const isVisible = Boolean(batch);

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

        if (!rows.length) {
            setText("dashboardActiveBatchMeta", metaParts.join(" | "));
            tbody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">Компоненты текущего замеса ещё не поступили</td></tr>';
            return;
        }

        const normalizedRows = rows.map((row) => {
            const planNumber = getBatchPlanNumber(row);
            const factNumber = parseNumber(row?.fact ?? row?.actualWeight);
            const deviationPercent = getBatchDeviationPercent(row, planNumber, factNumber);

            return {
                name: escapeHtml(row?.name ?? row?.ingredientName ?? "--"),
                plan: formatBatchMetricValue(planNumber, 1),
                fact: formatBatchMetricValue(factNumber, 1),
                deviation: formatSignedPercent(deviationPercent, 1),
                isViolation: asBoolean(row?.is_violation ?? row?.isViolation),
                hasPlan: planNumber !== null,
            };
        });

        if (!normalizedRows.some((row) => row.hasPlan)) {
            metaParts.push("план пока не передан");
        }

        setText("dashboardActiveBatchMeta", metaParts.join(" | "));

        tbody.innerHTML = normalizedRows.map((row) => `
            <tr>
                <td>${row.name}</td>
                <td>${row.plan}</td>
                <td>${row.fact}</td>
                <td>${row.deviation}</td>
                <td>
                    <span class="dashboard-bool-badge ${row.isViolation ? "is-yes" : "is-no"}">
                        ${row.isViolation ? "Да" : "Нет"}
                    </span>
                </td>
            </tr>
        `).join("");
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
