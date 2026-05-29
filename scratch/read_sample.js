import { readExcel } from '../src/excel.js';

try {
  const { rows, panKey } = readExcel('sample_pans.xlsx');
  console.log("Found PAN column:", panKey);
  console.log("First 10 rows:");
  console.log(rows.slice(0, 10));
} catch (e) {
  console.error("Error reading excel:", e.message);
}
