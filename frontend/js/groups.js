$(document).ready(function () {
    const tableBody = document.getElementById("groupsTableBody");
    const panelMeta = document.getElementById("groupsPanelMeta");
    const reloadButton = document.getElementById("groupsReloadButton");

    const createForm = document.getElementById("groupCreateForm");
    const nameInput = document.getElementById("groupNameInput");
    const headcountInput = document.getElementById("groupHeadcountInput");
    const rationSelect = document.getElementById("groupRationSelect");
    const radiusInput = document.getElementById("groupRadiusInput");
    const latInput = document.getElementById("groupLatInput");
    const lonInput = document.getElementById("groupLonInput");
    const createButton = document.getElementById("groupCreateSubmitButton");
    const formMeta = document.getElementById("groupsFormMeta");

    const editModal = document.getElementById("groupEditModal");
    const editForm = document.getElementById("groupEditForm");
    const editNameInput = document.getElementById("groupEditName");
    const editHeadcountInput = document.getElementById("groupEditHeadcountInput");
    const editRationSelect = document.getElementById("groupEditRationSelect");
    const editRadiusInput = document.getElementById("groupEditRadiusInput");
    const editLatInput = document.getElementById("groupEditLatInput");
    const editLonInput = document.getElementById("groupEditLonInput");
    const editMeta = document.getElementById("groupEditMeta");
    const editSaveButton = document.getElementById("groupEditSaveButton");
    const deleteButton = document.getElementById("groupDeleteButton");

    if (!tableBody || !panelMeta) {
        return;
    }

    const GROUPS_API_URL = window.AppAuth?.getApiUrl?.("/api/groups") || "/api/groups";
    const RATIONS_API_URL = window.AppAuth?.getApiUrl?.("/api/rations") || "/api/rations";
    const canWrite = Boolean(window.AppAuth?.hasWriteAccess?.());
    const numberFormatter = new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });

    const state = {
        groups: [],
        rations: [],
        isLoading: false,
        isCreating: false,
        isEditing: false,
        isDeleting: false,
        editingGroupId: null,
        rationLookupLoaded: !canWrite,
        rationLookupError: "",
        activeLoadId: 0,
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

    async function fetchJson(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...(options || {}),
        });

        if (!response.ok) {
            const message = await readErrorMessage(response);
            throw new Error(message || `Ошибка ${response.status}`);
        }

        return response.json();
    }

    function showAlert(message, type) {
        window.AppAuth?.showAlert?.(message, type);
    }

    function setPanelMeta(message) {
        panelMeta.textContent = message;
    }

    function getTableColumnCount() {
        return canWrite ? 6 : 5;
    }

    function getTrimmedValue(input) {
        return typeof input?.value === "string" ? input.value.trim() : "";
    }

    function parseOptionalNumber(rawValue) {
        if (rawValue === "") {
            return null;
        }

        const parsedValue = Number(rawValue);
        return Number.isFinite(parsedValue) ? parsedValue : Number.NaN;
    }

    function formatFixedNumber(value, digits) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return null;
        }

        return numericValue.toFixed(digits);
    }

    function formatHeadcount(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '<span class="text-muted">-</span>';
        }

        return `<span class="groups-headcount">${escapeHtml(numberFormatter.format(numericValue))}</span>`;
    }

    function renderRationBadge(group) {
        if (!group?.rationName) {
            return '<span class="groups-ration-badge is-empty">Без рациона</span>';
        }

        const badgeClass = group?.ration?.isActive ? "is-active" : "is-inactive";
        return `<span class="groups-ration-badge ${badgeClass}">${escapeHtml(group.rationName)}</span>`;
    }

    function renderCoordinates(group) {
        const lat = formatFixedNumber(group?.lat, 6);
        const lon = formatFixedNumber(group?.lon, 6);

        if (!lat && !lon) {
            return '<span class="text-muted">-</span>';
        }

        if (!lat || !lon) {
            return `
                <div class="groups-coordinate-cell">
                    ${escapeHtml(lat || lon)}
                    <div class="groups-coordinate-cell__meta">Координаты заполнены частично</div>
                </div>
            `;
        }

        return `
            <div class="groups-coordinate-cell">
                ${escapeHtml(lat)}, ${escapeHtml(lon)}
            </div>
        `;
    }

    function renderRadius(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '<span class="text-muted">-</span>';
        }

        return `<span class="groups-radius">${escapeHtml(numberFormatter.format(numericValue))} м</span>`;
    }

    function getGroupById(groupId) {
        return state.groups.find((group) => Number(group?.id) === Number(groupId)) || null;
    }

    function isEditModalOpen() {
        return Boolean(editModal?.classList.contains("show"));
    }

    function closeEditModal() {
        if (editModal) {
            $(editModal).modal("hide");
        }
    }

    function renderActionsCell(group) {
        const groupId = Number(group?.id);
        const rowBusy = state.isLoading
            || (state.editingGroupId === groupId && (state.isEditing || state.isDeleting));

        return `
            <td>
                <div class="groups-actions">
                    <button
                        type="button"
                        class="btn btn-sm btn-outline-primary groups-action-button"
                        data-action="edit"
                        data-group-id="${groupId}"
                        ${rowBusy ? "disabled" : ""}
                    >
                        <i class="fas fa-pen" aria-hidden="true"></i>
                        <span>Изменить</span>
                    </button>
                    <button
                        type="button"
                        class="btn btn-sm btn-outline-danger groups-action-button"
                        data-action="delete"
                        data-group-id="${groupId}"
                        ${rowBusy ? "disabled" : ""}
                    >
                        <i class="fas fa-trash-alt" aria-hidden="true"></i>
                        <span>Удалить</span>
                    </button>
                </div>
            </td>
        `;
    }

    function renderTable() {
        const colspan = getTableColumnCount();

        if (state.isLoading && !state.groups.length) {
            tableBody.innerHTML = `<tr><td colspan="${colspan}" class="telemetry-empty-state">Загрузка групп...</td></tr>`;
            return;
        }

        if (!state.groups.length) {
            tableBody.innerHTML = `<tr><td colspan="${colspan}" class="telemetry-empty-state">Группы пока не добавлены</td></tr>`;
            return;
        }

        tableBody.innerHTML = state.groups.map((group) => `
            <tr>
                <td>${escapeHtml(group?.name || `Группа #${group?.id || "-"}`)}</td>
                <td>${formatHeadcount(group?.headcount)}</td>
                <td>${renderRationBadge(group)}</td>
                <td>${renderCoordinates(group)}</td>
                <td>${renderRadius(group?.radius)}</td>
                ${canWrite ? renderActionsCell(group) : ""}
            </tr>
        `).join("");
    }

    function buildRationOptionsMarkup(selectedRationId, fallbackLabel) {
        const options = ['<option value="">Без рациона</option>'];
        const normalizedSelectedId = Number.isInteger(Number(selectedRationId)) && Number(selectedRationId) > 0
            ? Number(selectedRationId)
            : null;
        const knownIds = new Set();

        state.rations.forEach((ration) => {
            const rationId = Number(ration?.id);
            if (!Number.isInteger(rationId) || rationId <= 0) {
                return;
            }

            knownIds.add(rationId);
            const suffix = ration?.isActive ? " • активен" : "";
            const isSelected = normalizedSelectedId === rationId;
            options.push(
                `<option value="${rationId}" ${isSelected ? "selected" : ""}>${escapeHtml((ration?.name || `Рацион #${rationId}`) + suffix)}</option>`
            );
        });

        if (normalizedSelectedId && !knownIds.has(normalizedSelectedId)) {
            options.push(
                `<option value="${normalizedSelectedId}" selected>${escapeHtml(fallbackLabel || `Рацион #${normalizedSelectedId}`)}</option>`
            );
        }

        return options.join("");
    }

    function renderRationOptions() {
        if (rationSelect) {
            rationSelect.innerHTML = buildRationOptionsMarkup(null, "");
            rationSelect.classList.toggle("is-unavailable", Boolean(state.rationLookupError));
        }

        if (editRationSelect) {
            const currentGroup = getGroupById(state.editingGroupId);
            const selectedRationId = currentGroup?.rationId ?? "";
            const fallbackLabel = currentGroup?.rationName || "";
            editRationSelect.innerHTML = buildRationOptionsMarkup(selectedRationId, fallbackLabel);
            editRationSelect.classList.toggle("is-unavailable", Boolean(state.rationLookupError));
        }
    }

    function updateCreateFormState() {
        if (!createForm) {
            return;
        }

        const formDisabled = !canWrite || state.isCreating;
        [nameInput, headcountInput, rationSelect, radiusInput, latInput, lonInput].forEach((element) => {
            if (element) {
                element.disabled = formDisabled || (element === rationSelect && Boolean(state.rationLookupError));
            }
        });

        if (createButton) {
            createButton.disabled = formDisabled;
            createButton.innerHTML = state.isCreating
                ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Создание...'
                : '<i class="fas fa-plus mr-1"></i>Создать группу';
        }

        if (reloadButton) {
            reloadButton.disabled = state.isLoading || state.isCreating || state.isEditing || state.isDeleting;
        }

        if (formMeta) {
            if (!canWrite) {
                formMeta.textContent = "Создание недоступно в режиме просмотра.";
            } else if (!state.rationLookupLoaded && !state.rationLookupError) {
                formMeta.textContent = "Подтягиваем список рационов...";
            } else if (state.rationLookupError) {
                formMeta.textContent = "Список рационов недоступен. Группу можно создать без привязки.";
            } else {
                formMeta.textContent = `Доступно рационов: ${state.rations.length}`;
            }
        }
    }

    function updateEditFormState() {
        if (!editForm) {
            return;
        }

        const currentGroup = getGroupById(state.editingGroupId);
        const disabled = !canWrite || state.isEditing || state.isDeleting || !currentGroup;

        [editHeadcountInput, editRationSelect, editRadiusInput, editLatInput, editLonInput].forEach((element) => {
            if (element) {
                element.disabled = disabled || (element === editRationSelect && Boolean(state.rationLookupError));
            }
        });

        if (editSaveButton) {
            editSaveButton.disabled = disabled;
            editSaveButton.innerHTML = state.isEditing
                ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Сохранение...'
                : '<i class="fas fa-save mr-1"></i>Сохранить';
        }

        if (deleteButton) {
            deleteButton.disabled = disabled;
            deleteButton.innerHTML = state.isDeleting
                ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Удаление...'
                : '<i class="fas fa-trash-alt mr-1"></i>Удалить группу';
        }

        if (editMeta) {
            if (!currentGroup) {
                editMeta.textContent = "Выберите группу для редактирования.";
            } else if (state.rationLookupError) {
                editMeta.textContent = "Список рационов недоступен. Можно менять поголовье и координаты, но выбор рациона временно отключен.";
            } else {
                editMeta.textContent = "Можно изменить поголовье, рацион и геозону. Чтобы сбросить точку, очистите оба поля координат.";
            }
        }
    }

    function updateMeta() {
        setPanelMeta(`Групп: ${state.groups.length}`);
    }

    function resetCreateForm() {
        if (!createForm) {
            return;
        }

        createForm.reset();
        if (radiusInput) {
            radiusInput.value = "30";
        }
        if (rationSelect) {
            rationSelect.value = "";
        }
    }

    function resetEditForm() {
        if (editForm) {
            editForm.reset();
        }
        if (editNameInput) {
            editNameInput.value = "";
        }
        state.editingGroupId = null;
    }

    function buildSharedPayload(elements) {
        const headcount = Number.parseInt(getTrimmedValue(elements.headcountInput), 10);
        const radius = parseOptionalNumber(getTrimmedValue(elements.radiusInput));
        const lat = parseOptionalNumber(getTrimmedValue(elements.latInput));
        const lon = parseOptionalNumber(getTrimmedValue(elements.lonInput));
        const rationIdRaw = getTrimmedValue(elements.rationSelect);
        const rationId = rationIdRaw ? Number.parseInt(rationIdRaw, 10) : null;

        if (!Number.isInteger(headcount) || headcount <= 0) {
            throw new Error("Поголовье должно быть положительным целым числом.");
        }

        if (!Number.isFinite(radius) || radius <= 0) {
            throw new Error("Радиус должен быть положительным числом.");
        }

        if ((lat === null) !== (lon === null)) {
            throw new Error("Укажите и широту, и долготу, либо оставьте оба поля пустыми.");
        }

        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
            throw new Error("Широта должна быть в диапазоне от -90 до 90.");
        }

        if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
            throw new Error("Долгота должна быть в диапазоне от -180 до 180.");
        }

        if (rationId !== null && (!Number.isInteger(rationId) || rationId <= 0)) {
            throw new Error("Выберите корректный рацион.");
        }

        return {
            headcount,
            rationId,
            lat,
            lon,
            radius,
        };
    }

    function buildCreatePayload() {
        const name = getTrimmedValue(nameInput);
        if (!name) {
            throw new Error("Введите название группы.");
        }

        return {
            name,
            ...buildSharedPayload({
                headcountInput,
                rationSelect,
                radiusInput,
                latInput,
                lonInput,
            }),
        };
    }

    function buildEditPayload() {
        return buildSharedPayload({
            headcountInput: editHeadcountInput,
            rationSelect: editRationSelect,
            radiusInput: editRadiusInput,
            latInput: editLatInput,
            lonInput: editLonInput,
        });
    }

    function populateEditForm(group) {
        if (!group || !editForm) {
            return;
        }

        state.editingGroupId = Number(group.id);

        if (editNameInput) {
            editNameInput.value = group?.name || "";
        }
        if (editHeadcountInput) {
            editHeadcountInput.value = group?.headcount ?? "";
        }
        if (editRadiusInput) {
            editRadiusInput.value = group?.radius ?? 30;
        }
        if (editLatInput) {
            editLatInput.value = group?.lat ?? "";
        }
        if (editLonInput) {
            editLonInput.value = group?.lon ?? "";
        }

        renderRationOptions();
        if (editRationSelect) {
            editRationSelect.value = group?.rationId ?? "";
        }

        updateEditFormState();
    }

    function openEditModal(groupId) {
        const group = getGroupById(groupId);
        if (!group || !editModal) {
            return;
        }

        populateEditForm(group);
        $(editModal).modal("show");
    }

    async function loadPageData() {
        const loadId = ++state.activeLoadId;
        state.isLoading = true;
        renderTable();
        updateCreateFormState();
        updateEditFormState();

        try {
            if (canWrite) {
                const [groupsResult, rationsResult] = await Promise.allSettled([
                    fetchJson(GROUPS_API_URL),
                    fetchJson(RATIONS_API_URL),
                ]);

                if (loadId !== state.activeLoadId) {
                    return;
                }

                if (rationsResult.status === "fulfilled") {
                    state.rations = Array.isArray(rationsResult.value) ? rationsResult.value : [];
                    state.rationLookupLoaded = true;
                    state.rationLookupError = "";
                } else {
                    state.rations = [];
                    state.rationLookupLoaded = false;
                    state.rationLookupError = rationsResult.reason?.message || "Не удалось загрузить рационы.";
                    showAlert(state.rationLookupError, "warning");
                }

                if (groupsResult.status === "fulfilled") {
                    state.groups = Array.isArray(groupsResult.value) ? groupsResult.value : [];
                } else {
                    throw groupsResult.reason;
                }
            } else {
                const groupsPayload = await fetchJson(GROUPS_API_URL);
                if (loadId !== state.activeLoadId) {
                    return;
                }

                state.groups = Array.isArray(groupsPayload) ? groupsPayload : [];
            }
        } catch (error) {
            if (loadId !== state.activeLoadId) {
                return;
            }

            showAlert(error?.message || "Не удалось загрузить группы.", "danger");
        } finally {
            if (loadId !== state.activeLoadId) {
                return;
            }

            const currentGroup = getGroupById(state.editingGroupId);
            if (currentGroup) {
                populateEditForm(currentGroup);
            } else if (isEditModalOpen()) {
                closeEditModal();
            }

            state.isLoading = false;
            renderRationOptions();
            updateCreateFormState();
            updateEditFormState();
            updateMeta();
            renderTable();
        }
    }

    async function loadRationsOnly() {
        if (!canWrite) {
            return;
        }

        try {
            state.rationLookupLoaded = false;
            state.rationLookupError = "";
            updateCreateFormState();
            updateEditFormState();

            const payload = await fetchJson(RATIONS_API_URL);
            state.rations = Array.isArray(payload) ? payload : [];
            state.rationLookupLoaded = true;
            state.rationLookupError = "";
        } catch (error) {
            state.rations = [];
            state.rationLookupLoaded = false;
            state.rationLookupError = error?.message || "Не удалось загрузить рационы.";
        } finally {
            renderRationOptions();
            updateCreateFormState();
            updateEditFormState();
        }
    }

    async function handleCreateGroup() {
        if (!canWrite || state.isCreating) {
            return;
        }

        let payload;
        try {
            payload = buildCreatePayload();
        } catch (error) {
            showAlert(error.message, "warning");
            return;
        }

        state.isCreating = true;
        updateCreateFormState();
        renderTable();

        try {
            const response = await fetch(GROUPS_API_URL, {
                method: "POST",
                headers: getHeaders(true),
                credentials: "same-origin",
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось создать группу.");
            }

            resetCreateForm();
            showAlert(`Группа "${payload.name}" создана.`, "success");
            await loadPageData();
        } catch (error) {
            showAlert(error?.message || "Не удалось создать группу.", "danger");
            if (String(error?.message || "").toLowerCase().includes("рацион")) {
                await loadRationsOnly();
            }
        } finally {
            state.isCreating = false;
            updateCreateFormState();
            renderTable();
        }
    }

    async function handleSaveGroup() {
        if (!canWrite || state.isEditing || state.isDeleting || !state.editingGroupId) {
            return;
        }

        try {
            buildEditPayload();
        } catch (error) {
            showAlert(error.message, "warning");
            return;
        }

        const group = getGroupById(state.editingGroupId);
        state.isEditing = true;
        updateEditFormState();
        updateCreateFormState();
        renderTable();

        try {
            showAlert(`Редактирование группы "${group?.name || state.editingGroupId}" пока работает как заглушка. Бэкенд не изменяем.`, "info");
        } catch (error) {
            showAlert(error?.message || "Не удалось открыть заглушку редактирования.", "danger");
        } finally {
            state.isEditing = false;
            updateEditFormState();
            updateCreateFormState();
            renderTable();
        }
    }

    async function handleDeleteGroup(groupId) {
        const targetId = Number(groupId || state.editingGroupId);
        if (!canWrite || state.isDeleting || !Number.isInteger(targetId) || targetId <= 0) {
            return;
        }

        const group = getGroupById(targetId);
        const groupName = group?.name || `#${targetId}`;
        if (!window.confirm(`Удалить группу "${groupName}"?`)) {
            return;
        }

        state.editingGroupId = targetId;
        state.isDeleting = true;
        updateEditFormState();
        updateCreateFormState();
        renderTable();

        try {
            showAlert(`Удаление группы "${groupName}" пока оставлено заглушкой на фронте.`, "info");
        } catch (error) {
            showAlert(error?.message || "Не удалось открыть заглушку удаления.", "danger");
        } finally {
            state.isDeleting = false;
            updateEditFormState();
            updateCreateFormState();
            renderTable();
        }
    }

    reloadButton?.addEventListener("click", function () {
        loadPageData();
    });

    createForm?.addEventListener("submit", function (event) {
        event.preventDefault();
        handleCreateGroup();
    });

    editForm?.addEventListener("submit", function (event) {
        event.preventDefault();
        handleSaveGroup();
    });

    deleteButton?.addEventListener("click", function () {
        handleDeleteGroup(state.editingGroupId);
    });

    tableBody.addEventListener("click", function (event) {
        const actionButton = event.target.closest("[data-action][data-group-id]");
        if (!actionButton) {
            return;
        }

        const groupId = Number(actionButton.getAttribute("data-group-id"));
        if (!Number.isInteger(groupId) || groupId <= 0) {
            return;
        }

        const action = actionButton.getAttribute("data-action");
        if (action === "edit") {
            openEditModal(groupId);
            return;
        }

        if (action === "delete") {
            handleDeleteGroup(groupId);
        }
    });

    if (editModal) {
        $(editModal).on("hidden.bs.modal", function () {
            if (state.isEditing || state.isDeleting) {
                return;
            }

            resetEditForm();
            renderRationOptions();
            updateEditFormState();
            renderTable();
        });
    }

    renderRationOptions();
    updateCreateFormState();
    updateEditFormState();
    loadPageData();
});
