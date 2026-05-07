$(document).ready(function () {
    const query = new URLSearchParams(window.location.search);
    const batchId = parsePositiveInteger(query.get("id"));
    const returnDate = normalizeDateValue(query.get("date"));
    const canWrite = Boolean(window.AppAuth?.hasWriteAccess?.());

    const detailsTitle = document.getElementById("batchDetailsTitle");
    const detailsPageTitle = document.getElementById("batchDetailsPageTitle");
    const rationName = document.getElementById("batchDetailsRationName");
    const startTime = document.getElementById("batchDetailsStartTime");
    const endTime = document.getElementById("batchDetailsEndTime");
    const barnName = document.getElementById("batchDetailsBarnName");
    const remainingWeight = document.getElementById("batchDetailsRemainingWeight");
    const unloadProgressMeta = document.getElementById("batchUnloadProgressMeta");
    const unloadProgressBar = document.getElementById("batchUnloadProgressBar");
    const backLink = document.getElementById("batchDetailsBackLink");
    const ingredientListBody = document.getElementById("batchIngredientsTableBody");
    const planFactBody = document.getElementById("batchPlanFactTableBody");
    const planTotal = document.getElementById("batchPlanTotal");
    const factTotal = document.getElementById("batchFactTotal");
    const deviationTotal = document.getElementById("batchDeviationTotal");
    const telemetryEmpty = document.getElementById("batchTelemetryEmpty");
    const telemetryCanvas = document.getElementById("batchTelemetryChart");
    const editCard = document.getElementById("batchEditCard");
    const editMeta = document.getElementById("batchEditMeta");
    const editState = document.getElementById("batchEditState");
    const editRationSelect = document.getElementById("batchEditRationSelect");
    const editRationHint = document.getElementById("batchEditRationHint");
    const editGroupSelect = document.getElementById("batchEditGroupSelect");
    const editGroupHint = document.getElementById("batchEditGroupHint");
    const editSubmitButton = document.getElementById("batchEditSubmitButton");
    const stopButton = document.getElementById("batchStopButton");
    const deleteButton = document.getElementById("batchDeleteButton");

    const batchUrl = window.AppAuth?.getApiUrl?.(`/api/batches/${batchId}`) || `/api/batches/${batchId}`;
    const telemetryUrl = window.AppAuth?.getApiUrl?.(`/api/batches/${batchId}/telemetry`) || `/api/batches/${batchId}/telemetry`;
    const batchDeleteUrl = window.AppAuth?.getApiUrl?.(`/api/batches/${batchId}`) || `/api/batches/${batchId}`;
    const stopBatchUrl = window.AppAuth?.getApiUrl?.("/api/telemetry/host/manual-stop") || "/api/telemetry/host/manual-stop";
    const rationsUrl = window.AppAuth?.getApiUrl?.("/api/rations") || "/api/rations";
    const groupsUrl = window.AppAuth?.getApiUrl?.("/api/groups") || "/api/groups";

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

    const state = {
        batch: null,
        isBatchLoading: false,
        isSaving: false,
        ingredientUpdateId: null,
        stopBatchInFlight: false,
        deleteBatchInFlight: false,
        batchError: "",
        editorMessage: null,
        rations: [],
        groups: [],
        lookupStatus: {
            rations: {
                loading: false,
                loaded: false,
                error: "",
            },
            groups: {
                loading: false,
                loaded: false,
                error: "",
            },
        },
        loadRequestId: 0,
        lookupRequestId: 0,
    };

    let telemetryChart = null;

    function parsePositiveInteger(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function normalizeDateValue(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
    }

    function normalizeNullableId(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const parsed = Number.parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

    function formatSignedPercent(value) {
        if (value === null || value === undefined || value === "") {
            return "--";
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "--";
        }

        const prefix = numericValue > 0 ? "+" : "";
        return `${prefix}${weightFormatter.format(numericValue)}%`;
    }

    function renderViolationBadge(value, customLabel) {
        const label = customLabel || (value ? "Да" : "Нет");
        return `
            <span class="dashboard-bool-badge ${value ? "is-yes" : "is-no"}">
                ${label}
            </span>
        `;
    }

    function isUnknownIngredientName(value) {
        const normalized = String(value ?? "").trim().toLowerCase();
        return !normalized || normalized === "unknown" || normalized === "неизвестный";
    }

    function getIngredientDisplayName(value) {
        const raw = String(value ?? "").trim();
        return isUnknownIngredientName(raw) ? "Неизвестный" : raw;
    }

    function normalizeIngredientKey(value) {
        const displayName = getIngredientDisplayName(value);
        return displayName.trim().toLowerCase().replace(/\s+/g, " ");
    }

    function getReplacementIngredientOptions() {
        const rationIngredients = Array.isArray(state.batch?.ration?.ingredients) ? state.batch.ration.ingredients : [];
        const seenNames = new Set();

        return rationIngredients.reduce((accumulator, ingredient) => {
            const ingredientName = getIngredientDisplayName(ingredient?.name);
            if (!ingredientName || seenNames.has(ingredientName)) {
                return accumulator;
            }

            seenNames.add(ingredientName);
            accumulator.push(ingredientName);
            return accumulator;
        }, []);
    }

    function setText(element, value) {
        if (!element) {
            return;
        }

        element.textContent = value ?? "--";
    }

    function buildAuthHeaders(includeJson) {
        const headers = window.AppAuth?.getAuthHeaders?.({ includeJson: Boolean(includeJson) }) || {};

        if (!includeJson) {
            return headers;
        }

        return {
            "Content-Type": "application/json",
            ...headers,
        };
    }

    function setLoadingState() {
        setText(detailsTitle, "Загрузка...");
        setText(detailsPageTitle, "Детали замеса");
        setText(rationName, "--");
        setText(startTime, "--");
        setText(endTime, "--");
        setText(barnName, "--");
        setText(remainingWeight, "--");
        setText(unloadProgressMeta, "--");
        setText(planTotal, "--");
        setText(factTotal, "--");
        setText(deviationTotal, "--");

        if (unloadProgressBar) {
            unloadProgressBar.style.width = "0%";
        }

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
        renderUnloadProgress(batch?.unloadingInfo?.progress || null);
        updateStopButtonState(batch);
        updateDeleteButtonState(batch);
    }

    function renderUnloadProgress(progress) {
        if (unloadProgressBar) {
            unloadProgressBar.style.width = "0%";
        }

        if (!progress) {
            setText(unloadProgressMeta, "--");
            return;
        }

        const targetWeight = Number(progress?.target_weight);
        const unloadedFact = Number(progress?.unloaded_fact);

        if (!Number.isFinite(targetWeight) || targetWeight <= 0 || !Number.isFinite(unloadedFact)) {
            setText(unloadProgressMeta, "--");
            return;
        }

        const rawPercent = Math.max((unloadedFact / targetWeight) * 100, 0);
        const progressWidth = Math.min(rawPercent, 100);

        if (unloadProgressBar) {
            unloadProgressBar.style.width = `${progressWidth}%`;
        }

        setText(
            unloadProgressMeta,
            `${formatWeight(unloadedFact)} / ${formatWeight(targetWeight)} (${weightFormatter.format(rawPercent)}%)`
        );
    }

    function renderIngredientList(rows) {
        if (!ingredientListBody) {
            return;
        }

        if (!rows.length) {
            ingredientListBody.innerHTML = '<tr><td colspan="4" class="batch-detail-empty">По этому замесу нет загруженных ингредиентов</td></tr>';
            return;
        }

        const replacementOptions = getReplacementIngredientOptions();
        const hasReplacementOptions = replacementOptions.length > 0;
        const hasRation = Boolean(normalizeNullableId(state.batch?.rationId) || normalizeNullableId(state.batch?.ration?.id));
        const summaryRows = Array.isArray(state.batch?.ingredients) ? state.batch.ingredients : [];
        const componentViolationByKey = new Map(
            summaryRows.map((item) => [
                normalizeIngredientKey(item?.name),
                asBoolean(item?.isViolation ?? item?.is_violation)
            ])
        );
        const seenComponentViolationBadge = new Set();

        ingredientListBody.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(formatTime(row?.time))}</td>
                <td>${renderIngredientCell(row, hasRation, hasReplacementOptions, replacementOptions)}</td>
                <td>${escapeHtml(formatWeight(row?.fact ?? row?.actualWeight))}</td>
                <td>${renderIngredientViolationCell(row, componentViolationByKey, seenComponentViolationBadge)}</td>
            </tr>
        `).join("");
    }

    function renderIngredientViolationCell(row, componentViolationByKey, seenComponentViolationBadge) {
        const key = normalizeIngredientKey(row?.name);
        const isComponentViolation = asBoolean(componentViolationByKey.get(key));

        if (!isComponentViolation) {
            return renderViolationBadge(false);
        }

        if (seenComponentViolationBadge.has(key)) {
            return '<span class="text-muted small">По сумме компонента</span>';
        }

        seenComponentViolationBadge.add(key);
        return renderViolationBadge(true, "Да (итог)");
    }

    function renderIngredientCell(row, hasRation, hasReplacementOptions, replacementOptions) {
        const ingredientId = normalizeNullableId(row?.id);
        const ingredientName = getIngredientDisplayName(row?.name);
        const isUnknown = isUnknownIngredientName(ingredientName);
        const isDisabled = state.isBatchLoading || state.isSaving || state.stopBatchInFlight || state.deleteBatchInFlight;
        const canEditFromRation = canWrite && ingredientId !== null && !isDisabled && hasReplacementOptions;
        const canEditManual = canWrite && ingredientId !== null && !isDisabled && !hasRation;
        const disabledAttribute = canEditFromRation ? "" : " disabled";
        const optionsMarkup = replacementOptions
            .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
            .join("");

        if (!canWrite || ingredientId === null) {
            return `<strong>${escapeHtml(ingredientName || "Без названия")}</strong>`;
        }

        if (state.ingredientUpdateId === ingredientId) {
            return `
                <div class="batch-ingredient-editor">
                    <strong class="d-block ${isUnknown ? "text-warning" : ""}">${escapeHtml(ingredientName || "Без названия")}</strong>
                    <small class="text-muted d-block mt-1">Сохраняем выбранный корм...</small>
                </div>
            `;
        }

        let hint = isUnknown
            ? "Выберите корм вместо «Неизвестного»."
            : "Можно заменить компонент вручную.";

        if (!hasRation) {
            hint = "Рацион не назначен: доступно ручное переименование компонента.";
        } else if (!hasReplacementOptions) {
            hint = "В привязанном рационе нет ингредиентов для выбора.";
        } else if (isDisabled) {
            hint = "Подождите завершения текущего сохранения/загрузки.";
        }

        if (canEditManual) {
            return `
                <div class="batch-ingredient-editor">
                    <div class="batch-ingredient-editor__controls">
                        <span class="batch-ingredient-editor__trigger ${isUnknown ? "text-warning" : ""}">${escapeHtml(ingredientName || "Без названия")}</span>
                        <button
                            type="button"
                            class="btn btn-sm btn-outline-primary"
                            data-role="ingredient-rename"
                            data-ingredient-id="${ingredientId}"
                            data-current-name="${escapeHtml(ingredientName || "")}"
                        >
                            Переименовать
                        </button>
                    </div>
                    <small class="text-muted d-block mt-1">${escapeHtml(hint)}</small>
                </div>
            `;
        }

        if (!canEditFromRation) {
            return `
                <div class="batch-ingredient-editor">
                    <strong class="${isUnknown ? "text-warning" : ""}">${escapeHtml(ingredientName || "Без названия")}</strong>
                    <small class="text-muted d-block mt-1">${escapeHtml(hint)}</small>
                </div>
            `;
        }

        return `
            <div class="batch-ingredient-editor">
                <div class="batch-ingredient-editor__controls">
                <label class="sr-only" for="batchIngredientSelect${ingredientId}">Выбор корма</label>
                <span class="batch-ingredient-editor__trigger ${isUnknown ? "text-warning" : ""}">${escapeHtml(ingredientName || "Без названия")}</span>
                <select
                    id="batchIngredientSelect${ingredientId}"
                    class="form-control form-control-sm batch-ingredient-editor__select"
                    data-role="ingredient-replacement"
                    data-ingredient-id="${ingredientId}"${disabledAttribute}
                >
                    <option value="">Выберите корм</option>
                    ${optionsMarkup}
                </select>
                </div>
                <small class="text-muted d-block mt-1">${escapeHtml(hint)}</small>
            </div>
        `;
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

        const totals = rows.reduce((accumulator, row) => {
            accumulator.plan += toNumber(row?.plan);
            accumulator.fact += toNumber(row?.fact);
            return accumulator;
        }, { plan: 0, fact: 0 });

        const totalDeviationPercent = totals.plan > 0
            ? ((totals.fact - totals.plan) / totals.plan) * 100
            : null;

        setText(planTotal, formatWeight(totals.plan));
        setText(factTotal, formatWeight(totals.fact));
        setText(deviationTotal, formatSignedPercent(totalDeviationPercent));

        planFactBody.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(row?.name || "Без названия")}</td>
                <td>${escapeHtml(formatWeight(row?.plan))}</td>
                <td>${escapeHtml(formatWeight(row?.fact))}</td>
                <td>${escapeHtml(formatSignedPercent(row?.deviation_percent ?? row?.deviationPercent))}</td>
                <td>${renderViolationBadge(asBoolean(row?.isViolation ?? row?.is_violation))}</td>
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

    function setEditCardVisible(visible) {
        if (!editCard) {
            return;
        }

        editCard.hidden = !visible;
    }

    function setEditState(message, tone) {
        if (!editState) {
            return;
        }

        const tones = ["info", "warning", "danger"];
        editState.classList.remove("d-none");
        editState.classList.remove("batch-edit-state--info", "batch-edit-state--warning", "batch-edit-state--danger");

        if (!message) {
            editState.textContent = "";
            editState.classList.add("d-none");
            return;
        }

        editState.textContent = message;
        editState.classList.add(`batch-edit-state--${tones.includes(tone) ? tone : "info"}`);
    }

    function getCurrentRationOption(batch) {
        const rationId = normalizeNullableId(batch?.rationId);
        if (rationId === null) {
            return null;
        }

        return {
            id: rationId,
            name: batch?.ration?.name || batch?.rationName || `Рацион #${rationId}`,
            isActive: batch?.ration?.isActive,
        };
    }

    function getCurrentGroupOption(batch) {
        const groupId = normalizeNullableId(batch?.groupId);
        if (groupId === null) {
            return null;
        }

        return {
            id: groupId,
            name: batch?.group?.name || batch?.groupName || `Группа #${groupId}`,
        };
    }

    function formatRationOptionLabel(ration) {
        if (!ration) {
            return "";
        }

        const name = ration?.name || `Рацион #${ration.id}`;
        return ration?.isActive === false ? `${name} (неактивен)` : name;
    }

    function formatGroupOptionLabel(group) {
        return group?.name || `Группа #${group?.id}`;
    }

    function renderSelectOptions(selectElement, items, emptyLabel, currentId, currentOption, getLabel) {
        if (!selectElement) {
            return;
        }

        const normalizedCurrentId = normalizeNullableId(currentId);
        const options = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
        const seenIds = new Set();

        (Array.isArray(items) ? items : []).forEach((item) => {
            const id = normalizeNullableId(item?.id);
            if (id === null || seenIds.has(id)) {
                return;
            }

            seenIds.add(id);
            options.push(`<option value="${id}">${escapeHtml(getLabel(item))}</option>`);
        });

        if (normalizedCurrentId !== null && currentOption && !seenIds.has(normalizedCurrentId)) {
            options.push(`<option value="${normalizedCurrentId}">${escapeHtml(getLabel(currentOption))}</option>`);
        }

        selectElement.innerHTML = options.join("");
        selectElement.value = normalizedCurrentId === null ? "" : String(normalizedCurrentId);
    }

    function buildLookupHint(resourceName, status, items, currentOption) {
        if (status.loading) {
            return `Загружаем список ${resourceName}...`;
        }

        if (status.error) {
            const currentLabel = currentOption?.name ? ` Текущее значение: ${currentOption.name}.` : "";
            return `Не удалось загрузить список ${resourceName}.${currentLabel}`;
        }

        if (!items.length) {
            return `Список ${resourceName} пока пуст.`;
        }

        if (currentOption?.name) {
            return `Текущее значение: ${currentOption.name}.`;
        }

        return `Можно оставить поле пустым.`;
    }

    function getComputedEditorState() {
        if (!canWrite) {
            return null;
        }

        if (state.editorMessage?.message) {
            return state.editorMessage;
        }

        if (state.isSaving) {
            return {
                tone: "info",
                message: "Сохраняем изменения и пересчитываем замес...",
            };
        }

        if (state.isBatchLoading && !state.batch) {
            return {
                tone: "info",
                message: "Загружаем данные замеса...",
            };
        }

        if (state.batchError) {
            return {
                tone: "danger",
                message: state.batchError,
            };
        }

        const rationsLoading = state.lookupStatus.rations.loading;
        const groupsLoading = state.lookupStatus.groups.loading;
        if (rationsLoading || groupsLoading) {
            return {
                tone: "info",
                message: "Загружаем справочники рационов и групп...",
            };
        }

        const hasRationsError = Boolean(state.lookupStatus.rations.error);
        const hasGroupsError = Boolean(state.lookupStatus.groups.error);

        if (hasRationsError && hasGroupsError) {
            return {
                tone: "warning",
                message: "Не удалось загрузить списки рационов и групп. Редактирование временно недоступно.",
            };
        }

        if (hasRationsError) {
            return {
                tone: "warning",
                message: "Список рационов недоступен. Можно изменить только группу.",
            };
        }

        if (hasGroupsError) {
            return {
                tone: "warning",
                message: "Список групп недоступен. Можно изменить только рацион.",
            };
        }

        return null;
    }

    function getSelectedNullableId(selectElement, fallbackValue) {
        if (!selectElement) {
            return normalizeNullableId(fallbackValue);
        }

        return normalizeNullableId(selectElement.value);
    }

    function hasEditorChanges() {
        if (!state.batch) {
            return false;
        }

        const selectedRationId = getSelectedNullableId(editRationSelect, state.batch.rationId);
        const selectedGroupId = getSelectedNullableId(editGroupSelect, state.batch.groupId);

        return selectedRationId !== normalizeNullableId(state.batch.rationId)
            || selectedGroupId !== normalizeNullableId(state.batch.groupId);
    }

    function updateEditButtonState() {
        if (!editSubmitButton) {
            return;
        }

        editSubmitButton.disabled = !canWrite
            || !state.batch
            || Boolean(state.batchError)
            || state.isBatchLoading
            || state.isSaving
            || state.stopBatchInFlight
            || state.deleteBatchInFlight;

        editSubmitButton.textContent = state.isSaving ? "Сохраняем..." : "Пересчитать";
        updateStopButtonState(state.batch);
        updateDeleteButtonState(state.batch);
    }

    function renderBatchEditor(batch) {
        if (!editCard) {
            return;
        }

        setEditCardVisible(canWrite);
        if (!canWrite) {
            return;
        }

        const currentRation = getCurrentRationOption(batch);
        const currentGroup = getCurrentGroupOption(batch);

        renderSelectOptions(
            editRationSelect,
            state.rations,
            "Без рациона",
            batch?.rationId,
            currentRation,
            formatRationOptionLabel
        );

        renderSelectOptions(
            editGroupSelect,
            state.groups,
            "Без группы",
            batch?.groupId,
            currentGroup,
            formatGroupOptionLabel
        );

        if (editRationSelect) {
            editRationSelect.disabled = state.isSaving
                || state.isBatchLoading
                || Boolean(state.batchError)
                || !state.lookupStatus.rations.loaded
                || Boolean(state.lookupStatus.rations.error);
        }

        if (editGroupSelect) {
            editGroupSelect.disabled = state.isSaving
                || state.isBatchLoading
                || Boolean(state.batchError)
                || !state.lookupStatus.groups.loaded
                || Boolean(state.lookupStatus.groups.error);
        }

        setText(editRationHint, buildLookupHint("рационов", state.lookupStatus.rations, state.rations, currentRation));
        setText(editGroupHint, buildLookupHint("групп", state.lookupStatus.groups, state.groups, currentGroup));

        if (editMeta) {
            const currentGroupName = batch?.group?.name || batch?.groupName || "без группы";
            const currentRationName = batch?.ration?.name || batch?.rationName || "без рациона";
            setText(
                editMeta,
                batch
                    ? `Сейчас: ${currentGroupName}, ${currentRationName}. После сохранения данные перечитаются с сервера.`
                    : "После сохранения замес перечитается с сервера."
            );
        }

        const editorState = getComputedEditorState();
        setEditState(editorState?.message || "", editorState?.tone);
        updateEditButtonState();
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

    async function requestJson(url, options) {
        const requestOptions = options || {};
        const method = requestOptions.method || "GET";
        const includeJson = Boolean(requestOptions.includeJson);
        const response = await fetch(url, {
            ...requestOptions,
            method,
            headers: {
                ...buildAuthHeaders(includeJson),
                ...(requestOptions.headers || {}),
            },
        });

        if (!response.ok) {
            const message = await readErrorMessage(response);
            throw new Error(message || "Не удалось выполнить запрос");
        }

        if (response.status === 204) {
            return null;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return null;
        }

        return response.json();
    }

    async function fetchJson(url) {
        return requestJson(url, { method: "GET" });
    }

    async function patchJson(url, payload) {
        return requestJson(url, {
            method: "PATCH",
            includeJson: true,
            body: JSON.stringify(payload),
        });
    }

    async function postJson(url, payload) {
        return requestJson(url, {
            method: "POST",
            includeJson: true,
            body: JSON.stringify(payload || {}),
        });
    }

    async function deleteJson(url) {
        return requestJson(url, {
            method: "DELETE",
        });
    }

    async function handleIngredientReplacementChange(event) {
        const selectElement = event?.target;
        if (!(selectElement instanceof HTMLSelectElement) || selectElement.dataset.role !== "ingredient-replacement") {
            return;
        }

        const ingredientId = normalizeNullableId(selectElement.dataset.ingredientId);
        const ingredientName = getIngredientDisplayName(selectElement.value);

        if (ingredientId === null || !ingredientName || state.ingredientUpdateId !== null) {
            if (!ingredientName) {
                selectElement.value = "";
            }
            return;
        }

        state.ingredientUpdateId = ingredientId;
        renderIngredientList(Array.isArray(state.batch?.actualIngredients) ? state.batch.actualIngredients : []);

        try {
            await patchJson(`${batchUrl}/ingredients/${ingredientId}`, { ingredientName });
            const didReload = await loadBatchDetails();
            if (didReload) {
                window.AppAuth?.showAlert?.("Ингредиент обновлен", "success");
            }
        } catch (error) {
            window.AppAuth?.showAlert?.(error.message || "Не удалось обновить ингредиент", "danger");
        } finally {
            state.ingredientUpdateId = null;
            renderIngredientList(Array.isArray(state.batch?.actualIngredients) ? state.batch.actualIngredients : []);
        }
    }

    function updateStopButtonState(batch) {
        if (!stopButton) {
            return;
        }

        const canShow = canWrite && !batch?.endTime && normalizeNullableId(batch?.id) !== null;
        if (!canShow) {
            stopButton.classList.add("d-none");
            stopButton.disabled = true;
            stopButton.textContent = "Остановить замес";
            return;
        }

        stopButton.classList.remove("d-none");
        stopButton.disabled = state.stopBatchInFlight || state.deleteBatchInFlight || state.isBatchLoading || state.isSaving;
        stopButton.textContent = state.stopBatchInFlight ? "Останавливаем..." : "Остановить замес";
    }

    function updateDeleteButtonState(batch) {
        if (!deleteButton) {
            return;
        }

        const canShow = canWrite && normalizeNullableId(batch?.id) !== null;
        if (!canShow) {
            deleteButton.classList.add("d-none");
            deleteButton.disabled = true;
            deleteButton.textContent = "Удалить замес";
            return;
        }

        deleteButton.classList.remove("d-none");
        deleteButton.disabled = state.stopBatchInFlight || state.deleteBatchInFlight || state.isBatchLoading || state.isSaving;
        deleteButton.textContent = state.deleteBatchInFlight ? "Удаляем..." : "Удалить замес";
    }

    async function handleStopBatchClick() {
        const currentBatchId = normalizeNullableId(state.batch?.id);
        if (!canWrite || !currentBatchId || state.stopBatchInFlight || state.deleteBatchInFlight) {
            return;
        }

        const approved = window.confirm(`Остановить замес #${currentBatchId}?`);
        if (!approved) {
            return;
        }

        state.stopBatchInFlight = true;
        updateStopButtonState(state.batch);

        try {
            await postJson(stopBatchUrl, {
                batchId: currentBatchId,
                deviceId: state.batch?.deviceId || null,
            });
            window.AppAuth?.showAlert?.(`Замес #${currentBatchId} остановлен`, "success");
            await loadBatchDetails();
        } catch (error) {
            window.AppAuth?.showAlert?.(error.message || "Не удалось остановить замес", "danger");
        } finally {
            state.stopBatchInFlight = false;
            updateStopButtonState(state.batch);
            updateDeleteButtonState(state.batch);
        }
    }

    async function handleIngredientRenameClick(event) {
        const button = event?.target?.closest?.("[data-role='ingredient-rename']");
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        if (state.ingredientUpdateId !== null || state.isBatchLoading || state.isSaving || state.stopBatchInFlight || state.deleteBatchInFlight) {
            return;
        }

        const ingredientId = normalizeNullableId(button.dataset.ingredientId);
        if (ingredientId === null) {
            return;
        }

        const currentName = getIngredientDisplayName(button.dataset.currentName || "");
        const nextNameRaw = window.prompt("Введите новое название компонента", currentName);
        if (nextNameRaw === null) {
            return;
        }

        const nextName = String(nextNameRaw).trim().replace(/\s+/g, " ");
        if (!nextName) {
            window.AppAuth?.showAlert?.("Название компонента не может быть пустым", "warning");
            return;
        }

        state.ingredientUpdateId = ingredientId;
        renderIngredientList(Array.isArray(state.batch?.actualIngredients) ? state.batch.actualIngredients : []);

        try {
            await patchJson(`${batchUrl}/ingredients/${ingredientId}`, { ingredientName: nextName });
            const didReload = await loadBatchDetails();
            if (didReload) {
                window.AppAuth?.showAlert?.("Ингредиент обновлен", "success");
            }
        } catch (error) {
            window.AppAuth?.showAlert?.(error.message || "Не удалось обновить ингредиент", "danger");
        } finally {
            state.ingredientUpdateId = null;
            renderIngredientList(Array.isArray(state.batch?.actualIngredients) ? state.batch.actualIngredients : []);
        }
    }

    async function handleDeleteBatchClick() {
        const currentBatchId = normalizeNullableId(state.batch?.id);
        if (!canWrite || !currentBatchId || state.deleteBatchInFlight || state.stopBatchInFlight) {
            return;
        }

        const approved = window.confirm(`Удалить замес #${currentBatchId}? Это действие нельзя отменить.`);
        if (!approved) {
            return;
        }

        state.deleteBatchInFlight = true;
        updateStopButtonState(state.batch);
        updateDeleteButtonState(state.batch);

        try {
            await deleteJson(batchDeleteUrl);
            window.AppAuth?.showAlert?.(`Замес #${currentBatchId} удалён`, "success");
            window.location.href = buildBackLink();
        } catch (error) {
            window.AppAuth?.showAlert?.(error.message || "Не удалось удалить замес", "danger");
        } finally {
            state.deleteBatchInFlight = false;
            updateStopButtonState(state.batch);
            updateDeleteButtonState(state.batch);
        }
    }

    async function loadLookupOptions() {
        if (!canWrite) {
            return;
        }

        const requestId = ++state.lookupRequestId;
        state.lookupStatus.rations.loading = true;
        state.lookupStatus.groups.loading = true;
        state.lookupStatus.rations.error = "";
        state.lookupStatus.groups.error = "";
        renderBatchEditor(state.batch);

        const [rationsResult, groupsResult] = await Promise.allSettled([
            fetchJson(rationsUrl),
            fetchJson(groupsUrl),
        ]);

        if (requestId !== state.lookupRequestId) {
            return;
        }

        state.lookupStatus.rations.loading = false;
        state.lookupStatus.groups.loading = false;

        if (rationsResult.status === "fulfilled") {
            state.rations = Array.isArray(rationsResult.value) ? rationsResult.value : [];
            state.lookupStatus.rations.loaded = true;
            state.lookupStatus.rations.error = "";
        } else {
            state.rations = [];
            state.lookupStatus.rations.loaded = false;
            state.lookupStatus.rations.error = rationsResult.reason?.message || "Не удалось загрузить рационы";
        }

        if (groupsResult.status === "fulfilled") {
            state.groups = Array.isArray(groupsResult.value) ? groupsResult.value : [];
            state.lookupStatus.groups.loaded = true;
            state.lookupStatus.groups.error = "";
        } else {
            state.groups = [];
            state.lookupStatus.groups.loaded = false;
            state.lookupStatus.groups.error = groupsResult.reason?.message || "Не удалось загрузить группы";
        }

        renderBatchEditor(state.batch);
    }

    async function loadBatchDetails() {
        if (!batchId) {
            setText(detailsTitle, "Замес не найден");
            setText(detailsPageTitle, "Детали замеса");
            state.batchError = "Не указан идентификатор замеса";
            renderBatchEditor(state.batch);
            window.AppAuth?.showAlert?.("Не указан идентификатор замеса", "danger");
            return false;
        }

        const requestId = ++state.loadRequestId;
        state.isBatchLoading = true;
        state.batchError = "";
        state.editorMessage = null;
        setLoadingState();
        renderBatchEditor(state.batch);

        try {
            const [batch, telemetry] = await Promise.all([
                fetchJson(batchUrl),
                fetchJson(telemetryUrl),
            ]);

            if (requestId !== state.loadRequestId) {
                return false;
            }

            const actualRows = Array.isArray(batch?.actualIngredients) ? batch.actualIngredients : [];
            const summaryRows = Array.isArray(batch?.ingredients) ? batch.ingredients : [];

            state.batch = batch;

            renderBatchSummary(batch);
            renderIngredientList(actualRows);
            renderPlanFact(summaryRows);
            renderTelemetry(telemetry);
            renderBatchEditor(batch);
            return true;
        } catch (error) {
            if (requestId !== state.loadRequestId) {
                return false;
            }

            console.error("Ошибка загрузки деталей замеса:", error);
            state.batchError = error.message || "Не удалось загрузить детали замеса";
            setText(detailsTitle, batchId ? `Замес #${batchId}` : "Замес");
            setText(detailsPageTitle, "Детали замеса");
            window.AppAuth?.showAlert?.(state.batchError, "danger");

            if (ingredientListBody) {
                ingredientListBody.innerHTML = '<tr><td colspan="4" class="batch-detail-empty">Не удалось загрузить данные</td></tr>';
            }

            if (planFactBody) {
                planFactBody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">Не удалось загрузить данные</td></tr>';
            }

            renderTelemetry([]);
            renderBatchEditor(state.batch);
            return false;
        } finally {
            if (requestId === state.loadRequestId) {
                state.isBatchLoading = false;
                if (state.batch) {
                    renderIngredientList(Array.isArray(state.batch.actualIngredients) ? state.batch.actualIngredients : []);
                }
                renderBatchEditor(state.batch);
            }
        }
    }

    async function handleBatchEditSubmit() {
        if (!state.batch || state.isSaving) {
            return;
        }

        const payload = {
            rationId: getSelectedNullableId(editRationSelect, state.batch.rationId),
            groupId: getSelectedNullableId(editGroupSelect, state.batch.groupId),
        };

        state.isSaving = true;
        state.editorMessage = {
            tone: "info",
            message: "Сохраняем изменения и пересчитываем замес...",
        };
        renderBatchEditor(state.batch);

        try {
            await patchJson(batchUrl, payload);
            const didReload = await loadBatchDetails();
            if (didReload) {
                window.AppAuth?.showAlert?.("Замес пересчитан", "success");
            }
        } catch (error) {
            const message = error.message || "Не удалось пересчитать замес";
            state.editorMessage = {
                tone: "danger",
                message,
            };
            renderBatchEditor(state.batch);
            window.AppAuth?.showAlert?.(message, "danger");
        } finally {
            state.isSaving = false;
            if (!state.batchError) {
                state.editorMessage = null;
            }
            renderBatchEditor(state.batch);
        }
    }

    if (backLink) {
        backLink.href = buildBackLink();
    }

    if (editRationSelect) {
        editRationSelect.addEventListener("change", function () {
            state.editorMessage = null;
            updateEditButtonState();
        });
    }

    if (editGroupSelect) {
        editGroupSelect.addEventListener("change", function () {
            state.editorMessage = null;
            updateEditButtonState();
        });
    }

    if (editSubmitButton) {
        editSubmitButton.addEventListener("click", handleBatchEditSubmit);
    }

    if (ingredientListBody) {
        ingredientListBody.addEventListener("change", handleIngredientReplacementChange);
        ingredientListBody.addEventListener("click", handleIngredientRenameClick);
    }

    if (stopButton) {
        stopButton.addEventListener("click", handleStopBatchClick);
    }

    if (deleteButton) {
        deleteButton.addEventListener("click", handleDeleteBatchClick);
    }

    if (canWrite) {
        loadLookupOptions();
    }

    loadBatchDetails();
});
