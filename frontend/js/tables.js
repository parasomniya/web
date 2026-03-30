(function () {
    const table = document.getElementById("batchesTable");
    if (!table) {
        return;
    }

    const tbody = table.querySelector("tbody");
    if (tbody && !tbody.children.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted">
                    Страница замесов на фронтенде пока не подключена к актуальному API.
                </td>
            </tr>
        `;
    }

    if (window.jQuery && typeof window.jQuery.fn.DataTable === "function") {
        window.jQuery("#batchesTable").DataTable({
            info: false,
            lengthChange: false,
            ordering: false,
            pageLength: 25,
            searching: false,
        });
    }
})();
