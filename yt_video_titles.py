"""
Video DEKHKAR title banane wala tool (Gemini YouTube-URL input) - sirf TITLE badalta hai.
Description/tags/category/language bilkul nahi chhute.

Setup:
  pip install google-api-python-client google-auth-oauthlib requests
  - client_secret.json (Google Cloud OAuth, Desktop app) isi folder me rakho
  - export GEMINI_API_KEY="xxxx"          (Windows: set GEMINI_API_KEY=xxxx)
  - optional: export GEMINI_MODEL="model-ka-naam"   (AI Studio me jo current ho)

Use:
  python yt_video_titles.py --limit 5             # 5 videos ka preview -> preview.json
  python yt_video_titles.py --apply               # preview.json wale titles YouTube pe lagao
  python yt_video_titles.py --apply --direct      # seedha lagao (no preview)
  python yt_video_titles.py --restore             # purane titles wapas (backup.json)

Extra: --lang Hinglish --extra "channel niche: cooking" --low-res (kam token, thoda kam detail)

Notes:
 - Sirf PUBLIC videos dekhe ja sakte hain. Private/unlisted wale skip hote hain.
 - Dobara chalane par jo ho chuke wo khud skip hote hain (progress.json).
 - backup.json me sirf PEHLA original title save hota hai, dobara overwrite nahi hota.
 - Free Gemini tier: roz ~8 ghante ki YouTube video. videos.update = 50 quota units.
 - Har video me 20-60 sec lag sakte hain, script chalti rehne do.
"""
import os, json, time, argparse, requests
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/youtube"]
KEY = os.environ.get("GEMINI_API_KEY", "")
MODELS = [m for m in [os.environ.get("GEMINI_MODEL"), "gemini-3-flash-preview", "gemini-2.5-flash"] if m]


def load(f, default):
    return json.load(open(f, encoding="utf-8")) if os.path.exists(f) else default


def save(f, data):
    json.dump(data, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def get_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            creds = InstalledAppFlow.from_client_secrets_file("client_secret.json", SCOPES).run_local_server(port=0)
        open("token.json", "w").write(creds.to_json())
    return build("youtube", "v3", credentials=creds)


def all_videos(yt):
    ch = yt.channels().list(part="contentDetails", mine=True).execute()
    pl = ch["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
    ids, token = [], None
    while True:
        r = yt.playlistItems().list(part="contentDetails", playlistId=pl, maxResults=50, pageToken=token).execute()
        ids += [i["contentDetails"]["videoId"] for i in r["items"]]
        token = r.get("nextPageToken")
        if not token:
            break
    out = []
    for i in range(0, len(ids), 50):
        out += yt.videos().list(part="snippet,status", id=",".join(ids[i:i + 50])).execute()["items"]
    return out


def ai_title(v, lang, extra, low_res):
    sn = v["snippet"]
    prompt = f"""Ye YouTube video dhyan se dekho (audio + visuals) aur iska sirf naya title likho.
Language: {lang}. {extra}
Title catchy ho, max 90 chars, jhootha clickbait nahi, video ke ASLI content se match kare.
Agar purane title me brand/series ka naam ya episode number hai to use rakho.
Purana title: {sn.get('title')}
Purani description (reference): {sn.get('description', '')[:600]}
Sirf JSON do: {{"title": "..."}}"""
    url = f"https://www.youtube.com/watch?v={v['id']}"
    err = ""
    for model in MODELS:
        gc = {"responseMimeType": "application/json"}
        if low_res:
            gc["mediaResolution"] = "MEDIA_RESOLUTION_LOW"
        body = {"contents": [{"parts": [{"fileData": {"fileUri": url}}, {"text": prompt}]}], "generationConfig": gc}
        for _ in range(3):
            r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                              headers={"x-goog-api-key": KEY}, json=body, timeout=300)
            if r.status_code == 429:
                time.sleep(30)
                continue
            break
        if r.ok:
            txt = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
            return json.loads(txt)["title"].strip()[:100]
        err = r.text[:300]
        if r.status_code not in (400, 404):
            break
    raise RuntimeError(err)


def push(yt, v, title):
    sn = v["snippet"]
    s = {"title": title, "description": sn.get("description", ""), "categoryId": sn["categoryId"]}
    if sn.get("tags"):
        s["tags"] = sn["tags"]
    if sn.get("defaultLanguage"):
        s["defaultLanguage"] = sn["defaultLanguage"]
    yt.videos().update(part="snippet", body={"id": v["id"], "snippet": s}).execute()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--direct", action="store_true")
    ap.add_argument("--restore", action="store_true")
    ap.add_argument("--lang", default="Hinglish")
    ap.add_argument("--extra", default="")
    ap.add_argument("--low-res", action="store_true")
    a = ap.parse_args()

    yt = get_service()
    videos = all_videos(yt)
    vmap = {v["id"]: v for v in videos}
    backup = load("backup.json", {})
    done = set(load("progress.json", []))
    preview = load("preview.json", [])

    if a.restore:
        for vid, old in backup.items():
            v = vmap.get(vid)
            if v and v["snippet"]["title"] != old:
                push(yt, v, old)
                print("restored:", old)
        return

    if a.apply and not a.direct:
        for p in preview:
            v = vmap.get(p["id"])
            if not v or p["id"] in done:
                continue
            push(yt, v, p["new"])
            done.add(p["id"]); save("progress.json", sorted(done))
            print("updated:", p["new"])
            time.sleep(0.5)
        return

    if not KEY:
        raise SystemExit("GEMINI_API_KEY set karo")
    previewed = {p["id"] for p in preview}
    todo = [v for v in videos if v["id"] not in done and v["id"] not in previewed and v["status"]["privacyStatus"] == "public"]
    skipped = [v for v in videos if v["status"]["privacyStatus"] != "public"]
    print(f"{len(todo)} public videos baaki, {len(skipped)} non-public skip.")
    if a.limit:
        todo = todo[:a.limit]
    for v in todo:
        old = v["snippet"]["title"]
        backup.setdefault(v["id"], old)
        save("backup.json", backup)
        try:
            new = ai_title(v, a.lang, a.extra, a.low_res)
        except Exception as e:
            print("skip", v["id"], str(e)[:200])
            continue
        print(old, "->", new)
        if a.direct and a.apply:
            push(yt, v, new)
            done.add(v["id"]); save("progress.json", sorted(done))
        else:
            preview.append({"id": v["id"], "old": old, "new": new})
            save("preview.json", preview)
    if not (a.direct and a.apply):
        print("\npreview.json check karo, phir: python yt_video_titles.py --apply")


if __name__ == "__main__":
    main()
