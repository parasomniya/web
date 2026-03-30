const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginBtn");

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
        const response = await fetch("/api/auth/login", {
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

        if (!response.ok || !payload?.token || !payload?.role) {
            const errorMessage = payload?.error || "Неверный логин или пароль.";
            window.AppAuth?.showAlert(errorMessage, "danger");
            return;
        }

        window.AppAuth?.setSession(payload.token, payload.role);
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
