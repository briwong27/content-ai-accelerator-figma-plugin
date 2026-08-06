# Deploying to Vercel

This guide explains how to deploy your Content Design Toolkit plugin's backend to Vercel, so you won't need to run a local server.

## Prerequisites

1. A Vercel account (sign up free at https://vercel.com)
2. The Vercel CLI installed: `npm install -g vercel`

## Deployment Steps

### 1. Deploy to Vercel

```bash
# From the plugin directory
vercel
```

Follow the prompts:
- Select "Other" as the framework
- Use `.` as the root directory
- Say "No" when asked if you want to modify `vercel.json`

After deployment, you'll get a URL like: `https://content-design-toolkit-abc123.vercel.app`

### 2. Update Your Plugin Configuration

In `code.js`, find this line near the top:

```javascript
const API_ENDPOINT = 'http://localhost:3000/api/analyze-plugin';
```

Replace it with your Vercel URL:

```javascript
const API_ENDPOINT = 'https://content-design-toolkit-abc123.vercel.app/api/analyze-plugin';
```

(Use your actual Vercel project URL)

### 3. Rebuild and Reload

```bash
npm run build
```

Then reload the plugin in Figma:
1. Go to Plugins > Content Design Toolkit > Reload

## Testing

1. Open the Review tab in your plugin
2. Enter your Anthropic API key
3. Try the analysis feature

The plugin will now call your Vercel deployment instead of a local server.

## Troubleshooting

**"Network error" when running analysis?**
- Make sure you updated `API_ENDPOINT` in `code.js` with your actual Vercel URL
- Check that your Anthropic API key is valid
- View logs: `vercel logs [project-name]`

**Want to update the deployed function?**
```bash
vercel --prod
```

This deploys the latest version to your production URL.

## Local Development

If you want to test locally again:
1. Start the local server: `node server.js`
2. Update `API_ENDPOINT` back to: `http://localhost:3000/api/analyze-plugin`
3. Rebuild: `npm run build`
