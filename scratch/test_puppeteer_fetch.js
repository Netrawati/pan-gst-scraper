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

    // Intercept requests and block analytics/heavy media to speed up navigation
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      const resourceType = request.resourceType();
      const blockDomains = [
        'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
        'googleads', 'doubleclick', 'facebook.net', 'facebook.com',
        'segment.io', 'segment.com', 'sentry.io', 'lumberjack',
        'ads.linkedin.com', 'adroll.com'
      ];
      if (blockDomains.some(d => url.includes(d)) || ['image', 'media', 'font'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    console.log("Navigating page once to Razorpay...");
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait a brief moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pans = ['ABCDE1234F', 'AAGCR4375J', 'AAAAC1111A'];
    for (let i = 0; i < pans.length; i++) {
      const pan = pans[i];
      if (i > 0) {
        console.log("Waiting 2.5 seconds to avoid rate limiting...");
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      console.log(`Querying ${pan} via page.evaluate fetch...`);
      const startTime = Date.now();
      try {
        const result = await page.evaluate(async (panStr) => {
          const response = await fetch(`https://razorpay.com/api/gstin/pan/${panStr}`);
          if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
          }
          return await response.json();
        }, pan);
        const duration = Date.now() - startTime;
        console.log(`[SUCCESS] ${pan} took ${duration}ms. Result:`, JSON.stringify(result));
      } catch (e) {
        console.error(`[ERROR] ${pan} failed:`, e.message || e);
      }
    }

  } catch (error) {
    console.error("Error occurred:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main();
