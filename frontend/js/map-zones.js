let map
let marker
const API_URL = "/api/telemetry/host/current"

// токен из localStorage
function getHeaders() {
    return window.AppAuth?.getAuthHeaders?.() || {}
}

ymaps.ready(init)

function init() {

    map = new ymaps.Map("map", {
        center: [54.843243, 83.088801],
        zoom: 15
    })

    loadTelemetry()

    setInterval(loadTelemetry, 5000)
}

async function loadTelemetry() {

    try {

        const response = await fetch(API_URL, {
            headers: getHeaders()
        })

        if (!response.ok) {
            console.error("API error")
            return
        }

        const data = await response.json()

        const lat = data.lat
        const lon = data.lon

        if (!marker) {

            marker = new ymaps.Placemark([lat, lon], {
                balloonContent: "Вес: " + data.weight + " кг"
            })

            map.geoObjects.add(marker)
            map.setCenter([lat, lon])

        } else {

            marker.geometry.setCoordinates([lat, lon])

        }

    } catch (error) {
        console.error(error)
    }

}
