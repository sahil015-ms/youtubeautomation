const CID = process.env.GOOGLE_CLIENT_ID, SEC = process.env.GOOGLE_CLIENT_SECRET;
const GKEY = process.env.GEMINI_API_KEY, MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ALLOWED = process.env.ALLOWED_CHANNEL_ID || ""; // optional: sirf aapka channel
const json = (c, b, h = {}) => ({ statusCode: c, headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });
const redirectUri = (e) => `https://${e.headers.host}/api/callback`;
const getTok = (e) => ((e.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("yt=")) || "").slice(3);

async function yt(path, tok, opt = {}) {
  const r = await fetch("https://www.googleapis.com/youtube/v3/" + path, {
    ...opt, headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
  });
  const txt = await r.text();
  const d = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new Error((d.error && d.error.message) || "YouTube error");
  return d;
}

async function gem(prompt, asJson) {
  const models = [...new Set([process.env.GEMINI_MODEL, "gemini-3-flash-preview", "gemini-2.5-flash"].filter(Boolean))];
  let err = "Gemini error";
  for (const model of models) {
    const gc = {};
    if (asJson) gc.responseMimeType = "application/json";
    if (/2\.5.*flash/.test(model)) gc.thinkingConfig = { thinkingBudget: 0 };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GKEY}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }),
    });
    const d = await r.json();
    if (r.ok) {
      const t = d.candidates[0].content.parts.map((x) => x.text || "").join("");
      return asJson ? JSON.parse(t) : t;
    }
    err = (d.error && d.error.message) || err;
    if (r.status !== 404 && r.status !== 400) break; // quota/auth error: dusra model try mat karo
  }
  throw new Error(err);
}

