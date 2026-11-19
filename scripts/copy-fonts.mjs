// Copies the web font files the app serves from public/fonts (see src/app/fonts.css and src/lib/pdfFonts.ts):
// Carlito (the Calibri stand-in), Tinos (the Times New Roman stand-in and serif fallback for LaTeX fonts),
// DejaVu Serif and DejaVu Sans (the faces ReportLab-style resumes name, which Windows and Mac lack), and
// CMU Serif (Computer Modern Unicode, the face of LaTeX's Latin Modern Roman; from the computer-modern package).
// Run after upgrading any @fontsource or computer-modern package: `node scripts/copy-fonts.mjs`. Nothing runs this automatically.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const to = join(root, "public/fonts");
mkdirSync(to, { recursive: true });

// [fontsource package, file prefix in the package, served name prefix in public/fonts]
const families = [
  ["carlito", "carlito", "carlito"],
  ["tinos", "tinos", "tinos"],
  ["dejavu-serif", "dejavu-serif", "dejavu-serif"],
  ["dejavu-sans", "dejavu-sans", "dejavu-sans"],
];
// [fontsource file suffix, served suffix]
const weights = [
  ["400-normal", "400"],
  ["400-italic", "400-italic"],
  ["700-normal", "700"],
  ["700-italic", "700-italic"],
];

for (const [pkg, prefix, served] of families) {
  const from = join(root, `node_modules/@fontsource/${pkg}/files`);
  for (const [src, dst] of weights) {
    for (const ext of ["woff2", "woff"]) {
      copyFileSync(join(from, `${prefix}-latin-${src}.${ext}`), join(to, `${served}-${dst}.${ext}`));
    }
  }
  copyFileSync(join(root, `node_modules/@fontsource/${pkg}/LICENSE`), join(to, `${served}-OFL.txt`));
}

// CMU Serif: the 500 weight is the regular face, 700 the bold. react-pdf reads ttf or woff, so both formats are copied.
const cmuFrom = join(root, "node_modules/computer-modern/fonts");
const cmuWeights = [
  ["500-roman", "400"],
  ["500-italic", "400-italic"],
  ["700-roman", "700"],
  ["700-italic", "700-italic"],
];
for (const [src, dst] of cmuWeights) {
  for (const ext of ["woff2", "ttf"]) {
    copyFileSync(join(cmuFrom, `cmu-serif-${src}.${ext}`), join(to, `cmu-serif-${dst}.${ext}`));
  }
}
copyFileSync(join(root, "node_modules/computer-modern/OFL.txt"), join(to, "cmu-serif-OFL.txt"));

console.log(`Copied fonts to ${to}`);
