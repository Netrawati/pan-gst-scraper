async function test() {
  const pans = ['ABCDE1234F', 'AAGCR4375J', 'AAAAC1111A'];
  
  for (const pan of pans) {
    const url = `https://razorpay.com/api/gstin/pan/${pan}`;
    console.log(`Querying: ${url}`);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://razorpay.com/gst-number-search/pan/',
          'Accept': 'application/json, text/plain, */*'
        },
        signal: AbortSignal.timeout(5000) // 5s timeout
      });
      console.log(`Status: ${response.status}`);
      const text = await response.text();
      console.log(`Response: ${text.substring(0, 200)}`);
    } catch (e) {
      console.error(`Error for ${pan}:`, e.message || e);
    }
  }
}

test();
