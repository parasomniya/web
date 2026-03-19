let map
let marker
const API_URL = "http://localhost:3000/api/telemetry/latest"

// токен из localStorage
function getToken() {
    return localStorage.getItem("token")
}

ymaps.ready(init)

function init() {

    map = new ymaps.Map("map", {
        center: [55.75, 37.61],
        zoom: 15
    })

    loadTelemetry()

    setInterval(loadTelemetry, 5000)
}

async function loadTelemetry() {

    try {

        const response = await fetch(API_URL, {
            headers: {
                "Authorization": "Bearer " + getToken()
            }
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