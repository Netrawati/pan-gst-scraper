import xlsx from 'xlsx';
import path from 'path';

// Alphanumeric Indian PAN regex: 5 letters, 4 digits, 1 letter
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;

/**
 * Reads an Excel file and detects the PAN column.
 * Returns the parsed rows and the detected PAN column name.
 * @param {string} filePath 
 * @returns {object} { rows: Array, panKey: string }
 */
function readExcel(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Parse to JSON objects (defval: "" keeps empty cells as empty strings instead of omitting them)
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    
    if (rows.length === 0) {
      throw new Error("The Excel sheet is empty.");
    }
    
    // Detect which key contains PAN numbers
    let panKey = null;
    
    // 1. Look for common headers
    const sampleRow = rows[0];
    const keys = Object.keys(sampleRow);
    const commonHeaders = ['pan', 'pan number', 'pancard', 'pan_number', 'pan card', 'pannum'];
    
    for (const key of keys) {
      const normalizedKey = key.trim().toLowerCase();
      if (commonHeaders.includes(normalizedKey)) {
        panKey = key;
        break;
      }
    }
    
    // 2. Fallback: Scan row values using regex to find the PAN column
    if (!panKey) {
      for (const key of keys) {
        // Check if at least one row has a valid PAN in this column
        const hasValidPan = rows.some(row => {
          const val = String(row[key] || '').trim();
          return PAN_REGEX.test(val);
        });
        
        if (hasValidPan) {
          panKey = key;
          break;
        }
      }
    }
    
    // If still not found, default to the first column or throw error
    if (!panKey) {
      // Let's check if there is any column. If so, default to the first column but log a warning.
      if (keys.length > 0) {
        panKey = keys[0];
      } else {
        throw new Error("Could not find any columns in the Excel file.");
      }
    }
    
    return { rows, panKey };
  } catch (error) {
    console.error("Error reading Excel:", error);
    throw error;
  }
}

/**
 * Merges original rows with scraped GST results and writes them to a new Excel file.
 * @param {Array} originalRows 
 * @param {Array} scrapedResults Map of PAN -> { gstin, businessName, gstStatus, scrapeStatus }
 * @param {string} panKey Column name where PAN is stored
 * @param {string} outputPath Destination file path
 */
function writeExcel(originalRows, scrapedResults, panKey, outputPath) {
  try {
    const combinedRows = originalRows.map(row => {
      const panValue = String(row[panKey] || '').trim().toUpperCase();
      const gstInfo = scrapedResults[panValue] || {
        gstin: 'N/A',
        businessName: 'N/A',
        gstStatus: 'N/A',
        scrapeStatus: 'Not Processed'
      };
      
      return {
        ...row,
        'GST Number': gstInfo.gstin || 'N/A',
        'Business Name': gstInfo.businessName || 'N/A',
        'GST Status': gstInfo.gstStatus || 'N/A',
        'Scrape Status': gstInfo.scrapeStatus || 'N/A'
      };
    });
    
    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.json_to_sheet(combinedRows);
    
    xlsx.utils.book_append_sheet(workbook, sheet, 'GST_Results');
    xlsx.writeFile(workbook, outputPath);
    
    return outputPath;
  } catch (error) {
    console.error("Error writing Excel:", error);
    throw error;
  }
}

export {
  readExcel,
  writeExcel,
  PAN_REGEX
};
