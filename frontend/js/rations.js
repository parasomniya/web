$(document).ready(function () {
    const rationsTableBody = document.getElementById("rationsTableBody");
    const rationsPanelMeta = document.getElementById("rationsPanelMeta");
    const reloadButton = document.getElementById("rationsReloadButton");
    const uploadForm = document.getElementById("rationUploadForm");
    const uploadNameInput = document.getElementById("rationUploadName");
    const uploadGroupsSelect = document.getElementById("rationUploadGroups");
    const uploadDropzone = document.getElementById("rationUploadDropzone");
    const uploadFileInput = document.getElementById("rationUploadFile");
    const uploadFileMeta = document.getElementById("rationUploadFileMeta");
    const uploadSubmitButton = document.getElementById("rationUploadSubmitButton");
    const selectedGroupsPreview = document.getElementById("rationSelectedGroupsPreview");

    if (!rationsTableBody || !rationsPanelMeta) {
        return;
    }

    const RATIONS_API_URL = window.AppAuth?.getApiUrl?.("/api/rations") || "/api/rations";
    const RATIONS_UPLOAD_URL = window.AppAuth?.getApiUrl?.("/api/rations/upload") || "/api/rations/upload";
    const GROUPS_API_URL = window.AppAuth?.getApiUrl?.("/api/groups") || "/api/groups";
    const canWrite = Boolean(window.AppAuth?.hasWriteAccess?.());

    const weightFormatter = new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });

    const state = {
        rations: [],
        groups: [],
        isLoading: false,
        isUploading: false,
        lastLoadError: "",
        activeLoadId: 0,
        selectedFile: null,
        selectedGroupIds: [],
        toggleBusy: new Set(),
        deleteBusy: new Set(),
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getHeaders(includeJson) {
        return window.AppAuth?.getAuthHeaders?.({ includeJson: Boolean(includeJson) }) || (
            includeJson ? { "Content-Type": "application/json" } : {}
        );
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

    function showAlert(message, type) {
        window.AppAuth?.showAlert?.(message, type);
    }

    function formatWeight(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '<span class="text-muted">-</span>';
        }

        return `${escapeHtml(weightFormatter.format(numericValue))} кг`;
    }

    function getWeightValue(value) {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function formatFileMeta(file) {
        if (!file) {
            return "Файл не выбран";
        }

        const sizeKb = Math.max(Math.round(file.size / 102.4) / 10, 0.1);
        return `${file.name} | ${escapeHtml(weightFormatter.format(sizeKb))} КБ`;
    }

    function setPanelMeta(message) {
        if (rationsPanelMeta) {
            rationsPanelMeta.textContent = message;
        }
    }

    function getGroupsByRationId() {
        return state.groups.reduce((acc, group) => {
            const rationId = Number(group?.rationId);
            if (!Number.isInteger(rationId) || rationId <= 0) {
                return acc;
            }

            if (!acc.has(rationId)) {
                acc.set(rationId, []);
            }

            acc.get(rationId).push(group);
            return acc;
        }, new Map());
    }

    function renderGroupsSelect() {
        if (!uploadGroupsSelect) {
            return;
        }

        const validGroupIds = new Set(state.groups.map((group) => Number(group?.id)).filter((id) => Number.isInteger(id) && id > 0));
        state.selectedGroupIds = state.selectedGroupIds.filter((id) => validGroupIds.has(id));

        if (!state.groups.length) {
            uploadGroupsSelect.innerHTML = '<option value="" disabled>Нет доступных групп</option>';
            uploadGroupsSelect.disabled = true;
            return;
        }

        uploadGroupsSelect.disabled = !canWrite || state.isUploading;
        uploadGroupsSelect.innerHTML = state.groups.map((group) => {
            const groupId = Number(group?.id);
            const isSelected = state.selectedGroupIds.includes(groupId);
            const captionParts = [group?.name || `Группа #${groupId}`];

            if (Number.isFinite(Number(group?.headcount))) {
                captionParts.push(`${Number(group.headcount)} голов`);
            }

            return `<option value="${groupId}" ${isSelected ? "selected" : ""}>${escapeHtml(captionParts.join(" | "))}</option>`;
        }).join("");
    }

    function renderSelectedGroupsPreview() {
        if (!selectedGroupsPreview) {
            return;
        }

        const selectedGroups = state.groups.filter((group) => state.selectedGroupIds.includes(Number(group?.id)));
        if (!selectedGroups.length) {
            selectedGroupsPreview.innerHTML = '<span class="text-muted small">Группы не выбраны</span>';
            return;
        }

        selectedGroupsPreview.innerHTML = selectedGroups.map((group) => (
            `<span class="ration-groups-preview__badge">${escapeHtml(group?.name || `Группа #${group?.id || "-"}`)}</span>`
        )).join("");
    }

    function updateUploadState() {
        if (uploadNameInput) {
            uploadNameInput.disabled = !canWrite || state.isUploading;
        }

        renderGroupsSelect();

        if (uploadFileInput) {
            uploadFileInput.disabled = !canWrite || state.isUploading;
        }

        if (uploadDropzone) {
            uploadDropzone.classList.toggle("is-disabled", !canWrite || state.isUploading);
        }

        if (uploadSubmitButton) {
            uploadSubmitButton.disabled = !canWrite || state.isUploading;
            uploadSubmitButton.innerHTML = state.isUploading
                ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Загрузка...'
                : '<i class="fas fa-upload mr-1"></i>Создать рацион';
        }

        if (reloadButton) {
            reloadButton.disabled = state.isLoading || state.isUploading;
        }

        if (uploadFileMeta) {
            uploadFileMeta.textContent = formatFileMeta(state.selectedFile);
        }

        renderSelectedGroupsPreview();
    }

    function renderStatusBadge(isActive) {
        const active = Boolean(isActive);
        const badgeClass = active ? "ration-status-badge is-active" : "ration-status-badge is-inactive";
        const label = active ? "Активен" : "Неактивен";
        return `<span class="${badgeClass}">${label}</span>`;
    }

    function renderListCell(values, formatter) {
        const items = Array.isArray(values) ? values : [];
        if (!items.length) {
            return '<span class="text-muted">-</span>';
        }

        return `
            <div class="ration-table-list">
                ${items.map((item) => `<div class="ration-table-list__item">${formatter(item)}</div>`).join("")}
            </div>
        `;
    }

    function renderIngredientsTable(ingredients) {
        const items = Array.isArray(ingredients) ? ingredients : [];
        if (!items.length) {
            return '<span class="text-muted">-</span>';
        }

        const plannedTotal = items.reduce((sum, ingredient) => sum + getWeightValue(ingredient?.plannedWeight), 0);
        const dryMatterTotal = items.reduce((sum, ingredient) => sum + getWeightValue(ingredient?.dryMatterWeight), 0);

        return `
            <div class="ration-ingredients-table-wrap">
                <table class="ration-ingredients-table">
                    <thead>
                        <tr>
                            <th class="ration-ingredients-table__index">№</th>
                            <th>Ингредиент</th>
                            <th class="ration-ingredients-table__weight">Вес/голову</th>
                            <th class="ration-ingredients-table__weight">СВ/голову</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((ingredient, index) => `
                            <tr>
                                <td class="ration-ingredients-table__index">${index + 1}</td>
                                <td class="ration-ingredients-table__name">${escapeHtml(ingredient?.name || "Без названия")}</td>
                                <td class="ration-ingredients-table__weight">${formatWeight(ingredient?.plannedWeight)}</td>
                                <td class="ration-ingredients-table__weight">${formatWeight(ingredient?.dryMatterWeight)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="2">Итого</td>
                            <td class="ration-ingredients-table__weight">${formatWeight(plannedTotal)}</td>
                            <td class="ration-ingredients-table__weight">${formatWeight(dryMatterTotal)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    }

    function getToggleButtonMarkup(ration) {
        const rationId = Number(ration?.id);
        const isBusy = state.isLoading || state.toggleBusy.has(rationId) || state.deleteBusy.has(rationId);
        const isActive = Boolean(ration?.isActive);
        const buttonClass = isActive ? "btn-outline-secondary" : "btn-outline-success";
        const label = isActive ? "Деактивировать" : "Активировать";
        const icon = isActive ? "fa-toggle-off" : "fa-toggle-on";

        return `
            <button
                type="button"
                class="btn btn-sm ${buttonClass} ration-action-button"
                data-action="toggle"
                data-ration-id="${rationId}"
                ${isBusy ? "disabled" : ""}
            >
                ${state.toggleBusy.has(rationId)
                    ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>'
                    : `<i class="fas ${icon}" aria-hidden="true"></i>`}
                <span>${label}</span>
            </button>
        `;
    }

    function getDeleteButtonMarkup(ration) {
        const rationId = Number(ration?.id);
        const isBusy = state.isLoading || state.deleteBusy.has(rationId) || state.toggleBusy.has(rationId);

        return `
            <button
                type="button"
                class="btn btn-sm btn-outline-danger ration-action-button"
                data-action="delete"
                data-ration-id="${rationId}"
                ${isBusy ? "disabled" : ""}
            >
                ${state.deleteBusy.has(rationId)
                    ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>'
                    : '<i class="fas fa-trash-alt" aria-hidden="true"></i>'}
                <span>Удалить</span>
            </button>
        `;
    }

    function renderActionsCell(ration) {
        if (!canWrite) {
            return '<span class="text-muted small">Только просмотр</span>';
        }

        return `
            <div class="ration-actions">
                ${getToggleButtonMarkup(ration)}
                ${getDeleteButtonMarkup(ration)}
            </div>
        `;
    }

    function renderTable() {
        const groupsByRationId = getGroupsByRationId();

        if (state.isLoading && !state.rations.length) {
            rationsTableBody.innerHTML = '<tr><td colspan="5" class="telemetry-empty-state">Загрузка рационов...</td></tr>';
            return;
        }

        if (state.lastLoadError && !state.rations.length) {
            rationsTableBody.innerHTML = `<tr><td colspan="5" class="telemetry-empty-state">${escapeHtml(state.lastLoadError)}</td></tr>`;
            return;
        }

        if (!state.rations.length) {
            rationsTableBody.innerHTML = '<tr><td colspan="5" class="telemetry-empty-state">Рационы пока не загружены.</td></tr>';
            return;
        }

        rationsTableBody.innerHTML = state.rations.map((ration) => {
            const rationId = Number(ration?.id);
            const ingredients = Array.isArray(ration?.ingredients) ? ration.ingredients : [];
            const linkedGroups = groupsByRationId.get(rationId) || [];

            return `
                <tr>
                    <td class="align-middle">
                        <div class="font-weight-bold text-gray-800">#${escapeHtml(ration?.id ?? "-")} ${escapeHtml(ration?.name || "Без названия")}</div>
                        <div class="small text-muted">${ingredients.length ? `Ингредиентов: ${ingredients.length}` : "Без ингредиентов"}</div>
                    </td>
                    <td class="align-middle">${renderStatusBadge(ration?.isActive)}</td>
                    <td class="align-middle ration-ingredients-cell">
                        ${renderIngredientsTable(ingredients)}
                    </td>
                    <td class="align-middle">
                        ${renderListCell(linkedGroups, (group) => escapeHtml(group?.name || `Группа #${group?.id || "-"}`))}
                    </td>
                    <td class="align-middle">${renderActionsCell(ration)}</td>
                </tr>
            `;
        }).join("");
    }

    function syncUiState() {
        renderTable();
        updateUploadState();
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            method: "GET",
            headers: getHeaders(false),
        });

        if (!response.ok) {
            const message = await readErrorMessage(response);
            throw new Error(message || "Не удалось загрузить данные");
        }

        return response.json();
    }

    async function loadPageData(options) {
        const settings = options || {};
        const requestId = ++state.activeLoadId;

        state.isLoading = true;
        state.lastLoadError = "";
        setPanelMeta(state.rations.length ? "Обновление списка рационов..." : "Загрузка рационов...");
        syncUiState();

        try {
            const [rationsPayload, groupsPayload] = await Promise.all([
                fetchJson(RATIONS_API_URL),
                fetchJson(GROUPS_API_URL),
            ]);

            if (requestId !== state.activeLoadId) {
                return;
            }

            state.rations = Array.isArray(rationsPayload) ? rationsPayload : [];
            state.groups = Array.isArray(groupsPayload) ? groupsPayload : [];
            state.lastLoadError = "";
            setPanelMeta(`Рационов: ${state.rations.length} | Групп: ${state.groups.length}`);
        } catch (error) {
            if (requestId !== state.activeLoadId) {
                return;
            }

            state.lastLoadError = error.message || "Не удалось загрузить список рационов";
            setPanelMeta("Не удалось загрузить данные");

            if (!settings.silentError) {
                showAlert(state.lastLoadError, "danger");
            }
        } finally {
            if (requestId === state.activeLoadId) {
                state.isLoading = false;
                syncUiState();
            }
        }
    }

    function handleSelectedFile(file) {
        state.selectedFile = file || null;
        if (uploadFileInput && file && uploadFileInput.files?.[0] !== file) {
            try {
                const transfer = new DataTransfer();
                transfer.items.add(file);
                uploadFileInput.files = transfer.files;
            } catch (error) {
                uploadFileInput.value = "";
            }
        }

        updateUploadState();
    }

    function resetUploadForm() {
        state.selectedFile = null;
        state.selectedGroupIds = [];

        if (uploadForm) {
            uploadForm.reset();
        }

        updateUploadState();
    }

    async function uploadRation() {
        if (!canWrite) {
            return;
        }

        const rationName = uploadNameInput?.value?.trim() || "";
        if (!rationName) {
            showAlert("Укажите название рациона", "danger");
            uploadNameInput?.focus();
            return;
        }

        if (!state.selectedFile) {
            showAlert("Выберите Excel-файл", "danger");
            uploadFileInput?.focus();
            return;
        }

        const formData = new FormData();
        formData.append("name", rationName);
        formData.append("file", state.selectedFile);

        if (state.selectedGroupIds.length) {
            formData.append("groups", JSON.stringify(state.selectedGroupIds));
        }

        state.isUploading = true;
        updateUploadState();

        try {
            const response = await fetch(RATIONS_UPLOAD_URL, {
                method: "POST",
                headers: getHeaders(false),
                body: formData,
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось загрузить рацион");
            }

            showAlert("Рацион успешно загружен", "success");
            resetUploadForm();
            await loadPageData({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось загрузить рацион", "danger");
        } finally {
            state.isUploading = false;
            updateUploadState();
        }
    }

    async function toggleRation(rationId) {
        const ration = state.rations.find((item) => Number(item?.id) === Number(rationId));
        if (!ration || !canWrite) {
            return;
        }

        state.toggleBusy.add(Number(rationId));
        syncUiState();

        try {
            const response = await fetch(`${RATIONS_API_URL}/${rationId}/toggle`, {
                method: "PATCH",
                headers: getHeaders(true),
                body: JSON.stringify({ isActive: !Boolean(ration?.isActive) }),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось изменить статус рациона");
            }

            showAlert(Boolean(ration?.isActive) ? "Рацион деактивирован" : "Рацион активирован", "success");
            await loadPageData({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось изменить статус рациона", "danger");
        } finally {
            state.toggleBusy.delete(Number(rationId));
            syncUiState();
        }
    }

    async function deleteRation(rationId) {
        const ration = state.rations.find((item) => Number(item?.id) === Number(rationId));
        if (!ration || !canWrite) {
            return;
        }

        if (!window.confirm(`Удалить рацион "${ration.name || `#${rationId}`}"?`)) {
            return;
        }

        state.deleteBusy.add(Number(rationId));
        syncUiState();

        try {
            const response = await fetch(`${RATIONS_API_URL}/${rationId}`, {
                method: "DELETE",
                headers: getHeaders(false),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось удалить рацион");
            }

            showAlert("Рацион удален", "success");
            await loadPageData({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось удалить рацион", "danger");
        } finally {
            state.deleteBusy.delete(Number(rationId));
            syncUiState();
        }
    }

    uploadForm?.addEventListener("submit", function (event) {
        event.preventDefault();
        uploadRation();
    });

    reloadButton?.addEventListener("click", function () {
        loadPageData({ silentError: false });
    });

    uploadGroupsSelect?.addEventListener("change", function () {
        state.selectedGroupIds = Array.from(uploadGroupsSelect.selectedOptions)
            .map((option) => Number(option.value))
            .filter((value) => Number.isInteger(value) && value > 0);
        renderSelectedGroupsPreview();
    });

    uploadFileInput?.addEventListener("change", function () {
        handleSelectedFile(uploadFileInput.files?.[0] || null);
    });

    uploadDropzone?.addEventListener("click", function () {
        if (!canWrite || state.isUploading) {
            return;
        }

        uploadFileInput?.click();
    });

    uploadDropzone?.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        if (!canWrite || state.isUploading) {
            return;
        }

        uploadFileInput?.click();
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        uploadDropzone?.addEventListener(eventName, function (event) {
            if (!canWrite || state.isUploading) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            uploadDropzone.classList.add("is-dragover");
        });
    });

    ["dragleave", "dragend", "drop"].forEach((eventName) => {
        uploadDropzone?.addEventListener(eventName, function (event) {
            if (!canWrite || state.isUploading) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            uploadDropzone.classList.remove("is-dragover");
        });
    });

    uploadDropzone?.addEventListener("drop", function (event) {
        if (!canWrite || state.isUploading) {
            return;
        }

        const file = event.dataTransfer?.files?.[0] || null;
        if (file) {
            handleSelectedFile(file);
        }
    });

    rationsTableBody.addEventListener("click", function (event) {
        const actionButton = event.target.closest("[data-action][data-ration-id]");
        if (!actionButton) {
            return;
        }

        const rationId = Number(actionButton.getAttribute("data-ration-id"));
        if (!Number.isInteger(rationId) || rationId <= 0) {
            return;
        }

        const action = actionButton.getAttribute("data-action");
        if (action === "toggle") {
            toggleRation(rationId);
            return;
        }

        if (action === "delete") {
            deleteRation(rationId);
        }
    });

    updateUploadState();
    loadPageData({ silentError: true });
});
