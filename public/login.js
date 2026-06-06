const form = document.querySelector("#loginForm");
const input = document.querySelector("#passwordInput");
const message = document.querySelector("#loginMessage");
const intro = document.querySelector("#loginIntro");
const passwordLabel = document.querySelector("#passwordLabel");
const loginButton = document.querySelector("#loginButton");

let authMode = "disabled";
let feishuAppId = "";

function describeError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch (formatError) {
    return String(error);
  }
}

function hasFeishuBridge() {
  return Boolean(window.tt?.requestAccess || window.tt?.requestAuthCode);
}

function showPasswordLogin(text = "请输入团队统一访问密码") {
  intro.textContent = text;
  passwordLabel.hidden = false;
  loginButton.hidden = false;
  authMode = authMode === "feishu-password" ? "feishu-password" : "password";
  input.focus();
}

function showMessage(text) {
  message.textContent = text;
}

function requestFeishuCode(appId) {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (window.tt?.requestAccess) {
        window.tt.requestAccess({
          appID: appId,
          scopeList: [],
          success: (info) => resolve(info.code),
          fail: (error) => reject(new Error(`requestAccess失败：${describeError(error)}`)),
        });
        return;
      }
      if (window.tt?.requestAuthCode) {
        window.tt.requestAuthCode({
          appId,
          success: (info) => resolve(info.code),
          fail: (error) => reject(new Error(`requestAuthCode失败：${describeError(error)}`)),
        });
        return;
      }
      reject(new Error("未检测到飞书网页应用免登能力，请从飞书客户端工作台打开"));
    };

    if (window.h5sdk?.ready) {
      window.h5sdk.ready(run);
    } else {
      run();
    }
  });
}

async function loginWithFeishu() {
  showMessage("正在向飞书获取登录身份...");
  const code = await requestFeishuCode(feishuAppId);
  const response = await fetch("/api/feishu-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "飞书免登失败");
  window.location.href = "/";
}

async function checkStatus() {
  const response = await fetch("/api/auth/status", { cache: "no-store" });
  const data = await response.json();
  if (data.ok && (!data.enabled || data.authenticated)) {
    window.location.href = "/";
    return;
  }
  authMode = data.mode || "disabled";
  feishuAppId = data.feishuAppId || "";

  if (authMode === "feishu") {
    await loginWithFeishu();
    return;
  }

  if (authMode === "feishu-password") {
    if (!hasFeishuBridge()) {
      showPasswordLogin("团队成员请使用访问密码进入");
      return;
    }
    try {
      await loginWithFeishu();
      return;
    } catch (error) {
      showPasswordLogin("飞书免登暂不可用，也可以用团队访问密码进入");
      showMessage(describeError(error));
      return;
    }
  }

  if (authMode === "password") {
    showPasswordLogin();
    return;
  }

  window.location.href = "/";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (authMode !== "password" && authMode !== "feishu-password") return;
  showMessage("");
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: input.value }),
  });
  const data = await response.json();
  if (data.ok) {
    window.location.href = "/";
    return;
  }
  showMessage(data.message || "登录失败");
});

checkStatus().catch((error) => {
  if (authMode === "feishu-password") {
    showPasswordLogin("团队成员请使用访问密码进入");
  }
  showMessage(describeError(error) || "暂时无法完成登录");
});
