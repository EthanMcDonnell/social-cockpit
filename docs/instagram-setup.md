# Setting up your Meta app

Social Cockpit uses the **[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)** (Graph API `v25.0`, `graph.instagram.com`). You create your own Meta app and generate an access token for it; there's no shared/hosted app, and no App Review needed for running it against your own account.

## Steps

1. **Create a Meta developer account** at [developers.facebook.com](https://developers.facebook.com/) and verify it.
2. **Create a new app** → choose the **Business** type.
3. **Add the "Instagram" product** to the app and configure **Instagram API setup with Instagram Login**.
4. **Connect your Instagram Professional account** to the app (as an app tester/role while in Development mode).
5. **Grant the permissions** the app uses. Because you run this only against **your own** connected account while the app is in Development mode, these scopes are available to you immediately: **no permission request, App Review, or submission to Meta is required.** Just select them when generating your token in the Graph API Explorer:
   - `instagram_business_basic`: read your profile, media, and insights
   - `instagram_business_manage_comments`: read and reply to comments
   - `instagram_business_manage_messages`: send direct messages (for automations)
   - `instagram_business_content_publish`: publish Reels/media from Compose
   - `instagram_business_manage_insights`: read post and account insights
6. **Grab your credentials:**
   - **Instagram account ID**: your app-scoped Instagram user ID.
   - **App Secret**: from **App settings → Basic** (used for automatic long-lived-token refresh).
   - **A short-lived access token**: generate one from the [Graph API Explorer](https://developers.facebook.com/tools/explorer/), then exchange it inside the app (**Settings → Exchange Short-Lived Token**) for a 60-day long-lived token.
7. **Fill in `.env`** with the account ID, app secret, and long-lived token (see the [Configuration](../README.md#️-configuration) section of the README).

> [!NOTE]
> While your app is in **Development mode** it works only for accounts with a role on the app, perfect for running your own cockpit. Going through Meta **App Review** is only necessary if you want to operate on accounts you don't control.

> [!WARNING]
> This project is **not affiliated with, endorsed by, or sponsored by Meta or Instagram**. You are responsible for complying with the [Meta Platform Terms](https://developers.facebook.com/terms/) and Instagram's policies when using your own app and tokens.

## Token expiry

Long-lived tokens last ~60 days. The app's token manager (`src/lib/token/`) checks expiry and refreshes automatically using `INSTAGRAM_APP_SECRET`, well before the 60-day mark, as long as the server keeps running. If it's been offline past expiry, redo the short-lived → long-lived exchange from **Settings**.

## Optional: looking up other accounts

Everything above is enough for your own account. To read **other** public Business/Creator accounts (their recent posts with view, like and comment counts, used by the MCP tool `list_account_posts`), Meta requires its [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery) endpoint. That endpoint only exists in the **Instagram API with Facebook Login**, so it needs a second token. It can live in the same Meta app.

1. **Create a Facebook Page and link Instagram to it.** Create the Page from your personal Facebook account. Any name works, and it can stay empty. One Facebook account can own many Pages, so don't create a second Facebook account. On the Page, open **Settings → Linked accounts → Instagram → Connect account**. Linking in Accounts Center alone isn't enough.
2. **Add Facebook Login for Business** to the app, then add the Instagram permissions to the app's Instagram use case under its **Facebook login** setup. The Instagram Login setup above stays as it is.
3. **Generate a token** in the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) with these permissions:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`

   In the login dialog, choose **Edit previous settings** and tick both the Page and the Instagram account. Skipping that tick is why `me/accounts` comes back empty.
4. **Find your Instagram id as this token sees it:** `GET me/accounts?fields=name,instagram_business_account`. Use the `instagram_business_account.id` it returns. It can differ from `INSTAGRAM_ACCOUNT_ID`, which is app-scoped.
5. **Exchange it for a 60-day token**, using the App ID and App Secret from **App settings → Basic** (the Meta app's, not the Instagram app secret):
   ```bash
   curl "https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
   ```
6. **Set both values in `.env` and restart.** Set both or neither: one without the other stops the server at boot.
   ```bash
   FACEBOOK_ACCESS_TOKEN=EAA...
   FACEBOOK_INSTAGRAM_ACCOUNT_ID=17841400000000
   ```
7. **Check it works:** `curl 'localhost:3000/api/instagram/discovery?username=instagram&scan=5'`

**What you get, and the limits:**

- Only public **Business or Creator** accounts. Personal and age-gated accounts return an error.
- Per post: caption, timestamp, permalink, type, `view_count` (reels), `like_count` and `comments_count`. Reach, saves and shares stay private to the account owner.
- `media_url` (the video file) is left out whenever the post contains copyrighted material, such as licensed music on a reel. When it is present, it expires within days.
- Posts come back newest first, and the API has no sort. The tool ranks the most recent posts it fetched, up to 200.
- This token is **not refreshed automatically**. After ~60 days, calls fail with an `OAuthException` (code 190). Redo steps 3 and 5, update `.env` and restart.
