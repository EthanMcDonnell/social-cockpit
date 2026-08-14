# Key Future Considerations

- **YouTube OAuth client is currently a "Desktop app" type**, set up for local/loopback
  testing only. It cannot redirect to a custom domain. Before connecting the channel in
  production, create (or switch to) a **Web application** OAuth client in Cloud Console
  and register the exact `https://<prod-domain>/api/youtube/oauth/callback` redirect
  URI, then update `YOUTUBE_OAUTH_CLIENT_ID`/`YOUTUBE_OAUTH_CLIENT_SECRET` in the live
  `.env` to match.
