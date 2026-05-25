import { scrapeBulkPans } from '../src/scraper.js';

async function runTest() {
  console.log("==================================================");
  console.log("  PAN-GST Scraper CLI Verification Test");
  console.log("==================================================");
  
  // AAGCR4375J is the PAN for Razorpay Software Limited (GSTIN 29AAGCR4375J1ZU)
  const testPans = ['AAGCR4375J', 'INVALID123'];
  
  console.log(`Starting scraper test for PANs: ${testPans.join(', ')}...`);
  
  try {
    const results = await scrapeBulkPans(
      testPans,
      (progress, logMsg) => {
        console.log(`[SSE PROGRESS ${progress}%] ${logMsg}`);
      },
      true // Run headlessly
    );
    
    console.log("\n==================================================");
    console.log("  Verification Test Results:");
    console.log("==================================================");
    console.log(JSON.stringify(results, null, 2));
    console.log("==================================================");
    
    if (results['AAGCR4375J'] && results['AAGCR4375J'].scrapeStatus === 'Success') {
      console.log("✅ TEST SUCCESSFUL: Scraped Razorpay corporate details.");
    } else {
      console.log("❌ TEST FAILED: Could not scrape Razorpay corporate details.");
    }
  } catch (error) {
    console.error("Test execution failed:", error);
  }
}

runTest();
