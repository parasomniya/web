const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const forgotPasswordButton = document.getElementById("forgotPasswordBtn");
const resetPasswordButton = document.getElementById("resetPasswordBtn");
const forgotPasswordSection = document.getElementById("forgotPasswordSection");
const setPasswordSection = document.getElementById("setPasswordSection");
const titleElement = document.getElementById("resetPasswordTitle");
const descriptionElement = document.getElementById("resetPasswordDescription");

const REQUEST_MODE = "request";
const RESET_MODE = "reset";

function getResetParams() {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id")?.trim() || "";
    const parsedId = Number.parseInt(id, 10);

    return {
        id,
        parsedId: Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null,
        token: url.searchParams.get("token")?.trim() || "",
    };
}

function setViewMode(mode) {
    const isResetMode = mode === RESET_MODE;

    forgotPasswordSection?.classList.toggle("d-none", isResetMode);
    setPasswordSection?.classList.toggle("d-none", !isResetMode);

    if (titleElement) {
        titleElement.textContent = isResetMode ? "Новый пароль" : "Восстановление пароля";
    }

    if (descriptionElement) {
        descriptionElement.textContent = isResetMode
            ? "Введите новый пароль для завершения сброса."
            : "Введите логин, и мы отправим инструкцию по сбросу пароля.";
    }
}

function resolveMode() {
    const { id, parsedId, token } = getResetParams();

    if (id && token && parsedId) {
        return RESET_MODE;
    }

    if (!id && !token) {
        return REQUEST_MODE;
    }

    window.AppAuth?.showAlert("Ссылка для сброса пароля неполная. Запросите новую.", "warning");
    return REQUEST_MODE;
}

function getApiUrl(path) {
    return window.AppAuth?.getApiUrl?.(path) || path;
}

function setPasswordVisibility(button, input) {
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    button.textContent = isVisible ? "Показать" : "Скрыть";
    button.setAttribute("aria-label", isVisible ? "Показать пароль" : "Скрыть пароль");
}

async function handleForgotPasswordSubmit(event) {
    event.preventDefault();

    const username = document.getElementById("forgotUsername")?.value.trim() || "";
    if (!username) {
        window.AppAuth?.showAlert("Введите логин.", "warning");
        return;
    }

    if (forgotPasswordButton) {
        forgotPasswordButton.disabled = true;
    }

    try {
        const response = await fetch(getApiUrl("/api/auth/forgot-password"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ username }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            window.AppAuth?.showAlert(payload?.error || "Не удалось отправить запрос на сброс пароля.", "danger");
            return;
        }

        forgotPasswordForm?.reset();
        window.AppAuth?.showAlert(
            payload?.message || "Если пользователь найден, инструкция по сбросу отправлена.",
            "success"
        );
    } catch (error) {
        window.AppAuth?.showAlert("Не удалось отправить запрос на сброс пароля. Попробуйте снова.", "danger");
    } finally {
        if (forgotPasswordButton) {
            forgotPasswordButton.disabled = false;
        }
    }
}

async function handleResetPasswordSubmit(event) {
    event.preventDefault();

    const { parsedId, token } = getResetParams();
    const newPassword = document.getElementById("newPassword")?.value || "";
    const confirmPassword = document.getElementById("confirmPassword")?.value || "";

    if (!parsedId || !token) {
        window.AppAuth?.showAlert("Ссылка для сброса пароля недействительна.", "danger");
        return;
    }

    if (!newPassword) {
        window.AppAuth?.showAlert("Введите новый пароль.", "warning");
        return;
    }

    if (newPassword.length < 6) {
        window.AppAuth?.showAlert("Пароль должен содержать минимум 6 символов.", "warning");
        return;
    }

    if (newPassword !== confirmPassword) {
        window.AppAuth?.showAlert("Пароли не совпадают.", "warning");
        return;
    }

    if (resetPasswordButton) {
        resetPasswordButton.disabled = true;
    }

    try {
        const response = await fetch(getApiUrl("/api/auth/reset-password"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                id: parsedId,
                token,
                newPassword,
            }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            window.AppAuth?.showAlert(payload?.error || "Не удалось сохранить новый пароль.", "danger");
            return;
        }

        resetPasswordForm?.reset();
        window.AppAuth?.showAlert(payload?.message || "Пароль успешно изменен.", "success");
        window.setTimeout(() => {
            window.location.replace("/login?reset=success");
        }, 1600);
    } catch (error) {
        window.AppAuth?.showAlert("Не удалось сохранить новый пароль. Попробуйте снова.", "danger");
    } finally {
        if (resetPasswordButton) {
            resetPasswordButton.disabled = false;
        }
    }
}

function initPasswordToggles() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
        const input = document.getElementById(button.dataset.passwordToggle || "");
        if (!input) {
            return;
        }

        button.addEventListener("click", () => {
            setPasswordVisibility(button, input);
        });
    });
}

function initResetPasswordPage() {
    setViewMode(resolveMode());
    initPasswordToggles();

    forgotPasswordForm?.addEventListener("submit", handleForgotPasswordSubmit);
    resetPasswordForm?.addEventListener("submit", handleResetPasswordSubmit);
}

initResetPasswordPage();
