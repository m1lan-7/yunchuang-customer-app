const http = require("node:http");

const port = Number(process.env.PORT || 4184);
const password = process.env.APP_PASSWORD || "";

function request(path, options = {}, body = null, cookie = "") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  let cookie = "";
  if (password) {
    const login = await request("/api/login", { method: "POST" }, { password });
    cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] || "";
  }
  const backup = await request("/api/backup", { method: "POST" }, {}, cookie);
  if (backup.status >= 400) throw new Error(backup.body);
  console.log(backup.body);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
