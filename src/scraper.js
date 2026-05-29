import puppeteer from 'puppeteer';

// Indian PAN regex: 5 letters, 4 digits, 1 letter
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;

/**
 * Puppeteer scraping logic for a single PAN number using page-context API fetches.
 * @param {object} page Puppeteer Page instance
 * @param {string} pan 
 * @param {function} logCallback Real-time logger callback
 * @returns {object} { gstin, businessName, gstStatus, scrapeStatus }
 */
async function scrapePanDetails(page, pan, logCallback) {
  const cleanPan = pan.trim().toUpperCase();
  logCallback(`Querying PAN: ${cleanPan}...`);
  
  if (!PAN_REGEX.test(cleanPan)) {
    logCallback(`[WARNING] Invalid PAN format: ${cleanPan}. Skipping.`);
    return {
      gstin: 'N/A',
      businessName: 'N/A',
      gstStatus: 'N/A',
      scrapeStatus: 'Invalid PAN Format',
      gstDetailsList: []
    };
  }

  // Ensure the page session is established on razorpay origin
  const currentUrl = page.url();
  if (!currentUrl || !currentUrl.includes('razorpay.com')) {
    logCallback(`[DEBUG] Initial page navigation for worker to establish session...`);
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    // Sleep for 5.0 seconds instead of 2.0 seconds to give Cloudflare challenge scripts
    // ample time to execute and settle valid session cookies.
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Fetch GSTIN list for this specific PAN from the direct API in browser context
  logCallback(`Querying GSTIN list API for PAN: ${cleanPan}...`);
  const panApiUrl = `https://razorpay.com/api/gstin/pan/${cleanPan}`;
  
  let panApiResponse;
  try {
    panApiResponse = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          return { errorStatus: 429 };
        }
        if (!res.ok) {
          return { errorStatus: res.status, errorText: res.statusText };
        }
        const json = await res.json();
        return { success: true, data: json };
      } catch (err) {
        return { errorStatus: 999, errorText: err.message };
      }
    }, panApiUrl);
  } catch (err) {
    throw new Error(`Browser context page evaluate failed: ${err.message}`);
  }

  if (!panApiResponse) {
    throw new Error("No response returned from browser evaluate context.");
  }

  if (panApiResponse.errorStatus) {
    if (panApiResponse.errorStatus === 429 || panApiResponse.errorStatus === 403) {
      throw new Error('RATE_LIMIT_TRIGGERED');
    }
    throw new Error(`API returned HTTP ${panApiResponse.errorStatus}: ${panApiResponse.errorText}`);
  }

  const apiData = panApiResponse.data || {};
  
  // Strict stateless correctness check: ensure returned data matches queried PAN exactly
  const returnedPan = String(apiData.pan || '').trim().toUpperCase();
  if (returnedPan !== cleanPan) {
    throw new Error(`Stateless accuracy mismatch! Expected PAN ${cleanPan} but API returned ${returnedPan}`);
  }

  const items = apiData.items || [];
  const count = apiData.count || 0;

  if (count === 0 || items.length === 0) {
    logCallback(`[INFO] No GST registration associated with PAN: ${cleanPan}`);
    return {
      gstin: 'N/A',
      businessName: 'No Business Registered',
      gstStatus: 'N/A',
      scrapeStatus: 'No GST Associated',
      gstDetailsList: []
    };
  }

  // Map items to standard format expected by writeExcel: [{ gstin, status }]
  const gstDetailsList = items.map(item => {
    let status = 'Active';
    if (item.auth_status) {
      const lower = item.auth_status.toLowerCase();
      if (lower.includes('inactive')) status = 'Inactive';
      else if (lower.includes('cancelled')) status = 'Cancelled';
      else if (lower.includes('suspended')) status = 'Suspended';
      else if (lower.includes('pending')) status = 'Pending';
      else status = item.auth_status.charAt(0).toUpperCase() + item.auth_status.slice(1);
    }
    return {
      gstin: String(item.gstin || '').trim().toUpperCase(),
      status: status
    };
  });

  const uniqueGstins = gstDetailsList.map(item => item.gstin);

  // Take the first Active GSTIN to fetch business enrichment legal name
  const firstActiveItem = gstDetailsList.find(item => item.status === 'Active') || gstDetailsList[0];
  const targetGstin = firstActiveItem.gstin;

  logCallback(`Found ${gstDetailsList.length} GSTIN(s). Querying enrichment details for: ${targetGstin}...`);
  const gstinApiUrl = `https://razorpay.com/api/gstin/${targetGstin}`;

  let gstinApiResponse;
  try {
    gstinApiResponse = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          return { errorStatus: 429 };
        }
        if (!res.ok) {
          return { errorStatus: res.status, errorText: res.statusText };
        }
        const json = await res.json();
        return { success: true, data: json };
      } catch (err) {
        return { errorStatus: 999, errorText: err.message };
      }
    }, gstinApiUrl);
  } catch (err) {
    throw new Error(`Browser context evaluate for GSTIN failed: ${err.message}`);
  }

  if (gstinApiResponse && gstinApiResponse.errorStatus) {
    if (gstinApiResponse.errorStatus === 429 || gstinApiResponse.errorStatus === 403) {
      throw new Error('RATE_LIMIT_TRIGGERED');
    }
    logCallback(`[WARNING] Enrichment API failed (HTTP ${gstinApiResponse.errorStatus}: ${gstinApiResponse.errorText}). Using fallback legal name.`);
  }

  // Parse legal business name or trade name from enrichment JSON structure
  let businessName = 'Registered Entity';
  try {
    const details = gstinApiResponse?.data?.enrichment_details?.online_provider?.details;
    if (details?.legal_name?.value) {
      businessName = String(details.legal_name.value).replace(/\s+/g, ' ').trim();
    } else if (details?.trade_name?.value) {
      businessName = String(details.trade_name.value).replace(/\s+/g, ' ').trim();
    }
  } catch (e) {
    logCallback(`[WARNING] Failed to parse legal name from JSON structure. Using default fallback.`);
  }

  const gstStatus = firstActiveItem.status;
  logCallback(`[SUCCESS] Found ${uniqueGstins.length} GSTIN(s) for ${cleanPan}: ${uniqueGstins.join(', ')} (${businessName})`);

  return {
    gstin: uniqueGstins.join(', '),
    businessName: businessName,
    gstStatus: gstStatus,
    scrapeStatus: 'Success',
    gstDetailsList: gstDetailsList
  };
}

