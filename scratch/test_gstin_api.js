import puppeteer from 'puppeteer';

async function main() {
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Intercept requests and block heavy media
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      if (['image', 'media', 'font'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    console.log("Navigating to Razorpay...");
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const gstin = '29AAGCR4375J2ZT';
    console.log(`Querying GSTIN ${gstin} via page.evaluate fetch...`);
    try {
      const result = await page.evaluate(async (g) => {
        const response = await fetch(`https://razorpay.com/api/gstin/${g}`);
        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }
        return await response.json();
      }, gstin);
      console.log(`[SUCCESS] Result:`, JSON.stringify(result));
    } catch (e) {
      console.error(`[ERROR] failed:`, e.message || e);
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
}

main();