exports.handler = async (e) => {
  const route = e.path.replace(/^.*\/api\//, "").replace(/^\/+/, "");
  const q = e.queryStringParameters || {};
  try {
    if (route === "login") {
      const u = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: CID, redirect_uri: redirectUri(e), response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube", prompt: "consent",
      });
      return { statusCode: 302, headers: { location: u } };
    }
    if (route === "callback") {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: q.code, client_id: CID, client_secret: SEC, redirect_uri: redirectUri(e), grant_type: "authorization_code" }),
      });
      const d = await r.json();
      if (!d.access_token) return json(400, d);
      if (ALLOWED) {
        const c = await yt("channels?part=id&mine=true", d.access_token);
        if (!c.items || c.items[0].id !== ALLOWED) return json(403, { error: "Ye channel allowed nahi hai" });
      }
      return { statusCode: 302, headers: { location: "/", "set-cookie": `yt=${d.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3300` } };
    }

    const tok = getTok(e);
    if (!tok) return json(401, { error: "login" });
    const body = e.body ? JSON.parse(e.body) : {};

    if (route === "videos") {
      const ch = await yt("channels?part=contentDetails,snippet&mine=true", tok);
      const c = ch.items[0];
      if (ALLOWED && c.id !== ALLOWED) return json(403, { error: "Ye channel allowed nahi hai" });
      const pl = c.contentDetails.relatedPlaylists.uploads;
      const p = await yt(`playlistItems?part=contentDetails&maxResults=50&playlistId=${pl}` + (q.pageToken ? `&pageToken=${q.pageToken}` : ""), tok);
      const ids = p.items.map((i) => i.contentDetails.videoId).join(",");
      const v = await yt(`videos?part=snippet,status,statistics&id=${ids}`, tok);
      return json(200, {
        channel: c.snippet.title, next: p.nextPageToken || null,
        videos: v.items.map((x) => ({ id: x.id, title: x.snippet.title, description: x.snippet.description, tags: x.snippet.tags || [], categoryId: x.snippet.categoryId, defaultLanguage: x.snippet.defaultLanguage,
          publishedAt: x.snippet.publishedAt,
          status: { privacyStatus: x.status.privacyStatus, publishAt: x.status.publishAt, license: x.status.license, embeddable: x.status.embeddable, publicStatsViewable: x.status.publicStatsViewable, selfDeclaredMadeForKids: x.status.selfDeclaredMadeForKids },
          views: +((x.statistics || {}).viewCount || 0), likes: +((x.statistics || {}).likeCount || 0), commentsCount: +((x.statistics || {}).commentCount || 0) })),
      });
    }

    if (route === "rewrite") {
      const L = body.lang || "Hinglish";
      if (body.titleOnly) {
        const n = await gem(`Tum ek YouTube SEO expert ho. Is video ka sirf naya title likho.
Language: ${L}. ${body.extra || ""}
Title catchy ho, max 90 chars, jhootha clickbait nahi, video ke asli content se match kare.
PURANA TITLE: ${body.title}
DESCRIPTION: ${(body.description || "").slice(0, 1000)}
TAGS: ${(body.tags || []).join(", ")}
Sirf JSON do: {"title":"..."}`, true);
        return json(200, { title: String(n.title).slice(0, 100) });
      }
      const n = await gem(`Tum ek YouTube SEO expert ho. Is video ka naya metadata likho.
Language: ${L}. ${body.extra || ""}
Title catchy (max 90 chars), description 150-300 words (pehli 2 lines me hook + keywords, end me hashtags), tags 10-15 relevant.
PURANA TITLE: ${body.title}
PURANA DESCRIPTION: ${(body.description || "").slice(0, 1500)}
PURANE TAGS: ${(body.tags || []).join(", ")}
Sirf JSON do: {"title":"...","description":"...","tags":["..."]}`, true);
      let tot = 0; const tags = [];
      for (const t of n.tags || []) { if (tot + t.length + 1 > 480) break; tags.push(t); tot += t.length + 1; }
      return json(200, { title: String(n.title).slice(0, 100), description: String(n.description).slice(0, 4900), tags });
    }

    if (route === "script") {
      const base = `Language: ${body.lang || "Hinglish"}. Tone: ${body.tone || "engaging"}. Audience: ${body.audience || "general"}. Topic: ${body.topic}. ${body.extra || ""}
Plain text me likho, markdown symbols (*, #) bilkul use mat karo.`;
      if (body.mode === "short") {
        const text = await gem(`Tum ek viral YouTube Shorts scriptwriter ho. Is topic par 30-45 second ka Shorts script likho. Pehli line me strong hook, ending loop-able ya CTA wali.
${base}
Format:
HOOK (0-3 sec): ...
SCRIPT (line by line, har line ke saath timing, [VISUAL: ...] aur [ON-SCREEN TEXT: ...]):
...
CTA (last 3 sec): ...
CAPTION: ...
HASHTAGS: ...
TITLE IDEAS (3): ...`, false);
        return json(200, { text });
      }
      const m = Math.max(3, Math.min(30, Number(body.minutes) || 8));
      const n = Math.max(5, Math.min(12, Math.round(m / 1.5) + 2));
      if (body.mode === "outline") {
        const o = await gem(`Tum ek top YouTube scriptwriter ho. ${m} minute ke long video ka outline banao.
${base}
Exactly ${n} sections do. Pehla section "Hook + Intro", aakhri "Outro + CTA". Har section me 2-4 talking points.
Sirf JSON do: {"titles":["3 catchy title ideas"],"sections":[{"heading":"...","points":["..."]}]}`, true);
        return json(200, o);
      }
      if (body.mode === "section") {
        const o = body.outline, i = body.idx, sec = o.sections[i];
        const words = Math.round((m * 140) / o.sections.length);
        const text = await gem(`Tum ek top YouTube scriptwriter ho. Long video ka sirf ek section likho, bolne wale (spoken) style me, ~${words} words.
${base}
Poore video ke sections: ${o.sections.map((x, k) => `${k + 1}. ${x.heading}`).join(" | ")}
Abhi likhna hai: section ${i + 1} - ${sec.heading}
Talking points: ${(sec.points || []).join("; ")}
Jagah jagah [VISUAL: ...] cues daalo. Dusre sections ka content repeat mat karo.${i === 0 ? " Pehle 15 second me zabardast hook do." : ""}${i === o.sections.length - 1 ? " End me subscribe/comment CTA do." : ""}`, false);
        return json(200, { text });
      }
    }

    // ---------- COMMENTS ----------
    if (route === "comments") {
      const me = await yt("channels?part=id&mine=true", tok);
      const cid = me.items[0].id;
      const d = await yt(`commentThreads?part=snippet&allThreadsRelatedToChannelId=${cid}&maxResults=50&order=time&textFormat=plainText`, tok);
      const items = d.items
        .filter((t) => t.snippet.totalReplyCount === 0 && !(t.snippet.topLevelComment.snippet.authorChannelId && t.snippet.topLevelComment.snippet.authorChannelId.value === cid))
        .map((t) => ({ id: t.snippet.topLevelComment.id, text: t.snippet.topLevelComment.snippet.textDisplay, author: t.snippet.topLevelComment.snippet.authorDisplayName, videoId: t.snippet.videoId }));
      return json(200, { items });
    }
    if (route === "commentsAI") {
      const r = await gem(`Tum YouTube channel owner ho. Niche: ${body.niche || "general"}. Language: ${body.lang || "Hinglish"}. Tone: ${body.tone || "friendly"}.
Har comment ke liye action chuno: "reply" (chhota 1-2 line reply, comment ki language me, koi link ya jhootha vaada nahi), "spam" (promo link, gaali, scam), ya "skip" (jis par insaan ko sochna chahiye, ya sirf emoji).
Comments: ${JSON.stringify((body.items || []).map((i) => ({ id: i.id, text: String(i.text).slice(0, 300) })))}
Sirf JSON do: {"results":[{"id":"...","action":"reply|spam|skip","reply":"..."}]}`, true);
      return json(200, { results: r.results || [] });
    }
    if (route === "reply") {
      await yt("comments?part=snippet", tok, { method: "POST", body: JSON.stringify({ snippet: { parentId: body.parentId, textOriginal: body.text } }) });
      return json(200, { ok: true });
    }
    if (route === "moderate") {
      await yt(`comments/setModerationStatus?id=${encodeURIComponent(body.id)}&moderationStatus=rejected`, tok, { method: "POST" });
      return json(200, { ok: true });
    }

    // ---------- PLAYLISTS ----------
    if (route === "myPlaylists") {
      const d = await yt("playlists?part=snippet&mine=true&maxResults=50", tok);
      return json(200, { items: d.items.map((p) => ({ id: p.id, title: p.snippet.title })) });
    }
    if (route === "playlistsPlan") {
      const r = await gem(`Neeche YouTube videos ke titles hain. 5-8 playlist naam suggest karo jisme ye achhe se bant jayein (chhote, clear naam).
Sirf JSON do: {"playlists":["..."]}
Titles: ${JSON.stringify(body.titles || [])}`, true);
      return json(200, { playlists: r.playlists || [] });
    }
    if (route === "playlistsAssign") {
      const r = await gem(`Har video ko in playlists me se sabse sahi ek me daalo: ${JSON.stringify(body.names)}. Agar koi fit nahi hota to "none".
Sirf JSON do: {"map":{"<video id>":"<playlist naam ya none>"}}
Videos: ${JSON.stringify(body.items)}`, true);
      return json(200, { map: r.map || {} });
    }
    if (route === "playlistCreate") {
      const d = await yt("playlists?part=snippet,status", tok, { method: "POST", body: JSON.stringify({ snippet: { title: body.title }, status: { privacyStatus: "public" } }) });
      return json(200, { id: d.id });
    }
    if (route === "playlistAdd") {
      await yt("playlistItems?part=snippet", tok, { method: "POST", body: JSON.stringify({ snippet: { playlistId: body.playlistId, resourceId: { kind: "youtube#video", videoId: body.videoId } } }) });
      return json(200, { ok: true });
    }

    // ---------- SCHEDULER ----------
    if (route === "schedule") {
      const st = body.status || {};
      await yt("videos?part=status", tok, {
        method: "PUT",
        body: JSON.stringify({ id: body.id, status: { privacyStatus: "private", publishAt: body.publishAt, license: st.license, embeddable: st.embeddable, publicStatsViewable: st.publicStatsViewable, selfDeclaredMadeForKids: st.selfDeclaredMadeForKids } }),
      });
      return json(200, { ok: true });
    }

    // ---------- TRENDS ----------
    if (route === "trends") {
      const region = body.region || "IN";
      let titles = [];
      if (body.keyword) {
        const after = new Date(Date.now() - 30 * 864e5).toISOString();
        const sr = await yt(`search?part=snippet&type=video&order=viewCount&maxResults=15&regionCode=${region}&publishedAfter=${after}&q=${encodeURIComponent(body.keyword)}`, tok);
        titles = sr.items.map((i) => `${i.snippet.title} (${i.snippet.channelTitle})`);
      } else {
        const v = await yt(`videos?part=snippet,statistics&chart=mostPopular&maxResults=25&regionCode=${region}`, tok);
        titles = v.items.map((i) => `${i.snippet.title} (${(i.statistics || {}).viewCount || 0} views)`);
      }
      const ideas = await gem(`Tum YouTube growth strategist ho. Language: ${body.lang || "Hinglish"}. Channel niche: ${body.niche || "general"}.
Ye videos abhi trend kar rahe hain:
${titles.join("\n")}
Inse trend pattern samajh ke, niche ke hisaab se 10 naye video ideas do (catchy title ke saath, 1 line me kyun chalega). Plain text, markdown symbols mat use karo.`, false);
      return json(200, { titles, ideas });
    }

    // ---------- REPORT + TELEGRAM ----------
    if (route === "report") {
      const text = await gem(`Tum YouTube growth analyst ho. Language: ${body.lang || "Hinglish"}. Channel: ${body.count} videos, total ${body.total} views.
Top videos:
${(body.top || []).join("\n")}
Sabse kam chalne wale:
${(body.bottom || []).join("\n")}
Chhota report likho: 1) kya chal raha hai aur kyun 2) kya nahi chal raha 3) agle 5 videos ke liye concrete suggestions. Plain text, markdown symbols mat use karo, max 250 words.`, false);
      return json(200, { text });
    }
    if (route === "telegram") {
      const T = process.env.TELEGRAM_BOT_TOKEN, C = process.env.TELEGRAM_CHAT_ID;
      if (!T || !C) throw new Error("Netlify me TELEGRAM_BOT_TOKEN aur TELEGRAM_CHAT_ID set karo");
      const r = await fetch(`https://api.telegram.org/bot${T}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: C, text: String(body.text || "").slice(0, 4000) }) });
      if (!r.ok) throw new Error("Telegram error");
      return json(200, { ok: true });
    }

    // ---------- SIMPLE AI TOOLS (thumbnail / social / shorts ideas) ----------
    if (route === "tool") {
      const inp = String(body.input || "").slice(0, 12000), L = body.lang || "Hinglish";
      const P = {
        thumb: `Tum YouTube thumbnail expert ho. Language: ${L}. Video title/topic: ${inp}
3 thumbnail concepts do. Har ek me: Image description (expression, background, colors), Text overlay (max 4 words), Kyun chalega. End me 3 A/B title options. Plain text, markdown symbols mat use karo.`,
        social: `Language: ${L}. Is YouTube video ke liye promo content likho: 1) Instagram Reel caption (hook + hashtags) 2) Facebook post 3) WhatsApp channel message. Video topic/title/description: ${inp}
Plain text, markdown symbols mat use karo.`,
        shorts: `Tum viral Shorts editor ho. Language: ${L}. Neeche long video ka script/transcript hai. Isme se 5 best Shorts clip ideas nikalo. Har ek me: Kahan se (clip ki pehli line quote karke), Approx length (sec), Hook (pehle 3 sec), Title, Hashtags. Plain text, markdown symbols mat use karo.
SCRIPT:
${inp}`,
      };
      if (!P[body.kind]) return json(400, { error: "bad kind" });
      return json(200, { text: await gem(P[body.kind], false) });
    }

    if (route === "apply") {
      await yt("videos?part=snippet", tok, {
        method: "PUT",
        body: JSON.stringify({ id: body.id, snippet: { title: body.title, description: body.description, tags: body.tags, categoryId: body.categoryId, defaultLanguage: body.defaultLanguage } }),
      });
      return json(200, { ok: true });
    }
    return json(404, { error: "not found" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
