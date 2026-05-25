import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function explore() {
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a common viewport and user-agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log("Navigating to Razorpay GST PAN search page...");
    await page.goto('https://razorpay.com/gst-number-search/pan/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    console.log("Page loaded. Waiting 3 seconds for dynamic content...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check for inputs
    console.log("Analyzing inputs on the page...");
    const inputs = await page.evaluate(() => {
      const elList = Array.from(document.querySelectorAll('input'));
      return elList.map(el => ({
        type: el.type,
        placeholder: el.placeholder,
        name: el.name,
        id: el.id,
        className: el.className,
        outerHTML: el.outerHTML.substring(0, 200)
      }));
    });
    console.log("Inputs found:", JSON.stringify(inputs, null, 2));
    
    // Check for buttons
    console.log("Analyzing buttons on the page...");
    const buttons = await page.evaluate(() => {
      const elList = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      return elList.map(el => ({
        tagName: el.tagName,
        text: el.innerText || el.value || '',
        type: el.type,
        id: el.id,
        className: el.className,
        outerHTML: el.outerHTML.substring(0, 200)
      }));
    });
    console.log("Buttons found:", JSON.stringify(buttons, null, 2));
    
    // Let's take a screenshot
    const screenshotPath = path.join(__dirname, 'razorpay_loaded.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to: ${screenshotPath}`);
    
  } catch (error) {
    console.error("Exploration error:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

explore();
