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

    // Intercept requests and only allow basic HTML/JS, blocking heavy/tracking stuff
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      const resourceType = request.resourceType();
      
      // Block lists
      const blockDomains = [
        'google-analytics.com',
        'analytics.google.com',
        'googletagmanager.com',
        'googleads',
        'doubleclick',
        'facebook.net',
        'facebook.com',
        'segment.io',
        'segment.com',
        'sentry.io',
        'lumberjack',
        'ads.linkedin.com',
        'adroll.com'
      ];

      const blockTypes = ['image', 'media', 'font'];

      const shouldBlockDomain = blockDomains.some(d => url.includes(d));
      const shouldBlockType = blockTypes.includes(resourceType);

      if (shouldBlockDomain || shouldBlockType) {
        request.abort();
      } else {
        request.continue();
        if (resourceType === 'xhr' || resourceType === 'fetch' || url.includes('gst')) {
          console.log(`[Request] [${request.method()}] [${resourceType}] -> ${url}`);
        }
      }
    });

    page.on('response', async response => {
      const url = response.url();
      const resourceType = response.request().resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch' || url.includes('gst')) {
        console.log(`[Response] ${response.status()} <- ${url}`);
        try {
          const text = await response.text();
          console.log(`  Content snippet: ${text.substring(0, 300)}`);
        } catch (e) {}
      }
    });

    console.log("Navigating to Razorpay GST PAN search page...");
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log("Locating input field and typing PAN...");
    await page.waitForSelector('input', { timeout: 10000 });
    const inputField = await page.$('input');
    await inputField.type('ABCDE1234F'); // Dummy PAN

    console.log("Clicking Search...");
    const buttons = await page.$$('button');
    let searchBtn = null;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.innerText, btn);
      if (text.toLowerCase().includes('search')) {
        searchBtn = btn;
        break;
      }
    }
    if (!searchBtn) {
      searchBtn = buttons[0];
    }

    await searchBtn.click();

    console.log("Waiting for 5 seconds to see navigation/API requests...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log("Final URL:", page.url());

  } catch (error) {
    console.error("Error occurred:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main();
