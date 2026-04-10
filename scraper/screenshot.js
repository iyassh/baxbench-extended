const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1440, height: 1800 });
  console.log('Navigating to dashboard...');
  await page.goto('https://dashboard-wheat-iota-87.vercel.app/', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('Taking full page screenshot...');
  // We'll capture the entire dashboard
  await page.screenshot({ path: '/Users/deepanshsharma/baxbench-extended/docs/dashboard_results.png', fullPage: true });

  await browser.close();
  console.log('Done.');
})();