/**
 * Bulk scrapes an array of PAN numbers using high-speed parallel API fetches.
 * @param {Array} pans List of PAN numbers
 * @param {function} progressCallback Callback to stream live progress percentage and log strings
 * @param {boolean} headless Whether to run browser headlessly
 * @param {number} concurrency Number of parallel worker tabs (default = 3)
 * @returns {object} Map of PAN -> results
 */
async function scrapeBulkPans(pans, progressCallback, headless = true, concurrency = 3) {
  progressCallback(0, `[INIT] Starting Puppeteer browser session with ${concurrency} parallel workers...`);
  
  const launchOptions = {
    headless: headless ? 'shell' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled'
    ]
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const browser = await puppeteer.launch(launchOptions);
  const results = {};
  const total = pans.length;
  let completedCount = 0;
  
  // Create shared queue containing the array indices
  const queue = [...pans.keys()];

  // Worker loop
  const runWorker = async (workerId) => {
    progressCallback(0, `[Worker-${workerId}] Initializing worker tab...`);
    let page = await browser.newPage();
    
    const initPage = async (p) => {
      await p.setViewport({ width: 1280, height: 800 });
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await p.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      
      // Request interception to block ads, tracking analytics, and heavy fonts/images
      await p.setRequestInterception(true);
      p.on('request', request => {
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
    };

    await initPage(page);
    let processedCount = 0;

    while (queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) break;

      const rawPan = pans[index];
      const pan = String(rawPan || '').trim().toUpperCase();

      if (!pan) {
        completedCount++;
        continue;
      }

      // Tab recycling: recreate page tab every 150 requests to keep browser state absolutely clean and avoid memory drift
      if (processedCount > 0 && processedCount % 150 === 0) {
        progressCallback(
          Math.round((completedCount / total) * 100),
          `[Worker-${workerId}] Recycling page tab session to maintain clean state...`
        );
        try {
          await page.close();
        } catch (e) {}
        page = await browser.newPage();
        await initPage(page);
      }

      const currentProgress = Math.round((completedCount / total) * 100);
      progressCallback(
        currentProgress,
        `[Worker-${workerId}] [${completedCount + 1}/${total}] Querying PAN: ${pan}`
      );

      let panResult = null;
      let retries = 5; // Retry up to 5 times (6 attempts total) to guarantee successful scraping!

      while (retries >= 0) {
        try {
          panResult = await scrapePanDetails(page, pan, (msg) => {
            progressCallback(currentProgress, `[Worker-${workerId}] ${msg}`);
          });
          break;
        } catch (error) {
          if (error.message === 'RATE_LIMIT_TRIGGERED') {
            retries--;
            if (retries >= 0) {
              // Progressive backoff delay: 5s, 10s, 15s, 20s, 25s
              const sleepTime = (5 - retries) * 5000;
              progressCallback(
                currentProgress,
                `[Worker-${workerId}] [RATE LIMIT / 403 / 429] Session block triggered for ${pan}. Backing off for ${sleepTime / 1000}s, recycling session, and retrying (Attempts left: ${retries + 1})...`
              );
              
              try {
                await page.close();
              } catch (e) {}
              await new Promise(resolve => setTimeout(resolve, sleepTime));
              page = await browser.newPage();
              await initPage(page);
              continue;
            } else {
              // Emergency Final Deep-Clean Retry: Sleep 45 seconds to guarantee cooling down, then attempt once more
              progressCallback(
                currentProgress,
                `[Worker-${workerId}] [WARNING] Standard retries exhausted for ${pan}. Performing emergency 45-second deep backoff to clear any security locks...`
              );
              try {
                try {
                  await page.close();
                } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, 45000));
                page = await browser.newPage();
                await initPage(page);
                panResult = await scrapePanDetails(page, pan, (msg) => {
                  progressCallback(currentProgress, `[Worker-${workerId}] [EMERGENCY RETRY] ${msg}`);
                });
                break;
              } catch (finalErr) {
                progressCallback(
                  currentProgress,
                  `[Worker-${workerId}] [FATAL] Emergency final attempt failed for ${pan}: ${finalErr.message}`
                );
                panResult = {
                  gstin: 'N/A',
                  businessName: 'N/A',
                  gstStatus: 'N/A',
                  scrapeStatus: `Failed: Rate Limit Exceeded`,
                  gstDetailsList: []
                };
                break;
              }
            }
          }

          progressCallback(
            currentProgress,
            `[Worker-${workerId}] [ERROR] Attempt failed for ${pan}: ${error.message}. Retries left: ${retries}`
          );
          retries--;
          
          if (retries >= 0) {
            try {
              await page.close();
            } catch (e) {}
            page = await browser.newPage();
            await initPage(page);
            // Progressive backoff delay for general errors as well
            const sleepTime = (5 - retries) * 5000;
            await new Promise(resolve => setTimeout(resolve, sleepTime));
          } else {
            // Emergency Final Deep-Clean Retry for general errors
            progressCallback(
              currentProgress,
              `[Worker-${workerId}] [WARNING] Standard retries exhausted for general error on ${pan}. Performing emergency 45-second deep backoff to clear any network blocks...`
            );
            try {
              try {
                await page.close();
              } catch (e) {}
              await new Promise(resolve => setTimeout(resolve, 45000));
              page = await browser.newPage();
              await initPage(page);
              panResult = await scrapePanDetails(page, pan, (msg) => {
                progressCallback(currentProgress, `[Worker-${workerId}] [EMERGENCY RETRY] ${msg}`);
              });
              break;
            } catch (finalErr) {
              progressCallback(
                currentProgress,
                `[Worker-${workerId}] [FATAL] Emergency final attempt failed for general error on ${pan}: ${finalErr.message}`
              );
              panResult = {
                gstin: 'N/A',
                businessName: 'N/A',
                gstStatus: 'N/A',
                scrapeStatus: `Failed: ${error.message}`,
                gstDetailsList: []
              };
            }
          }
        }
      }

      results[pan] = panResult;
      completedCount++;
      processedCount++;

      const finalProgress = Math.round((completedCount / total) * 100);
      progressCallback(
        finalProgress,
        `[Worker-${workerId}] Completed item ${pan}. Total completed: ${completedCount}/${total}`
      );

      // Add a polite human-like delay between searches to prevent triggering rate limits
      if (queue.length > 0) {
        const delay = Math.floor(Math.random() * 1000) + 2000; // 2s to 3s (average 2.5s)
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    try {
      await page.close();
    } catch (e) {}
    progressCallback(
      Math.round((completedCount / total) * 100),
      `[Worker-${workerId}] Worker finished.`
    );
  };

  try {
    // Launch parallel workers
    const workers = [];
    for (let w = 1; w <= concurrency; w++) {
      workers.push(runWorker(w));
    }

    // Wait for all workers to finish their queues
    await Promise.all(workers);
    progressCallback(100, `[COMPLETED] Successfully completed processing all ${total} PAN(s).`);

  } catch (error) {
    progressCallback(100, `[FATAL] Scraper session encountered a critical error: ${error.message}`);
    console.error("Critical scrape bulk error:", error);
  } finally {
    await browser.close();
    progressCallback(100, `[CLOSE] Puppeteer browser closed successfully.`);
  }

  return results;
}

export {
  scrapeBulkPans
};
