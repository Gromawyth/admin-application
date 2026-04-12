"use strict";

const {
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");

/* =========================================================
   KONFIG
========================================================= */

const EMBED_AI_CHANNEL_ID = "1492932668495499304";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const DEFAULT_COLOR = 0x2ecc71;
const PREVIEW_FOOTER = "Embed AI v3 • élő előnézet";
const MAX_HISTORY = 40;
const MAX_REPLY_CHARS = 1800;

/*
  Ha üres, bárki használhatja.
*/
const ALLOWED_ROLE_IDS = [];

/*
  Ha üres, bármelyik szöveges csatornába mehet publish.
*/
const ALLOWED_TARGET_CHANNEL_IDS = [];

/* =========================================================
   ÁLLAPOT
========================================================= */

const sessions = new Map();
let listenersRegistered = false;

/* =========================================================
   ALAP SEGÉDEK
========================================================= */

function nowIso() {
  return new Date().toISOString();
}

function clean(text) {
  return String(text ?? "").trim();
}

function safeLower(text) {
  return clean(text).toLowerCase();
}

function truncate(text, max) {
  const s = String(text ?? "");
  if (!max || s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function isBuilderChannel(message) {
  return message?.channel?.id === EMBED_AI_CHANNEL_ID;
}

function hasAccess(member) {
  if (!member) return false;
  if (!ALLOWED_ROLE_IDS.length) return true;
  return ALLOWED_ROLE_IDS.some((id) => member.roles?.cache?.has(id));
}

function extractFirstUrl(text) {
  const m = String(text || "").match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}

function extractAllUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/\S+/gi)].map((m) => m[0]);
}

