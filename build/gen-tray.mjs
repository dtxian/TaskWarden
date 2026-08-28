import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// 托盘图标：32×32 与 64×64 两版（Windows 托盘逻辑 16px，高 DPI 下用到 32~40px）
const svg = readFileSync(fileURLToPath(new URL("./tray-icon.svg", import.meta.url)));
for (const px of [32, 64]) {
  await sharp(svg, { density: 96 })
    .resize(px, px)
    .png()
    .toFile(fileURLToPath(new URL(`../src-tauri/icons/tray-icon-${px}.png`, import.meta.url)));
}
// 主交付：64（清晰），后端 include_bytes 用之
await sharp(readFileSync(fileURLToPath(new URL("../src-tauri/icons/tray-icon-64.png", import.meta.url))))
  .png()
  .toFile(fileURLToPath(new URL("../src-tauri/icons/tray-icon.png", import.meta.url)));
console.log("OK src-tauri/icons/tray-icon.png 64x64 (+32 变体)");
