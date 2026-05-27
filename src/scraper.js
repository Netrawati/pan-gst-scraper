import puppeteer from 'puppeteer';

// Indian PAN regex: 5 letters, 4 digits, 1 letter
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;
// Indian GSTIN regex: 2 digits, 5 letters, 4 digits, 1 letter, 1 char, Z, 1 char
const GSTIN_REGEX = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/gi;

/**
 * Clean text by removing extra spaces and newlines
 */
function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Puppeteer scraping logic for a single PAN number (re-using the page session).
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

  try {
    // 1. Ensure the browser is on the search page
    const currentUrl = page.url();
    if (!currentUrl || !currentUrl.includes('razorpay.com/gst-number-search/pan/')) {
      logCallback(`[DEBUG] Initial page navigation for worker...`);
      await page.goto('https://razorpay.com/gst-number-search/pan/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 2. Locate the PAN input field
    const inputSelectors = [
      'input[placeholder="DWWPB9503H"]',
      '.chakra-input',
      'input[type="text"]',
      'input[placeholder*="PAN" i]',
      'input'
    ];
    
    let inputField = null;
    for (const selector of inputSelectors) {
      try {
        inputField = await page.$(selector);
        if (inputField) {
          const isVisible = await page.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
          }, inputField);
          if (isVisible) break;
        }
      } catch (err) {}
    }

    if (!inputField) {
      logCallback(`[WARNING] Input field missing. Reloading search page...`);
      await page.goto('https://razorpay.com/gst-number-search/pan/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      for (const selector of inputSelectors) {
        try {
          inputField = await page.$(selector);
          if (inputField) break;
        } catch (e) {}
      }
      if (!inputField) {
        throw new Error("Could not locate any valid, visible PAN input field.");
      }
    }

    // 3. Clear existing input and type the new PAN
    await inputField.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.evaluate(el => el.value = '', inputField); // Hard clear in DOM
    await inputField.type(cleanPan, { delay: 30 });
    
    // 4. Locate the search/submit button
    const buttonSelectors = [
      '.css-eo7rsn',
      'button[type="submit"]',
      'button:has-text("Search")',
      'form button',
      'button'
    ];

    let searchButton = null;
    for (const selector of buttonSelectors) {
      try {
        if (selector.includes(':has-text')) {
          const textToMatch = selector.match(/"([^"]+)"/)[1];
          searchButton = await page.evaluateHandle((text) => {
            const btns = Array.from(document.querySelectorAll('button'));
            return btns.find(b => (b.innerText || '').toLowerCase().includes(text.toLowerCase()));
          }, textToMatch);
          if (searchButton && searchButton.asElement()) {
            searchButton = searchButton.asElement();
            break;
          }
        } else {
          searchButton = await page.$(selector);
          if (searchButton) {
            const isVisible = await page.evaluate(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }, searchButton);
            if (isVisible) break;
          }
        }
      } catch (err) {}
    }

    if (!searchButton) {
      throw new Error("Could not locate the search/submit button.");
    }

    // 5. Submit the search
    await searchButton.click();
    
    // 6. Dynamic Result Wait (Polling every 500ms for up to 5 seconds)
    const maxPollTime = 5000;
    const pollInterval = 500;
    let elapsed = 0;
    let pageText = '';
    let hasResultLoaded = false;
    
    const noResultsPhrases = [
      'no details found', 
      'no records found', 
      'no gstin associated', 
      'invalid pan', 
      'no data found', 
      'does not exist', 
      'could not find any records'
    ];

    while (elapsed < maxPollTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
      
      pageText = await page.evaluate(() => document.body.innerText);
      
      const containsPan = pageText.toUpperCase().includes(cleanPan);
      const containsNoResult = noResultsPhrases.some(phrase => pageText.toLowerCase().includes(phrase));
      
      if (containsPan || containsNoResult) {
        hasResultLoaded = true;
        break;
      }
    }

    if (!hasResultLoaded) {
      logCallback(`[DEBUG] Waiting 2 additional seconds for slow network rendering...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      pageText = await page.evaluate(() => document.body.innerText);
    }

    // 7. Check if explicit "No records found" or equivalent is displayed
    const hasNoResults = noResultsPhrases.some(phrase => pageText.toLowerCase().includes(phrase));
    if (hasNoResults) {
      logCallback(`[INFO] No GST registration associated with PAN: ${cleanPan}`);
      return {
        gstin: 'N/A',
        businessName: 'No Business Registered',
        gstStatus: 'N/A',
        scrapeStatus: 'No GST Associated',
        gstDetailsList: []
      };
    }

    // 8. Extract GSTINs and their statuses from the DOM table/page
    const gstDetailsList = await page.evaluate(() => {
      const gstinRegex = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i;
      const rows = Array.from(document.querySelectorAll('tr, [role="row"]'));
      const results = [];
      
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td, [role="gridcell"], div'));
        let foundGstin = null;
        let foundStatus = null;
        
        for (const cell of cells) {
          const txt = (cell.innerText || '').trim();
          if (gstinRegex.test(txt)) {
            foundGstin = txt.match(gstinRegex)[0].toUpperCase();
          }
          const lowerTxt = txt.toLowerCase();
          if (lowerTxt === 'active' || lowerTxt === 'inactive' || lowerTxt === 'cancelled' || lowerTxt === 'suspended') {
            foundStatus = txt;
          }
        }
        
        if (foundGstin) {
          if (!foundStatus) {
            const rowText = (row.innerText || '').toLowerCase();
            const statusWords = ['active', 'inactive', 'cancelled', 'suspended'];
            const matched = statusWords.find(w => rowText.includes(w));
            if (matched) {
              foundStatus = matched.charAt(0).toUpperCase() + matched.slice(1);
            }
          }
          
          results.push({
            gstin: foundGstin,
            status: foundStatus || 'Active'
          });
        }
      }
      
      if (results.length === 0) {
        const allElements = Array.from(document.querySelectorAll('a, p, span, td, div'));
        const seenGstins = new Set();
        
        for (const el of allElements) {
          const txt = (el.innerText || '').trim();
          if (gstinRegex.test(txt)) {
            const gstin = txt.match(gstinRegex)[0].toUpperCase();
            if (!seenGstins.has(gstin)) {
              seenGstins.add(gstin);
              
              let status = 'Active';
              let parent = el.parentElement;
              let depth = 0;
              
              while (parent && depth < 3) {
                const parentText = (parent.innerText || '').toLowerCase();
                const statusWords = ['active', 'inactive', 'cancelled', 'suspended'];
                const matched = statusWords.find(w => parentText.includes(w));
                if (matched) {
                  status = matched.charAt(0).toUpperCase() + matched.slice(1);
                  break;
                }
                parent = parent.parentElement;
                depth++;
              }
              
              results.push({ gstin, status });
            }
          }
        }
      }
      
      return results;
    });

    let uniqueGstins = [];
    if (gstDetailsList && gstDetailsList.length > 0) {
      uniqueGstins = gstDetailsList.map(item => item.gstin);
    } else {
      let foundGstins = pageText.match(GSTIN_REGEX);
      if (foundGstins) {
        uniqueGstins = Array.from(new Set(foundGstins)).map(g => g.toUpperCase());
        uniqueGstins.forEach(gstin => {
          gstDetailsList.push({ gstin, status: 'Active' });
        });
      }
    }

    if (uniqueGstins.length === 0) {
      // Check for CAPTCHA/Anti-Bot Block
      if (pageText.toLowerCase().includes('captcha') || pageText.toLowerCase().includes('robot') || pageText.toLowerCase().includes('human')) {
        logCallback(`[WARNING] CAPTCHA / Anti-Bot block detected for PAN: ${cleanPan}`);
        return {
          gstin: 'N/A',
          businessName: 'Verification Required',
          gstStatus: 'Blocked',
          scrapeStatus: 'CAPTCHA Triggered',
          gstDetailsList: []
        };
      }
      
      logCallback(`[INFO] No GST details visible for PAN: ${cleanPan}`);
      return {
        gstin: 'N/A',
        businessName: 'Not Found',
        gstStatus: 'N/A',
        scrapeStatus: 'No GST Details Found',
        gstDetailsList: []
      };
    }

    logCallback(`[SUCCESS] Found ${uniqueGstins.length} GSTIN(s) for PAN ${cleanPan}: ${uniqueGstins.join(', ')}`);

    // 9. Extract and parse Business Name & Status
    let businessName = 'N/A';
    let gstStatus = 'N/A';

    const nameMatches = [
      /Business Name\s*[:|-]?\s*([^\n\r]+)/i,
      /Legal Name of Business\s*[:|-]?\s*([^\n\r]+)/i,
      /Trade Name\s*[:|-]?\s*([^\n\r]+)/i,
      /Legal Name\s*[:|-]?\s*([^\n\r]+)/i
    ];

    for (const regex of nameMatches) {
      const match = pageText.match(regex);
      if (match && match[1]) {
        const potentialName = cleanText(match[1]);
        if (potentialName && potentialName.length > 3 && !potentialName.includes('GSTIN') && !potentialName.includes('Status')) {
          businessName = potentialName;
          break;
        }
      }
    }

    const statusMatches = [
      /GSTIN Status\s*[:|-]?\s*([^\n\r]+)/i,
      /GST Status\s*[:|-]?\s*([^\n\r]+)/i,
      /Status\s*[:|-]?\s*([^\n\r]+)/i
    ];

    for (const regex of statusMatches) {
      const match = pageText.match(regex);
      if (match && match[1]) {
        const potentialStatus = cleanText(match[1]);
        if (potentialStatus && potentialStatus.length > 2 && potentialStatus.length < 20) {
          gstStatus = potentialStatus;
          break;
        }
      }
    }

    if (businessName === 'N/A' || gstStatus === 'N/A') {
      const domDetails = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('div, p, td, span, li'));
        let name = null;
        let stat = null;
        
        for (let i = 0; i < items.length; i++) {
          const txt = items[i].innerText || '';
          if (txt.includes('Business Name') || txt.includes('Legal Name')) {
            if (txt.includes(':')) {
              name = txt.split(':')[1];
            } else if (items[i].nextElementSibling) {
              name = items[i].nextElementSibling.innerText;
            }
          }
          if (txt.includes('GSTIN Status') || (txt.includes('Status') && !txt.includes('GSTIN'))) {
            if (txt.includes(':')) {
              stat = txt.split(':')[1];
            } else if (items[i].nextElementSibling) {
              stat = items[i].nextElementSibling.innerText;
            }
          }
        }
        return { name, stat };
      });

      if (businessName === 'N/A' && domDetails.name) {
        businessName = cleanText(domDetails.name);
      }
      if (gstStatus === 'N/A' && domDetails.stat) {
        gstStatus = cleanText(domDetails.stat);
      }
    }

    if (gstStatus !== 'N/A') {
      const statusWords = ['active', 'inactive', 'cancelled', 'suspended', 'pending'];
      const matchedWord = statusWords.find(w => gstStatus.toLowerCase().includes(w));
      if (matchedWord) {
        gstStatus = matchedWord.charAt(0).toUpperCase() + matchedWord.slice(1);
      }
    }

    return {
      gstin: uniqueGstins.join(', '),
      businessName: businessName !== 'N/A' ? businessName : 'Registered Entity',
      gstStatus: gstStatus !== 'N/A' ? gstStatus : 'Active',
      scrapeStatus: 'Success',
      gstDetailsList: gstDetailsList
    };

  } catch (error) {
    logCallback(`[ERROR] Scraping failed: ${error.message}`);
    throw error; // Let the concurrent manager handle retry and page refresh
  }
}

/**
 * Bulk scrapes an array of PAN numbers using high-speed parallel worker tabs.
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

      // Session recycling: recreate page every 50 PANs to manage memory and session cookies
      if (processedCount > 0 && processedCount % 50 === 0) {
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
      let retries = 2; // Retry up to 2 times on failures

      while (retries >= 0) {
        try {
          panResult = await scrapePanDetails(page, pan, (msg) => {
            progressCallback(currentProgress, `[Worker-${workerId}] ${msg}`);
          });

          // If blocked by CAPTCHA, trigger immediate session recycling for next item
          if (panResult.scrapeStatus === 'CAPTCHA Triggered') {
            progressCallback(
              currentProgress,
              `[Worker-${workerId}] [WARNING] Blocked by CAPTCHA. Flagging for session recycle...`
            );
            processedCount = 50; 
          }
          break;
        } catch (error) {
          progressCallback(
            currentProgress,
            `[Worker-${workerId}] [ERROR] Attempt failed for ${pan}: ${error.message}. Retries left: ${retries}`
          );
          retries--;
          
          if (retries >= 0) {
            // Re-create the page tab to heal the session
            try {
              await page.close();
            } catch (e) {}
            page = await browser.newPage();
            await initPage(page);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            panResult = {
              gstin: 'N/A',
              businessName: 'N/A',
              gstStatus: 'N/A',
              scrapeStatus: `Failed: ${error.message}`
            };
          }
        }
      }

      results[pan] = panResult;
      completedCount++;
      processedCount++;

      // Progress reporting
      const finalProgress = Math.round((completedCount / total) * 100);
      progressCallback(
        finalProgress,
        `[Worker-${workerId}] Completed item ${pan}. Total completed: ${completedCount}/${total}`
      );

      // Add a polite human-like delay between searches
      if (queue.length > 0) {
        const delay = Math.floor(Math.random() * 1500) + 1500; // 1.5s to 3s
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