function extractChannelIdFromText(text) {
  const mention = String(text || "").match(/<#(\d+)>/);
  if (mention) return mention[1];
  return null;
}

function extractAfterColon(text) {
  const m = String(text || "").match(/:\s*([\s\S]+)$/);
  return m?.[1]?.trim() || "";
}

function pickAttachmentUrls(message) {
  const files = [];
  for (const att of message.attachments.values()) {
    files.push({
      name: att.name || "fajl",
      url: att.url,
      contentType: att.contentType || "",
      isImage: (att.contentType || "").startsWith("image/"),
      isVideo: (att.contentType || "").startsWith("video/"),
    });
  }
  return files;
}

function normalizeColor(input) {
  if (!input) return null;
  const text = String(input).trim().toLowerCase();

  const named = {
    piros: 0xe74c3c,
    vörös: 0xe74c3c,
    voros: 0xe74c3c,
    bordó: 0x8e2430,
    bordo: 0x8e2430,
    zöld: 0x2ecc71,
    zold: 0x2ecc71,
    sötétzöld: 0x1f8b4c,
    sotetzold: 0x1f8b4c,
    kék: 0x3498db,
    kek: 0x3498db,
    sötétkék: 0x1f5f9e,
    sotetkek: 0x1f5f9e,
    lila: 0x9b59b6,
    sárga: 0xf1c40f,
    sarga: 0xf1c40f,
    narancs: 0xe67e22,
    türkiz: 0x1abc9c,
    turkiz: 0x1abc9c,
    rózsaszín: 0xff5fa2,
    rozsaszin: 0xff5fa2,
    fehér: 0xffffff,
    feher: 0xffffff,
    fekete: 0x111111,
    szürke: 0x95a5a6,
    szurke: 0x95a5a6,
    sötétszürke: 0x2f3136,
    sotetszurke: 0x2f3136,
  };

  if (named[text] != null) return named[text];

  const hex = text.match(/^#?([0-9a-f]{6})$/i);
  if (hex) return parseInt(hex[1], 16);

  return null;
}

function extractColorFromNaturalText(text) {
  const directHex = String(text || "").match(/#([0-9a-fA-F]{6})/);
  if (directHex) return `#${directHex[1]}`;

  const words = [
    "piros", "vörös", "voros",
    "zöld", "zold",
    "kék", "kek",
    "lila",
    "sárga", "sarga",
    "narancs",
    "fekete",
    "fehér", "feher",
    "szürke", "szurke",
    "türkiz", "turkiz",
    "rózsaszín", "rozsaszin",
    "bordó", "bordo",
    "sötétzöld", "sotetzold",
    "sötétkék", "sotetkek",
    "sötétszürke", "sotetszurke"
  ];

  const lower = safeLower(text);
  for (const w of words) {
    if (lower.includes(w)) return w;
  }

  return null;
}

function createDefaultSession(channelId) {
  return {
    channelId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    previewMessageId: null,
    history: [],
    conversation: [],
    lastIntent: null,
    locked: {
      title: false,
      description: false,
      color: false,
      footer: false,
      author: false,
      thumbnail: false,
      image: false,
      timestamp: false,
      content: false,
      attachments: false,
    },
    draft: {
      title: "",
      description: "",
      color: DEFAULT_COLOR,
      footer: "",
      footerIconURL: "",
      author: "",
      authorIconURL: "",
      thumbnailURL: "",
      imageURL: "",
      timestamp: false,
      content: "",
      attachmentUrls: [],
      videoUrls: [],
    },
  };
}

function getSession(channelId) {
  if (!sessions.has(channelId)) {
    sessions.set(channelId, createDefaultSession(channelId));
  }
  return sessions.get(channelId);
}

function snapshotSession(session) {
  return JSON.parse(JSON.stringify(session));
}

function pushHistory(session) {
  session.history.push(snapshotSession(session));
  if (session.history.length > 30) session.history.shift();
}

function restoreLast(session) {
  const prev = session.history.pop();
  if (!prev) return false;
  sessions.set(session.channelId, prev);
  return true;
}

function addConversationTurn(session, role, text) {
  session.conversation.push({
    role,
    text: truncate(clean(text), 1200),
    at: nowIso(),
  });

  if (session.conversation.length > MAX_HISTORY) {
    session.conversation.shift();
  }
}

function unlockAll(session) {
  for (const key of Object.keys(session.locked)) {
    session.locked[key] = false;
  }
}

function canEdit(session, part) {
  return !session.locked?.[part];
}

function setLock(session, part, value) {
  if (Object.prototype.hasOwnProperty.call(session.locked, part)) {
    session.locked[part] = !!value;
  }
}

function clearPart(session, part) {
  const d = session.draft;

  switch (part) {
    case "all":
      unlockAll(session);
      d.title = "";
      d.description = "";
      d.color = DEFAULT_COLOR;
      d.footer = "";
      d.footerIconURL = "";
      d.author = "";
      d.authorIconURL = "";
      d.thumbnailURL = "";
      d.imageURL = "";
      d.timestamp = false;
      d.content = "";
      d.attachmentUrls = [];
      d.videoUrls = [];
      break;
    case "title":
      d.title = "";
      break;
    case "description":
      d.description = "";
      break;
    case "color":
      d.color = DEFAULT_COLOR;
      break;
    case "footer":
      d.footer = "";
      d.footerIconURL = "";
      break;
    case "author":
      d.author = "";
      d.authorIconURL = "";
      break;
    case "thumbnail":
      d.thumbnailURL = "";
      break;
    case "image":
      d.imageURL = "";
      break;
    case "timestamp":
      d.timestamp = false;
      break;
    case "content":
      d.content = "";
      break;
    case "attachments":
      d.attachmentUrls = [];
      d.videoUrls = [];
      break;
    default:
      break;
  }
}

function summarizeDraft(session) {
  const d = session.draft;
  const locked = Object.entries(session.locked)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return {
    title: d.title || null,
    description: d.description || null,
    color: d.color,
    footer: d.footer || null,
    author: d.author || null,
    thumbnailURL: d.thumbnailURL || null,
    imageURL: d.imageURL || null,
    timestamp: d.timestamp,
    content: d.content || null,
    attachmentCount: d.attachmentUrls.length,
    videoCount: d.videoUrls.length,
    locked,
  };
}

function humanDraftSummary(session) {
  const d = session.draft;
  const colorHex = `#${(d.color || DEFAULT_COLOR).toString(16).padStart(6, "0")}`;
  const locked = Object.entries(session.locked)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return [
    `Cím: ${d.title || "nincs"}`,
    `Leírás: ${d.description ? "van" : "nincs"}`,
    `Szín: ${colorHex}`,
    `Footer: ${d.footer || "nincs"}`,
    `Author: ${d.author || "nincs"}`,
    `Thumbnail: ${d.thumbnailURL ? "van" : "nincs"}`,
    `Fő kép: ${d.imageURL ? "van" : "nincs"}`,
    `Timestamp: ${d.timestamp ? "bekapcsolva" : "kikapcsolva"}`,
    `Embeden kívüli szöveg: ${d.content ? "van" : "nincs"}`,
    `Külső képek: ${d.attachmentUrls.length}`,
    `Videók: ${d.videoUrls.length}`,
    `Zárolt részek: ${locked.length ? locked.join(", ") : "nincs"}`
  ].join("\n");
}

function buildMainEmbed(session) {
  const d = session.draft;
  const embed = new EmbedBuilder().setColor(d.color || DEFAULT_COLOR);

  if (d.title) embed.setTitle(truncate(d.title, 256));
  if (d.description) embed.setDescription(truncate(d.description, 4096));
  if (d.footer) {
    embed.setFooter({
      text: truncate(d.footer, 2048),
      iconURL: d.footerIconURL || undefined,
    });
  }
  if (d.author) {
    embed.setAuthor({
      name: truncate(d.author, 256),
      iconURL: d.authorIconURL || undefined,
    });
  }
  if (d.thumbnailURL) embed.setThumbnail(d.thumbnailURL);
  if (d.imageURL) embed.setImage(d.imageURL);
  if (d.timestamp) embed.setTimestamp(new Date());

  return embed;
}

function buildControlEmbed(session) {
  const d = session.draft;
  const locked = Object.entries(session.locked)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle("⚙️ Embed AI v3")
    .setDescription(
      [
        `**Cím:** ${d.title ? "van" : "nincs"}`,
        `**Leírás:** ${d.description ? "van" : "nincs"}`,
        `**Oldalsó szín:** #${(d.color || DEFAULT_COLOR).toString(16).padStart(6, "0")}`,
        `**Embeden kívüli szöveg:** ${d.content ? "van" : "nincs"}`,
        `**Külső képek:** ${d.attachmentUrls.length}`,
        `**Videók:** ${d.videoUrls.length}`,
        `**Utolsó intent:** ${session.lastIntent || "nincs"}`,
        `**Zárolt részek:** ${locked.length ? locked.join(", ") : "nincs"}`
      ].join("\n")
    )
    .addFields({
      name: "Példák",
      value: truncate(
        [
          "`szia`",
          "`az oldalsó csík legyen #3498db`",
          "`a cím maradjon, csak a leírást írd át`",
          "`a képet hagyd, csak a színt változtasd`",
          "`mi van most az embedben?`",
          "`ezt a videót rakd az embed alá`",
          "`küldd be ebbe a csatornába #hirdetesek`",
          "`vond vissza`"
        ].join("\n"),
        1024
      ),
      inline: false,
    })
    .setFooter({ text: PREVIEW_FOOTER })
    .setTimestamp(new Date());
}

function buildPreviewPayload(session) {
  const embeds = [buildControlEmbed(session), buildMainEmbed(session)];
  const contentLines = [];

  if (session.draft.content) {
    contentLines.push(truncate(session.draft.content, 2000));
  }

  if (session.draft.attachmentUrls.length) {
    contentLines.push("🖼️ **Embeden kívüli képek:**");
    for (const url of session.draft.attachmentUrls.slice(0, 10)) {
      contentLines.push(url);
    }
  }

  if (session.draft.videoUrls.length) {
    contentLines.push("🎬 **Videók:**");
    for (const url of session.draft.videoUrls.slice(0, 10)) {
      contentLines.push(url);
    }
  }

  return {
    content: contentLines.join("\n").trim() || null,
    embeds,
    allowedMentions: { parse: [] },
  };
}

async function ensurePreviewMessage(channel, session) {
  if (session.previewMessageId) {
    const existing = await channel.messages.fetch(session.previewMessageId).catch(() => null);
    if (existing) return existing;
  }

  const msg = await channel.send({
    content: "⚡ Előnézet inicializálva...",
    allowedMentions: { parse: [] },
  });

  session.previewMessageId = msg.id;
  return msg;
}

async function refreshPreview(channel, session) {
  const preview = await ensurePreviewMessage(channel, session);
  session.updatedAt = nowIso();
  const payload = buildPreviewPayload(session);

  await preview.edit(payload).catch(async () => {
    const newPreview = await channel.send(payload);
    session.previewMessageId = newPreview.id;
  });
}

/* =========================================================
   TERMÉSZETES SZÖVEG FELISMERÉS
========================================================= */

function isGreeting(text) {
  const t = safeLower(text);
  return /^(szia+|sziasztok|hello|helló|helo|hali|haliho|jóreggelt|jo reggelt|jó estét|jo estet|jónapot|szevasz|csá|csa|yo|hey)\s*!*$/i.test(t);
}

function isThanks(text) {
  const t = safeLower(text);
  return /^(köszi|koszi|köszönöm|koszonom|thx|thanks|király|jo lett|jó lett)\s*!*$/i.test(t);
}

function isBye(text) {
  const t = safeLower(text);
  return /^(bye|viszlát|viszlat|csá|csa|szia|oké csá|na csá)\s*!*$/i.test(t);
}

function looksLikeQuestion(text) {
  const t = safeLower(text);
  if (!t) return false;
  if (t.includes("?")) return true;

  const starters = [
    "mi ",
    "mit ",
    "hogyan",
    "hogy ",
    "miért",
    "mikor",
    "melyik",
    "mennyi",
    "mutasd",
    "meg tudod",
    "el tudod",
    "tudod",
    "lehet",
    "most mi",
    "mi van",
    "jó így",
    "jo igy",
  ];

  return starters.some((s) => t.startsWith(s));
}

function detectTargetFromNaturalText(text) {
  const t = safeLower(text);

  if (/(cím|title)/i.test(t)) return "title";
  if (/(leírás|description)/i.test(t)) return "description";
  if (/(szín|szin|oldalsó csík|oldalso csik|oldalsó szín|oldalso szin|csík|csik|color)/i.test(t)) return "color";
  if (/(footer)/i.test(t)) return "footer";
  if (/(author)/i.test(t)) return "author";
  if (/(thumbnail)/i.test(t)) return "thumbnail";
  if (/(fő kép|fo kep|borítókép|boritokep|embed kép|image)/i.test(t)) return "image";
  if (/(embeden kívül|embeden kivul|külön szöveg|kulon szoveg|content)/i.test(t)) return "content";
  if (/(videó|video|csatolmány|csatolmany|külső kép|kulso kep)/i.test(t)) return "attachments";

  return null;
}

function getFriendlyReplyForGreeting() {
  const replies = [
    "Szia, mondd nyugodtan mit szeretnél módosítani az embeden.",
    "Szia. Írd le természetesen, mit csináljak az embeddel.",
    "Szia, jöhet amit szeretnél: cím, leírás, szín, kép, bármi."
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

/* =========================================================
   FALLBACK ÉRTELMEZÉS
========================================================= */

function fallbackInterpret(messageText, session, attachments) {
  const text = clean(messageText);
  const lower = safeLower(text);

  if (!text && attachments.length) {
    const firstImage = attachments.find((a) => a.isImage);
    const videos = attachments.filter((a) => a.isVideo);
    const ops = [];

    if (firstImage && canEdit(session, "image")) {
      ops.push({ type: "set_image", value: firstImage.url });
    }

    if (videos.length && canEdit(session, "attachments")) {
      for (const v of videos) ops.push({ type: "add_video", value: v.url });
    }

    return {
      intent: "edit",
      reply: "Feldolgoztam a csatolmányokat.",
      ops,
    };
  }

  if (isGreeting(text)) {
    return {
      intent: "chat",
      reply: getFriendlyReplyForGreeting(),
      ops: [],
    };
  }

  if (isThanks(text)) {
    return {
      intent: "chat",
      reply: "Szívesen.",
      ops: [],
    };
  }

  if (isBye(text)) {
    return {
      intent: "chat",
      reply: "Rendben.",
      ops: [],
    };
  }

  if (/^(help|segítség|segitseg|mit tudsz|parancsok|példák|peldak)$/i.test(lower)) {
    return {
      intent: "help",
      reply: [
        "Írhatsz sima mondatokat is.",
        "Példák:",
        "- az oldalsó csík legyen kék",
        "- a cím maradjon, csak a leírást írd át",
        "- tegyél be egy képet embedbe",
        "- ezt a videót rakd az embed alá",
        "- mi van most az embedben?"
      ].join("\n"),
      ops: [],
    };
  }

  if (/^(mi van most az embedben|mutasd az állapotot|állapot|allapot|mi a jelenlegi állapot)/i.test(lower)) {
    return {
      intent: "state_question",
      reply: humanDraftSummary(session),
      ops: [],
    };
  }

  if (looksLikeQuestion(text)) {
    const target = detectTargetFromNaturalText(text);

    if (target === "color") {
      const current = `#${(session.draft.color || DEFAULT_COLOR).toString(16).padStart(6, "0")}`;
      return {
        intent: "question",
        reply: `Az oldalsó szín most ${current}.`,
        ops: [],
      };
    }

    return {
      intent: "question",
      reply: "Értem a kérdést. Ha módosítást kérsz, írd le természetesen, például: `a cím maradjon, csak a színt állítsd kékre`.",
      ops: [],
    };
  }

  if (/(vond vissza|undo|vissza egyet|előző állapot)/i.test(lower)) {
    return {
      intent: "undo",
      reply: "Visszaállítottam az előző állapotot.",
      ops: [{ type: "undo" }],
    };
  }

  if (/(új embed|uj embed|reset|nullázd|nullazd|töröld ki mindent|torold ki mindent|kezdjük újra)/i.test(lower)) {
    return {
      intent: "reset",
      reply: "Lenulláztam az egész embedet.",
      ops: [{ type: "clear", part: "all" }],
    };
  }

  if (/(oldj fel mindent|unlock all|mindent újra lehessen módosítani|mindent oldj fel)/i.test(lower)) {
    return {
      intent: "unlock_all",
      reply: "Feloldottam az összes zárolást.",
      ops: [{ type: "unlock_all" }],
    };
  }

  const publishChannelId = extractChannelIdFromText(text);
  if (/(küldd be|kuldd be|publish|rakd ki|küldheted)/i.test(lower) && publishChannelId) {
    return {
      intent: "publish",
      reply: "Küldöm a végleges verziót a megadott csatornába.",
      ops: [{ type: "publish", channelId: publishChannelId }],
    };
  }

  const lockPatterns = [
    { regex: /(címhez ne nyúlj|a cím maradjon|title maradjon)/i, part: "title", reply: "Rögzítettem a címet." },
    { regex: /(leíráshoz ne nyúlj|a leírás maradjon|description maradjon)/i, part: "description", reply: "Rögzítettem a leírást." },
    { regex: /(színhez ne nyúlj|a szín maradjon|color maradjon)/i, part: "color", reply: "Rögzítettem a színt." },
    { regex: /(footerhez ne nyúlj|a footer maradjon)/i, part: "footer", reply: "Rögzítettem a footert." },
    { regex: /(authorhoz ne nyúlj|az author maradjon)/i, part: "author", reply: "Rögzítettem az authort." },
    { regex: /(thumbnailhez ne nyúlj|a thumbnail maradjon)/i, part: "thumbnail", reply: "Rögzítettem a thumbnailt." },
    { regex: /(képhez ne nyúlj|a képet hagyd|image maradjon)/i, part: "image", reply: "Rögzítettem a fő képet." },
    { regex: /(videókhoz ne nyúlj|csatolmányokhoz ne nyúlj|attachments maradjanak)/i, part: "attachments", reply: "Rögzítettem a külső csatolmányokat." },
    { regex: /(contenthez ne nyúlj|embeden kívüli szöveg maradjon)/i, part: "content", reply: "Rögzítettem az embeden kívüli szöveget." },
  ];

  for (const p of lockPatterns) {
    if (p.regex.test(lower)) {
      return {
        intent: "lock",
        reply: p.reply,
        ops: [{ type: "lock", part: p.part, value: true }],
      };
    }
  }

  const unlockPatterns = [
    { regex: /(oldd fel a címet|title unlock)/i, part: "title", reply: "A cím újra módosítható." },
    { regex: /(oldd fel a leírást|description unlock)/i, part: "description", reply: "A leírás újra módosítható." },
    { regex: /(oldd fel a színt|color unlock)/i, part: "color", reply: "A szín újra módosítható." },
    { regex: /(oldd fel a képet|image unlock)/i, part: "image", reply: "A fő kép újra módosítható." },
  ];

  for (const p of unlockPatterns) {
    if (p.regex.test(lower)) {
      return {
        intent: "unlock",
        reply: p.reply,
        ops: [{ type: "lock", part: p.part, value: false }],
      };
    }
  }

  if (/(csak a címet módosítsd|csak a címhez nyúlj)/i.test(lower)) {
    return {
      intent: "restrict_edit",
      reply: "Rendben, most csak a cím módosítható.",
      ops: [
        { type: "unlock_all" },
        { type: "lock", part: "description", value: true },
        { type: "lock", part: "color", value: true },
        { type: "lock", part: "footer", value: true },
        { type: "lock", part: "author", value: true },
        { type: "lock", part: "thumbnail", value: true },
        { type: "lock", part: "image", value: true },
        { type: "lock", part: "timestamp", value: true },
        { type: "lock", part: "content", value: true },
        { type: "lock", part: "attachments", value: true },
      ],
    };
  }

  if (/(csak a leírást módosítsd|csak a leíráshoz nyúlj)/i.test(lower)) {
    return {
      intent: "restrict_edit",
      reply: "Rendben, most csak a leírás módosítható.",
      ops: [
        { type: "unlock_all" },
        { type: "lock", part: "title", value: true },
        { type: "lock", part: "color", value: true },
        { type: "lock", part: "footer", value: true },
        { type: "lock", part: "author", value: true },
        { type: "lock", part: "thumbnail", value: true },
        { type: "lock", part: "image", value: true },
        { type: "lock", part: "timestamp", value: true },
        { type: "lock", part: "content", value: true },
        { type: "lock", part: "attachments", value: true },
      ],
    };
  }

  const titleMatch =
    text.match(/(?:a\s+)?cím(?:e)?\s+(?:legyen|ez legyen|:)\s*([\s\S]+)$/i) ||
    text.match(/^title\s*:\s*([\s\S]+)$/i);

  if (titleMatch) {
    return {
      intent: "edit",
      reply: "Beállítottam a címet.",
      ops: [{ type: "set_title", value: titleMatch[1].trim() }],
    };
  }

  const descMatch =
    text.match(/(?:a\s+)?leírás(?:a)?\s+(?:legyen|ez legyen|:)\s*([\s\S]+)$/i) ||
    text.match(/^description\s*:\s*([\s\S]+)$/i);

  if (descMatch) {
    return {
      intent: "edit",
      reply: "Frissítettem a leírást.",
      ops: [{ type: "set_description", value: descMatch[1].trim() }],
    };
  }

  const footerMatch =
    text.match(/(?:a\s+)?footer(?:e)?\s+(?:legyen|:)\s*([\s\S]+)$/i) ||
    text.match(/^footer\s*:\s*([\s\S]+)$/i);

  if (footerMatch) {
    return {
      intent: "edit",
      reply: "Beállítottam a footert.",
      ops: [{ type: "set_footer", value: footerMatch[1].trim() }],
    };
  }

  const authorMatch =
    text.match(/(?:az\s+)?author(?:e)?\s+(?:legyen|:)\s*([\s\S]+)$/i) ||
    text.match(/^author\s*:\s*([\s\S]+)$/i);

  if (authorMatch) {
    return {
      intent: "edit",
      reply: "Beállítottam az authort.",
      ops: [{ type: "set_author", value: authorMatch[1].trim() }],
    };
  }

  const contentMatch =
    text.match(/(?:embeden kívül(?:i)? szöveg|embeden kivuli szoveg|content|külön szöveg|kulon szoveg)\s*(?:legyen|:)\s*([\s\S]+)$/i);

  if (contentMatch) {
    return {
      intent: "edit",
      reply: "Beállítottam az embeden kívüli szöveget.",
      ops: [{ type: "set_content", value: contentMatch[1].trim() }],
    };
  }

  if (/(timestamp|időbélyeg|idobelyeg|időpont)/i.test(lower)) {
    if (/(be|kapcsold be|legyen|igen|on|true)/i.test(lower)) {
      return {
        intent: "edit",
        reply: "Bekapcsoltam a timestampet.",
        ops: [{ type: "set_timestamp", value: true }],
      };
    }

    if (/(ki|kapcsold ki|ne legyen|nem|off|false)/i.test(lower)) {
      return {
        intent: "edit",
        reply: "Kikapcsoltam a timestampet.",
        ops: [{ type: "set_timestamp", value: false }],
      };
    }
  }

  if (/(töröld a címet|title törlés|title törles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem a címet.", ops: [{ type: "clear", part: "title" }] };
  }

  if (/(töröld a leírást|description törlés|description torles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem a leírást.", ops: [{ type: "clear", part: "description" }] };
  }

  if (/(töröld a képet|image törlés|image torles|fő képet töröld|fo kepet torold)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem a fő képet.", ops: [{ type: "clear", part: "image" }] };
  }

  if (/(töröld a thumbnailt|thumbnail törlés|thumbnail torles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem a thumbnailt.", ops: [{ type: "clear", part: "thumbnail" }] };
  }

  if (/(töröld a footert|footer törlés|footer torles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem a footert.", ops: [{ type: "clear", part: "footer" }] };
  }

  if (/(töröld az authort|author törlés|author torles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem az authort.", ops: [{ type: "clear", part: "author" }] };
  }

  if (/(töröld az embeden kívüli szöveget|content törlés|content torles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem az embeden kívüli szöveget.", ops: [{ type: "clear", part: "content" }] };
  }

  if (/(töröld a csatolmányokat|töröld a videókat|attachments törlés|attachments torles)/i.test(lower)) {
    return { intent: "edit", reply: "Töröltem a külső csatolmányokat.", ops: [{ type: "clear", part: "attachments" }] };
  }

  if (/(tegyél be egy thumbnailt|thumbnail legyen|thumbnailt rakj be)/i.test(lower)) {
    const url = extractFirstUrl(text) || attachments.find((a) => a.isImage)?.url;
    if (url) {
      return {
        intent: "edit",
        reply: "Beállítottam a thumbnailt.",
        ops: [{ type: "set_thumbnail", value: url }],
      };
    }
  }

  if (/(tegyél be egy képet embedbe|rakj be egy képet embedbe|fő kép legyen|fo kep legyen|embed kép|image legyen)/i.test(lower)) {
    const url = extractFirstUrl(text) || attachments.find((a) => a.isImage)?.url;
    if (url) {
      return {
        intent: "edit",
        reply: "Beállítottam az embed fő képét.",
        ops: [{ type: "set_image", value: url }],
      };
    }
  }

  if (/(embeden kívülre rakd a képet|képet kívülre rakd|kép legyen külön|kép embeden kívül)/i.test(lower)) {
    const image = extractFirstUrl(text) || attachments.find((a) => a.isImage)?.url;
    if (image) {
      return {
        intent: "edit",
        reply: "A képet embeden kívülre raktam.",
        ops: [{ type: "add_attachment_image", value: image }],
      };
    }
  }

  if (/(videót rakd alá|videó legyen külön|video legyen kulon|videó embeden kívül|rakd ki a videót)/i.test(lower)) {
    const videos = attachments.filter((a) => a.isVideo);
    const url = extractFirstUrl(text) || videos[0]?.url;
    if (url) {
      return {
        intent: "edit",
        reply: "A videót embeden kívülre raktam.",
        ops: [{ type: "add_video", value: url }],
      };
    }
  }

  if (attachments.length) {
    const localOps = [];
    const firstImage = attachments.find((a) => a.isImage);
    const videos = attachments.filter((a) => a.isVideo);

    if (firstImage) {
      if (/thumbnail/i.test(lower)) localOps.push({ type: "set_thumbnail", value: firstImage.url });
      else if (/kívül|kivul|külön|kulon/i.test(lower)) localOps.push({ type: "add_attachment_image", value: firstImage.url });
      else localOps.push({ type: "set_image", value: firstImage.url });
    }

    for (const v of videos) {
      localOps.push({ type: "add_video", value: v.url });
    }

    if (localOps.length) {
      return {
        intent: "edit",
        reply: "Feldolgoztam a csatolmányokat.",
        ops: localOps,
      };
    }
  }

  const detectedTarget = detectTargetFromNaturalText(text);

  if (detectedTarget === "color") {
    const foundColor = extractColorFromNaturalText(text);
    if (foundColor) {
      return {
        intent: "edit",
        reply: "Átállítottam az embed oldalsó színét.",
        ops: [{ type: "set_color", value: foundColor }],
      };
    }

    return {
      intent: "clarify",
      reply: "Milyen színre állítsam? Írhatsz hexet is, például: `#2ecc71`.",
      ops: [],
    };
  }

  if (detectedTarget === "title") {
    const value = extractAfterColon(text);
    if (value) {
      return {
        intent: "edit",
        reply: "Beállítottam a címet.",
        ops: [{ type: "set_title", value }],
      };
    }

    return {
      intent: "clarify",
      reply: "Mi legyen pontosan a cím?",
      ops: [],
    };
  }

  if (detectedTarget === "description") {
    const value =
      text.match(/(?:legyen|írd át|ird at|cseréld|csereled|írjad|irjad|:)\s*([\s\S]+)$/i)?.[1]?.trim() || "";

    if (value) {
      return {
        intent: "edit",
        reply: "Frissítettem a leírást.",
        ops: [{ type: "set_description", value }],
      };
    }

    return {
      intent: "clarify",
      reply: "Mit írjak pontosan a leírásba?",
      ops: [],
    };
  }

  if (detectedTarget === "footer") {
    const value = extractAfterColon(text);
    if (value) {
      return {
        intent: "edit",
        reply: "Beállítottam a footert.",
        ops: [{ type: "set_footer", value }],
      };
    }

    return {
      intent: "clarify",
      reply: "Mi legyen pontosan a footer szövege?",
      ops: [],
    };
  }

  if (detectedTarget === "author") {
    const value = extractAfterColon(text);
    if (value) {
      return {
        intent: "edit",
        reply: "Beállítottam az authort.",
        ops: [{ type: "set_author", value }],
      };
    }

    return {
      intent: "clarify",
      reply: "Mi legyen pontosan az author neve?",
      ops: [],
    };
  }

  if (detectedTarget === "image") {
    const url = extractFirstUrl(text) || attachments.find((a) => a.isImage)?.url;
    if (url) {
      return {
        intent: "edit",
        reply: "Beállítottam a fő képet.",
        ops: [{ type: "set_image", value: url }],
      };
    }

    return {
      intent: "clarify",
      reply: "Küldj egy képet vagy linket a fő képhez.",
      ops: [],
    };
  }

  if (detectedTarget === "thumbnail") {
    const url = extractFirstUrl(text) || attachments.find((a) => a.isImage)?.url;
    if (url) {
      return {
        intent: "edit",
        reply: "Beállítottam a thumbnailt.",
        ops: [{ type: "set_thumbnail", value: url }],
      };
    }

    return {
      intent: "clarify",
      reply: "Küldj egy képet vagy linket a thumbnailhez.",
      ops: [],
    };
  }

  if (detectedTarget === "content") {
    const value =
      text.match(/(?:legyen|:)\s*([\s\S]+)$/i)?.[1]?.trim() || "";

    if (value) {
      return {
        intent: "edit",
        reply: "Beállítottam az embeden kívüli szöveget.",
        ops: [{ type: "set_content", value }],
      };
    }

    return {
      intent: "clarify",
      reply: "Mit írjak az embed mellé, embeden kívülre?",
      ops: [],
    };
  }

  if (detectedTarget === "attachments") {
    const image = extractFirstUrl(text) || attachments.find((a) => a.isImage)?.url;
    const video = attachments.find((a) => a.isVideo)?.url;
    const ops = [];

    if (image) ops.push({ type: "add_attachment_image", value: image });
    if (video) ops.push({ type: "add_video", value: video });

    if (ops.length) {
      return {
        intent: "edit",
        reply: "Hozzáadtam a külső csatolmányokat.",
        ops,
      };
    }

    return {
      intent: "clarify",
      reply: "Küldj képet vagy videót, és hozzáadom embeden kívülre.",
      ops: [],
    };
  }

  return {
    intent: "clarify",
    reply: "Értem, de ezt most még nem tudtam biztosan mire érted. Írd le úgy, hogy például: `a szín legyen kék` vagy `a cím legyen: Fontos`.",
    ops: [],
  };
}

/* =========================================================
   OPENAI ÉRTELMEZÉS
========================================================= */

async function interpretWithOpenAI(messageText, session, attachments) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const system = `
Te egy nagyon okos Discord embed builder AI vagy.

Feladatod:
- természetes magyar beszélgetést érts
- különbséget tegyél:
  - sima beszélgetés
  - kérdés
  - módosítási kérés
  - tiltás / ne nyúlj hozzá
  - csak ezt módosítsd típusú kérés
  - állapotlekérés
  - publish
  - undo
- semmit ne vegyél automatikusan leírásnak, ha a user inkább más mezőre utal
- ha a user azt írja, hogy "szia", normálisan válaszolj, és ne módosíts semmit
- ha színről / oldalsó csíkról beszél, akkor a color mezőre gondol
- ha valami kétértelmű, inkább röviden kérdezz vissza

Kizárólag JSON-t adj vissza.

Formátum:
{
  "intent": "chat|question|edit|lock|unlock|state_question|publish|undo|reset|clarify|help",
  "reply": "rövid magyar válasz",
  "ops": [
    { "type": "set_title", "value": "..." },
    { "type": "set_description", "value": "..." },
    { "type": "append_description", "value": "..." },
    { "type": "set_color", "value": "#3498db vagy kék" },
    { "type": "set_footer", "value": "..." },
    { "type": "set_author", "value": "..." },
    { "type": "set_thumbnail", "value": "https://..." },
    { "type": "set_image", "value": "https://..." },
    { "type": "set_timestamp", "value": true },
    { "type": "set_content", "value": "embeden kívüli szöveg" },
    { "type": "add_attachment_image", "value": "https://..." },
    { "type": "add_video", "value": "https://..." },
    { "type": "clear", "part": "all|title|description|color|footer|author|thumbnail|image|timestamp|content|attachments" },
    { "type": "lock", "part": "title|description|color|footer|author|thumbnail|image|timestamp|content|attachments", "value": true },
    { "type": "unlock_all" },
    { "type": "publish", "channelId": "1234567890" },
    { "type": "undo" }
  ]
}

Fontos szabályok:
- "szia" => chat, nincs módosítás
- "köszi" => chat, nincs módosítás
- "mi van most az embedben?" => state_question, nincs módosítás
- "az oldalsó csík legyen #3498db" => set_color
- "ehhez ne nyúlj" => lock
- "csak ezt módosítsd" => a többit lockold
- ne találj ki URL-t, ID-t, szöveget
- rövid, emberi választ adj
- nincs gomb, nincs poll, nincs giveaway
`;

  const payload = {
    user_message: messageText,
    draft_state: summarizeDraft(session),
    recent_conversation: session.conversation.slice(-12),
    incoming_attachments: attachments,
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(payload) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "embed_ai_v3_intent",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              intent: { type: "string" },
              reply: { type: "string" },
              ops: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    type: { type: "string" },
                    value: { type: ["string", "boolean", "number", "null"] },
                    part: { type: "string" },
                    channelId: { type: "string" },
                  },
                  required: ["type"],
                },
              },
            },
            required: ["intent", "reply", "ops"],
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI hiba: ${res.status} ${err}`);
  }

  const data = await res.json();
  const output = data.output_text || "{}";

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Az AI válasza nem volt érvényes JSON.");
  }

  return parsed;
}

/* =========================================================
   MŰVELETEK
========================================================= */

async function applyOps({ client, session, ops }) {
  for (const op of ops) {
    switch (op.type) {
      case "undo": {
        restoreLast(session);
        break;
      }

      case "unlock_all": {
        pushHistory(session);
        unlockAll(session);
        break;
      }

      case "lock": {
        pushHistory(session);
        setLock(session, op.part, !!op.value);
        break;
      }

      case "clear": {
        pushHistory(session);
        clearPart(session, op.part || "all");
        break;
      }

      case "set_title": {
        if (!canEdit(session, "title")) break;
        pushHistory(session);
        session.draft.title = clean(op.value);
        break;
      }

      case "set_description": {
        if (!canEdit(session, "description")) break;
        pushHistory(session);
        session.draft.description = clean(op.value);
        break;
      }

      case "append_description": {
        if (!canEdit(session, "description")) break;
        pushHistory(session);
        session.draft.description = clean(
          [session.draft.description, clean(op.value)].filter(Boolean).join("\n")
        );
        break;
      }

      case "set_color": {
        if (!canEdit(session, "color")) break;
        pushHistory(session);
        const c = normalizeColor(op.value);
        if (c != null) session.draft.color = c;
        break;
      }

      case "set_footer": {
        if (!canEdit(session, "footer")) break;
        pushHistory(session);
        session.draft.footer = clean(op.value);
        break;
      }

      case "set_author": {
        if (!canEdit(session, "author")) break;
        pushHistory(session);
        session.draft.author = clean(op.value);
        break;
      }

      case "set_thumbnail": {
        if (!canEdit(session, "thumbnail")) break;
        pushHistory(session);
        session.draft.thumbnailURL = clean(op.value);
        break;
      }

      case "set_image": {
        if (!canEdit(session, "image")) break;
        pushHistory(session);
        session.draft.imageURL = clean(op.value);
        break;
      }

      case "set_timestamp": {
        if (!canEdit(session, "timestamp")) break;
        pushHistory(session);
        session.draft.timestamp = !!op.value;
        break;
      }

      case "set_content": {
        if (!canEdit(session, "content")) break;
        pushHistory(session);
        session.draft.content = clean(op.value);
        break;
      }

      case "add_attachment_image": {
        if (!canEdit(session, "attachments")) break;
        pushHistory(session);
        const url = clean(op.value);
        if (url && !session.draft.attachmentUrls.includes(url)) {
          session.draft.attachmentUrls.push(url);
        }
        break;
      }

      case "add_video": {
        if (!canEdit(session, "attachments")) break;
        pushHistory(session);
        const url = clean(op.value);
        if (url && !session.draft.videoUrls.includes(url)) {
          session.draft.videoUrls.push(url);
        }
        break;
      }

      case "publish": {
        await publishToChannel(client, session, op.channelId);
        break;
      }

      default:
        break;
    }
  }
}

async function publishToChannel(client, session, targetChannelId) {
  const target = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!target || typeof target.send !== "function") {
    throw new Error("A célcsatorna nem található vagy nem szöveges.");
  }

  if (ALLOWED_TARGET_CHANNEL_IDS.length && !ALLOWED_TARGET_CHANNEL_IDS.includes(target.id)) {
    throw new Error("Ebbe a csatornába nincs engedélyezve a küldés.");
  }

  const me = target.guild?.members?.me || (target.guild ? await target.guild.members.fetchMe().catch(() => null) : null);
  if (me && target.permissionsFor && !target.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages)) {
    throw new Error("Nincs jogosultságom üzenetet küldeni a célcsatornába.");
  }

  const payload = {
    content: [
      session.draft.content || "",
      ...session.draft.attachmentUrls,
      ...session.draft.videoUrls,
    ].filter(Boolean).join("\n") || null,
    embeds: [buildMainEmbed(session)],
    allowedMentions: { parse: [] },
  };

  await target.send(payload);
}

/* =========================================================
   FELDOLGOZÁS
========================================================= */

function shouldRefreshPreview(parsed, attachments) {
  if (attachments?.length && (!parsed?.intent || parsed.intent !== "chat")) return true;
  return Array.isArray(parsed?.ops) && parsed.ops.length > 0;
}

function shortReply(text) {
  return truncate(clean(text), MAX_REPLY_CHARS);
}

async function handleUserMessage(client, message) {
  if (!isBuilderChannel(message)) return;
  if (message.author.bot) return;

  if (!hasAccess(message.member)) {
    await message.reply({
      content: "Nincs jogosultságod az Embed AI használatához.",
      allowedMentions: { parse: [] },
    }).catch(() => null);
    return;
  }

  const session = getSession(message.channel.id);
  const attachments = pickAttachmentUrls(message);

  addConversationTurn(session, "user", message.content || "[csatolmány]");

  try {
    let parsed = null;

    try {
      parsed = await interpretWithOpenAI(message.content, session, attachments);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      parsed = fallbackInterpret(message.content, session, attachments);
    }

    session.lastIntent = parsed.intent || null;

    if (
      parsed.intent !== "chat" &&
      parsed.intent !== "question" &&
      parsed.intent !== "clarify" &&
      parsed.intent !== "help" &&
      parsed.intent !== "state_question" &&
      Array.isArray(parsed.ops) &&
      parsed.ops.length
    ) {
      await applyOps({
        client,
        session,
        ops: parsed.ops,
      });
    }

    if (parsed.intent === "state_question" && !parsed.reply) {
      parsed.reply = humanDraftSummary(session);
    }

    if (shouldRefreshPreview(parsed, attachments)) {
      await refreshPreview(message.channel, getSession(message.channel.id));
    }

    const replyText = shortReply(parsed.reply || "Kész.");

    if (replyText) {
      addConversationTurn(session, "assistant", replyText);
      await message.reply({
        content: replyText,
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }
  } catch (error) {
    const msg = `❌ Hiba történt: ${error.message || "ismeretlen hiba"}`;
    addConversationTurn(session, "assistant", msg);
    await message.reply({
      content: msg,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
}

/* =========================================================
   REGISZTRÁLÁS
========================================================= */

function registerEmbedAi(client) {
  if (listenersRegistered) return;
  listenersRegistered = true;

  client.on("messageCreate", async (message) => {
    await handleUserMessage(client, message);
  });

  client.once("ready", async () => {
    const channel = await client.channels.fetch(EMBED_AI_CHANNEL_ID).catch(() => null);
    if (!channel || typeof channel.send !== "function") {
      console.log("⚠️ [EMBED AI V3] A fix csatorna nem található vagy nem szöveges.");
      return;
    }

    const session = getSession(channel.id);
    await refreshPreview(channel, session).catch((e) => {
      console.log("⚠️ [EMBED AI V3] Előnézet inicializálási hiba:", e.message);
    });

    console.log("✅ [EMBED AI V3] Okos embed builder aktív.");
  });
}

module.exports = {
  registerEmbedAi,
};