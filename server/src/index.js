const express = require("express");
const app = express();

app.get("/", (req, res) => {
    res.send("Hello World");
});

app.post("/telemetry", (req, res) => {
    const { lat, lon, weight } = req.body;
    console.log(lat, lon, weight);
    res.send({ success: true });
});

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});

