# Setting up your Meta app

Social Cockpit uses the **[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)** (Graph API `v25.0`, `graph.instagram.com`). You create your own Meta app and generate an access token for it — there's no shared/hosted app, and no App Review needed for running it against your own account.

## Steps

1. **Create a Meta developer account** at [developers.facebook.com](https://developers.facebook.com/) and verify it.
2. **Create a new app** → choose the **Business** type.
3. **Add the "Instagram" product** to the app and configure **Instagram API setup with Instagram Login**.
4. **Connect your Instagram Professional account** to the app (as an app tester/role while in Development mode).
5. **Grant the permissions** the app uses. Because you run this only against **your own** connected account while the app is in Development mode, these scopes are available to you immediately — **no permission request, App Review, or submission to Meta is required.** Just select them when generating your token in the Graph API Explorer:
   - `instagram_business_basic` — read your profile, media, and insights
   - `instagram_business_manage_comments` — read and reply to comments
   - `instagram_business_manage_messages` — send direct messages (for automations)
   - `instagram_business_content_publish` — publish Reels/media from Compose
   - `instagram_business_manage_insights` — read post and account insights
6. **Grab your credentials:**
   - **Instagram account ID** — your app-scoped Instagram user ID.
   - **App Secret** — from **App settings → Basic** (used for automatic long-lived-token refresh).
   - **A short-lived access token** — generate one from the [Graph API Explorer](https://developers.facebook.com/tools/explorer/), then exchange it inside the app (**Settings → Exchange Short-Lived Token**) for a 60-day long-lived token.
7. **Fill in `.env.local`** with the account ID, app secret, and long-lived token (see the [Configuration](../README.md#️-configuration) section of the README).

> [!NOTE]
> While your app is in **Development mode** it works only for accounts with a role on the app — perfect for running your own cockpit. Going through Meta **App Review** is only necessary if you want to operate on accounts you don't control.

> [!WARNING]
> This project is **not affiliated with, endorsed by, or sponsored by Meta or Instagram**. You are responsible for complying with the [Meta Platform Terms](https://developers.facebook.com/terms/) and Instagram's policies when using your own app and tokens.

## Token expiry

Long-lived tokens last ~60 days. The app's token manager (`src/lib/token/`) checks expiry and refreshes automatically using `INSTAGRAM_APP_SECRET`, well before the 60-day mark — as long as the server keeps running. If it's been offline past expiry, redo the short-lived → long-lived exchange from **Settings**.
