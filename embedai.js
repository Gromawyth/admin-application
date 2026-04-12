"use strict";

/*
  embedai.js
  =========================================================
  Beszélgetés alapú AI Embed Builder egy fix csatornára.
  Slash command NINCS. Egy csatornában beszélsz vele, és élőben építi az embedet.

  MIT TUD:
  - fix builder csatorna
  - élő preview üzenet
  - title / description / color / footer / author / image / thumbnail / timestamp
  - mezők hozzáadása / törlése
  - gombok (primary / secondary / success / danger / link)
  - poll rendszer százalékokkal és élő frissítéssel
  - giveaway rendszer résztvevő számlálással és sorsolással
  - exact text mód: "csak az én szövegemet használd"
  - reset / clear / publish #csatorna
  - csatolt képek és videók kezelése
  - AI intent értelmezés OpenAI-val, fallback parserrel

  HASZNÁLAT:
  1) állítsd be az EMBED_AI_CHANNEL_ID-t
  2) opcionálisan add meg az OPENAI_API_KEY-t env-ben
  3) index.js-ben már jó a:
      const embedAi = require("./embedai");
      embedAi.registerEmbedAi(client);

  AJÁNLOTT MONDATOK:
  - új embed
  - a cím legyen: Szerverfrissítés
  - leírás: Ma este karbantartás lesz...
  - szín legyen piros
  - tegyél bele thumbnailt
  - rakj hozzá egy zöld gombot "Jelentkezem"
  - csinálj igen/nem szavazást
  - csinálj nyereményjátékot 2 nyertessel
  - csak az én szövegemet használd
  - polishold ki
  - töröld csak a gombokat
  - töröld ki légyszíves
  - küldd be ebbe a csatornába #hirdetesek
  - sorsolj nyertest
*/

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");

/* =========================
   KONFIG
========================= */

const EMBED_AI_CHANNEL_ID = "1492932668495499304";
const OPENAI_MODEL = "gpt-5.4";
const MAX_FIELDS = 25;
const MAX_BUTTONS = 25;
const MAX_BUTTONS_PER_ROW = 5;
const PREVIEW_FOOTER = "Embed AI Studio • élő előnézet";
const CONTROL_EMBED_COLOR = 0x2f3136;

/*
  Ha csak bizonyos rangok használhatják, ide írj role ID-kat.
  Ha üres, bárki használhatja a fix csatornában.
*/
const ALLOWED_ROLE_IDS = [];

/*
  Ha csak bizonyos célcsatornákba mehessen a publish, ide írhatsz ID-kat.
  Ha üres, bármelyik szöveges csatornába mehet, ahol a bot tud küldeni.
*/
const ALLOWED_TARGET_CHANNEL_IDS = [];

/* =========================
   ÁLLAPOT
========================= */

const sessions = new Map(); // channelId -> session
let listenersRegistered = false;

/* =========================
   ALAP HELPEREK
========================= */

function nowIso() {
  return new Date().toISOString();
}

function truncate(text, max = 4096) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function clean(text) {
  return String(text ?? "").trim();
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

function extractQuoted(text) {
  const s = String(text || "");
  const m1 = s.match(/"([^"]+)"/);
  if (m1) return m1[1];
  const m2 = s.match(/„([^”]+)”/);
  if (m2) return m2[1];
  const m3 = s.match(/'([^']+)'/);
  if (m3) return m3[1];
  return null;
}

