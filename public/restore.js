const form = document.querySelector("#restoreForm");
const fileInput = document.querySelector("#restoreFile");
const preview = document.querySelector("#restorePreview");
const message = document.querySelector("#restoreMessage");

let parsedStore = null;

function summarize(store) {
  const level1 = Array.isArray(store.level1) ? store.level1.length : 0;
  const level2 = Array.isArray(store.level2) ? store.level2.length : 0;
  const followups = [...(store.level1 || []), ...(store.level2 || [])].filter((item) => item.followUp?.updatedAt).length;
  return `一级 ${level1} 组｜二级 ${level2} 组｜已有跟进记录 ${followups} 组`;
}

fileInput.addEventListener("change", async () => {
  message.textContent = "";
  parsedStore = null;
  const file = fileInput.files?.[0];
  if (!file) {
    preview.textContent = "尚未选择文件";
    return;
  }
  try {
    parsedStore = JSON.parse(await file.text());
    if (!Array.isArray(parsedStore.level1) || !Array.isArray(parsedStore.level2)) {
      throw new Error("文件格式不正确");
    }
    preview.textContent = summarize(parsedStore);
  } catch (error) {
    preview.textContent = "无法读取该文件";
    message.textContent = error.message || "文件格式不正确";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  if (!parsedStore) {
    message.textContent = "请先选择正确的 customers.json 文件";
    return;
  }
  const ok = window.confirm(`确认导入到云端吗？\n${summarize(parsedStore)}\n系统会先备份当前云端数据。`);
  if (!ok) return;
  const response = await fetch("/api/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store: parsedStore }),
  });
  const data = await response.json();
  if (!data.ok) {
    message.textContent = data.message || "导入失败";
    return;
  }
  message.style.color = "#24725b";
  message.textContent = `导入完成：一级 ${data.totals.level1} 组，二级 ${data.totals.level2} 组。`;
  setTimeout(() => {
    window.location.href = "/";
  }, 1200);
});
