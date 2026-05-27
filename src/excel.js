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
    
    // Parse as 2D array of arrays first to analyze headers dynamically
    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    
    if (rawRows.length === 0) {
      throw new Error("The Excel sheet is empty.");
    }
    
    // Determine the maximum number of columns across all rows
    const numCols = Math.max(...rawRows.map(r => r.length));
    
    // Find the column index that contains PAN numbers
    let panColIndex = -1;
    for (let colIdx = 0; colIdx < numCols; colIdx++) {
      const hasValidPan = rawRows.some(row => {
        const val = String(row[colIdx] || '').trim();
        return PAN_REGEX.test(val);
      });
      if (hasValidPan) {
        panColIndex = colIdx;
        break;
      }
    }
    
    // Fallback if no valid PAN found in any column (default to first column)
    if (panColIndex === -1) {
      panColIndex = 0;
    }
    
    // Check if the first row has a valid PAN. If it does, there is no header row!
    const firstRowVal = String(rawRows[0][panColIndex] || '').trim();
    const hasHeader = !PAN_REGEX.test(firstRowVal);
    
    let headers = [];
    let dataRows = [];
    
    if (hasHeader) {
      // The first row is the header row
      headers = rawRows[0].map((h, i) => String(h || '').trim() || `Column ${String.fromCharCode(65 + i)}`);
      dataRows = rawRows.slice(1);
    } else {
      // The first row is a valid PAN -> No header row exists!
      // Generate default headers (Column A = "PAN Number")
      for (let i = 0; i < numCols; i++) {
        if (i === panColIndex) {
          headers.push("PAN Number");
        } else {
          headers.push(`Column ${String.fromCharCode(65 + i)}`);
        }
      }
      dataRows = rawRows; // Include the first row in active data
    }
    
    // Map rows to JSON objects using the determined headers
    const rows = dataRows.map(row => {
      const obj = {};
      for (let i = 0; i < numCols; i++) {
        obj[headers[i]] = row[i] !== undefined ? row[i] : "";
      }
      return obj;
    });
    
    const panKey = headers[panColIndex];
    
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
    const combinedRows = [];
    
    for (const row of originalRows) {
      const panValue = String(row[panKey] || '').trim().toUpperCase();
      const gstInfo = scrapedResults[panValue];
      
      if (!gstInfo) {
        // Not processed
        combinedRows.push({
          ...row,
          'GST Number': 'N/A',
          'Business Name': 'N/A',
          'GST Status': 'N/A',
          'Scrape Status': 'Not Processed'
        });
        continue;
      }
      
      // Extract detailed list of GSTINs and their statuses
      const gstDetailsList = gstInfo.gstDetailsList || [];
      
      if (gstDetailsList.length > 0) {
        const activeItems = [];
        const inactiveItems = [];
        
        gstDetailsList.forEach(item => {
          const statLower = String(item.status || 'Active').toLowerCase();
          const isInactive = statLower.includes('inactive') || statLower.includes('cancelled') || statLower.includes('suspended');
          if (isInactive) {
            inactiveItems.push(item);
          } else {
            activeItems.push(item);
          }
        });
        
        if (activeItems.length > 0 && inactiveItems.length > 0) {
          // Scenario A: Both Active and Inactive GSTINs exist -> Split into 2 rows
          // Row 1: Active GSTINs (keeps original PAN and all other columns)
          combinedRows.push({
            ...row,
            'GST Number': activeItems.map(g => g.gstin).join(', '),
            'Business Name': gstInfo.businessName || 'Registered Entity',
            'GST Status': 'Active',
            'Scrape Status': gstInfo.scrapeStatus || 'Success'
          });
          
          // Row 2: Inactive GSTINs (all original columns are set to empty/blank)
          const blankRow = {};
          Object.keys(row).forEach(k => {
            blankRow[k] = ""; // Keep other columns blank
          });
          
          combinedRows.push({
            ...blankRow,
            'GST Number': inactiveItems.map(g => g.gstin).join(', '),
            'Business Name': '', // blank
            'GST Status': 'Inactive',
            'Scrape Status': gstInfo.scrapeStatus || 'Success'
          });
          
        } else if (inactiveItems.length > 0) {
          // Scenario B: Only Inactive GSTINs exist -> Single row with "Inactive" status
          combinedRows.push({
            ...row,
            'GST Number': inactiveItems.map(g => g.gstin).join(', '),
            'Business Name': gstInfo.businessName || 'Registered Entity',
            'GST Status': 'Inactive',
            'Scrape Status': gstInfo.scrapeStatus || 'Success'
          });
        } else {
          // Scenario C: Only Active GSTINs exist -> Single row with "Active" status
          combinedRows.push({
            ...row,
            'GST Number': activeItems.map(g => g.gstin).join(', '),
            'Business Name': gstInfo.businessName || 'Registered Entity',
            'GST Status': 'Active',
            'Scrape Status': gstInfo.scrapeStatus || 'Success'
          });
        }
        
      } else {
        // Scenario D: Fallback for early exit/unregistered/error states
        combinedRows.push({
          ...row,
          'GST Number': gstInfo.gstin || 'N/A',
          'Business Name': gstInfo.businessName || 'N/A',
          'GST Status': gstInfo.gstStatus || 'N/A',
          'Scrape Status': gstInfo.scrapeStatus || 'N/A'
        });
      }
    }
    
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
