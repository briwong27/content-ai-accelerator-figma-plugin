export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { texts, systemPrompt, apiKey } = req.body;

    if (!apiKey) {
      console.log('❌ No API key provided');
      res.status(400).json({ error: 'API key required' });
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
        max_tokens: 8000,
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
      res.status(anthropicRes.status).json({ error: err });
      return;
    }

    const data = await anthropicRes.json();
    console.log('API response structure:', JSON.stringify(data, null, 2));

    if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error('❌ Unexpected API response structure - no content array');
      res.status(500).json({ error: 'Invalid API response structure' });
      return;
    }

    const responseText = data.content[0].text;
    if (!responseText) {
      console.error('❌ No text in first content item');
      res.status(500).json({ error: 'No text in API response' });
      return;
    }

    console.log('✓ Success! Sending response back to plugin');
    res.status(200).json({ report: responseText });
  } catch (err) {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: err.message });
  }
}
