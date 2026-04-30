$(document).ready(function () {
    const tableBody = document.getElementById("groupsTableBody");
    const panelMeta = document.getElementById("groupsPanelMeta");
    const reloadButton = document.getElementById("groupsReloadButton");

    const createForm = document.getElementById("groupCreateForm");
    const nameInput = document.getElementById("groupNameInput");
    const headcountInput = document.getElementById("groupHeadcountInput");
    const rationSelect = document.getElementById("groupRationSelect");
    const storageZoneSelect = document.getElementById("groupStorageZoneSelect");
    const createButton = document.getElementById("groupCreateSubmitButton");
    const formMeta = document.getElementById("groupsFormMeta");

    const editModal = document.getElementById("groupEditModal");
    const editForm = document.getElementById("groupEditForm");
    const editNameInput = document.getElementById("groupEditName");
    const editHeadcountInput = document.getElementById("groupEditHeadcountInput");
    const editRationSelect = document.getElementById("groupEditRationSelect");
    const editStorageZoneSelect = document.getElementById("groupEditStorageZoneSelect");
    const editMeta = document.getElementById("groupEditMeta");
    const editSaveButton = document.getElementById("groupEditSaveButton");
    const deleteButton = document.getElementById("groupDeleteButton");

    if (!tableBody || !panelMeta) {
        return;
    }

    const GROUPS_API_URL = window.AppAuth?.getApiUrl?.("/api/groups") || "/api/groups";
    const RATIONS_API_URL = window.AppAuth?.getApiUrl?.("/api/rations") || "/api/rations";
    const STORAGE_ZONES_API_URL = window.AppAuth?.getApiUrl?.("/api/telemetry/zones") || "/api/telemetry/zones";
    const canWrite = Boolean(window.AppAuth?.hasWriteAccess?.());
    const numberFormatter = new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });

    const state = {
        groups: [],
        rations: [],
        storageZones: [],
        isLoading: false,
        isCreating: false,
        isEditing: false,
        isDeleting: false,
        editingGroupId: null,
        rationLookupLoaded: !canWrite,
        rationLookupError: "",
        storageZoneLookupLoaded: false,
        storageZoneLookupError: "",
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
        return canWrite ? 5 : 4;
    }

    function getTrimmedValue(input) {
        return typeof input?.value === "string" ? input.value.trim() : "";
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

    function getGroupById(groupId) {
        return state.groups.find((group) => Number(group?.id) === Number(groupId)) || null;
    }

    function getStorageZoneById(zoneId) {
        const normalizedZoneId = Number(zoneId);
        if (!Number.isInteger(normalizedZoneId) || normalizedZoneId <= 0) {
            return null;
        }

        return state.storageZones.find((zone) => Number(zone?.id) === normalizedZoneId) || null;
    }

    function normalizeZoneShape(zone) {
        return String(zone?.shapeType || "CIRCLE").trim().toUpperCase() === "SQUARE" ? "SQUARE" : "CIRCLE";
    }

    function getZoneSizeLabel(zone) {
        if (normalizeZoneShape(zone) === "SQUARE") {
            const sideMeters = Number(zone?.sideMeters);
            return Number.isFinite(sideMeters) && sideMeters > 0
                ? `квадрат ${numberFormatter.format(sideMeters)} м`
                : "квадрат";
        }

        const radius = Number(zone?.radius);
        return Number.isFinite(radius) && radius > 0
            ? `радиус ${numberFormatter.format(radius)} м`
            : "круг";
    }

    function zonesMatchGroup(zone, group) {
        const zoneLat = Number(zone?.lat);
        const zoneLon = Number(zone?.lon);
        const zoneRadius = Number(zone?.radius);
        const groupLat = Number(group?.lat);
        const groupLon = Number(group?.lon);
        const groupRadius = Number(group?.radius);

        return Number.isFinite(zoneLat)
            && Number.isFinite(zoneLon)
            && Number.isFinite(zoneRadius)
            && Number.isFinite(groupLat)
            && Number.isFinite(groupLon)
            && Number.isFinite(groupRadius)
            && Math.abs(zoneLat - groupLat) < 0.000001
            && Math.abs(zoneLon - groupLon) < 0.000001
            && Math.abs(zoneRadius - groupRadius) < 0.001;
    }

    function getStorageZoneForGroup(group) {
        const storageZoneId = Number(group?.storageZoneId);
        if (Number.isInteger(storageZoneId) && storageZoneId > 0) {
            return getStorageZoneById(storageZoneId) || group?.storageZone || null;
        }

        return state.storageZones.find((zone) => zonesMatchGroup(zone, group)) || null;
    }

    function renderStorageZone(group) {
        const zone = getStorageZoneForGroup(group);
        if (zone) {
            const zoneName = zone?.name || `Зона #${zone?.id || "-"}`;
            return `
                <div class="groups-zone-cell">
                    <span class="groups-zone-name">${escapeHtml(zoneName)}</span>
                    <div class="groups-zone-cell__meta">${escapeHtml(getZoneSizeLabel(zone))}</div>
                </div>
            `;
        }

        const lat = formatFixedNumber(group?.lat, 6);
        const lon = formatFixedNumber(group?.lon, 6);
        if (!lat || !lon) {
            return '<span class="text-muted">-</span>';
        }

        return `
            <div class="groups-zone-cell">
                <span class="groups-zone-name text-muted">Зона не найдена</span>
                <div class="groups-zone-cell__meta">${escapeHtml(lat)}, ${escapeHtml(lon)}</div>
            </div>
        `;
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
                <td>${renderStorageZone(group)}</td>
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

    function buildStorageZoneOptionsMarkup(selectedZoneId) {
        const options = ['<option value="">Выберите зону</option>'];
        const normalizedSelectedId = Number.isInteger(Number(selectedZoneId)) && Number(selectedZoneId) > 0
            ? Number(selectedZoneId)
            : null;

        state.storageZones.forEach((zone) => {
            const zoneId = Number(zone?.id);
            if (!Number.isInteger(zoneId) || zoneId <= 0) {
                return;
            }

            const label = `${zone?.name || `Зона #${zoneId}`} (${getZoneSizeLabel(zone)})`;
            const isSelected = normalizedSelectedId === zoneId;
            options.push(
                `<option value="${zoneId}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`
            );
        });

        return options.join("");
    }

    function renderStorageZoneOptions() {
        if (storageZoneSelect) {
            storageZoneSelect.innerHTML = buildStorageZoneOptionsMarkup("");
            storageZoneSelect.classList.toggle("is-unavailable", Boolean(state.storageZoneLookupError));
        }

        if (editStorageZoneSelect) {
            const currentGroup = getGroupById(state.editingGroupId);
            const selectedZone = currentGroup ? getStorageZoneForGroup(currentGroup) : null;
            editStorageZoneSelect.innerHTML = buildStorageZoneOptionsMarkup(selectedZone?.id || "");
            editStorageZoneSelect.classList.toggle("is-unavailable", Boolean(state.storageZoneLookupError));
        }
    }

    function updateCreateFormState() {
        if (!createForm) {
            return;
        }

        const formDisabled = !canWrite || state.isCreating;
        const lookupsBusy = (!state.rationLookupLoaded && !state.rationLookupError)
            || (!state.storageZoneLookupLoaded && !state.storageZoneLookupError);
        const zoneSelectUnavailable = Boolean(state.storageZoneLookupError) || lookupsBusy || state.storageZones.length === 0;
        [nameInput, headcountInput, rationSelect, storageZoneSelect].forEach((element) => {
            if (element) {
                element.disabled = formDisabled
                    || (element === rationSelect && Boolean(state.rationLookupError))
                    || (element === storageZoneSelect && zoneSelectUnavailable);
            }
        });

        if (createButton) {
            createButton.disabled = formDisabled || lookupsBusy || Boolean(state.storageZoneLookupError) || state.storageZones.length === 0;
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
            } else if (
                (!state.rationLookupLoaded && !state.rationLookupError)
                || (!state.storageZoneLookupLoaded && !state.storageZoneLookupError)
            ) {
                formMeta.textContent = "Подтягиваем списки рационов и зон хранения...";
            } else if (state.rationLookupError) {
                formMeta.textContent = "Список рационов недоступен. Группу можно создать без привязки.";
            } else if (state.storageZoneLookupError) {
                formMeta.textContent = "Список зон хранения недоступен. Создание группы временно отключено.";
            } else if (state.storageZones.length === 0) {
                formMeta.textContent = "Сначала добавьте хотя бы одну зону хранения.";
            } else {
                formMeta.textContent = `Доступно рационов: ${state.rations.length}, зон хранения: ${state.storageZones.length}`;
            }
        }
    }

    function updateEditFormState() {
        if (!editForm) {
            return;
        }

        const currentGroup = getGroupById(state.editingGroupId);
        const disabled = !canWrite || state.isEditing || state.isDeleting || !currentGroup;

        [editHeadcountInput, editRationSelect, editStorageZoneSelect].forEach((element) => {
            if (element) {
                element.disabled = disabled
                    || (element === editRationSelect && Boolean(state.rationLookupError))
                    || (element === editStorageZoneSelect && Boolean(state.storageZoneLookupError));
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
            } else if (state.rationLookupError || state.storageZoneLookupError) {
                editMeta.textContent = "Один из справочников недоступен. Обновите страницу или попробуйте позже.";
            } else {
                editMeta.textContent = "Можно изменить поголовье, рацион и зону хранения.";
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
        if (rationSelect) {
            rationSelect.value = "";
        }
        if (storageZoneSelect) {
            storageZoneSelect.value = "";
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
        const rationIdRaw = getTrimmedValue(elements.rationSelect);
        const rationId = rationIdRaw ? Number.parseInt(rationIdRaw, 10) : null;
        const storageZoneId = Number.parseInt(getTrimmedValue(elements.storageZoneSelect), 10);
        const storageZone = getStorageZoneById(storageZoneId);

        if (!Number.isInteger(headcount) || headcount <= 0) {
            throw new Error("Поголовье должно быть положительным целым числом.");
        }

        if (rationId !== null && (!Number.isInteger(rationId) || rationId <= 0)) {
            throw new Error("Выберите корректный рацион.");
        }

        if (!storageZone) {
            throw new Error("Выберите зону хранения.");
        }

        const lat = Number(storageZone.lat);
        const lon = Number(storageZone.lon);
        const radius = Number(storageZone.radius);

        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
            throw new Error("У выбранной зоны хранения некорректные координаты.");
        }

        if (!Number.isFinite(radius) || radius <= 0) {
            throw new Error("У выбранной зоны хранения некорректный радиус.");
        }

        return {
            headcount,
            rationId,
            storageZoneId,
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
                storageZoneSelect,
            }),
        };
    }

    function buildEditPayload() {
        return buildSharedPayload({
            headcountInput: editHeadcountInput,
            rationSelect: editRationSelect,
            storageZoneSelect: editStorageZoneSelect,
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
        renderRationOptions();
        renderStorageZoneOptions();
        if (editRationSelect) {
            editRationSelect.value = group?.rationId ?? "";
        }
        if (editStorageZoneSelect) {
            editStorageZoneSelect.value = getStorageZoneForGroup(group)?.id ?? "";
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
                const [groupsResult, rationsResult, storageZonesResult] = await Promise.allSettled([
                    fetchJson(GROUPS_API_URL),
                    fetchJson(RATIONS_API_URL),
                    fetchJson(STORAGE_ZONES_API_URL),
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

                if (storageZonesResult.status === "fulfilled") {
                    state.storageZones = Array.isArray(storageZonesResult.value) ? storageZonesResult.value : [];
                    state.storageZoneLookupLoaded = true;
                    state.storageZoneLookupError = "";
                } else {
                    state.storageZones = [];
                    state.storageZoneLookupLoaded = false;
                    state.storageZoneLookupError = storageZonesResult.reason?.message || "Не удалось загрузить зоны хранения.";
                    showAlert(state.storageZoneLookupError, "warning");
                }

                if (groupsResult.status === "fulfilled") {
                    state.groups = Array.isArray(groupsResult.value) ? groupsResult.value : [];
                } else {
                    throw groupsResult.reason;
                }
            } else {
                const [groupsResult, storageZonesResult] = await Promise.allSettled([
                    fetchJson(GROUPS_API_URL),
                    fetchJson(STORAGE_ZONES_API_URL),
                ]);
                if (loadId !== state.activeLoadId) {
                    return;
                }

                if (groupsResult.status === "fulfilled") {
                    state.groups = Array.isArray(groupsResult.value) ? groupsResult.value : [];
                } else {
                    throw groupsResult.reason;
                }

                if (storageZonesResult.status === "fulfilled") {
                    state.storageZones = Array.isArray(storageZonesResult.value) ? storageZonesResult.value : [];
                    state.storageZoneLookupLoaded = true;
                    state.storageZoneLookupError = "";
                } else {
                    state.storageZones = [];
                    state.storageZoneLookupLoaded = false;
                    state.storageZoneLookupError = storageZonesResult.reason?.message || "Не удалось загрузить зоны хранения.";
                    showAlert(state.storageZoneLookupError, "warning");
                }
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
            renderStorageZoneOptions();
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

        let payload;
        try {
            payload = buildEditPayload();
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
            const response = await fetch(`${GROUPS_API_URL}/${state.editingGroupId}`, {
                method: "PUT",
                headers: getHeaders(true),
                credentials: "same-origin",
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось обновить группу.");
            }

            showAlert(`Группа "${group?.name || state.editingGroupId}" обновлена.`, "success");
            closeEditModal();
            await loadPageData();
        } catch (error) {
            showAlert(error?.message || "Не удалось обновить группу.", "danger");
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
            const response = await fetch(`${GROUPS_API_URL}/${targetId}`, {
                method: "DELETE",
                headers: getHeaders(false),
                credentials: "same-origin",
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось удалить группу.");
            }

            const payload = await response.json().catch(() => null);
            showAlert(payload?.message || `Группа "${groupName}" удалена.`, "success");
            closeEditModal();
            await loadPageData();
        } catch (error) {
            showAlert(error?.message || "Не удалось удалить группу.", "danger");
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
            renderStorageZoneOptions();
            updateEditFormState();
            renderTable();
        });
    }

    renderRationOptions();
    renderStorageZoneOptions();
    updateCreateFormState();
    updateEditFormState();
    loadPageData();
});
