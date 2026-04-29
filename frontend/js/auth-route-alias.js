(function () {
    const routeMap = {
        "/login": "/login.html",
        "/reset-password": "/reset-password.html",
        "/digest/settings": "/digest-settings.html",
        "/violations": "/violations.html",
    };

    const normalizedPath = window.location.pathname.length > 1
        ? window.location.pathname.replace(/\/+$/, "")
        : window.location.pathname;
    const targetPage = routeMap[normalizedPath];

    if (!targetPage) {
        return;
    }

    fetch(targetPage)
        .then(response => {
            if (response.status >= 200 && response.status < 300) {
                return response.text();
            }
            throw new Error(`Failed to load ${targetPage}: ${response.status}`);
        })
        .then(html => {
            document.open();
            document.write(html);
            document.close();
        })
        .catch(error => {
            console.error("Failed to load auth route alias:", error);
            window.location.replace(targetPage);
        });
})();
