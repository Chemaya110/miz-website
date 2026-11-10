# MIZ Management website: how to put it online

This folder is the complete website, including the AI floor visualizer
(Google Gemini "Nano Banana 2", model `gemini-3.1-flash-image`).

## 1. Get a Gemini API key (5 minutes)
1. Go to https://aistudio.google.com/apikey and sign in with your Google account.
2. Click **Create API key** and copy it. Keep it private.
3. Turn on billing for the key's Google Cloud project. Image generation is
   billed per image by Google. Set a monthly budget alert in Google Cloud
   Billing so costs can't surprise you.

## 2. Put the site on Vercel (free plan works)
1. Create an account at https://vercel.com.
2. Easiest: install the Vercel CLI (`npm i -g vercel`), open this folder in a
   terminal and run `vercel`. Or upload this folder to a GitHub repository
   and click **Add New > Project** in Vercel to import it.
3. In Vercel, open the project > **Settings > Environment Variables** and add:
   - `GEMINI_API_KEY` = the key from step 1 (required)
   - `ALLOWED_ORIGIN` = your site address, e.g. `https://www.mizmanagement.com`
     (recommended: stops other websites from using your key)
   - `HOURLY_LIMIT_PER_VISITOR` = e.g. `10` (optional, default 10)
   - `GEMINI_MODEL` = only if you want a different Nano Banana model,
     e.g. `gemini-3-pro-image` (Nano Banana Pro, higher quality, costs more)
4. Redeploy (Deployments > ... > Redeploy) so the variables take effect.

## 3. Connect your domain
Vercel > Project > **Settings > Domains** > add your domain and follow the DNS steps.

## Before going live, update in index.html
- Phone number: search for `(305) 555-0123` and `+13055550123` (placeholders).
- The quote form shows a thank-you message but doesn't send anywhere yet.
  Connect it to a form service (Formspree, Vercel form handler, etc.) to
  receive requests by email.

## Files
- `index.html`: the website
- `img/`: logos and photos (stock photos from Pexels, free for commercial use)
- `api/visualize.js`: server function that calls Gemini; your key stays here
- `vercel.json`: gives the AI function up to 60 seconds to respond
