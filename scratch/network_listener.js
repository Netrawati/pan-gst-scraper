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

    // Intercept requests and log them
    page.on('request', request => {
      const url = request.url();
      if (url.includes('razorpay') || url.includes('api') || request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
        console.log(`[Request] [${request.method()}] [${request.resourceType()}] -> ${url}`);
        if (request.method() === 'POST') {
          console.log(`  Payload: ${request.postData()}`);
        }
      }
    });

    page.on('response', async response => {
      const url = response.url();
      if (url.includes('razorpay') || url.includes('api') || response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
        console.log(`[Response] ${response.status()} <- ${url}`);
        try {
          // Only log small JSON responses to avoid clutter
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            console.log(`  JSON response:`, JSON.stringify(json).substring(0, 500));
          }
        } catch (e) {
          // Ignored
        }
      }
    });

    console.log("Navigating to Razorpay GST PAN search page...");
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log("Waiting for input field...");
    await page.waitForSelector('input', { timeout: 10000 });
    
    // Find input and type a sample PAN (using a dummy but valid PAN format like AAAAP1234A or similar)
    // Let's use a real sample PAN if possible or a known dummy format.
    // Wait, the user wants us to find GSTins.
    const samplePan = 'ABCDE1234F'; // Let's try this
    console.log(`Typing PAN: ${samplePan}`);
    
    const inputField = await page.$('input');
    await inputField.type(samplePan);

    console.log("Clicking Search...");
    // Find button
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

    console.log("Waiting 10 seconds for request completion...");
    await new Promise(resolve => setTimeout(resolve, 10000));

  } catch (error) {
    console.error("Error occurred:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main();
