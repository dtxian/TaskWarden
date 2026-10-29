import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/*
 * build/app-icon.svg → desktop/resources/icons/app.ico
 * （256×256 PNG 负载的 ICO 容器，Vista+ 原生支持；Qt 资源与 exe 资源同源）
 */
const svgPath = fileURLToPath(new URL("./app-icon.svg", import.meta.url));
const outPath = fileURLToPath(new URL("../desktop/resources/icons/app.ico", import.meta.url));

const png = await sharp(readFileSync(svgPath), { density: 96 }).resize(256, 256).png().toBuffer();

// ICO = ICONDIR(6B) + ICONDIRENTRY(16B) + 图像数据
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = 1 (icon)
header.writeUInt16LE(1, 4); // 图像数量

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // 宽 256 记为 0
entry.writeUInt8(0, 1); // 高 256 记为 0
entry.writeUInt8(0, 2); // 调色板数
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // 位深
entry.writeUInt32LE(png.length, 8); // 数据长度
entry.writeUInt32LE(6 + 16, 12); // 数据偏移

writeFileSync(outPath, Buffer.concat([header, entry, png]));
console.log(`OK desktop/resources/icons/app.ico (256x256 PNG 负载 ${png.length}B)`);
