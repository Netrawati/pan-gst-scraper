import { scrapeBulkPans } from '../src/scraper.js';

async function runTest() {
  console.log("==================================================");
  console.log("  Running Automated Refined Scraper E2E Validation");
  console.log("==================================================");

  const testPans = [
    'AAGCR4375J', // Real PAN with active/inactive GSTINs (Razorpay Software Limited)
    'ABCDE1234F', // Mock/dummy PAN in correct format
    'AAACR4375',  // Invalid PAN format (9 characters instead of 10)
    'AAAAC1111A'  // Non-existent PAN in valid format
  ];

  console.log(`Starting bulk scrape for: ${testPans.join(', ')}`);
  
  const startTime = Date.now();
  
  const results = await scrapeBulkPans(
    testPans,
    (progress, logText) => {
      console.log(`[PROGRESS - ${progress}%] ${logText}`);
    },
    true, // headless
    1 // concurrency
  );

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n==================================================");
  console.log(`  Scraping Completed in ${totalTime}s`);
  console.log("==================================================");
  console.log("Results Object Structure Verification:");
  console.log(JSON.stringify(results, null, 2));

  // Assertions / Mappings check
  console.log("\nPerforming Integrity Verifications:");
  
  // 1. Verify AAGCR4375J (Real active PAN)
  const activeResult = results['AAGCR4375J'];
  if (activeResult) {
    console.log(`- [AAGCR4375J] Status: ${activeResult.scrapeStatus}`);
    console.log(`- [AAGCR4375J] Legal Name: ${activeResult.businessName}`);
    console.log(`- [AAGCR4375J] GSTIN list: ${activeResult.gstin}`);
    console.log(`- [AAGCR4375J] Details Count: ${activeResult.gstDetailsList.length}`);
    
    const hasName = activeResult.businessName.includes("RAZORPAY");
    console.log(`  -> Business Name Correctly Fetched? ${hasName ? 'PASS' : 'FAIL'}`);
    
    const detailsValid = activeResult.gstDetailsList.every(d => d.gstin && d.status);
    console.log(`  -> gstDetailsList Correctly Formatted? ${detailsValid ? 'PASS' : 'FAIL'}`);
  } else {
    console.log("  -> [AAGCR4375J] FAILED to retrieve any results!");
  }

  // 2. Verify AAACR4375 (Invalid PAN format)
  const invalidResult = results['AAACR4375'];
  if (invalidResult && invalidResult.scrapeStatus === 'Invalid PAN Format') {
    console.log(`- [AAACR4375] Successfully flagged as Invalid format: PASS`);
  } else {
    console.log(`- [AAACR4375] Failed invalid format check: FAIL`);
  }

  // 3. Verify AAAAC1111A (Non-existent PAN)
  const emptyResult = results['AAAAC1111A'];
  if (emptyResult && emptyResult.scrapeStatus === 'No GST Associated') {
    console.log(`- [AAAAC1111A] Successfully flagged as No GST Associated: PASS`);
  } else {
    console.log(`- [AAAAC1111A] Failed non-existent PAN check: FAIL`);
  }

  // 4. Verify ABCDE1234F (Mock correct format)
  const mockResult = results['ABCDE1234F'];
  if (mockResult && mockResult.scrapeStatus === 'Success') {
    console.log(`- [ABCDE1234F] Successfully resolved mock format PAN on retry: PASS`);
  } else {
    console.log(`- [ABCDE1234F] Failed mock format PAN check: FAIL`);
  }

  console.log("==================================================");
}

runTest().catch(console.error);
