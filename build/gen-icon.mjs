import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// build/app-icon.svg → 1024×1024 PNG（tauri icon 输入要求正方形 ≥1024）
const svg = readFileSync(fileURLToPath(new URL("./app-icon.svg", import.meta.url)));
await sharp(svg, { density: 96 })
  .resize(1024, 1024)
  .png()
  .toFile(fileURLToPath(new URL("./app-icon.png", import.meta.url)));
console.log("OK build/app-icon.png 1024x1024");
