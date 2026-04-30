(function () {
    const STORAGE_KEY = "digest-settings-v1";
    const DEFAULT_SETTINGS = {
        enabled: false,
        senderEmail: "",
        sendTime: "08:00",
        timezone: "Asia/Novosibirsk",
        recipients: [],
        updatedAt: "",
    };

    const form = document.getElementById("digestSettingsForm");
    if (!form) {
        return;
    }

    const elements = {
        enabled: document.getElementById("digestEnabled"),
        enabledLabel: document.getElementById("digestEnabledLabel"),
        senderEmail: document.getElementById("digestSenderEmail"),
        sendTime: document.getElementById("digestSendTime"),
        timezone: document.getElementById("digestTimezone"),
        recipientInput: document.getElementById("digestRecipientInput"),
        addRecipientButton: document.getElementById("digestAddRecipientButton"),
        recipientsEmpty: document.getElementById("digestRecipientsEmpty"),
        recipientsList: document.getElementById("digestRecipientsList"),
        formState: document.getElementById("digestFormState"),
        updatedAt: document.getElementById("digestUpdatedAt"),
        saveButton: document.getElementById("digestSaveButton"),
        resetButton: document.getElementById("digestResetButton"),
        testButton: document.getElementById("digestTestButton"),
        summaryStatus: document.getElementById("digestSummaryStatus"),
        summarySchedule: document.getElementById("digestSummarySchedule"),
        summaryRecipients: document.getElementById("digestSummaryRecipients"),
        previewStatus: document.getElementById("digestPreviewStatus"),
        previewSender: document.getElementById("digestPreviewSender"),
        previewSchedule: document.getElementById("digestPreviewSchedule"),
        previewRecipientsCount: document.getElementById("digestPreviewRecipientsCount"),
        previewRecipientsList: document.getElementById("digestPreviewRecipientsList"),
    };

    let recipients = [];
    const writeAccess = window.AppAuth?.hasWriteAccess?.() ?? false;

    function normalizeEmail(value) {
        return String(value || "").trim().toLowerCase();
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
    }

    function loadSettings() {
        try {
            const rawValue = window.localStorage.getItem(STORAGE_KEY);
            if (!rawValue) {
                return { ...DEFAULT_SETTINGS };
            }

            const parsed = JSON.parse(rawValue);
            return {
                ...DEFAULT_SETTINGS,
                ...parsed,
                recipients: Array.isArray(parsed?.recipients)
                    ? parsed.recipients.map(normalizeEmail).filter(Boolean)
                    : [],
            };
        } catch (error) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings(settings) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function formatUpdatedAt(value) {
        if (!value) {
            return "Изменения еще не сохранены";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "Изменения еще не сохранены";
        }

        return `Сохранено ${date.toLocaleString("ru-RU")}`;
    }

    function describeSchedule(settings) {
        if (!settings.sendTime) {
            return "Не задано";
        }

        return `Каждый день в ${settings.sendTime} (${settings.timezone || "UTC"})`;
    }

    function formatRecipientCount(count) {
        const normalizedCount = Number(count) || 0;
        const remainder10 = normalizedCount % 10;
        const remainder100 = normalizedCount % 100;

        let suffix = "адресов";
        if (remainder10 === 1 && remainder100 !== 11) {
            suffix = "адрес";
        } else if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
            suffix = "адреса";
        }

        return `${normalizedCount} ${suffix}`;
    }

    function readFormSettings() {
        return {
            enabled: Boolean(elements.enabled?.checked),
            senderEmail: normalizeEmail(elements.senderEmail?.value),
            sendTime: String(elements.sendTime?.value || "").trim(),
            timezone: String(elements.timezone?.value || DEFAULT_SETTINGS.timezone).trim(),
            recipients: [...recipients],
            updatedAt: new Date().toISOString(),
        };
    }

    function fillForm(settings) {
        if (elements.enabled) {
            elements.enabled.checked = Boolean(settings.enabled);
        }

        if (elements.senderEmail) {
            elements.senderEmail.value = settings.senderEmail || "";
        }

        if (elements.sendTime) {
            elements.sendTime.value = settings.sendTime || DEFAULT_SETTINGS.sendTime;
        }

        if (elements.timezone) {
            elements.timezone.value = settings.timezone || DEFAULT_SETTINGS.timezone;
        }

        recipients = Array.isArray(settings.recipients) ? [...settings.recipients] : [];
        renderRecipients();
        updatePreview();
        setState("Готово");
        updateSavedAt(settings.updatedAt);
        applyEnabledLabel();
    }

    function applyEnabledLabel() {
        if (!elements.enabledLabel || !elements.enabled) {
            return;
        }

        elements.enabledLabel.textContent = elements.enabled.checked ? "Включен" : "Выключен";
    }

    function setState(message) {
        if (elements.formState) {
            elements.formState.textContent = message;
        }
    }

    function updateSavedAt(value) {
        if (elements.updatedAt) {
            elements.updatedAt.textContent = formatUpdatedAt(value);
        }
    }

    function renderRecipients() {
        if (!elements.recipientsList || !elements.recipientsEmpty) {
            return;
        }

        elements.recipientsList.innerHTML = "";
        elements.recipientsEmpty.classList.toggle("d-none", recipients.length > 0);

        recipients.forEach((email) => {
            const item = document.createElement("div");
            item.className = "digest-recipient-item";
            item.innerHTML = `
                <div class="digest-recipient-item__meta">
                    <div class="digest-recipient-item__email">${escapeHtml(email)}</div>
                </div>
                <button type="button" class="btn btn-outline-danger btn-sm digest-recipient-item__remove" ${writeAccess ? "" : "disabled"}>
                    Удалить
                </button>
            `;

            const removeButton = item.querySelector("button");
            removeButton?.addEventListener("click", () => {
                recipients = recipients.filter((value) => value !== email);
                renderRecipients();
                updatePreview();
                setState(`Адрес ${email} удален из списка получателей.`);
            });

            elements.recipientsList.appendChild(item);
        });
    }

    function renderRecipientPreview() {
        if (!elements.previewRecipientsList) {
            return;
        }

        elements.previewRecipientsList.innerHTML = "";

        recipients.forEach((email) => {
            const badge = document.createElement("span");
            badge.className = "digest-recipient-preview__badge";
            badge.textContent = email;
            elements.previewRecipientsList.appendChild(badge);
        });
    }

    function updatePreview() {
        const settings = readFormSettings();
        const statusText = settings.enabled ? "Включен" : "Выключен";
        const senderText = settings.senderEmail || "Не задан";
        const scheduleText = settings.enabled ? describeSchedule(settings) : "Отправка отключена";
        const recipientsText = formatRecipientCount(settings.recipients.length);

        if (elements.summaryStatus) {
            elements.summaryStatus.textContent = statusText;
        }

        if (elements.summarySchedule) {
            elements.summarySchedule.textContent = scheduleText;
        }

        if (elements.summaryRecipients) {
            elements.summaryRecipients.textContent = recipientsText;
        }

        if (elements.previewStatus) {
            elements.previewStatus.textContent = statusText;
        }

        if (elements.previewSender) {
            elements.previewSender.textContent = senderText;
        }

        if (elements.previewSchedule) {
            elements.previewSchedule.textContent = scheduleText;
        }

        if (elements.previewRecipientsCount) {
            elements.previewRecipientsCount.textContent = recipientsText;
        }

        renderRecipientPreview();
        applyEnabledLabel();
    }

    function addRecipient() {
        if (!writeAccess) {
            return;
        }

        const email = normalizeEmail(elements.recipientInput?.value);
        if (!email) {
            window.AppAuth?.showAlert("Введите email получателя.", "warning");
            return;
        }

        if (!isValidEmail(email)) {
            window.AppAuth?.showAlert("Укажите корректный email получателя.", "warning");
            return;
        }

        if (recipients.includes(email)) {
            window.AppAuth?.showAlert("Этот получатель уже добавлен.", "warning");
            return;
        }

        recipients.push(email);
        recipients.sort((left, right) => left.localeCompare(right, "ru"));

        if (elements.recipientInput) {
            elements.recipientInput.value = "";
            elements.recipientInput.focus();
        }

        renderRecipients();
        updatePreview();
        setState(`Получатель ${email} добавлен.`);
    }

    function validateSettings(settings) {
        if (!settings.senderEmail || !isValidEmail(settings.senderEmail)) {
            return "Укажите корректный email отправителя.";
        }

        if (!settings.sendTime) {
            return "Выберите время отправки.";
        }

        if (!settings.recipients.length) {
            return "Добавьте хотя бы одного получателя.";
        }

        return "";
    }

    function applyReadOnlyState() {
        document.querySelectorAll("[data-digest-input]").forEach((element) => {
            element.disabled = !writeAccess;
        });
    }

    function handleSubmit(event) {
        event.preventDefault();

        if (!writeAccess) {
            window.AppAuth?.showAlert("Недостаточно прав для изменения настроек уведомлений.", "warning");
            return;
        }

        const settings = readFormSettings();
        const validationError = validateSettings(settings);
        if (validationError) {
            window.AppAuth?.showAlert(validationError, "warning");
            setState(validationError);
            return;
        }

        saveSettings(settings);
        updateSavedAt(settings.updatedAt);
        updatePreview();
        setState("Настройки уведомлений сохранены.");
        window.AppAuth?.showAlert("Настройки уведомлений сохранены.", "success");
    }

    function handleReset() {
        if (!writeAccess) {
            return;
        }

        fillForm({ ...DEFAULT_SETTINGS });
        if (elements.recipientInput) {
            elements.recipientInput.value = "";
        }

        setState("Форма сброшена к значениям по умолчанию.");
    }

    function handleTest() {
        const settings = readFormSettings();
        const validationError = validateSettings(settings);
        if (validationError) {
            window.AppAuth?.showAlert(validationError, "warning");
            setState(validationError);
            return;
        }

        const recipientsText = settings.recipients.join(", ");
        window.AppAuth?.showAlert(`Тестовый прогон UI: письмо ушло бы на ${recipientsText}.`, "info");
        setState("Тест выполнен.");
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    form.addEventListener("submit", handleSubmit);

    elements.addRecipientButton?.addEventListener("click", addRecipient);
    elements.recipientInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addRecipient();
        }
    });

    elements.resetButton?.addEventListener("click", handleReset);
    elements.testButton?.addEventListener("click", handleTest);

    [elements.enabled, elements.senderEmail, elements.sendTime, elements.timezone].forEach((element) => {
        element?.addEventListener("input", updatePreview);
        element?.addEventListener("change", updatePreview);
    });

    applyReadOnlyState();
    fillForm(loadSettings());
})();
