YT AUTO META DASHBOARD - SETUP

A) Dashboard (Netlify)
1) Google Cloud Console: project -> YouTube Data API v3 enable
   OAuth consent screen: External, Testing, client/apni Gmail "Test user" me add karo
   Credentials -> OAuth client ID -> Web application
   Authorized redirect URI: https://YOUR-SITE.netlify.app/api/callback
2) Is folder ko GitHub repo me daalo -> Netlify "Import from Git"
3) Netlify -> Site settings -> Environment variables:
   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GEMINI_API_KEY
   Optional:
   GEMINI_MODEL          (AI Studio me jo current model ho; default khud fallback try karta hai)
   ALLOWED_CHANNEL_ID    (sirf is channel ko login milega)
   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   (report Telegram pe bhejne ke liye)
4) Deploy -> site kholo -> Metadata tab -> Google Login -> Videos load
   "Sirf Title" select karo agar sirf title badalna hai.

B) Video dekhkar title (tools/yt_video_titles.py)
   Computer pe chalta hai (Netlify ki 10 sec limit ki wajah se). Upar file ke andar commands likhe hain.
   Pehle --limit 5 se test karo.

HAMESHA: pehle Backup download karo, 5-10 videos ka preview client ko dikhao, fir baaki.
