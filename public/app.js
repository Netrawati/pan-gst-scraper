// Frontend Application Logic
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const dropzoneEmpty = document.getElementById('dropzoneEmpty');
  const dropzoneFilled = document.getElementById('dropzoneFilled');
  const fileNameEl = document.getElementById('fileName');
  const fileSizeEl = document.getElementById('fileSize');
  const removeFileBtn = document.getElementById('removeFileBtn');
  
  const excelMeta = document.getElementById('excelMeta');
  const metaPanColumn = document.getElementById('metaPanColumn');
  const metaRecordCount = document.getElementById('metaRecordCount');
  
  const processBtn = document.getElementById('processBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  
  const statTotal = document.getElementById('statTotal');
  const statProcessed = document.getElementById('statProcessed');
  const statSuccess = document.getElementById('statSuccess');
  const statFail = document.getElementById('statFail');
  
  const progressPercentage = document.getElementById('progressPercentage');
  const currentPanIndicator = document.getElementById('currentPanIndicator');
  const progressFill = document.getElementById('progressFill');
  
  const logConsole = document.getElementById('logConsole');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const scrollLogBtn = document.getElementById('scrollLogBtn');
  
  const statusPulse = document.getElementById('statusPulse');
  const statusText = document.getElementById('statusText');

  // Application State
  let selectedFile = null;
  let eventSource = null;
  let isAutoScroll = true;
  let sCounter = 0;
  let fCounter = 0;
  let pCounter = 0;
  let totalRecordsCount = 0;

  // --- 1. Helper: Logging Console ---
  
  /**
   * Appends a log line with custom coloring based on prefix tags
   */
  function addLog(text) {
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    
    // Classify text and apply appropriate styling classes
    if (text.includes('[SUCCESS]')) {
      logLine.classList.add('success-msg');
      sCounter++;
      pCounter++;
      updateStatsUI();
    } else if (text.includes('[ERROR]') || text.includes('[FATAL]')) {
      logLine.classList.add('error-msg');
      fCounter++;
      pCounter++;
      updateStatsUI();
    } else if (text.includes('[WARNING]') || text.includes('CAPTCHA')) {
      logLine.classList.add('warning-msg');
    } else if (text.includes('[PROCESS]') || text.includes('Querying PAN')) {
      logLine.classList.add('info-msg');
      
      // Extract active PAN number to display
      const panMatch = text.match(/PAN:\s*([A-Z0-9]{10})/i) || text.match(/item:\s*([A-Z0-9]{10})/i);
      if (panMatch && panMatch[1]) {
        currentPanIndicator.innerText = `Querying: ${panMatch[1]}`;
        currentPanIndicator.classList.remove('text-faded');
      }
    } else if (text.includes('[DEBUG]')) {
      logLine.classList.add('debug-msg');
    } else if (text.includes('[FILE]') || text.includes('[INIT]')) {
      logLine.classList.add('system-msg');
    } else if (text.includes('No GST registration') || text.includes('No GST details')) {
      // Treat soft failures cleanly
      fCounter++;
      pCounter++;
      updateStatsUI();
    }

    logLine.innerText = text;
    logConsole.appendChild(logLine);

    if (isAutoScroll) {
      logConsole.scrollTop = logConsole.scrollHeight;
    }
  }

  function updateStatsUI() {
    statProcessed.innerText = Math.min(pCounter, totalRecordsCount);
    statSuccess.innerText = Math.min(sCounter, totalRecordsCount);
    statFail.innerText = Math.min(fCounter, totalRecordsCount);
  }

  // Auto-scroll toggle
  scrollLogBtn.addEventListener('click', () => {
    isAutoScroll = !isAutoScroll;
    scrollLogBtn.classList.toggle('active', isAutoScroll);
    if (isAutoScroll) {
      logConsole.scrollTop = logConsole.scrollHeight;
    }
  });

  // Clear log console
  clearLogBtn.addEventListener('click', () => {
    logConsole.innerHTML = '';
    addLog('[INFO] Log console cleared.');
  });

  // --- 2. Event Handlers: Drag & Drop File Upload ---

  // Drag over events
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  // Drag leave events
  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  // On Drop file
  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    if (file) {
      handleFileSelection(file);
    }
  });

  // Browse click triggers hidden file input
  dropzone.addEventListener('click', (e) => {
    // Avoid click bubble from inner buttons
    if (e.target !== removeFileBtn && !removeFileBtn.contains(e.target)) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      handleFileSelection(file);
    }
  });

  // Remove selected file click handler
  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetUploadState();
  });

  /**
   * Validates file type and prepares upload
   */
  function handleFileSelection(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      addLog(`[ERROR] File selection rejected. "${file.name}" is not an Excel sheet.`);
      alert("Only Excel files (.xlsx or .xls) are allowed.");
      return;
    }

    selectedFile = file;
    
    // UI Update to filled state
    fileNameEl.innerText = file.name;
    fileSizeEl.innerText = formatBytes(file.size);
    
    dropzoneEmpty.style.display = 'none';
    dropzoneFilled.style.display = 'flex';
    
    uploadFileToServer(file);
  }

  function resetUploadState() {
    selectedFile = null;
    fileInput.value = '';
    
    dropzoneEmpty.style.display = 'block';
    dropzoneFilled.style.display = 'none';
    excelMeta.style.display = 'none';
    
    processBtn.disabled = true;
    
    statTotal.innerText = '0';
    statProcessed.innerText = '0';
    statSuccess.innerText = '0';
    statFail.innerText = '0';
    totalRecordsCount = 0;
    
    progressFill.style.width = '0%';
    progressPercentage.innerText = '0% Completed';
    currentPanIndicator.innerText = 'Waiting for start...';
    currentPanIndicator.classList.add('text-faded');
    
    updateBadge('idle', 'System Ready');
    addLog(`[INFO] Removed active file.`);
  }

  /**
   * Upload file to express backend via Multer
   */
  function uploadFileToServer(file) {
    addLog(`[FILE] Uploading ${file.name} to server...`);
    updateBadge('processing', 'Uploading File');
    
    const formData = new FormData();
    formData.append('excelFile', file);

    fetch('/upload', {
      method: 'POST',
      body: formData
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => { throw new Error(err.error || 'Server upload failed'); });
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        addLog(`[SUCCESS] Server accepted file. Column "${data.panKey}" detected containing ${data.panCount} records.`);
        
        // Show Excel sheet meta info in UI
        excelMeta.style.display = 'block';
        metaPanColumn.innerText = data.panKey;
        metaRecordCount.innerText = data.panCount;
        
        // Update stats dashboard
        totalRecordsCount = data.panCount;
        statTotal.innerText = data.panCount;
        
        sCounter = 0;
        fCounter = 0;
        pCounter = 0;
        updateStatsUI();
        
        // Enable Process Button
        processBtn.disabled = false;
        
        updateBadge('idle', 'File Loaded');
      }
    })
    .catch(error => {
      addLog(`[ERROR] Upload process failed: ${error.message}`);
      updateBadge('error', 'Upload Failed');
      resetUploadState();
    });
  }

  // --- 3. SSE Stream and Processing ---

  processBtn.addEventListener('click', () => {
    if (!selectedFile) return;
    
    // UI state transitions
    processBtn.disabled = true;
    removeFileBtn.disabled = true;
    updateBadge('processing', 'Querying Portal');
    
    sCounter = 0;
    fCounter = 0;
    pCounter = 0;
    updateStatsUI();

    // Start listening to live SSE logs before launching job
    setupSSEStream();

    // Launch scrape job
    addLog(`[PROCESS] Launching background scraping engine...`);
    fetch('/process', {
      method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        addLog(`[PROCESS] Scraping request dispatched successfully.`);
      } else {
        throw new Error(data.error || 'Failed to initialize processing.');
      }
    })
    .catch(err => {
      addLog(`[FATAL] Start execution failed: ${err.message}`);
      updateBadge('error', 'Failed Init');
      processBtn.disabled = false;
      removeFileBtn.disabled = false;
    });
  });

  /**
   * Instantiates SSE channel and registers logs / progress listeners
   */
  function setupSSEStream() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/progress');

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      
      // Update progress bar
      progressFill.style.width = `${data.progress}%`;
      progressPercentage.innerText = `${data.progress}% Completed`;
      
      // Write log line to terminal console
      addLog(data.log);
    });

    eventSource.addEventListener('completed', (e) => {
      const data = JSON.parse(e.data);
      
      // Close SSE connection
      eventSource.close();
      
      if (data.success) {
        addLog(`[SUCCESS] Scrape batch fully completed.`);
        updateBadge('success', 'Completed');
        
        // Hide process button, show download & reset button
        processBtn.style.display = 'none';
        downloadBtn.style.display = 'inline-flex';
        resetBtn.style.display = 'inline-flex';
        
        currentPanIndicator.innerText = `Saved output: ${data.filename}`;
        
        // Connect download action
        downloadBtn.onclick = () => {
          addLog(`[FILE] Initializing download for: ${data.filename}`);
          window.location.href = data.downloadUrl;
        };
      } else {
        addLog(`[ERROR] Scraping batch aborted: ${data.error}`);
        updateBadge('error', 'Execution Error');
        resetBtn.style.display = 'inline-flex';
      }
      
      removeFileBtn.disabled = false;
    });

    eventSource.onerror = (err) => {
      console.error("SSE stream error:", err);
      // Don't log spam to console as SSE standard auto-reconnects
    };
  }

  // --- 4. Reset to Start Over ---
  
  resetBtn.addEventListener('click', () => {
    fetch('/reset', { method: 'POST' })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        // Reset UI Buttons
        processBtn.style.display = 'inline-flex';
        downloadBtn.style.display = 'none';
        resetBtn.style.display = 'none';
        
        resetUploadState();
        addLog(`[INFO] Workspace reset successfully. Ready for new spreadsheet.`);
      }
    })
    .catch(err => {
      console.error("Reset error:", err);
    });
  });

  // --- Helper Utilities ---

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function updateBadge(type, text) {
    statusText.innerText = text;
    statusPulse.className = 'pulse-indicator'; // clear previous
    statusPulse.classList.add(type);
  }
});
