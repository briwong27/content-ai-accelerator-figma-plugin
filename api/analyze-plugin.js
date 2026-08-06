const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://osvqneioxpqhsebnvcdf.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zdnFuZWlveHBxaHNlYm52Y2RmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjAyNDM2MiwiZXhwIjoyMTAxNjAwMzYyfQ.88if5p_cv3d0eFqjPVZcRP9FZ1QUiLyi2b--XQcHGn8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
    const { texts, systemPrompt, apiKey, userId } = req.body;

    if (!apiKey) {
      console.log('❌ No API key provided');
      res.status(400).json({ error: 'API key required' });
      return;
    }

    if (!userId) {
      console.log('❌ No user ID provided');
      res.status(400).json({ error: 'User ID required' });
      return;
    }

    console.log(`API key received: ${apiKey.substring(0, 20)}... (length: ${apiKey.length})`);
    console.log(`User ID: ${userId}`);

    // Check usage from Supabase
    const { data: userData, error: fetchError } = await supabase
      .from('user_usage')
      .select('analysis_count, month_reset')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows found (new user)
      console.error('❌ Error checking usage:', fetchError);
      res.status(500).json({ error: 'Failed to check usage' });
      return;
    }

    let analysisCount = 0;
    const now = new Date();

    if (userData) {
      // User exists, check if month has reset
      const lastReset = new Date(userData.month_reset);
      const monthsPassed = (now.getFullYear() - lastReset.getFullYear()) * 12 +
                           (now.getMonth() - lastReset.getMonth());

      if (monthsPassed >= 1) {
        // Reset count
        await supabase
          .from('user_usage')
          .update({ analysis_count: 0, month_reset: now.toISOString() })
          .eq('user_id', userId);
        analysisCount = 0;
      } else {
        analysisCount = userData.analysis_count || 0;
      }
    } else {
      // New user, create entry
      await supabase
        .from('user_usage')
        .insert({ user_id: userId, analysis_count: 0, month_reset: now.toISOString() });
    }

    // Check if over free tier limit (10 analyses/month)
    const FREE_TIER_LIMIT = 10;
    if (analysisCount >= FREE_TIER_LIMIT) {
      console.log(`❌ User ${userId} exceeded free tier limit (${analysisCount}/${FREE_TIER_LIMIT})`);
      res.status(429).json({
        error: 'Free tier limit reached',
        usage: analysisCount,
        limit: FREE_TIER_LIMIT,
        message: 'You have used all 10 free analyses this month. Provide your own API key for unlimited analyses.'
      });
      return;
    }

    console.log(`✓ User ${userId} has ${analysisCount}/${FREE_TIER_LIMIT} analyses used`);

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

    // Increment usage counter
    const newCount = analysisCount + 1;
    await supabase
      .from('user_usage')
      .update({ analysis_count: newCount })
      .eq('user_id', userId);

    console.log('✓ Success! Sending response back to plugin');
    res.status(200).json({
      report: responseText,
      usage: {
        current: newCount,
        limit: FREE_TIER_LIMIT,
        remaining: FREE_TIER_LIMIT - newCount
      }
    });
  } catch (err) {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: err.message });
  }
}