function pickAttachmentUrls(message) {
  const files = [];
  for (const att of message.attachments.values()) {
    files.push({
      name: att.name || "fajl",
      url: att.url,
      contentType: att.contentType || "",
      size: att.size || 0,
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
    zöld: 0x2ecc71,
    zold: 0x2ecc71,
    kék: 0x3498db,
    kek: 0x3498db,
    lila: 0x9b59b6,
    sárga: 0xf1c40f,
    sarga: 0xf1c40f,
    narancs: 0xe67e22,
    rózsaszín: 0xff5fa2,
    rozsaszin: 0xff5fa2,
    fehér: 0xffffff,
    feher: 0xffffff,
    fekete: 0x111111,
    szürke: 0x95a5a6,
    szurke: 0x95a5a6,
    szürkéssötét: 0x2f3136,
    szurkesotet: 0x2f3136,
    zöldeskék: 0x1abc9c,
    zoldeskek: 0x1abc9c,
    türkiz: 0x1abc9c,
    turkiz: 0x1abc9c,
  };

  if (named[text] != null) return named[text];

  const hex = text.match(/^#?([0-9a-f]{6})$/i);
  if (hex) return parseInt(hex[1], 16);

  return null;
}

function styleFromWord(word) {
  const t = String(word || "").toLowerCase().trim();
  if (t.includes("zöld") || t.includes("zold") || t.includes("igen") || t.includes("join")) {
    return ButtonStyle.Success;
  }
  if (t.includes("piros") || t.includes("nem") || t.includes("veszély") || t.includes("veszely")) {
    return ButtonStyle.Danger;
  }
  if (t.includes("szürke") || t.includes("szurke") || t.includes("secondary")) {
    return ButtonStyle.Secondary;
  }
  if (t.includes("link")) return ButtonStyle.Link;
  return ButtonStyle.Primary;
}

function styleName(style) {
  switch (style) {
    case ButtonStyle.Primary: return "primary";
    case ButtonStyle.Secondary: return "secondary";
    case ButtonStyle.Success: return "success";
    case ButtonStyle.Danger: return "danger";
    case ButtonStyle.Link: return "link";
    default: return "primary";
  }
}

function createDefaultSession(channelId) {
  return {
    channelId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    previewMessageId: null,
    exactTextMode: false,
    mode: "standard", // standard | poll | giveaway
    draft: {
      title: "",
      description: "",
      color: 0x2ecc71,
      footer: "",
      footerIconURL: "",
      author: "",
      authorIconURL: "",
      thumbnailURL: "",
      imageURL: "",
      timestamp: false,
      fields: [],
      buttons: [],
      content: "",
      attachmentUrls: [],
      videoUrls: [],
    },
    poll: {
      question: "",
      options: [], // [{label, emoji}]
      votes: {},   // userId -> optionIndex
      closed: false,
    },
    giveaway: {
      title: "",
      description: "",
      winnersCount: 1,
      joinedUserIds: [],
      closed: false,
      winnerIds: [],
    },
    history: [],
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
  if (session.history.length > 20) session.history.shift();
}

function restoreLast(session) {
  const prev = session.history.pop();
  if (!prev) return false;
  sessions.set(session.channelId, prev);
  return true;
}

function resetSession(session) {
  const fresh = createDefaultSession(session.channelId);
  fresh.previewMessageId = session.previewMessageId;
  sessions.set(session.channelId, fresh);
  return fresh;
}

function clearPart(session, part) {
  const d = session.draft;
  switch (part) {
    case "all":
      session.mode = "standard";
      d.title = "";
      d.description = "";
      d.color = 0x2ecc71;
      d.footer = "";
      d.footerIconURL = "";
      d.author = "";
      d.authorIconURL = "";
      d.thumbnailURL = "";
      d.imageURL = "";
      d.timestamp = false;
      d.fields = [];
      d.buttons = [];
      d.content = "";
      d.attachmentUrls = [];
      d.videoUrls = [];
      session.poll = { question: "", options: [], votes: {}, closed: false };
      session.giveaway = { title: "", description: "", winnersCount: 1, joinedUserIds: [], closed: false, winnerIds: [] };
      break;
    case "title": d.title = ""; break;
    case "description": d.description = ""; break;
    case "fields": d.fields = []; break;
    case "buttons": d.buttons = []; session.poll = { question: "", options: [], votes: {}, closed: false }; session.giveaway = { title: "", description: "", winnersCount: 1, joinedUserIds: [], closed: false, winnerIds: [] }; session.mode = "standard"; break;
    case "image": d.imageURL = ""; break;
    case "thumbnail": d.thumbnailURL = ""; break;
    case "footer": d.footer = ""; d.footerIconURL = ""; break;
    case "author": d.author = ""; d.authorIconURL = ""; break;
    case "attachments": d.attachmentUrls = []; d.videoUrls = []; break;
    default: break;
  }
}

function buildRowsFromButtons(buttons) {
  const rows = [];
  const safeButtons = buttons.slice(0, MAX_BUTTONS);

  for (let i = 0; i < safeButtons.length; i += MAX_BUTTONS_PER_ROW) {
    const chunk = safeButtons.slice(i, i + MAX_BUTTONS_PER_ROW);
    const row = new ActionRowBuilder();

    for (const btn of chunk) {
      const b = new ButtonBuilder()
        .setLabel(truncate(btn.label || "Gomb", 80))
        .setDisabled(!!btn.disabled);

      if (btn.emoji) b.setEmoji(btn.emoji);

      if (btn.style === ButtonStyle.Link) {
        b.setStyle(ButtonStyle.Link).setURL(btn.url || "https://discord.com");
      } else {
        b.setStyle(btn.style || ButtonStyle.Primary)
          .setCustomId(btn.customId || `embedai:btn:${Math.random().toString(36).slice(2, 10)}`);
      }

      row.addComponents(b);
    }

    rows.push(row);
  }

  return rows;
}

function countPollVotes(poll) {
  const counts = new Array(poll.options.length).fill(0);
  for (const uid of Object.keys(poll.votes)) {
    const idx = poll.votes[uid];
    if (idx >= 0 && idx < counts.length) counts[idx]++;
  }
  return counts;
}

function totalPollVotes(poll) {
  return Object.keys(poll.votes).length;
}

function makePercentBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return "🟩".repeat(filled) + "⬜".repeat(10 - filled);
}

function buildMainEmbed(session) {
  const d = session.draft;
  const embed = new EmbedBuilder()
    .setColor(d.color || 0x2ecc71);

  if (d.title) embed.setTitle(truncate(d.title, 256));
  if (d.description) embed.setDescription(truncate(d.description, 4096));
  if (d.footer) embed.setFooter({ text: truncate(d.footer, 2048), iconURL: d.footerIconURL || undefined });
  if (d.author) embed.setAuthor({ name: truncate(d.author, 256), iconURL: d.authorIconURL || undefined });
  if (d.thumbnailURL) embed.setThumbnail(d.thumbnailURL);
  if (d.imageURL) embed.setImage(d.imageURL);
  if (d.timestamp) embed.setTimestamp(new Date());

  if (Array.isArray(d.fields) && d.fields.length) {
    embed.addFields(
      d.fields.slice(0, MAX_FIELDS).map((f) => ({
        name: truncate(f.name || "Mező", 256),
        value: truncate(f.value || "-", 1024),
        inline: !!f.inline,
      }))
    );
  }

  return embed;
}

function buildControlEmbed(session) {
  const d = session.draft;

  let statusText = `**Mód:** ${session.mode}\n`;
  statusText += `**Exact text mód:** ${session.exactTextMode ? "bekapcsolva" : "kikapcsolva"}\n`;
  statusText += `**Mezők:** ${d.fields.length}\n`;
  statusText += `**Gombok:** ${d.buttons.length}\n`;
  statusText += `**Csatolmányok:** ${d.attachmentUrls.length}\n`;
  statusText += `**Videók:** ${d.videoUrls.length}\n`;

  if (session.mode === "poll") {
    const counts = countPollVotes(session.poll);
    const total = totalPollVotes(session.poll);
    statusText += `**Szavazatok:** ${total}\n`;
    if (session.poll.options.length) {
      statusText += `**Opciók:**\n`;
      session.poll.options.forEach((opt, i) => {
        const count = counts[i] || 0;
        const pct = total ? Math.round((count / total) * 100) : 0;
        statusText += `${opt.emoji ? `${opt.emoji} ` : ""}${opt.label}: ${count} (${pct}%)\n`;
      });
    }
  }

  if (session.mode === "giveaway") {
    statusText += `**Résztvevők:** ${session.giveaway.joinedUserIds.length}\n`;
    statusText += `**Nyertesek száma:** ${session.giveaway.winnersCount}\n`;
    statusText += `**Állapot:** ${session.giveaway.closed ? "lezárva" : "nyitott"}\n`;
    if (session.giveaway.winnerIds.length) {
      statusText += `**Nyertes(ek):** ${session.giveaway.winnerIds.map((id) => `<@${id}>`).join(", ")}\n`;
    }
  }

  const attachmentInfo = [];
  if (d.attachmentUrls.length) {
    attachmentInfo.push(
      d.attachmentUrls.slice(0, 4).map((u, i) => `[kép ${i + 1}](${u})`).join(" • ")
    );
  }
  if (d.videoUrls.length) {
    attachmentInfo.push(
      d.videoUrls.slice(0, 4).map((u, i) => `[videó ${i + 1}](${u})`).join(" • ")
    );
  }

  return new EmbedBuilder()
    .setColor(CONTROL_EMBED_COLOR)
    .setTitle("⚙️ Embed AI Studio")
    .setDescription(statusText)
    .addFields(
      {
        name: "Gyors tippek",
        value: truncate(
          [
            "`új embed`",
            "`töröld ki légyszíves`",
            "`csak az én szövegemet használd`",
            "`csinálj igen/nem szavazást`",
            "`csinálj nyereményjátékot 2 nyertessel`",
            "`küldd be ebbe a csatornába #csatorna`",
            "`sorsolj nyertest`",
            "`vond vissza`",
          ].join(" • "),
          1024
        ),
        inline: false,
      },
      {
        name: "Csatolmány állapot",
        value: attachmentInfo.length ? truncate(attachmentInfo.join("\n"), 1024) : "Nincs csatolt kép vagy videó",
        inline: false,
      }
    )
    .setFooter({ text: PREVIEW_FOOTER })
    .setTimestamp(new Date());
}

function buildPreviewPayload(session) {
  const embeds = [buildControlEmbed(session), buildMainEmbed(session)];
  const components = buildRowsFromButtons(session.draft.buttons);
  const contentLines = [];

  if (session.draft.content) {
    contentLines.push(truncate(session.draft.content, 2000));
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
    components,
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

/* =========================
   POLL / GIVEAWAY LOGIKA
========================= */

function rebuildPollButtons(session) {
  const poll = session.poll;
  const counts = countPollVotes(poll);
  const total = totalPollVotes(poll);

  session.draft.buttons = poll.options.slice(0, 5).map((opt, index) => {
    const count = counts[index] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    return {
      label: `${opt.label} • ${pct}%`,
      emoji: opt.emoji || undefined,
      style: ButtonStyle.Primary,
      customId: `embedai:poll:${index}`,
      disabled: !!poll.closed,
    };
  });

  const lines = [];
  if (poll.question) lines.push(`**${poll.question}**`);
  lines.push("");

  poll.options.forEach((opt, i) => {
    const count = counts[i] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    lines.push(`${opt.emoji ? `${opt.emoji} ` : ""}**${opt.label}** — ${count} szavazat • ${pct}%`);
    lines.push(makePercentBar(pct));
  });

  lines.push("");
  lines.push(`Összes szavazat: **${total}**`);
  if (poll.closed) lines.push("🔒 A szavazás le van zárva.");

  session.draft.description = lines.join("\n");
}

function rebuildGiveawayButtons(session) {
  const g = session.giveaway;
  const joined = g.joinedUserIds.length;

  session.draft.buttons = [
    {
      label: `Részt veszek • ${joined}`,
      emoji: "🎉",
      style: ButtonStyle.Success,
      customId: "embedai:giveaway:join",
      disabled: !!g.closed,
    },
  ];

  if (!g.closed) {
    session.draft.buttons.push({
      label: "Lezárás",
      emoji: "🔒",
      style: ButtonStyle.Danger,
      customId: "embedai:giveaway:close",
      disabled: false,
    });
  }

  if (g.closed && g.winnerIds.length) {
    session.draft.buttons.push({
      label: "Újrasorsolás",
      emoji: "🎲",
      style: ButtonStyle.Primary,
      customId: "embedai:giveaway:reroll",
      disabled: false,
    });
  }

  const lines = [];
  if (g.description) lines.push(g.description);
  lines.push("");
  lines.push(`🎉 Résztvevők száma: **${joined}**`);
  lines.push(`🏆 Nyertesek száma: **${g.winnersCount}**`);
  lines.push(`📌 Állapot: **${g.closed ? "Lezárva" : "Nyitva"}**`);

  if (g.winnerIds.length) {
    lines.push("");
    lines.push(`**Nyertes(ek):** ${g.winnerIds.map((id) => `<@${id}>`).join(", ")}`);
  }

  session.draft.description = lines.join("\n");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawGiveawayWinners(session) {
  const g = session.giveaway;
  const participants = shuffle(g.joinedUserIds);
  g.winnerIds = participants.slice(0, Math.max(1, g.winnersCount));
  g.closed = true;
  rebuildGiveawayButtons(session);
}

/* =========================
   SZÖVEG SEGÉD / EXACT MODE
========================= */

function preserveTextIfNeeded(session, originalText, generatedText) {
  if (session.exactTextMode) {
    return clean(originalText || generatedText || "");
  }
  return clean(generatedText || originalText || "");
}

/* =========================
   DETERMINISZTIKUS PARSER
========================= */

function fallbackInterpret(messageText, session, attachmentUrls) {
  const text = clean(messageText);
  const lower = text.toLowerCase();

  const ops = [];
  let reply = "Átnéztem és frissítettem az előnézetet.";

  if (!text) {
    if (attachmentUrls.length) {
      const firstImage = attachmentUrls.find((a) => a.isImage);
      const videos = attachmentUrls.filter((a) => a.isVideo);
      if (firstImage) ops.push({ type: "set_image", value: firstImage.url });
      if (videos.length) {
        for (const v of videos) ops.push({ type: "add_video", value: v.url });
      }
      reply = "Betöltöttem a csatolmányokat az előnézetbe.";
      return { ops, reply };
    }
    return { ops, reply: "Írj valamit, például: `a cím legyen...`, `csinálj pollt`, `küldd be #csatorna`." };
  }

  if (/(vond vissza|undo|visszaállítás|vissza egyet)/i.test(lower)) {
    return { ops: [{ type: "undo" }], reply: "Visszaállítottam az előző állapotot." };
  }

  if (/(töröld ki légyszíves|töröld ki|reset|kezdjük újra|új embed|uj embed|kezdjük elölről|kezdjuk elolrol)/i.test(lower)) {
    return { ops: [{ type: "clear", part: "all" }], reply: "Lenulláztam a projektet, indulhat az új embed." };
  }

  if (/(csak az én szövegemet használd|csak az en szovegemet hasznald|strict mode|exact text)/i.test(lower)) {
    return { ops: [{ type: "exact_mode", value: true }], reply: "Bekapcsoltam az exact text módot, nem fogom átírni a szövegedet." };
  }

  if (/(átírhatod|atirhatod|szépítsd|szepitsd|polish|fogalmazd át|fogalmazd at)/i.test(lower)) {
    return { ops: [{ type: "exact_mode", value: false }], reply: "Kikapcsoltam az exact text módot, finomíthatom a szöveget." };
  }

  const publishChannelId = extractChannelIdFromText(text);
  if (/(küldd be|kuldd be|küldheted|publish|send it)/i.test(lower) && publishChannelId) {
    return {
      ops: [{ type: "publish", channelId: publishChannelId }],
      reply: "Küldöm a végleges verziót a megadott csatornába.",
    };
  }

  if (/(sorsolj nyertest|sorsolás|sorsolas|draw winner|reroll)/i.test(lower)) {
    return { ops: [{ type: "giveaway_draw" }], reply: "Lefuttattam a sorsolást." };
  }

  if (/(zárd le a nyereményjátékot|zar le a nyeremenyjatekot|zárd le|zar le)/i.test(lower) && session.mode === "giveaway") {
    return { ops: [{ type: "giveaway_close" }], reply: "Lezártam a nyereményjátékot." };
  }

  if (/(igen\/nem szavazás|igen nem szavazas|igen nem poll|igen nem)/i.test(lower)) {
    return {
      ops: [{
        type: "create_poll",
        question: session.draft.title || "Szavazás",
        options: [
          { label: "Igen", emoji: "✅" },
          { label: "Nem", emoji: "❌" },
        ],
      }],
      reply: "Létrehoztam egy igen/nem szavazást.",
    };
  }

  if (/(nyereményjáték|nyeremenyjatek|giveaway)/i.test(lower)) {
    const numMatch = lower.match(/(\d+)\s*(nyertes|winner)/i);
    const winners = numMatch ? Math.max(1, Number(numMatch[1])) : 1;

    return {
      ops: [{
        type: "create_giveaway",
        title: session.draft.title || "Nyereményjáték",
        description: session.draft.description || "Kattints a gombra, és már részt is veszel.",
        winnersCount: winners,
      }],
      reply: `Létrehoztam a nyereményjátékot ${winners} nyertessel.`,
    };
  }

  if (/(töröld a gombokat|torold a gombokat|clear buttons)/i.test(lower)) {
    return { ops: [{ type: "clear", part: "buttons" }], reply: "Töröltem az összes gombot." };
  }
  if (/(töröld a mezőket|torold a mezoket|clear fields)/i.test(lower)) {
    return { ops: [{ type: "clear", part: "fields" }], reply: "Töröltem az összes mezőt." };
  }
  if (/(töröld a képet|torold a kepet)/i.test(lower)) {
    return { ops: [{ type: "clear", part: "image" }], reply: "Töröltem a fő képet." };
  }
  if (/(töröld a thumbnailt|torold a thumbnailt)/i.test(lower)) {
    return { ops: [{ type: "clear", part: "thumbnail" }], reply: "Töröltem a thumbnailt." };
  }
  if (/(töröld a footert|torold a footert)/i.test(lower)) {
    return { ops: [{ type: "clear", part: "footer" }], reply: "Töröltem a footert." };
  }

  const titleMatch =
    text.match(/(?:a\s+)?cím(?:e)?\s+(?:legyen|legyen ez|:)\s*(.+)$/i) ||
    text.match(/title\s*:\s*(.+)$/i);

  if (titleMatch) {
    return { ops: [{ type: "set_title", value: titleMatch[1].trim() }], reply: "Beállítottam a címet." };
  }

  const descMatch =
    text.match(/(?:a\s+)?leírás(?:a)?\s+(?:legyen|:)\s*([\s\S]+)$/i) ||
    text.match(/description\s*:\s*([\s\S]+)$/i);

  if (descMatch) {
    return { ops: [{ type: "set_description", value: descMatch[1].trim() }], reply: "Beállítottam a leírást." };
  }

  const footerMatch =
    text.match(/footer\s*:\s*(.+)$/i) ||
    text.match(/(?:a\s+)?footer(?:e)?\s+(?:legyen|:)\s*(.+)$/i);

  if (footerMatch) {
    return { ops: [{ type: "set_footer", value: footerMatch[1].trim() }], reply: "Beállítottam a footert." };
  }

  const authorMatch =
    text.match(/author\s*:\s*(.+)$/i) ||
    text.match(/(?:az\s+)?author(?:e)?\s+(?:legyen|:)\s*(.+)$/i);

  if (authorMatch) {
    return { ops: [{ type: "set_author", value: authorMatch[1].trim() }], reply: "Beállítottam az authort." };
  }

  const colorMatch =
    text.match(/(?:szín|szin|color)\s+(?:legyen|:)?\s*(#[0-9a-fA-F]{6}|[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]+)$/i);

  if (colorMatch) {
    return { ops: [{ type: "set_color", value: colorMatch[1].trim() }], reply: "Átállítottam a színt." };
  }

  if (/(timestamp be|időbélyeg be|idobelyeg be|legyen időpont|legyen timestamp)/i.test(lower)) {
    return { ops: [{ type: "set_timestamp", value: true }], reply: "Bekapcsoltam a timestampet." };
  }
  if (/(timestamp ki|időbélyeg ki|idobelyeg ki|ne legyen időpont|ne legyen timestamp)/i.test(lower)) {
    return { ops: [{ type: "set_timestamp", value: false }], reply: "Kikapcsoltam a timestampet." };
  }

  const fieldQuoted = text.match(/(?:adj hozzá|adj hozza|tegyél bele|tegyel bele)\s+(?:egy\s+)?mezőt?\s+(.+?)\s*\|\s*([\s\S]+)$/i);
  if (fieldQuoted) {
    return {
      ops: [{
        type: "add_field",
        name: fieldQuoted[1].trim(),
        value: fieldQuoted[2].trim(),
        inline: false,
      }],
      reply: "Hozzáadtam a mezőt.",
    };
  }

  const removeFieldMatch = lower.match(/(?:töröld|torold)\s+(?:a\s+)?(\d+)\.?\s*mezőt?/i);
  if (removeFieldMatch) {
    return {
      ops: [{ type: "remove_field", index: Math.max(0, Number(removeFieldMatch[1]) - 1) }],
      reply: "Töröltem a kért mezőt.",
    };
  }

  if (/thumbnail/i.test(text)) {
    const url = extractFirstUrl(text) || attachmentUrls.find((a) => a.isImage)?.url;
    if (url) return { ops: [{ type: "set_thumbnail", value: url }], reply: "Beállítottam a thumbnailt." };
  }

  if (/(fő kép|fo kep|main image|borítókép|boritokep|image)/i.test(lower)) {
    const url = extractFirstUrl(text) || attachmentUrls.find((a) => a.isImage)?.url;
    if (url) return { ops: [{ type: "set_image", value: url }], reply: "Beállítottam a fő képet." };
  }

  if (attachmentUrls.length) {
    const firstImage = attachmentUrls.find((a) => a.isImage);
    const videos = attachmentUrls.filter((a) => a.isVideo);
    const imageOps = [];

    if (firstImage) {
      if (/thumbnail/i.test(lower)) imageOps.push({ type: "set_thumbnail", value: firstImage.url });
      else imageOps.push({ type: "set_image", value: firstImage.url });
    }
    for (const v of videos) imageOps.push({ type: "add_video", value: v.url });

    if (imageOps.length) {
      return {
        ops: imageOps,
        reply: "Feldolgoztam a csatolmányokat az előnézethez.",
      };
    }
  }

  const buttonLabelQuoted = extractQuoted(text);
  if (/(gomb|button)/i.test(lower) && buttonLabelQuoted) {
    const style =
      /(piros|nem)/i.test(lower) ? ButtonStyle.Danger :
      /(zöld|zold|igen)/i.test(lower) ? ButtonStyle.Success :
      /(szürke|szurke)/i.test(lower) ? ButtonStyle.Secondary :
      ButtonStyle.Primary;

    const emoji = [...text.matchAll(/(<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu)].map((m) => m[0])[0] || null;
    const link = /(link|url)/i.test(lower) ? extractFirstUrl(text) : null;

    return {
      ops: [{
        type: "add_button",
        label: buttonLabelQuoted,
        style: link ? ButtonStyle.Link : style,
        emoji,
        url: link,
      }],
      reply: "Hozzáadtam a gombot.",
    };
  }

  // Ha az egész szöveg hosszabb és nincs konkrét parancs, akkor description legyen.
  if (text.length > 15) {
    return {
      ops: [{ type: "set_description", value: preserveTextIfNeeded(session, text, text) }],
      reply: session.exactTextMode
        ? "A saját szövegeddel frissítettem a leírást."
        : "Frissítettem a leírást.",
    };
  }

  return { ops, reply };
}

/* =========================
   OPENAI ÉRTELMEZÉS
========================= */

async function interpretWithOpenAI(messageText, session, attachmentUrls) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const system = `
Te egy Discord embed builder AI vagy.
Feladatod: a felhasználó üzenetéből egy SZIGORÚ JSON választ adj vissza, semmi mást.
A válasz formátuma:
{
  "reply": "rövid magyar válasz",
  "ops": [
    { "type": "set_title", "value": "..." },
    { "type": "set_description", "value": "..." },
    { "type": "append_description", "value": "..." },
    { "type": "set_color", "value": "#2ecc71 vagy színnév" },
    { "type": "set_footer", "value": "..." },
    { "type": "set_author", "value": "..." },
    { "type": "set_thumbnail", "value": "url" },
    { "type": "set_image", "value": "url" },
    { "type": "set_timestamp", "value": true/false },
    { "type": "add_field", "name": "...", "value": "...", "inline": false },
    { "type": "remove_field", "index": 0 },
    { "type": "clear", "part": "all|title|description|fields|buttons|image|thumbnail|footer|author|attachments" },
    { "type": "add_button", "label": "...", "style": "primary|secondary|success|danger|link", "emoji": "✅", "url": "https://..." },
    { "type": "remove_button", "index": 0 },
    { "type": "create_poll", "question": "...", "options": [{"label":"Igen","emoji":"✅"},{"label":"Nem","emoji":"❌"}] },
    { "type": "create_giveaway", "title": "...", "description": "...", "winnersCount": 1 },
    { "type": "giveaway_close" },
    { "type": "giveaway_draw" },
    { "type": "exact_mode", "value": true/false },
    { "type": "publish", "channelId": "123" },
    { "type": "add_video", "value": "url" },
    { "type": "undo" }
  ]
}
SZABÁLYOK:
- Csak JSON.
- Magyar reply.
- Ne találj ki csatorna ID-t, csak ha a user említett channel mentiont.
- Ha a user azt kéri, hogy mindenképp az ő szövege maradjon, exact_mode = true.
- Ha pollt kér, create_poll.
- Ha giveaway-t kér, create_giveaway.
- Ha gombot kér linkkel, add_button + style=link.
- Ha nem egyértelmű, próbálj kevés, biztonságos módosítást javasolni.
`;

  const userPayload = {
    user_message: messageText,
    session_summary: {
      mode: session.mode,
      exactTextMode: session.exactTextMode,
      title: session.draft.title,
      description: session.draft.description,
      fields: session.draft.fields.length,
      buttons: session.draft.buttons.map((b) => ({
        label: b.label,
        style: typeof b.style === "number" ? styleName(b.style) : b.style,
      })),
      poll: session.poll,
      giveaway: {
        ...session.giveaway,
        joinedCount: session.giveaway.joinedUserIds.length,
      },
      attachments: attachmentUrls,
    },
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
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(userPayload) }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "embed_builder_ops",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
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
                    name: { type: "string" },
                    index: { type: "number" },
                    inline: { type: "boolean" },
                    label: { type: "string" },
                    style: { type: "string" },
                    emoji: { type: "string" },
                    url: { type: "string" },
                    question: { type: "string" },
                    options: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          label: { type: "string" },
                          emoji: { type: "string" },
                        },
                        required: ["label"],
                      },
                    },
                    title: { type: "string" },
                    description: { type: "string" },
                    winnersCount: { type: "number" },
                    channelId: { type: "string" },
                  },
                  required: ["type"],
                },
              },
            },
            required: ["reply", "ops"],
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
    throw new Error("Az AI válasza nem volt értelmezhető JSON.");
  }

  return parsed;
}

