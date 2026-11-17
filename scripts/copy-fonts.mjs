// Copies the Carlito font files the app serves from public/fonts (see src/app/fonts.css and src/lib/pdfFonts.ts).
// Run after upgrading @fontsource/carlito: `node scripts/copy-fonts.mjs`. Nothing runs this automatically.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@fontsource/carlito/files");
const to = join(root, "public/fonts");
mkdirSync(to, { recursive: true });

const weights = [
  ["400-normal", "400"],
  ["400-italic", "400-italic"],
  ["700-normal", "700"],
  ["700-italic", "700-italic"],
];
for (const [src, dst] of weights) {
  for (const ext of ["woff2", "woff"]) {
    copyFileSync(join(from, `carlito-latin-${src}.${ext}`), join(to, `carlito-${dst}.${ext}`));
  }
}
copyFileSync(join(root, "node_modules/@fontsource/carlito/LICENSE"), join(to, "carlito-OFL.txt"));
console.log(`Copied Carlito fonts to ${to}`);
