// 產生 PWA 圖示 — 執行一次即可
// node scripts/generate-icons.js

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function generateIcon(size, filename, maskable = false) {
  const padding = maskable ? Math.round(size * 0.1) : 0;
  const innerSize = size - padding * 2;
  const fkSize = Math.round(innerSize * 0.38);
  const subSize = Math.round(innerSize * 0.19);
  const rx = maskable ? 0 : Math.round(size * 0.125);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rx}" fill="#0f172a"/>
    <text x="${size/2}" y="${size * 0.38}" font-family="Arial, Helvetica, sans-serif" font-size="${fkSize}" font-weight="900" fill="#f59e0b" text-anchor="middle" dominant-baseline="middle">FK</text>
    <text x="${size/2}" y="${size * 0.66}" font-family="Arial, Helvetica, sans-serif" font-size="${subSize}" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">菁英</text>
  </svg>`;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(path.join(outDir, filename));

  console.log(`✅ Generated ${filename} (${size}x${size})`);
}

async function main() {
  await generateIcon(192, 'icon-192x192.png', false);
  await generateIcon(512, 'icon-512x512.png', false);
  await generateIcon(192, 'icon-192x192-maskable.png', true);
  await generateIcon(512, 'icon-512x512-maskable.png', true);
  // Apple touch icon
  await generateIcon(180, 'apple-touch-icon.png', false);
  console.log('\n🎉 All PWA icons generated!');
}

main().catch(console.error);
