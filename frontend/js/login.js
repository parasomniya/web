document.getElementById("loginBtn").onclick = async function () {

    const login = document.getElementById("login").value;
    const password = document.getElementById("password").value;

    const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            login: login,
            password: password
        })
    });

    if (response.ok) {
        window.location.href = "index.html";
    } else {
        alert("Неверный логин или пароль");
    }
};