(function () {
    const TOKEN_KEY = "token";
    const ROLE_KEY = "role";

    const LOGIN_PAGE = "login.html";
    const ADMIN_TELEMETRY_PAGE = "telemetry-admin.html";

    const ROLE_ADMIN = "ADMIN";
    const ROLE_DIRECTOR = "DIRECTOR";
    const ROLE_GUEST = "GUEST";

    const APP_PAGES = new Set([
        "index.html",
        "tables.html",
        "map-zones.html",
        ADMIN_TELEMETRY_PAGE,
    ]);

    const WRITE_ROLES = new Set([ROLE_ADMIN, ROLE_DIRECTOR]);

    function normalizeRole(role) {
        return typeof role === "string" ? role.trim().toUpperCase() : "";
    }

    function getToken() {
        const token = localStorage.getItem(TOKEN_KEY);
        return typeof token === "string" ? token.trim() : "";
    }

    function decodeBase64Url(value) {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        return atob(padded);
    }

    function getTokenPayload(token) {
        if (!token) {
            return null;
        }

        try {
            const payloadChunk = token.split(".")[1];
            if (!payloadChunk) {
                return null;
            }

            return JSON.parse(decodeBase64Url(payloadChunk));
        } catch (error) {
            return null;
        }
    }

    function getRoleFromToken(token) {
        const payload = getTokenPayload(token);
        return normalizeRole(payload?.role);
    }

    function isTokenExpired(token) {
        const payload = getTokenPayload(token);
        const expiresAt = Number(payload?.exp);

        if (!Number.isFinite(expiresAt)) {
            return false;
        }

        return (Date.now() >= expiresAt * 1000);
    }

    function getRole() {
        const storedRole = normalizeRole(localStorage.getItem(ROLE_KEY));
        if (storedRole) {
            return storedRole;
        }

        const derivedRole = getRoleFromToken(getToken());
        if (derivedRole) {
            localStorage.setItem(ROLE_KEY, derivedRole);
        }

        return derivedRole;
    }

    function setSession(token, role) {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }

        const normalizedRole = normalizeRole(role) || getRoleFromToken(token);
        if (normalizedRole) {
            localStorage.setItem(ROLE_KEY, normalizedRole);
        } else {
            localStorage.removeItem(ROLE_KEY);
        }
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROLE_KEY);
    }

    function isAuthenticated() {
        const token = getToken();
        return Boolean(token && !isTokenExpired(token) && getRole());
    }

    function isAdmin() {
        return getRole() === ROLE_ADMIN;
    }

    function hasWriteAccess() {
        return WRITE_ROLES.has(getRole());
    }

    function getCurrentPageName() {
        const path = window.location.pathname.replace(/\\/g, "/");
        const pageName = path.split("/").pop();
        return pageName || "index.html";
    }

    function buildUrl(pageName, params) {
        const url = new URL(pageName, window.location.href);

        Object.entries(params || {}).forEach(([key, value]) => {
            if (value) {
                url.searchParams.set(key, value);
            }
        });

        return url.toString();
    }

    function redirectToLogin(reason) {
        clearSession();
        window.location.replace(buildUrl(LOGIN_PAGE, { error: reason || "auth-required" }));
    }

    function redirectToHome(reason) {
        window.location.replace(buildUrl("index.html", { error: reason || "no-access" }));
    }

    function resolveAlertHost() {
        return (
            document.querySelector("[data-page-alerts]") ||
            document.querySelector(".container-fluid") ||
            document.querySelector(".page-wrapper") ||
            document.querySelector(".container") ||
            document.body
        );
    }

    function showAlert(message, type) {
        const host = resolveAlertHost();
        if (!host) {
            return;
        }

        const alert = document.createElement("div");
        alert.className = `alert alert-${type || "danger"} shadow-sm`;
        alert.textContent = message;
        host.prepend(alert);
    }

    function consumeErrorMessage() {
        const url = new URL(window.location.href);
        const errorCode = url.searchParams.get("error");

        if (!errorCode) {
            return;
        }

        const messages = {
            "auth-required": { type: "warning", text: "Войдите в систему." },
            "session-invalid": { type: "warning", text: "Сессия недействительна. Войдите снова." },
            "no-access": { type: "danger", text: "Нет доступа." },
        };

        const alertConfig = messages[errorCode];
        if (alertConfig) {
            showAlert(alertConfig.text, alertConfig.type);
        }

        url.searchParams.delete("error");
        window.history.replaceState({}, document.title, url.toString());
    }

    function hideTelemetryNavigation() {
        if (isAdmin()) {
            return;
        }

        document.querySelectorAll('a[href="telemetry-admin.html"], a[href="telemetry.html"]').forEach((link) => {
            const navItem = link.closest(".nav-item");
            if (navItem) {
                navItem.style.display = "none";
            } else {
                link.style.display = "none";
            }
        });
    }

    function applyReadOnlyState() {
        const canWrite = hasWriteAccess();
        const role = getRole();

        document.documentElement.setAttribute("data-role", role || "");
        document.documentElement.setAttribute("data-can-write", canWrite ? "true" : "false");

        document.querySelectorAll("[data-requires-write]").forEach((element) => {
            element.hidden = !canWrite;
        });

        document.querySelectorAll("[data-readonly-banner]").forEach((element) => {
            element.classList.toggle("d-none", canWrite);
        });
    }

    function guardCurrentPage() {
        const pageName = getCurrentPageName();

        if (pageName === LOGIN_PAGE) {
            if (isAuthenticated()) {
                window.location.replace(buildUrl("index.html"));
                return false;
            }

            return true;
        }

        if (!APP_PAGES.has(pageName)) {
            return true;
        }

        const token = getToken();

        if (!token) {
            redirectToLogin("auth-required");
            return false;
        }

        if (isTokenExpired(token)) {
            redirectToLogin("session-invalid");
            return false;
        }

        if (!getRole()) {
            redirectToLogin("session-invalid");
            return false;
        }

        if (pageName === ADMIN_TELEMETRY_PAGE && !isAdmin()) {
            redirectToHome("no-access");
            return false;
        }

        return true;
    }

    function initPageChrome() {
        consumeErrorMessage();
        hideTelemetryNavigation();
        applyReadOnlyState();
    }

    const accessAllowed = guardCurrentPage();

    window.AppAuth = {
        ROLE_ADMIN,
        ROLE_DIRECTOR,
        ROLE_GUEST,
        clearSession,
        getRole,
        getToken,
        hasWriteAccess,
        isAdmin,
        isAuthenticated,
        setSession,
        showAlert,
    };

    if (!accessAllowed) {
        return;
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initPageChrome, { once: true });
    } else {
        initPageChrome();
    }
})();
