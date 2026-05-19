import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update?.available) return;

    showUpdateBanner(update.version ?? "", async () => {
      const banner = document.getElementById("update-banner");
      if (banner) banner.innerHTML = `<span class="update-text">다운로드 중…</span>`;

      await update.downloadAndInstall();
      await relaunch();
    });
  } catch (e) {
    console.warn("[updater] 업데이트 확인 실패:", e);
  }
}

function showUpdateBanner(version: string, onInstall: () => Promise<void>): void {
  if (document.getElementById("update-banner")) return;

  const banner = document.createElement("div");
  banner.id = "update-banner";
  banner.innerHTML = `
    <span class="update-text">새 버전 <strong>${version}</strong>이 출시됐습니다</span>
    <button class="update-btn" id="update-install-btn">지금 업데이트</button>
    <button class="update-dismiss" id="update-dismiss-btn">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById("update-install-btn")!.addEventListener("click", async () => {
    (document.getElementById("update-install-btn") as HTMLButtonElement).disabled = true;
    await onInstall();
  });

  document.getElementById("update-dismiss-btn")!.addEventListener("click", () => {
    banner.remove();
  });
}
