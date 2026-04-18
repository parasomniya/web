const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginBtn");
const passwordInput = document.getElementById("password");
const togglePasswordButton = document.getElementById("togglePasswordBtn");

function consumeResetSuccessMessage() {
    const url = new URL(window.location.href);

    if (url.searchParams.get("reset") !== "success") {
        return;
    }

    window.AppAuth?.showAlert("Пароль успешно изменен. Теперь можно войти.", "success");
    url.searchParams.delete("reset");
    window.history.replaceState({}, document.title, url.toString());
}

consumeResetSuccessMessage();

async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById("login").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) {
        window.AppAuth?.showAlert("Введите логин и пароль.", "warning");
        return;
    }

    loginButton.disabled = true;

    try {
        const response = await fetch(window.AppAuth?.getApiUrl?.("/api/auth/login") || "/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                username,
                password,
            }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.token) {
            const errorMessage = payload?.error || "Неверный логин или пароль.";
            window.AppAuth?.showAlert(errorMessage, "danger");
            return;
        }

        window.AppAuth?.setSession(payload.token, payload.role, username);

        if (!window.AppAuth?.isAuthenticated?.()) {
            window.AppAuth?.clearSession?.();
            window.AppAuth?.showAlert("Session save failed. Please try again.", "danger");
            return;
        }
        window.location.replace("index.html");
    } catch (error) {
        window.AppAuth?.showAlert("Не удалось выполнить вход. Попробуйте снова.", "danger");
    } finally {
        loginButton.disabled = false;
    }
}

if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
}

if (passwordInput && togglePasswordButton) {
    togglePasswordButton.addEventListener("click", () => {
        const isVisible = passwordInput.type === "text";
        passwordInput.type = isVisible ? "password" : "text";
        togglePasswordButton.textContent = isVisible ? "Показать" : "Скрыть";
        togglePasswordButton.setAttribute("aria-label", isVisible ? "Показать пароль" : "Скрыть пароль");
    });
}
