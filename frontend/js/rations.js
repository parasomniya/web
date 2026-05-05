$(document).ready(function () {
    const rationsTableBody = document.getElementById("rationsTableBody");
    const rationsPanelMeta = document.getElementById("rationsPanelMeta");
    const reloadButton = document.getElementById("rationsReloadButton");

    const manualNewButton = document.getElementById("rationManualNewButton");
    const manualForm = document.getElementById("rationManualForm");
    const manualFormTitle = document.getElementById("rationManualFormTitle");
    const manualFormMeta = document.getElementById("rationManualFormMeta");
    const manualIdInput = document.getElementById("rationManualId");
    const manualNameInput = document.getElementById("rationManualName");
    const manualIsActiveInput = document.getElementById("rationManualIsActive");
    const manualGroupsSelect = document.getElementById("rationManualGroups");
    const manualIngredientsBody = document.getElementById("rationManualIngredientsBody");
    const manualAddIngredientButton = document.getElementById("rationManualAddIngredientButton");
    const manualGroupsPreview = document.getElementById("rationManualGroupsPreview");
    const manualSummary = document.getElementById("rationManualSummary");
    const manualCancelButton = document.getElementById("rationManualCancelButton");
    const manualSubmitButton = document.getElementById("rationManualSubmitButton");

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
        isManualSaving: false,
        lastLoadError: "",
        activeLoadId: 0,
        selectedFile: null,
        uploadSelectedGroupIds: [],
        manualSelectedGroupIds: [],
        manualIngredients: [],
        editingRationId: null,
        ingredientSeq: 0,
        highlightedIngredientId: null,
        toggleBusy: new Set(),
        deleteBusy: new Set(),
    };
    let ingredientHighlightTimer = null;

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeText(value) {
        return String(value || "").trim().replace(/\s+/g, " ");
    }

    function normalizeComparableName(value) {
        return normalizeText(value).toLowerCase();
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

    function parseFormNumber(value) {
        const normalized = String(value ?? "").trim().replace(",", ".");
        if (!normalized) {
            return null;
        }

        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
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

    function makeIngredientRow(source) {
        const item = source || {};
        state.ingredientSeq += 1;

        return {
            localId: `ingredient-${state.ingredientSeq}`,
            name: item.name || "",
            plannedWeight: item.plannedWeight ?? "",
        };
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

    function getRationGroups(ration, groupsByRationId) {
        const directGroups = Array.isArray(ration?.livestockGroups) ? ration.livestockGroups : [];
        if (directGroups.length) {
            return directGroups;
        }

        return groupsByRationId.get(Number(ration?.id)) || [];
    }

    function buildGroupOptions(selectedIds) {
        const normalizedSelectedIds = Array.isArray(selectedIds) ? selectedIds.map(Number) : [];

        if (!state.groups.length) {
            return '<option value="" disabled>Нет доступных групп</option>';
        }

        return state.groups.map((group) => {
            const groupId = Number(group?.id);
            const isSelected = normalizedSelectedIds.includes(groupId);
            const captionParts = [group?.name || `Группа #${groupId}`];

            if (Number.isFinite(Number(group?.headcount))) {
                captionParts.push(`${Number(group.headcount)} голов`);
            }

            if (group?.rationName) {
                captionParts.push(group.rationName);
            }

            return `<option value="${groupId}" ${isSelected ? "selected" : ""}>${escapeHtml(captionParts.join(" | "))}</option>`;
        }).join("");
    }

    function syncSelectedGroupIds(target) {
        const validGroupIds = new Set(state.groups.map((group) => Number(group?.id)).filter((id) => Number.isInteger(id) && id > 0));
        state[target] = state[target].filter((id) => validGroupIds.has(Number(id)));
    }

    function renderUploadGroupsSelect() {
        if (!uploadGroupsSelect) {
            return;
        }

        syncSelectedGroupIds("uploadSelectedGroupIds");
        uploadGroupsSelect.innerHTML = buildGroupOptions(state.uploadSelectedGroupIds);
        uploadGroupsSelect.disabled = !canWrite || state.isUploading || state.isManualSaving || !state.groups.length;
    }

    function renderManualGroupsSelect() {
        if (!manualGroupsSelect) {
            return;
        }

        syncSelectedGroupIds("manualSelectedGroupIds");
        manualGroupsSelect.innerHTML = buildGroupOptions(state.manualSelectedGroupIds);
        manualGroupsSelect.disabled = !canWrite || state.isManualSaving || !state.groups.length;
    }

    function renderGroupsPreview(host, selectedIds) {
        if (!host) {
            return;
        }

        const selectedGroups = state.groups.filter((group) => selectedIds.includes(Number(group?.id)));
        if (!selectedGroups.length) {
            host.innerHTML = '<span class="text-muted small">Группы не выбраны</span>';
            return;
        }

        host.innerHTML = selectedGroups.map((group) => (
            `<span class="ration-groups-preview__badge">${escapeHtml(group?.name || `Группа #${group?.id || "-"}`)}</span>`
        )).join("");
    }

    function updateUploadState() {
        if (uploadNameInput) {
            uploadNameInput.disabled = !canWrite || state.isUploading || state.isManualSaving;
        }

        renderUploadGroupsSelect();

        if (uploadFileInput) {
            uploadFileInput.disabled = !canWrite || state.isUploading || state.isManualSaving;
        }

        if (uploadDropzone) {
            uploadDropzone.classList.toggle("is-disabled", !canWrite || state.isUploading || state.isManualSaving);
        }

        if (uploadSubmitButton) {
            uploadSubmitButton.disabled = !canWrite || state.isUploading || state.isManualSaving;
            uploadSubmitButton.innerHTML = state.isUploading
                ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Загрузка...'
                : '<i class="fas fa-upload mr-1"></i>Создать рацион';
        }

        if (uploadFileMeta) {
            uploadFileMeta.textContent = formatFileMeta(state.selectedFile);
        }

        renderGroupsPreview(selectedGroupsPreview, state.uploadSelectedGroupIds);
    }

    function renderManualIngredientsEditor() {
        if (!manualIngredientsBody) {
            return;
        }

        if (!state.manualIngredients.length) {
            state.manualIngredients = [makeIngredientRow()];
        }

        manualIngredientsBody.innerHTML = state.manualIngredients.map((ingredient) => {
            const rowId = escapeHtml(ingredient.localId);
            const rowClass = ingredient.localId === state.highlightedIngredientId ? "ration-manual-row is-highlighted" : "ration-manual-row";
            return `
                <tr class="${rowClass}" data-ingredient-id="${rowId}">
                    <td>
                        <input
                            type="text"
                            class="form-control form-control-sm"
                            data-ingredient-field="name"
                            maxlength="120"
                            value="${escapeHtml(ingredient.name)}"
                            placeholder="Силос"
                        >
                    </td>
                    <td>
                        <input
                            type="number"
                            class="form-control form-control-sm ration-manual-number"
                            data-ingredient-field="plannedWeight"
                            min="0.01"
                            step="0.01"
                            value="${escapeHtml(ingredient.plannedWeight)}"
                            placeholder="1200"
                        >
                    </td>
                    <td>
                        <button
                            type="button"
                            class="btn btn-outline-danger btn-sm ration-manual-remove"
                            data-action="remove-ingredient"
                            ${state.manualIngredients.length <= 1 || state.isManualSaving ? "disabled" : ""}
                            title="Удалить ингредиент"
                            aria-label="Удалить ингредиент"
                        >
                            <i class="fas fa-trash-alt" aria-hidden="true"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    function updateManualSummary() {
        if (!manualSummary) {
            return;
        }

        const plannedTotal = state.manualIngredients.reduce((sum, ingredient) => sum + (parseFormNumber(ingredient.plannedWeight) || 0), 0);
        manualSummary.textContent = `Ингредиентов: ${state.manualIngredients.length} | Вес: ${weightFormatter.format(plannedTotal)} кг`;
    }

    function focusManualIngredientRow(localId) {
        window.requestAnimationFrame(() => {
            const row = Array.from(manualIngredientsBody?.querySelectorAll("tr[data-ingredient-id]") || [])
                .find((item) => item.getAttribute("data-ingredient-id") === localId);

            if (!row) {
                return;
            }

            row.scrollIntoView({ behavior: "smooth", block: "nearest" });
            row.querySelector("[data-ingredient-field='name']")?.focus?.();
        });
    }

    function clearIngredientHighlightLater(localId) {
        if (ingredientHighlightTimer) {
            window.clearTimeout(ingredientHighlightTimer);
        }

        ingredientHighlightTimer = window.setTimeout(() => {
            if (state.highlightedIngredientId === localId) {
                state.highlightedIngredientId = null;
                Array.from(manualIngredientsBody?.querySelectorAll("tr[data-ingredient-id]") || [])
                    .find((item) => item.getAttribute("data-ingredient-id") === localId)
                    ?.classList.remove("is-highlighted");
            }
        }, 1800);
    }

    function addManualIngredientRow() {
        syncManualRowsFromInputs();
        const ingredient = makeIngredientRow();
        state.manualIngredients.push(ingredient);
        state.highlightedIngredientId = ingredient.localId;
        updateManualState();
        focusManualIngredientRow(ingredient.localId);
        clearIngredientHighlightLater(ingredient.localId);
    }

    function updateManualState() {
        const isEditing = Number.isInteger(state.editingRationId) && state.editingRationId > 0;
        const disabled = !canWrite || state.isManualSaving;

        if (manualFormTitle) {
            manualFormTitle.textContent = isEditing ? `Редактирование рациона #${state.editingRationId}` : "Ручное создание рациона";
        }

        if (manualFormMeta) {
            manualFormMeta.textContent = isEditing
                ? "Изменения состава и групп сохраняются полной заменой"
                : "Заполните состав рациона без Excel";
        }

        if (manualIdInput) {
            manualIdInput.value = isEditing ? String(state.editingRationId) : "";
        }

        [manualNameInput, manualIsActiveInput, manualAddIngredientButton].forEach((element) => {
            if (element) {
                element.disabled = disabled;
            }
        });

        renderManualGroupsSelect();
        renderManualIngredientsEditor();
        updateManualSummary();
        renderGroupsPreview(manualGroupsPreview, state.manualSelectedGroupIds);

        if (manualCancelButton) {
            manualCancelButton.classList.toggle("d-none", !isEditing);
            manualCancelButton.disabled = disabled;
        }

        if (manualSubmitButton) {
            manualSubmitButton.disabled = disabled;
            manualSubmitButton.innerHTML = state.isManualSaving
                ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Сохранение...'
                : `<i class="fas fa-save mr-1"></i>${isEditing ? "Сохранить изменения" : "Сохранить рацион"}`;
        }

        if (manualNewButton) {
            manualNewButton.disabled = disabled;
        }

        if (reloadButton) {
            reloadButton.disabled = state.isLoading || state.isUploading || state.isManualSaving;
        }
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

        return `
            <div class="ration-ingredients-table-wrap">
                <table class="ration-ingredients-table">
                    <thead>
                        <tr>
                            <th class="ration-ingredients-table__index">№</th>
                            <th>Ингредиент</th>
                            <th class="ration-ingredients-table__weight">Вес/голову</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((ingredient, index) => `
                            <tr>
                                <td class="ration-ingredients-table__index">${index + 1}</td>
                                <td class="ration-ingredients-table__name">${escapeHtml(ingredient?.name || "Без названия")}</td>
                                <td class="ration-ingredients-table__weight">${formatWeight(ingredient?.plannedWeight)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="2">Итого</td>
                            <td class="ration-ingredients-table__weight">${formatWeight(plannedTotal)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    }

    function getEditButtonMarkup(ration) {
        const rationId = Number(ration?.id);
        const isBusy = state.isLoading || state.isManualSaving || state.toggleBusy.has(rationId) || state.deleteBusy.has(rationId);

        return `
            <button
                type="button"
                class="btn btn-sm btn-outline-primary ration-action-button"
                data-action="edit"
                data-ration-id="${rationId}"
                ${isBusy ? "disabled" : ""}
            >
                <i class="fas fa-pen" aria-hidden="true"></i>
                <span>Изменить</span>
            </button>
        `;
    }

    function getToggleButtonMarkup(ration) {
        const rationId = Number(ration?.id);
        const isBusy = state.isLoading || state.isManualSaving || state.toggleBusy.has(rationId) || state.deleteBusy.has(rationId);
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
        const isBusy = state.isLoading || state.isManualSaving || state.deleteBusy.has(rationId) || state.toggleBusy.has(rationId);

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
                ${getEditButtonMarkup(ration)}
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
            const ingredients = Array.isArray(ration?.ingredients) ? ration.ingredients : [];
            const linkedGroups = getRationGroups(ration, groupsByRationId);

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
        updateManualState();
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

    function validateManualPayload() {
        const rationName = normalizeText(manualNameInput?.value || "");
        if (!rationName) {
            return { ok: false, message: "Укажите название рациона", focus: manualNameInput };
        }

        const normalizedName = normalizeComparableName(rationName);
        const duplicate = state.rations.find((ration) => (
            normalizeComparableName(ration?.name) === normalizedName
            && Number(ration?.id) !== Number(state.editingRationId || 0)
        ));

        if (duplicate) {
            return { ok: false, message: `Рацион с названием "${rationName}" уже существует`, focus: manualNameInput };
        }

        const ingredients = [];
        const seenIngredients = new Set();

        for (let index = 0; index < state.manualIngredients.length; index += 1) {
            const row = state.manualIngredients[index];
            const name = normalizeText(row.name);

            if (!name) {
                return { ok: false, message: `Ингредиент #${index + 1}: укажите название` };
            }

            const normalizedIngredientName = normalizeComparableName(name);
            if (seenIngredients.has(normalizedIngredientName)) {
                return { ok: false, message: `Ингредиент "${name}" дублируется в рационе` };
            }
            seenIngredients.add(normalizedIngredientName);

            const plannedWeight = parseFormNumber(row.plannedWeight);
            if (plannedWeight === null || plannedWeight <= 0) {
                return { ok: false, message: `Ингредиент "${name}": вес должен быть больше 0` };
            }

            ingredients.push({ name, plannedWeight });
        }

        if (!ingredients.length) {
            return { ok: false, message: "Добавьте хотя бы один ингредиент" };
        }

        return {
            ok: true,
            payload: {
                name: rationName,
                isActive: Boolean(manualIsActiveInput?.checked),
                groups: state.manualSelectedGroupIds,
                ingredients,
            },
        };
    }

    function syncManualRowsFromInputs() {
        if (!manualIngredientsBody) {
            return;
        }

        manualIngredientsBody.querySelectorAll("tr[data-ingredient-id]").forEach((row) => {
            const localId = row.getAttribute("data-ingredient-id");
            const item = state.manualIngredients.find((ingredient) => ingredient.localId === localId);
            if (!item) {
                return;
            }

            row.querySelectorAll("[data-ingredient-field]").forEach((input) => {
                const field = input.getAttribute("data-ingredient-field");
                item[field] = input.value;
            });
        });

        updateManualSummary();
    }

    function resetManualForm() {
        state.editingRationId = null;
        state.manualSelectedGroupIds = [];
        state.manualIngredients = [makeIngredientRow()];
        state.highlightedIngredientId = null;

        if (manualForm) {
            manualForm.reset();
        }

        if (manualNameInput) {
            manualNameInput.value = "";
        }

        if (manualIsActiveInput) {
            manualIsActiveInput.checked = false;
        }

        updateManualState();
    }

    async function saveManualRation() {
        if (!canWrite) {
            return;
        }

        syncManualRowsFromInputs();
        const validation = validateManualPayload();
        if (!validation.ok) {
            showAlert(validation.message, "danger");
            validation.focus?.focus?.();
            return;
        }

        const isEditing = Number.isInteger(state.editingRationId) && state.editingRationId > 0;
        const url = isEditing ? `${RATIONS_API_URL}/${state.editingRationId}` : RATIONS_API_URL;

        state.isManualSaving = true;
        syncUiState();

        try {
            const response = await fetch(url, {
                method: isEditing ? "PATCH" : "POST",
                headers: getHeaders(true),
                body: JSON.stringify(validation.payload),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось сохранить рацион");
            }

            showAlert(isEditing ? "Рацион обновлен" : "Рацион создан", "success");
            resetManualForm();
            await loadPageData({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось сохранить рацион", "danger");
        } finally {
            state.isManualSaving = false;
            syncUiState();
        }
    }

    function startEditRation(rationId) {
        const ration = state.rations.find((item) => Number(item?.id) === Number(rationId));
        if (!ration || !canWrite) {
            return;
        }

        const groupsByRationId = getGroupsByRationId();
        const linkedGroups = getRationGroups(ration, groupsByRationId);

        state.editingRationId = Number(rationId);
        state.manualSelectedGroupIds = linkedGroups
            .map((group) => Number(group?.id))
            .filter((id) => Number.isInteger(id) && id > 0);
        state.manualIngredients = (Array.isArray(ration?.ingredients) ? ration.ingredients : [])
            .map((ingredient) => makeIngredientRow({
                name: ingredient?.name || "",
                plannedWeight: ingredient?.plannedWeight ?? "",
            }));

        if (!state.manualIngredients.length) {
            state.manualIngredients = [makeIngredientRow()];
        }
        state.highlightedIngredientId = null;

        if (manualNameInput) {
            manualNameInput.value = ration?.name || "";
        }

        if (manualIsActiveInput) {
            manualIsActiveInput.checked = Boolean(ration?.isActive);
        }

        updateManualState();
        manualForm?.closest(".card")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        manualNameInput?.focus?.();
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
        state.uploadSelectedGroupIds = [];

        if (uploadForm) {
            uploadForm.reset();
        }

        updateUploadState();
    }

    async function uploadRation() {
        if (!canWrite) {
            return;
        }

        const rationName = normalizeText(uploadNameInput?.value || "");
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

        if (state.uploadSelectedGroupIds.length) {
            formData.append("groups", JSON.stringify(state.uploadSelectedGroupIds));
        }

        state.isUploading = true;
        syncUiState();

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
            syncUiState();
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
            if (Number(state.editingRationId) === Number(rationId)) {
                resetManualForm();
            }
            await loadPageData({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось удалить рацион", "danger");
        } finally {
            state.deleteBusy.delete(Number(rationId));
            syncUiState();
        }
    }

    manualForm?.addEventListener("submit", function (event) {
        event.preventDefault();
        saveManualRation();
    });

    manualNewButton?.addEventListener("click", function () {
        resetManualForm();
        manualNameInput?.focus?.();
    });

    manualCancelButton?.addEventListener("click", function () {
        resetManualForm();
    });

    manualAddIngredientButton?.addEventListener("click", function () {
        addManualIngredientRow();
    });

    manualGroupsSelect?.addEventListener("change", function () {
        state.manualSelectedGroupIds = Array.from(manualGroupsSelect.selectedOptions)
            .map((option) => Number(option.value))
            .filter((value) => Number.isInteger(value) && value > 0);
        renderGroupsPreview(manualGroupsPreview, state.manualSelectedGroupIds);
    });

    manualIngredientsBody?.addEventListener("input", function (event) {
        const input = event.target.closest("[data-ingredient-field]");
        if (!input) {
            return;
        }

        const row = input.closest("[data-ingredient-id]");
        const localId = row?.getAttribute("data-ingredient-id");
        const item = state.manualIngredients.find((ingredient) => ingredient.localId === localId);
        if (!item) {
            return;
        }

        item[input.getAttribute("data-ingredient-field")] = input.value;
        updateManualSummary();
    });

    manualIngredientsBody?.addEventListener("click", function (event) {
        const actionButton = event.target.closest("[data-action='remove-ingredient']");
        if (!actionButton || state.manualIngredients.length <= 1 || state.isManualSaving) {
            return;
        }

        const row = actionButton.closest("[data-ingredient-id]");
        const localId = row?.getAttribute("data-ingredient-id");
        state.manualIngredients = state.manualIngredients.filter((ingredient) => ingredient.localId !== localId);
        if (state.highlightedIngredientId === localId) {
            state.highlightedIngredientId = null;
        }
        updateManualState();
    });

    uploadForm?.addEventListener("submit", function (event) {
        event.preventDefault();
        uploadRation();
    });

    reloadButton?.addEventListener("click", function () {
        loadPageData({ silentError: false });
    });

    uploadGroupsSelect?.addEventListener("change", function () {
        state.uploadSelectedGroupIds = Array.from(uploadGroupsSelect.selectedOptions)
            .map((option) => Number(option.value))
            .filter((value) => Number.isInteger(value) && value > 0);
        renderGroupsPreview(selectedGroupsPreview, state.uploadSelectedGroupIds);
    });

    uploadFileInput?.addEventListener("change", function () {
        handleSelectedFile(uploadFileInput.files?.[0] || null);
    });

    uploadDropzone?.addEventListener("click", function () {
        if (!canWrite || state.isUploading || state.isManualSaving) {
            return;
        }

        uploadFileInput?.click();
    });

    uploadDropzone?.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        if (!canWrite || state.isUploading || state.isManualSaving) {
            return;
        }

        uploadFileInput?.click();
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        uploadDropzone?.addEventListener(eventName, function (event) {
            if (!canWrite || state.isUploading || state.isManualSaving) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            uploadDropzone.classList.add("is-dragover");
        });
    });

    ["dragleave", "dragend", "drop"].forEach((eventName) => {
        uploadDropzone?.addEventListener(eventName, function (event) {
            if (!canWrite || state.isUploading || state.isManualSaving) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            uploadDropzone.classList.remove("is-dragover");
        });
    });

    uploadDropzone?.addEventListener("drop", function (event) {
        if (!canWrite || state.isUploading || state.isManualSaving) {
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
        if (action === "edit") {
            startEditRation(rationId);
            return;
        }

        if (action === "toggle") {
            toggleRation(rationId);
            return;
        }

        if (action === "delete") {
            deleteRation(rationId);
        }
    });

    resetManualForm();
    updateUploadState();
    loadPageData({ silentError: true });
});
