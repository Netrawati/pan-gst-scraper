import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readExcel, writeExcel } from './src/excel.js';
import { scrapeBulkPans } from './src/scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads and outputs folders exist (using /tmp on serverless environments like Vercel)
const isServerless = process.env.VERCEL || process.env.NOW_BUILDER;
const UPLOADS_DIR = isServerless ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const OUTPUTS_DIR = isServerless ? '/tmp/outputs' : path.join(__dirname, 'outputs');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Setup JSON parsing and static directory serving
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx or .xls) are allowed.'));
    }
  }
});

// Simple in-memory store for the active scraping job
let activeJob = {
  originalRows: null,
  panKey: null,
  pans: [],
  progress: 0,
  logs: [],
  results: null,
  outputFileName: null,
  status: 'idle', // idle, uploaded, processing, completed, error
  originalFilename: null
};

// SSE Client list
let sseClients = [];

/**
 * Sends an SSE message to all connected clients.
 */
function broadcastSSE(event, data) {
  sseClients.forEach(client => {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

/**
 * Log message and broadcast to SSE clients
 */
function logMessage(progressPercentage, text) {
  const timestamp = new Date().toLocaleTimeString();
  const formattedLog = `[${timestamp}] ${text}`;
  
  activeJob.progress = progressPercentage;
  activeJob.logs.push(formattedLog);
  
  broadcastSSE('progress', {
    progress: progressPercentage,
    log: formattedLog,
    status: activeJob.status
  });
  
  console.log(formattedLog);
}

// 1. Upload Excel File Endpoint
app.post('/upload', upload.single('excelFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload an Excel file.' });
    }

    logMessage(0, `[FILE] Uploaded file: ${req.file.originalname}`);

    // Read the Excel file and extract PANs
    const { rows, panKey } = readExcel(req.file.path);
    
    // Extract non-empty PANs from rows
    const pans = rows
      .map(row => String(row[panKey] || '').trim().toUpperCase())
      .filter(pan => pan.length > 0);
      
    if (pans.length === 0) {
      return res.status(400).json({ 
        error: `Could not find any non-empty PANs in column: "${panKey}".` 
      });
    }

    // Reset and initialize active job
    activeJob = {
      originalRows: rows,
      panKey: panKey,
      pans: pans,
      progress: 0,
      logs: [`[${new Date().toLocaleTimeString()}] [FILE] Uploaded ${req.file.originalname} successfully. Found ${pans.length} PANs in column: "${panKey}".`],
      results: null,
      outputFileName: null,
      status: 'uploaded',
      originalFilename: req.file.originalname,
      tempUploadPath: req.file.path
    };

    return res.status(200).json({
      success: true,
      filename: req.file.originalname,
      panCount: pans.length,
      panKey: panKey,
      pans: pans.slice(0, 10), // send sample of first 10
      totalPans: pans.length
    });

  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. Start Scraping Process Endpoint
app.post('/process', async (req, res) => {
  if (activeJob.status === 'idle') {
    return res.status(400).json({ error: 'No Excel file has been uploaded yet.' });
  }
  
  if (activeJob.status === 'processing') {
    return res.status(400).json({ error: 'A scraping job is already in progress.' });
  }

  // Trigger processing asynchronously in the background
  res.status(200).json({ success: true, message: 'Processing started.' });
  
  activeJob.status = 'processing';
  logMessage(0, `[PROCESS] Initializing scraping job for ${activeJob.pans.length} PANs...`);

  try {
    // Run Puppeteer scraper bulk processing (with 3 parallel workers for high speed)
    const results = await scrapeBulkPans(
      activeJob.pans, 
      (progress, logText) => {
        logMessage(progress, logText);
      },
      true, // headless mode
      1 // concurrency level
    );

    activeJob.results = results;
    
    // Generate output filename
    const sanitizedOriginalName = path.parse(activeJob.originalFilename).name;
    const outputFileName = `GST_Results_${sanitizedOriginalName}_${Date.now()}.xlsx`;
    const outputPath = path.join(OUTPUTS_DIR, outputFileName);
    
    // Write and save the Excel sheet
    logMessage(95, `[FILE] Merging scraped results and generating output Excel file...`);
    writeExcel(activeJob.originalRows, results, activeJob.panKey, outputPath);
    
    activeJob.outputFileName = outputFileName;
    activeJob.status = 'completed';
    
    logMessage(100, `[SUCCESS] Output file generated: ${outputFileName}`);
    
    // Cleanup temporary uploaded file
    if (activeJob.tempUploadPath && fs.existsSync(activeJob.tempUploadPath)) {
      fs.unlinkSync(activeJob.tempUploadPath);
      console.log(`[CLEANUP] Deleted temporary uploaded file: ${activeJob.tempUploadPath}`);
    }

    broadcastSSE('completed', {
      success: true,
      downloadUrl: `/download/${outputFileName}`,
      filename: outputFileName
    });

  } catch (error) {
    activeJob.status = 'error';
    logMessage(100, `[FATAL] Job failed with critical error: ${error.message}`);
    
    broadcastSSE('completed', {
      success: false,
      error: error.message
    });
  }
});

// 3. Server-Sent Events for Real-time Progress Tracking
app.get('/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  res.write('\n');
  
  // Register client
  sseClients.push(res);
  
  // Stream existing logs to catch up new client instantly
  activeJob.logs.forEach(log => {
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify({ progress: activeJob.progress, log, status: activeJob.status })}\n\n`);
  });
  
  // If the job is already completed when client connects, let them know immediately
  if (activeJob.status === 'completed') {
    res.write(`event: completed\n`);
    res.write(`data: ${JSON.stringify({ success: true, downloadUrl: `/download/${activeJob.outputFileName}`, filename: activeJob.outputFileName })}\n\n`);
  } else if (activeJob.status === 'error') {
    res.write(`event: completed\n`);
    res.write(`data: ${JSON.stringify({ success: false, error: 'Job failed.' })}\n\n`);
  }

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// 4. Download Generated Output File Endpoint
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(OUTPUTS_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Error: File not found.');
  }
  
  res.download(filePath, filename, (err) => {
    if (err) {
      console.error("Download file transmission error:", err);
      res.status(500).send('Error during file transmission.');
    }
  });
});

// 5. Reset Endpoint (Start over)
app.post('/reset', (req, res) => {
  if (activeJob.status === 'processing') {
    return res.status(400).json({ error: 'Cannot reset while a scraping job is running.' });
  }

  activeJob = {
    originalRows: null,
    panKey: null,
    pans: [],
    progress: 0,
    logs: [],
    results: null,
    outputFileName: null,
    status: 'idle',
    originalFilename: null
  };

  res.status(200).json({ success: true, message: 'Reset successful.' });
});

// Expose app status
app.get('/status', (req, res) => {
  res.status(200).json({
    status: activeJob.status,
    progress: activeJob.progress,
    panCount: activeJob.pans.length,
    filename: activeJob.originalFilename
  });
});

// Start Express App with automatic port fallback if port is in use
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`==================================================`);
    console.log(`  PAN-GST Scraper Server running on http://localhost:${port}`);
    console.log(`==================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[WARNING] Port ${port} is in use. Retrying on port ${port + 1}...`);
      startServer(Number(port) + 1);
    } else {
      console.error('Server error:', err);
    }
  });
};

startServer(PORT);
