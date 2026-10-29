import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// build/tray-icon.svg → desktop/resources/icons/tray.png（托盘/QIcon 直接用 64px）
const svg = readFileSync(fileURLToPath(new URL("./tray-icon.svg", import.meta.url)));
const out = fileURLToPath(new URL("../desktop/resources/icons/tray.png", import.meta.url));

await sharp(svg, { density: 96 }).resize(64, 64).png().toFile(out);
console.log("OK desktop/resources/icons/tray.png 64x64");
