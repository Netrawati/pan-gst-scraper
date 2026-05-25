import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createSample() {
  const data = [
    { 'Vendor ID': 'VEND001', 'Vendor Name': 'Razorpay Payments Corp', 'PAN Number': 'AAGCR4375J' },
    { 'Vendor ID': 'VEND002', 'Vendor Name': 'Mock Invalid Vendor', 'PAN Number': 'ABCDE1234F' },
    { 'Vendor ID': 'VEND003', 'Vendor Name': 'Non-Existent PAN', 'PAN Number': 'AAAAC1111A' },
    { 'Vendor ID': 'VEND004', 'Vendor Name': 'Format Failure Co', 'PAN Number': 'AAACR4375J' }
  ];
  
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.json_to_sheet(data);
  
  xlsx.utils.book_append_sheet(workbook, sheet, 'Vendors');
  
  const outputPath = path.join(__dirname, '..', 'sample_pans.xlsx');
  xlsx.writeFile(workbook, outputPath);
  
  console.log(`Sample Excel file created successfully at: ${outputPath}`);
}

createSample();
