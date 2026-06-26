const http = require("http");
const { spawn } = require("child_process");

const PORT = Number(process.env.ROUTE_TEST_PORT || 4100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${path}`, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timeout requesting ${path}`));
    });
  });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const res = await request("/mcp/health");
      if (res.status < 500) return;
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw new Error("Server did not start in time");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRoute(path, expected) {
  const res = await request(path);
  assert(res.status === 200, `${path} expected 200, got ${res.status}`);
  assert(res.body.includes(expected), `${path} did not include ${expected}`);
}

async function main() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: BASE_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk.toString(); });
  child.stderr.on("data", chunk => { logs += chunk.toString(); });

  try {
    await waitForServer();

    await assertRoute("/", "/portal.css");
    await assertRoute("/", "safetyFloat");
    await assertRoute("/portal", "/portal.css");
    await assertRoute("/portal", "safetyFloat");
    await assertRoute("/login", "/app.js");
    await assertRoute("/erp", "/app.js");

    console.log("Route guard passed: / and /portal are public, /login and /erp are ERP.");
  } catch (err) {
    console.error(err.message);
    if (logs.trim()) console.error(logs.trim());
    process.exitCode = 1;
  } finally {
    child.kill();
  }
}

main();
