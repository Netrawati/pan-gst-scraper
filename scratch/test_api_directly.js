async function test() {
  const pan = 'AAGCR4375J';
  const url = `https://razorpay.com/api/gstin/pan/${pan}`;
  
  console.log(`Querying API directly: ${url}`);
  
  // Try 1: Plain fetch without any special headers
  try {
    const response = await fetch(url);
    console.log(`Try 1 Status: ${response.status}`);
    const text = await response.text();
    console.log(`Try 1 Response:`, text);
  } catch (error) {
    console.error("Try 1 Error:", error);
  }

  // Try 2: Fetch with standard User-Agent and Referer headers
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://razorpay.com/gst-number-search/pan/',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    console.log(`Try 2 Status: ${response.status}`);
    const text = await response.text();
    console.log(`Try 2 Response:`, text);
  } catch (error) {
    console.error("Try 2 Error:", error);
  }
}

test();
