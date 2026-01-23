import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, 'src', 'data');
const OUTPUT_DIR = path.join(ROOT, 'src', 'data', 'resized');
const SIZE = 1024;

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function listSampleImages() {
  const entries = await fs.readdir(INPUT_DIR);
  return entries.filter((name) => /^sample_image\d+\.jpg$/i.test(name));
}

async function resizeOne(filename) {
  const inputPath = path.join(INPUT_DIR, filename);
  const outputPath = path.join(OUTPUT_DIR, filename);

  await sharp(inputPath)
    .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(outputPath);
}

async function main() {
  await ensureOutputDir();
  const images = await listSampleImages();

  if (images.length === 0) {
    console.log('No sample_image*.jpg files found in src/data.');
    return;
  }

  await Promise.all(images.map(resizeOne));
  console.log(`Resized ${images.length} images to ${SIZE}x${SIZE} in src/data/resized.`);
}

main().catch((err) => {
  console.error('resize-images failed:', err);
  process.exit(1);
});
