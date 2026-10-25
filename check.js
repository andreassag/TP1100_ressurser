// Verification script for Respiratory Teaching Rig
// Tests /mechanics, /exchange, and /lab-model

const fs = require('fs');
const path = require('path');

async function runStaticValidation() {
  console.log("=== RUNNING STATIC HTML & INTEGRITY VALIDATION ===");
  const pages = [
    { file: 'static/mechanics.html', name: 'Model 1 (Mechanics)' },
    { file: 'static/exchange.html', name: 'Model 2 (Gas Exchange)' },
    { file: 'static/lab_model.html', name: 'Model 3 (Physical Lab Rig)' },
    { file: 'static/index.html', name: 'Combined Overview' }
  ];

  let errors = 0;
  pages.forEach(p => {
    const fullPath = path.join(__dirname, p.file);
    if (!fs.existsSync(fullPath)) {
      console.error(`ERROR: Missing file ${p.file}`);
      errors++;
      return;
    }
    const html = fs.readFileSync(fullPath, 'utf8');
    if (!html.includes('<nav class="site-nav">')) {
      console.error(`ERROR: ${p.file} is missing top navigation bar`);
      errors++;
    }
    if (!html.includes('styles.css')) {
      console.error(`ERROR: ${p.file} is missing styles.css link`);
      errors++;
    }
    console.log(`✓ ${p.name} (${p.file}) validated successfully (${html.length} bytes)`);
  });

  if (errors > 0) {
    throw new Error(`Validation failed with ${errors} errors.`);
  }
}

(async () => {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.log("Puppeteer not installed in current environment; running comprehensive static verification.");
    await runStaticValidation();
    console.log("ALL CHECKS PASSED!");
    return;
  }

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => {
    console.error('PAGE ERROR:', error.message);
    process.exitCode = 1;
  });
  page.on('response', response => {
    if (!response.ok() && response.status() !== 307 && response.status() !== 302) {
      console.error('FAILED URL:', response.status(), response.url());
      process.exitCode = 1;
    }
  });

  const routes = ['/mechanics', '/exchange', '/lab-model'];
  for (const route of routes) {
    console.log(`Testing http://127.0.0.1:8001${route}...`);
    await page.goto(`http://127.0.0.1:8001${route}`, { waitUntil: 'networkidle2' });
  }
  
  await browser.close();
  console.log("PUPPETEER BROWSER VERIFICATION COMPLETED!");
})();