/* =========================
   MŰVELET VÉGREHAJTÁS
========================= */

function coerceButtonStyle(style) {
  if (typeof style === "number") return style;
  const s = String(style || "").toLowerCase().trim();
  switch (s) {
    case "secondary": return ButtonStyle.Secondary;
    case "success": return ButtonStyle.Success;
    case "danger": return ButtonStyle.Danger;
    case "link": return ButtonStyle.Link;
    default: return ButtonStyle.Primary;
  }
}

function generateCustomId() {
  return `embedai:custom:${Math.random().toString(36).slice(2, 10)}`;
}

async function applyOps({ client, channel, session, ops }) {
  for (const op of ops) {
    switch (op.type) {
      case "undo": {
        restoreLast(session);
        break;
      }

      case "exact_mode": {
        session.exactTextMode = !!op.value;
        break;
      }

      case "clear": {
        pushHistory(session);
        clearPart(session, op.part || "all");
        break;
      }

      case "set_title": {
        pushHistory(session);
        session.draft.title = clean(op.value);
        break;
      }

      case "set_description": {
        pushHistory(session);
        session.draft.description = clean(op.value);
        break;
      }

      case "append_description": {
        pushHistory(session);
        session.draft.description = clean(
          [session.draft.description, clean(op.value)].filter(Boolean).join("\n")
        );
        break;
      }

      case "set_color": {
        pushHistory(session);
        const c = normalizeColor(op.value);
        if (c != null) session.draft.color = c;
        break;
      }

      case "set_footer": {
        pushHistory(session);
        session.draft.footer = clean(op.value);
        break;
      }

      case "set_author": {
        pushHistory(session);
        session.draft.author = clean(op.value);
        break;
      }

      case "set_thumbnail": {
        pushHistory(session);
        session.draft.thumbnailURL = clean(op.value);
        break;
      }

      case "set_image": {
        pushHistory(session);
        session.draft.imageURL = clean(op.value);
        break;
      }

      case "set_timestamp": {
        pushHistory(session);
        session.draft.timestamp = !!op.value;
        break;
      }

      case "add_field": {
        pushHistory(session);
        if (session.draft.fields.length < MAX_FIELDS) {
          session.draft.fields.push({
            name: clean(op.name || "Mező"),
            value: clean(op.value || "-"),
            inline: !!op.inline,
          });
        }
        break;
      }

      case "remove_field": {
        pushHistory(session);
        const idx = Number(op.index);
        if (!Number.isNaN(idx) && idx >= 0 && idx < session.draft.fields.length) {
          session.draft.fields.splice(idx, 1);
        }
        break;
      }

      case "add_button": {
        pushHistory(session);
        if (session.draft.buttons.length < MAX_BUTTONS) {
          const style = coerceButtonStyle(op.style);
          session.draft.buttons.push({
            label: clean(op.label || "Gomb"),
            emoji: clean(op.emoji || "") || undefined,
            style,
            url: style === ButtonStyle.Link ? clean(op.url || "") : undefined,
            customId: style === ButtonStyle.Link ? undefined : generateCustomId(),
            disabled: false,
          });
        }
        break;
      }

      case "remove_button": {
        pushHistory(session);
        const idx = Number(op.index);
        if (!Number.isNaN(idx) && idx >= 0 && idx < session.draft.buttons.length) {
          session.draft.buttons.splice(idx, 1);
        }
        break;
      }

      case "create_poll": {
        pushHistory(session);
        session.mode = "poll";
        session.poll = {
          question: clean(op.question || session.draft.title || "Szavazás"),
          options: Array.isArray(op.options) && op.options.length
            ? op.options.slice(0, 5).map((o) => ({
                label: clean(o.label || "Opció"),
                emoji: clean(o.emoji || "") || undefined,
              }))
            : [
                { label: "Igen", emoji: "✅" },
                { label: "Nem", emoji: "❌" },
              ],
          votes: {},
          closed: false,
        };
        session.draft.title = session.poll.question;
        rebuildPollButtons(session);
        break;
      }

      case "create_giveaway": {
        pushHistory(session);
        session.mode = "giveaway";
        session.giveaway = {
          title: clean(op.title || session.draft.title || "Nyereményjáték"),
          description: clean(op.description || session.draft.description || "Kattints a gombra a részvételhez."),
          winnersCount: Math.max(1, Number(op.winnersCount || 1)),
          joinedUserIds: [],
          closed: false,
          winnerIds: [],
        };
        session.draft.title = session.giveaway.title;
        rebuildGiveawayButtons(session);
        break;
      }

      case "giveaway_close": {
        if (session.mode === "giveaway") {
          pushHistory(session);
          session.giveaway.closed = true;
          rebuildGiveawayButtons(session);
        }
        break;
      }

      case "giveaway_draw": {
        if (session.mode === "giveaway") {
          pushHistory(session);
          drawGiveawayWinners(session);
        }
        break;
      }

      case "publish": {
        await publishToChannel(client, channel, session, op.channelId);
        break;
      }

      case "add_video": {
        pushHistory(session);
        const url = clean(op.value);
        if (url && !session.draft.videoUrls.includes(url)) {
          session.draft.videoUrls.push(url);
        }
        break;
      }

      default:
        break;
    }
  }

  if (session.mode === "poll") rebuildPollButtons(session);
  if (session.mode === "giveaway") rebuildGiveawayButtons(session);
}

