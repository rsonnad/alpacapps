# You Are Warned deployment

The durable source for `https://youarewarned.com/` is `sites/youarewarned/`.

- Account ID: `9cd3a280a54ce2a5b382602f0247b577`
- Pages project: `youarewarned`
- Production branch: `main`

Deploy the full directory because a Pages Direct Upload is a complete deployment:

```bash
export CLOUDFLARE_API_TOKEN="$(bw get item 'Cloudflare - Pages Deploy (spotka / wingsiebird)' | jq -r '.login.password')"
export CLOUDFLARE_ACCOUNT_ID="9cd3a280a54ce2a5b382602f0247b577"
cd sites/youarewarned
wrangler pages deploy . --project-name youarewarned --branch main --commit-dirty=true
```

Run Wrangler from inside `sites/youarewarned/`; otherwise Pages does not discover the `functions/` directory.

After deployment, verify the custom-domain page, existing warning, contact API, `robots.txt`, sitemap, and an unknown-path 404 separately.
