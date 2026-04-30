(function () {
    const usersTableBody = document.getElementById("usersTableBody");
    const usersPanelMeta = document.getElementById("usersPanelMeta");
    const createUserForm = document.getElementById("createUserForm");
    const createUserModal = document.getElementById("createUserModal");
    const createUserSubmitButton = document.getElementById("createUserSubmitButton");
    const createUserRole = document.getElementById("createUserRole");
    const editUserForm = document.getElementById("editUserForm");
    const editUserModal = document.getElementById("editUserModal");
    const editUserIdInput = document.getElementById("editUserId");
    const editUserNameInput = document.getElementById("editUserName");
    const editUserEmailInput = document.getElementById("editUserEmail");
    const editUserSubmitButton = document.getElementById("editUserSubmitButton");

    if (!usersTableBody || !createUserForm || !editUserForm) {
        return;
    }

    const USERS_API_URL = window.AppAuth?.getApiUrl?.("/api/users") || "/api/users";
    const AVAILABLE_ROLES = ["ADMIN", "DIRECTOR", "GUEST"];

    const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    const state = {
        users: [],
        isLoading: false,
        isCreating: false,
        activeLoadId: 0,
        lastLoadError: "",
        pendingRoles: new Map(),
        roleUpdates: new Set(),
        deletions: new Set(),
        editUserId: null,
        isEditing: false,
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
            includeJson
                ? { "Content-Type": "application/json" }
                : {}
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

    function formatCreatedAt(value) {
        if (!value) {
            return '<span class="text-muted">-</span>';
        }

        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
            return '<span class="text-muted">-</span>';
        }

        return escapeHtml(dateFormatter.format(parsedDate));
    }

    function setPanelMeta(message) {
        if (usersPanelMeta) {
            usersPanelMeta.textContent = message;
        }
    }

    function showAlert(message, type) {
        window.AppAuth?.showAlert?.(message, type);
    }

    function getUserById(userId) {
        return state.users.find((user) => Number(user?.id) === Number(userId)) || null;
    }

    function getRoleSelectMarkup(user) {
        const userId = Number(user?.id);
        const currentRole = state.pendingRoles.get(userId)
            || (typeof user?.role === "string" ? user.role.toUpperCase() : "GUEST");
        const isBusy = state.isLoading || state.roleUpdates.has(userId) || state.deletions.has(userId);

        const options = AVAILABLE_ROLES.map((role) => (
            `<option value="${role}" ${role === currentRole ? "selected" : ""}>${role}</option>`
        )).join("");

        return `
            <select
                class="custom-select custom-select-sm admin-users-role-select"
                data-user-id="${userId}"
                ${isBusy ? "disabled" : ""}
                aria-label="Изменить роль пользователя ${escapeHtml(user?.username || userId)}"
            >
                ${options}
            </select>
        `;
    }

    function getDeleteButtonMarkup(user) {
        const userId = Number(user?.id);
        const isDeleting = state.deletions.has(userId);
        const isBusy = state.isLoading || state.roleUpdates.has(userId) || isDeleting;
        const iconMarkup = isDeleting
            ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>'
            : '<i class="fas fa-trash-alt" aria-hidden="true"></i>';

        return `
            <button
                type="button"
                class="btn btn-link text-danger p-0 admin-users-delete-button"
                data-user-id="${userId}"
                ${isBusy ? "disabled" : ""}
                aria-label="Удалить пользователя ${escapeHtml(user?.username || userId)}"
                title="Удалить пользователя"
            >
                ${iconMarkup}
            </button>
        `;
    }

    function getEditButtonMarkup(user) {
        const userId = Number(user?.id);
        const isBusy = state.isLoading || state.roleUpdates.has(userId) || state.deletions.has(userId) || (state.isEditing && state.editUserId === userId);
        const iconMarkup = (state.isEditing && state.editUserId === userId)
            ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>'
            : '<i class="fas fa-pen" aria-hidden="true"></i>';

        return `
            <button
                type="button"
                class="btn btn-link text-primary p-0 admin-users-edit-button"
                data-user-id="${userId}"
                ${isBusy ? "disabled" : ""}
                aria-label="Редактировать пользователя ${escapeHtml(user?.username || userId)}"
                title="Редактировать пользователя"
            >
                ${iconMarkup}
            </button>
        `;
    }

    function renderTableBody() {
        if (state.isLoading && !state.users.length) {
            usersTableBody.innerHTML = '<tr><td colspan="6" class="telemetry-empty-state">Загрузка пользователей...</td></tr>';
            return;
        }

        if (state.lastLoadError && !state.users.length) {
            usersTableBody.innerHTML = `<tr><td colspan="6" class="telemetry-empty-state">${escapeHtml(state.lastLoadError)}</td></tr>`;
            return;
        }

        if (!state.users.length) {
            usersTableBody.innerHTML = '<tr><td colspan="6" class="telemetry-empty-state">Пользователи не найдены.</td></tr>';
            return;
        }

        usersTableBody.innerHTML = state.users.map((user) => `
            <tr>
                <td>${escapeHtml(user?.id ?? "-")}</td>
                <td class="font-weight-bold text-gray-800">${escapeHtml(user?.username || "-")}</td>
                <td>${escapeHtml(user?.email || "-")}</td>
                <td>${getRoleSelectMarkup(user)}</td>
                <td>${formatCreatedAt(user?.createdAt)}</td>
                <td class="text-center">
                    <div class="admin-users-actions">
                        ${getEditButtonMarkup(user)}
                        ${getDeleteButtonMarkup(user)}
                    </div>
                </td>
            </tr>
        `).join("");
    }

    function updateCreateButtonState() {
        if (!createUserSubmitButton) {
            return;
        }

        createUserSubmitButton.disabled = state.isCreating || state.isLoading;
        createUserSubmitButton.innerHTML = state.isCreating
            ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Создание...'
            : 'Создать';
    }

    function updateEditButtonState() {
        if (!editUserSubmitButton) {
            return;
        }

        editUserSubmitButton.disabled = state.isEditing || state.isLoading;
        editUserSubmitButton.innerHTML = state.isEditing
            ? '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Сохранение...'
            : 'Сохранить';
    }

    function syncUiState() {
        renderTableBody();
        updateCreateButtonState();
        updateEditButtonState();
    }

    async function loadUsers(options) {
        const settings = options || {};
        const requestId = ++state.activeLoadId;

        state.isLoading = true;
        state.lastLoadError = "";
        setPanelMeta(state.users.length ? "Обновление списка пользователей..." : "Загрузка пользователей...");
        syncUiState();

        try {
            const response = await fetch(USERS_API_URL, {
                method: "GET",
                headers: getHeaders(false),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось загрузить пользователей");
            }

            const payload = await response.json();
            if (requestId !== state.activeLoadId) {
                return;
            }

            state.users = Array.isArray(payload) ? payload : [];
            state.lastLoadError = "";
            setPanelMeta(`Всего пользователей: ${state.users.length}`);
        } catch (error) {
            if (requestId !== state.activeLoadId) {
                return;
            }

            state.lastLoadError = error.message || "Не удалось загрузить пользователей";
            setPanelMeta("Не удалось загрузить пользователей");

            if (!settings.silentError) {
                showAlert(error.message || "Не удалось загрузить пользователей", "danger");
            }
        } finally {
            if (requestId === state.activeLoadId) {
                state.isLoading = false;
                syncUiState();
            }
        }
    }

    async function updateUserRole(userId, nextRole) {
        const user = getUserById(userId);
        const previousRole = typeof user?.role === "string" ? user.role.toUpperCase() : "";

        if (!user || !AVAILABLE_ROLES.includes(nextRole) || nextRole === previousRole) {
            syncUiState();
            return;
        }

        state.pendingRoles.set(userId, nextRole);
        state.roleUpdates.add(userId);
        syncUiState();

        try {
            const response = await fetch(`${USERS_API_URL}/${userId}/role`, {
                method: "PATCH",
                headers: getHeaders(true),
                body: JSON.stringify({ role: nextRole }),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось обновить роль пользователя");
            }

            state.users = state.users.map((item) => (
                Number(item?.id) === Number(userId)
                    ? { ...item, role: nextRole }
                    : item
            ));

            showAlert("Роль обновлена", "success");
        } catch (error) {
            showAlert(error.message || "Не удалось обновить роль пользователя", "danger");
        } finally {
            state.pendingRoles.delete(userId);
            state.roleUpdates.delete(userId);
            syncUiState();
        }
    }

    async function deleteUser(userId) {
        const user = getUserById(userId);
        if (!user) {
            return;
        }

        const confirmationMessage = `Удалить пользователя "${user.username}"?`;
        if (!window.confirm(confirmationMessage)) {
            return;
        }

        state.deletions.add(userId);
        syncUiState();

        try {
            const response = await fetch(`${USERS_API_URL}/${userId}`, {
                method: "DELETE",
                headers: getHeaders(false),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось удалить пользователя");
            }

            showAlert("Пользователь удален", "success");
            await loadUsers({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось удалить пользователя", "danger");
        } finally {
            state.deletions.delete(userId);
            syncUiState();
        }
    }

    function resetCreateForm() {
        createUserForm.reset();

        if (createUserRole) {
            createUserRole.value = "GUEST";
        }
    }

    function closeCreateModal() {
        if (window.jQuery && createUserModal) {
            window.jQuery(createUserModal).modal("hide");
        }
    }

    function openEditModal(user) {
        if (!user || !editUserIdInput || !editUserNameInput || !editUserEmailInput) {
            return;
        }

        state.editUserId = Number(user.id);
        editUserIdInput.value = String(user.id);
        editUserNameInput.value = user.username || "";
        editUserEmailInput.value = user.email || "";
        updateEditButtonState();

        if (window.jQuery && editUserModal) {
            window.jQuery(editUserModal).modal("show");
        }
    }

    function closeEditModal() {
        if (window.jQuery && editUserModal) {
            window.jQuery(editUserModal).modal("hide");
        }
    }

    function resetEditForm() {
        editUserForm.reset();
        state.editUserId = null;
        updateEditButtonState();
    }

    async function createUser(event) {
        event.preventDefault();

        const formData = new FormData(createUserForm);
        const username = String(formData.get("username") || "").trim();
        const email = String(formData.get("email") || "").trim();
        const password = String(formData.get("password") || "");
        const role = String(formData.get("role") || "GUEST").trim().toUpperCase();

        if (!username || !email || !password) {
            showAlert("Заполните имя, email и пароль", "warning");
            return;
        }

        if (password.length < 6) {
            showAlert("Пароль должен содержать минимум 6 символов", "warning");
            return;
        }

        if (!AVAILABLE_ROLES.includes(role)) {
            showAlert("Выберите корректную роль пользователя", "warning");
            return;
        }

        state.isCreating = true;
        updateCreateButtonState();

        try {
            const response = await fetch(USERS_API_URL, {
                method: "POST",
                headers: getHeaders(true),
                body: JSON.stringify({
                    username,
                    email,
                    password,
                    role,
                }),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось создать пользователя");
            }

            resetCreateForm();
            closeCreateModal();
            showAlert("Пользователь создан", "success");
            await loadUsers({ silentError: false });
        } catch (error) {
            showAlert(error.message || "Не удалось создать пользователя", "danger");
        } finally {
            state.isCreating = false;
            updateCreateButtonState();
        }
    }

    async function updateUser(event) {
        event.preventDefault();

        const formData = new FormData(editUserForm);
        const userId = Number(formData.get("id"));
        const username = String(formData.get("username") || "").trim();
        const email = String(formData.get("email") || "").trim();
        const existingUser = getUserById(userId);

        if (!existingUser) {
            showAlert("Пользователь не найден", "danger");
            return;
        }

        if (!username) {
            showAlert("Логин обязателен", "warning");
            return;
        }

        if (!email) {
            showAlert("Email обязателен", "warning");
            return;
        }

        state.isEditing = true;
        state.editUserId = userId;
        syncUiState();

        try {
            const response = await fetch(`${USERS_API_URL}/${userId}`, {
                method: "PATCH",
                headers: getHeaders(true),
                body: JSON.stringify({ username, email }),
            });

            if (!response.ok) {
                const message = await readErrorMessage(response);
                throw new Error(message || "Не удалось обновить пользователя");
            }

            const payload = await response.json();
            const updatedUser = payload?.user || payload;

            state.users = state.users.map((item) => (
                Number(item?.id) === userId
                    ? { ...item, ...updatedUser }
                    : item
            ));

            if ((window.AppAuth?.getUsername?.() || "") === (existingUser.username || "") && window.AppAuth?.setSession && window.AppAuth?.getToken) {
                window.AppAuth.setSession(window.AppAuth.getToken(), window.AppAuth.getRole?.(), updatedUser.username || username);
            }

            closeEditModal();
            resetEditForm();
            showAlert("Пользователь обновлен", "success");
        } catch (error) {
            showAlert(error.message || "Не удалось обновить пользователя", "danger");
        } finally {
            state.isEditing = false;
            state.editUserId = null;
            syncUiState();
        }
    }

    usersTableBody.addEventListener("change", (event) => {
        const select = event.target.closest(".admin-users-role-select");
        if (!select) {
            return;
        }

        const userId = Number(select.dataset.userId);
        const nextRole = String(select.value || "").trim().toUpperCase();
        updateUserRole(userId, nextRole);
    });

    usersTableBody.addEventListener("click", (event) => {
        const editButton = event.target.closest(".admin-users-edit-button");
        if (editButton) {
            const userId = Number(editButton.dataset.userId);
            openEditModal(getUserById(userId));
            return;
        }

        const button = event.target.closest(".admin-users-delete-button");
        if (!button) {
            return;
        }

        const userId = Number(button.dataset.userId);
        deleteUser(userId);
    });

    createUserForm.addEventListener("submit", createUser);
    editUserForm.addEventListener("submit", updateUser);

    if (window.jQuery && editUserModal) {
        window.jQuery(editUserModal).on("hidden.bs.modal", resetEditForm);
    }

    loadUsers({ silentError: false });
})();