async function publishToChannel(client, builderChannel, session, targetChannelId) {
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

  const payload = buildPreviewPayload(session);
  payload.embeds = [buildMainEmbed(session)];
  await target.send(payload);
}

/* =========================
   AI / FALLBACK KEZELŐ
========================= */

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
  const attachmentUrls = pickAttachmentUrls(message);

  try {
    let parsed = null;

    try {
      parsed = await interpretWithOpenAI(message.content, session, attachmentUrls);
    } catch (e) {
      parsed = null;
    }

    if (!parsed) {
      parsed = fallbackInterpret(message.content, session, attachmentUrls);
    }

    await applyOps({
      client,
      channel: message.channel,
      session,
      ops: Array.isArray(parsed.ops) ? parsed.ops : [],
    });

    await refreshPreview(message.channel, getSession(message.channel.id));

    if (parsed.reply) {
      await message.reply({
        content: parsed.reply,
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }
  } catch (error) {
    await message.reply({
      content: `❌ Hiba történt: ${error.message || "ismeretlen hiba"}`,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
}

/* =========================
   INTERAKCIÓK
========================= */

async function handlePollVote(interaction) {
  const session = getSession(interaction.channel.id);
  if (session.mode !== "poll") {
    await interaction.reply({ content: "Ez a szavazás már nem aktív.", ephemeral: true }).catch(() => null);
    return;
  }

  if (session.poll.closed) {
    await interaction.reply({ content: "A szavazás le van zárva.", ephemeral: true }).catch(() => null);
    return;
  }

  const idx = Number(interaction.customId.split(":")[2]);
  if (Number.isNaN(idx) || idx < 0 || idx >= session.poll.options.length) {
    await interaction.reply({ content: "Érvénytelen opció.", ephemeral: true }).catch(() => null);
    return;
  }

  pushHistory(session);
  session.poll.votes[interaction.user.id] = idx;
  rebuildPollButtons(session);
  await refreshPreview(interaction.channel, session);

  await interaction.reply({
    content: `✅ A szavazatod mentve lett: **${session.poll.options[idx].label}**`,
    ephemeral: true,
  }).catch(() => null);
}

async function handleGiveawayJoin(interaction) {
  const session = getSession(interaction.channel.id);
  if (session.mode !== "giveaway") {
    await interaction.reply({ content: "Ez a nyereményjáték már nem aktív.", ephemeral: true }).catch(() => null);
    return;
  }

  if (session.giveaway.closed) {
    await interaction.reply({ content: "A nyereményjáték le van zárva.", ephemeral: true }).catch(() => null);
    return;
  }

  pushHistory(session);
  const arr = session.giveaway.joinedUserIds;
  const idx = arr.indexOf(interaction.user.id);

  if (idx === -1) {
    arr.push(interaction.user.id);
    rebuildGiveawayButtons(session);
    await refreshPreview(interaction.channel, session);
    await interaction.reply({
      content: "🎉 Részt veszel a nyereményjátékban.",
      ephemeral: true,
    }).catch(() => null);
  } else {
    arr.splice(idx, 1);
    rebuildGiveawayButtons(session);
    await refreshPreview(interaction.channel, session);
    await interaction.reply({
      content: "Kiléptél a nyereményjátékból.",
      ephemeral: true,
    }).catch(() => null);
  }
}

async function handleGiveawayClose(interaction) {
  const session = getSession(interaction.channel.id);
  if (session.mode !== "giveaway") {
    await interaction.reply({ content: "Nincs aktív nyereményjáték.", ephemeral: true }).catch(() => null);
    return;
  }

  pushHistory(session);
  session.giveaway.closed = true;
  rebuildGiveawayButtons(session);
  await refreshPreview(interaction.channel, session);
  await interaction.reply({
    content: "🔒 Lezártam a nyereményjátékot.",
    ephemeral: true,
  }).catch(() => null);
}

async function handleGiveawayReroll(interaction) {
  const session = getSession(interaction.channel.id);
  if (session.mode !== "giveaway") {
    await interaction.reply({ content: "Nincs aktív nyereményjáték.", ephemeral: true }).catch(() => null);
    return;
  }

  pushHistory(session);
  drawGiveawayWinners(session);
  await refreshPreview(interaction.channel, session);
  await interaction.reply({
    content: session.giveaway.winnerIds.length
      ? `🎲 Újrasorsoltam: ${session.giveaway.winnerIds.map((id) => `<@${id}>`).join(", ")}`
      : "Nincs elég résztvevő a sorsoláshoz.",
    ephemeral: true,
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

/* =========================
   REGISZTRÁLÁS
========================= */

function registerEmbedAi(client) {
  if (listenersRegistered) return;
  listenersRegistered = true;

  client.on("messageCreate", async (message) => {
    await handleUserMessage(client, message);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (!interaction.channel || interaction.channel.id !== EMBED_AI_CHANNEL_ID) return;
      if (!interaction.customId.startsWith("embedai:")) return;

      if (interaction.customId.startsWith("embedai:poll:")) {
        await handlePollVote(interaction);
        return;
      }

      if (interaction.customId === "embedai:giveaway:join") {
        await handleGiveawayJoin(interaction);
        return;
      }

      if (interaction.customId === "embedai:giveaway:close") {
        await handleGiveawayClose(interaction);
        return;
      }

      if (interaction.customId === "embedai:giveaway:reroll") {
        await handleGiveawayReroll(interaction);
        return;
      }

      if (interaction.customId.startsWith("embedai:custom:")) {
        await interaction.reply({
          content: "Ez egy egyedi gomb. Ha akarod, a következő körben ráépítek külön logikát is.",
          ephemeral: true,
        }).catch(() => null);
        return;
      }
    } catch (error) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ Hiba történt: ${error.message || "ismeretlen hiba"}`,
          ephemeral: true,
        }).catch(() => null);
      }
    }
  });

  client.once("ready", async () => {
    const channel = await client.channels.fetch(EMBED_AI_CHANNEL_ID).catch(() => null);
    if (!channel || typeof channel.send !== "function") {
      console.log("⚠️ [EMBED AI] A fix csatorna nem található vagy nem szöveges.");
      return;
    }

    const session = getSession(channel.id);
    await refreshPreview(channel, session).catch((e) => {
      console.log("⚠️ [EMBED AI] Előnézet inicializálási hiba:", e.message);
    });

    console.log("✅ [EMBED AI] Beszélgetés alapú embed builder aktív.");
  });
}

module.exports = {
  registerEmbedAi,
};