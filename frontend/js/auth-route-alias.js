(function () {
    const routeMap = {
        "/login": "/login.html",
        "/reset-password": "/reset-password.html",
    };

    const normalizedPath = window.location.pathname.length > 1
        ? window.location.pathname.replace(/\/+$/, "")
        : window.location.pathname;
    const targetPage = routeMap[normalizedPath];

    if (!targetPage) {
        return;
    }

    try {
        const request = new XMLHttpRequest();
        request.open("GET", targetPage, false);
        request.send(null);

        if (request.status >= 200 && request.status < 300 && request.responseText) {
            document.open();
            document.write(request.responseText);
            document.close();
        }
    } catch (error) {
        console.error("Failed to load auth route alias.", error);
    }
})();
