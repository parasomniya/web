$(document).ready(function() {
    // 1. Инициализируем DataTable
    const table = $('#batchesTable').DataTable({
        language: {
            url: 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/ru.json'
        },
        
        // --- НОВЫЕ НАСТРОЙКИ ---
        searching: false,    // Убирает поле "Поиск"
        lengthChange: false, // Убирает выпадающий список "Показать 10 записей"
        info: false,         // (Опционально) Убирает надпись "Записи с 1 по 10 из..."
        // -----------------------

        order: [[0, 'desc']], // Авто-сортировка по первой колонке (время)
        
        // Отключаем возможность клика по заголовкам для ручной сортировки
        columnDefs: [
            { orderable: false, targets: '_all' }
        ],

        columns: [
            { 
                data: 'time', 
                render: function(data) {
                    return data ? new Date(data).toLocaleString('ru-RU') : '-';
                }
            },
            { 
                data: 'action',
                render: function(data) {
                    if (data.includes('Загрузка')) {
                        return `<span class="badge badge-primary" style="font-size: 13px; padding: 6px 10px;">${data}</span>`;
                    } else if (data.includes('Разгрузка')) {
                        return `<span class="badge badge-success" style="font-size: 13px; padding: 6px 10px;">${data}</span>`;
                    }
                    return data;
                }
            },
            { 
                data: 'zone',
                render: function(data) {
                    return `<strong>${data || '-'}</strong>`;
                }
            },
            { 
                data: 'weight',
                render: function(data) {
                    return `<span>${data}</span>`;
                }
            },
            { 
                data: 'status',
                render: function(data) {
                    if (data === 'Завершен') {
                        return '<span class="text-success font-weight-bold"><i class="fas fa-check"></i> Завершен</span>';
                    }
                    return '<span class="text-warning font-weight-bold"><i class="fas fa-spinner fa-spin"></i> В процессе</span>';
                }
            }
        ]
    });

    // 2. Функция для загрузки данных с бэкенда
    // 2. Функция для загрузки данных с бэкенда
    async function loadBatches() {
        try {
            const response = await fetch(window.AppAuth?.getApiUrl?.('/api/batches') || '/api/batches', {
                method: 'GET',
                headers: window.AppAuth?.getAuthHeaders?.({ includeJson: true }) || {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                
                // Проверяем, изменились ли данные (чтобы зря не перерисовывать таблицу)
                const currentDataString = JSON.stringify(table.rows().data().toArray());
                const newDataString = JSON.stringify(data);
                
                if (currentDataString !== newDataString) {
                    // draw(false) - обновляет данные, но оставляет пользователя на текущей странице пагинации
                    table.clear().rows.add(data).draw(false);
                }
            }
        } catch (error) {
            console.error('Ошибка сети при загрузке логов:', error);
        }
    }

    // 3. Запускаем первый раз сразу
    loadBatches();
    
    // 4. Запускаем цикл автообновления каждые 2 секунды (2000 мс)
    setInterval(loadBatches, 2000); 
});
