(function () {
    const DESKTOP_MIN_WIDTH = 768;
    const STORAGE_KEY = "app-sidebar-collapsed";
    const DIGEST_ITEM_ID = "sidebar-digest-settings";
    const DIGEST_PAGE = "digest-settings.html";
    const DIGEST_ROUTE = "/digest/settings";
    const VIOLATIONS_ITEM_ID = "sidebar-violations";
    const VIOLATIONS_PAGE = "violations.html";
    const VIOLATIONS_ROUTE = "/violations";
    const REPORTS_ITEM_ID = "sidebar-reports";
    const REPORTS_PAGE = "reports.html";
    const REPORTS_ROUTE = "/reports";
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

    function getNormalizedPathname() {
        const pathname = window.location.pathname.replace(/\\/g, "/");

        if (!pathname || pathname === "/") {
            return "/";
        }

        return pathname.replace(/\/+$/, "") || "/";
    }

    function getCurrentPageName() {
        const path = window.location.pathname.replace(/\\/g, "/");
        const pageName = path.split("/").pop();
        return pageName || "index.html";
    }

    function ensureNavigationItem(config) {
        const {
            id,
            page,
            route,
            label,
            icon,
            insertAfterHref,
        } = config;

        if (sidebar.querySelector(`[data-sidebar-item="${id}"]`)) {
            return;
        }

        const divider = sidebar.querySelector(".sidebar-divider.d-none.d-md-block");
        const insertAfterLink = insertAfterHref ? sidebar.querySelector(`a[href="${insertAfterHref}"]`) : null;
        const insertAfterItem = insertAfterLink ? insertAfterLink.closest(".nav-item") : null;

        if (!divider && !insertAfterItem) {
            return;
        }

        const navItem = document.createElement("li");
        const isActive = getCurrentPageName() === page || getNormalizedPathname() === route;

        navItem.className = `nav-item${isActive ? " active" : ""}`;
        navItem.dataset.sidebarItem = id;
        navItem.innerHTML = `
            <a class="nav-link" href="${page}"${isActive ? ' aria-current="page"' : ""}>
                <i class="fas fa-fw ${icon}"></i>
                <span>${label}</span>
            </a>
        `;

        if (insertAfterItem) {
            insertAfterItem.insertAdjacentElement("afterend", navItem);
            return;
        }

        sidebar.insertBefore(navItem, divider);
    }

    function ensureViolationsNavigationItem() {
        ensureNavigationItem({
            id: VIOLATIONS_ITEM_ID,
            page: VIOLATIONS_PAGE,
            route: VIOLATIONS_ROUTE,
            label: "Нарушения",
            icon: "fa-exclamation-triangle",
            insertAfterHref: "tables.html",
        });
    }

    function ensureDigestNavigationItem() {
        if (window.AppAuth?.isGuest?.()) {
            return;
        }

        ensureNavigationItem({
            id: DIGEST_ITEM_ID,
            page: DIGEST_PAGE,
            route: DIGEST_ROUTE,
            label: "Email digest",
            icon: "fa-envelope-open-text",
        });
    }

    function ensureReportsNavigationItem() {
        ensureNavigationItem({
            id: REPORTS_ITEM_ID,
            page: REPORTS_PAGE,
            route: REPORTS_ROUTE,
            label: "Отчеты",
            icon: "fa-chart-bar",
            insertAfterHref: VIOLATIONS_PAGE,
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

    ensureViolationsNavigationItem();
    ensureReportsNavigationItem();
    ensureDigestNavigationItem();
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
