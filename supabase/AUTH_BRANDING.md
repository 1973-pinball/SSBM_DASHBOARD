# Branded Google sign-in

The app code returns OAuth to one clean URL (`VITE_SITE_URL/?auth=return`) and
removes that temporary marker after Supabase restores the session. The random
project reference that Google shows during the handoff is the Supabase Auth
hostname; changing that part requires a Supabase custom domain (paid add-on) or
an available vanity subdomain.

## Recommended production setup

1. Pick an auth hostname such as `auth.your-domain.com`.
2. In Supabase **Project Settings → General → Custom Domains**, add that
   hostname and follow the displayed CNAME/TXT verification steps. Do not
   activate it until Google accepts both callback URLs below.
3. In Google Cloud Console, open the OAuth Web client and keep the existing
   callback while adding the branded one:

   ```text
   https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
   https://auth.your-domain.com/auth/v1/callback
   ```

4. Complete the Google OAuth consent-screen branding:
   - App name: `SSBM Dashboard`
   - Home page: your production app URL
   - Privacy policy: `https://YOUR-APP/?overlay=privacy`
   - Use the production icon and verified domain.
5. Activate the Supabase custom domain.
6. Set Vercel environment variables:

   ```text
   VITE_SUPABASE_URL=https://auth.your-domain.com
   VITE_SUPABASE_ANON_KEY=...
   VITE_SITE_URL=https://YOUR-APP
   ```

7. Add the exact app callback to Supabase **Authentication → URL
   Configuration → Redirect URLs**:

   ```text
   https://YOUR-APP/?auth=return
   ```

   Keep `http://localhost:5173/?auth=return` only for local development. Use
   exact production URLs rather than a broad wildcard.
8. Add `https://auth.your-domain.com` and `wss://auth.your-domain.com` to the
   `connect-src` directive in `vercel.json`. The existing `*.supabase.co`
   allowance does not cover a custom hostname.
9. Deploy, sign out, and test a completely fresh sign-in before removing any
   old callback URL. Supabase keeps the original project hostname active, so a
   staged migration is possible.

## Community setup

Run `schema.sql`, then `community.sql`. Create a Supabase Cron job that runs:

```sql
select public.refresh_community_snapshot();
```

Hourly is enough for the Community tab. The refresh rebuilds aggregates from
currently consenting accounts; it is deliberately not callable by the PWA.
