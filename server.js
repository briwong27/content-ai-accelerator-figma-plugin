const http = require('http');

const server = http.createServer(async (req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/analyze-plugin') {
    console.log(`❌ 404: Expected POST /api/analyze-plugin, got ${req.method} ${req.url}`);
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  console.log('✓ Request matched, processing...');

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { texts, systemPrompt, apiKey } = JSON.parse(body);

      if (!apiKey) {
        console.log('❌ No API key provided');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'API key required' }));
        return;
      }

      console.log(`API key received: ${apiKey.substring(0, 20)}... (length: ${apiKey.length})`);

      // Call Anthropic API
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 2048,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Please analyze the following UI text strings and provide grades and recommendations:\n\n${texts.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`
            }
          ]
        })
      });

      console.log(`Anthropic API response: ${anthropicRes.status} ${anthropicRes.statusText}`);

      if (!anthropicRes.ok) {
        const err = await anthropicRes.json();
        console.error('❌ Anthropic API error:', err);
        res.writeHead(anthropicRes.status);
        res.end(JSON.stringify({ error: err }));
        return;
      }

      const data = await anthropicRes.json();
      console.log('✓ Success! Sending response back to plugin');
      res.writeHead(200);
      res.end(JSON.stringify({ report: data.content[0].text }));
    } catch (err) {
      console.error('❌ Server error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Plugin can call: http://localhost:${PORT}/api/analyze-plugin`);
});
