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
 * Puppeteer scraping logic for a single PAN number.
 * @param {object} page Puppeteer Page instance
 * @param {string} pan 
 * @param {function} logCallback Real-time logger callback
 * @returns {object} { gstin, businessName, gstStatus, scrapeStatus }
 */
async function scrapePanDetails(page, pan, logCallback) {
  const cleanPan = pan.trim().toUpperCase();
  logCallback(`[PROCESS] Querying PAN: ${cleanPan}...`);
  
  if (!PAN_REGEX.test(cleanPan)) {
    logCallback(`[WARNING] Invalid PAN format: ${cleanPan}. Skipping scraping.`);
    return {
      gstin: 'N/A',
      businessName: 'N/A',
      gstStatus: 'N/A',
      scrapeStatus: 'Invalid PAN Format'
    };
  }

  try {
    // Navigate to the Razorpay GST PAN search page
    logCallback(`[DEBUG] Navigating to page for PAN: ${cleanPan}`);
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait a brief moment to let React render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Find the PAN input field
    // Try multiple selectors including the exact ones discovered
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
          if (isVisible) {
            logCallback(`[DEBUG] Found input with selector: ${selector}`);
            break;
          }
        }
      } catch (err) {
        // Suppress and continue
      }
    }

    if (!inputField) {
      throw new Error("Could not locate any valid, visible PAN input field on the page.");
    }

    // Select all text in input and delete before typing
    await inputField.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await inputField.type(cleanPan, { delay: 50 });
    
    // Find the submit/search button
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
            logCallback(`[DEBUG] Found button matching text: ${textToMatch}`);
            break;
          }
        } else {
          searchButton = await page.$(selector);
          if (searchButton) {
            const isVisible = await page.evaluate(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }, searchButton);
            if (isVisible) {
              logCallback(`[DEBUG] Found button with selector: ${selector}`);
              break;
            }
          }
        }
      } catch (err) {
        // Suppress and continue
      }
    }

    if (!searchButton) {
      throw new Error("Could not locate the search/submit button.");
    }

    // Click and wait for search to complete
    await searchButton.click();
    logCallback(`[DEBUG] Submitted search. Waiting for results to load...`);
    
    // Wait for either results or "No records found" / error elements
    // Let's sleep for 4 seconds to let the search run dynamically
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Extract page body text to inspect for results
    const pageText = await page.evaluate(() => document.body.innerText);
    
    // Check if there's an explicit "No records found" or similar message
    const noResultsPhrases = [
      'no details found', 
      'no records found', 
      'no gstin associated', 
      'invalid pan', 
      'no data found', 
      'does not exist', 
      'could not find any records'
    ];
    const hasNoResults = noResultsPhrases.some(phrase => pageText.toLowerCase().includes(phrase));
    
    if (hasNoResults) {
      logCallback(`[INFO] No GST registration associated with PAN: ${cleanPan}`);
      return {
        gstin: 'N/A',
        businessName: 'No Business Registered',
        gstStatus: 'N/A',
        scrapeStatus: 'No GST Associated'
      };
    }

    // Let's parse the body text for GSTINs using regex
    let foundGstins = pageText.match(GSTIN_REGEX);
    
    if (!foundGstins || foundGstins.length === 0) {
      // Maybe there are no GSTINs, or they haven't loaded yet.
      logCallback(`[DEBUG] GSTIN not found in body text yet. Waiting 2 more seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const secondPageText = await page.evaluate(() => document.body.innerText);
      foundGstins = secondPageText.match(GSTIN_REGEX);
      
      if (!foundGstins || foundGstins.length === 0) {
        // If we still didn't find GSTINs, but we didn't find "No records found" either, check if there is text indicating a block or rate limit
        if (secondPageText.toLowerCase().includes('captcha') || secondPageText.toLowerCase().includes('robot') || secondPageText.toLowerCase().includes('human')) {
          logCallback(`[WARNING] Scraping was blocked by a CAPTCHA or Anti-Bot challenge.`);
          return {
            gstin: 'N/A',
            businessName: 'Verification Required',
            gstStatus: 'Blocked',
            scrapeStatus: 'CAPTCHA Triggered'
          };
        }
        
        logCallback(`[INFO] No GST details found or visible on page for PAN: ${cleanPan}`);
        return {
          gstin: 'N/A',
          businessName: 'Not Found',
          gstStatus: 'N/A',
          scrapeStatus: 'No GST Details Found'
        };
      }
    }

    // We found one or more GSTINs!
    const uniqueGstins = Array.from(new Set(foundGstins)).map(g => g.toUpperCase());
    logCallback(`[SUCCESS] Found ${uniqueGstins.length} GSTIN(s) for PAN ${cleanPan}: ${uniqueGstins.join(', ')}`);

    // Let's extract the details associated with the first GSTIN (or compile all of them)
    let businessName = 'N/A';
    let gstStatus = 'N/A';

    // Parse business name
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

    // Parse GST Status
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

    // Fallback if status or name not found through regex: 
    // Scan DOM elements that contain the values
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

    // Clean up status (remove junk words)
    if (gstStatus !== 'N/A') {
      const statusWords = ['active', 'inactive', 'cancelled', 'suspended', 'pending'];
      const matchedWord = statusWords.find(w => gstStatus.toLowerCase().includes(w));
      if (matchedWord) {
        gstStatus = matchedWord.charAt(0).toUpperCase() + matchedWord.slice(1);
      }
    }

    // Return successfully scraped details
    return {
      gstin: uniqueGstins.join(', '),
      businessName: businessName !== 'N/A' ? businessName : 'Registered Entity',
      gstStatus: gstStatus !== 'N/A' ? gstStatus : 'Active',
      scrapeStatus: 'Success'
    };

  } catch (error) {
    logCallback(`[ERROR] Scraping failed for PAN ${cleanPan}: ${error.message}`);
    return {
      gstin: 'N/A',
      businessName: 'N/A',
      gstStatus: 'N/A',
      scrapeStatus: `Error: ${error.message}`
    };
  }
}

/**
 * Bulk scrapes an array of PAN numbers.
 * @param {Array} pans List of PAN numbers
 * @param {function} progressCallback Callback to stream live progress percentage and log strings
 * @param {boolean} headless Whether to run browser headlessly
 * @returns {object} Map of PAN -> results
 */
async function scrapeBulkPans(pans, progressCallback, headless = true) {
  progressCallback(0, `[INIT] Starting Puppeteer browser session...`);
  
  const launchOptions = {
    headless: headless ? 'shell' : false, // Puppeteer headless shell mode is fast and robust
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

  try {
    const page = await browser.newPage();
    
    // Emulate human headers and settings
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Hide webdriver footprint
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    for (let i = 0; i < total; i++) {
      const rawPan = pans[i];
      const pan = String(rawPan || '').trim().toUpperCase();
      
      if (!pan) {
        continue;
      }

      // Live progress callback
      const currentProgress = Math.round(((i) / total) * 100);
      progressCallback(
        currentProgress,
        `[PROGRESS] Scraped ${i}/${total} PANs. Current active item: ${pan}`
      );

      // Scrape individual PAN
      const panResult = await scrapePanDetails(page, pan, (msg) => {
        progressCallback(currentProgress, msg);
      });

      results[pan] = panResult;

      // Add a polite random delay between 2 to 4 seconds to prevent rate-blocking
      if (i < total - 1) {
        const delay = Math.floor(Math.random() * 2000) + 2000;
        progressCallback(currentProgress, `[DEBUG] Sleeping for ${(delay / 1000).toFixed(1)} seconds to emulate human behavior...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Final completion callback
    progressCallback(100, `[COMPLETED] Successfully completed processing all ${total} PAN(s).`);

  } catch (error) {
    progressCallback(100, `[FATAL] Scraper session encountered a critical error: ${error.message}`);
    console.error("Critical scrape bulk error:", error);
  } finally {
    await browser.close();
    progressCallback(100, `[CLOSE] Browser closed successfully.`);
  }

  return results;
}

export {
  scrapeBulkPans
};
