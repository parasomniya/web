(function () {
    const DESKTOP_MIN_WIDTH = 768;
    const STORAGE_KEY = "app-sidebar-collapsed";
    const body = document.body;
    const sidebar = document.getElementById("accordionSidebar");

    if (!body || !sidebar) {
        return;
    }

    function isDesktopViewport() {
        return window.innerWidth >= DESKTOP_MIN_WIDTH;
    }

    function readSavedState() {
        try {
            return window.localStorage.getItem(STORAGE_KEY) === "true";
        } catch (error) {
            return false;
        }
    }

    function saveState(isCollapsed) {
        try {
            window.localStorage.setItem(STORAGE_KEY, String(isCollapsed));
        } catch (error) {
            // Ignore storage issues and keep runtime behavior working.
        }
    }

    function getCurrentState() {
        return sidebar.classList.contains("toggled");
    }

    function applyState(isCollapsed) {
        body.classList.toggle("sidebar-toggled", isCollapsed);
        sidebar.classList.toggle("toggled", isCollapsed);
        syncToggleButtons(isCollapsed);
    }

    function syncToggleButtons(isCollapsed) {
        const label = isCollapsed ? "Развернуть меню" : "Свернуть меню";
        document.querySelectorAll("#sidebarToggle, #sidebarToggleTop").forEach((button) => {
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            button.setAttribute("aria-expanded", String(!isCollapsed));
        });
    }

    function syncNavLabels() {
        sidebar.querySelectorAll(".nav-link").forEach((link) => {
            const label = (link.querySelector("span")?.textContent || link.textContent || "").trim();
            if (!label) {
                return;
            }

            link.dataset.navLabel = label;
            if (!link.getAttribute("aria-label")) {
                link.setAttribute("aria-label", label);
            }
        });
    }

    function syncFromCurrentMarkup() {
        syncToggleButtons(getCurrentState());
    }

    function handleToggleClick() {
        window.setTimeout(() => {
            if (!isDesktopViewport()) {
                syncFromCurrentMarkup();
                return;
            }

            const isCollapsed = getCurrentState();
            saveState(isCollapsed);
            syncToggleButtons(isCollapsed);
        }, 0);
    }

    function handleResize() {
        if (!isDesktopViewport()) {
            body.classList.remove("sidebar-toggled");
            sidebar.classList.remove("toggled");
            syncToggleButtons(false);
            return;
        }

        applyState(readSavedState());
    }

    syncNavLabels();

    if (isDesktopViewport()) {
        applyState(readSavedState());
    } else {
        syncFromCurrentMarkup();
    }

    document.querySelectorAll("#sidebarToggle, #sidebarToggleTop").forEach((button) => {
        button.addEventListener("click", handleToggleClick);
    });

    window.addEventListener("resize", handleResize);
})();
