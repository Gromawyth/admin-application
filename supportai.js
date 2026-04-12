"use strict";

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================================================
   KONFIG
========================================================= */

const CONFIG = {
  AI_MODEL: process.env.OPENAI_MODEL || "gpt-5-mini",

  SERVER_NAME: "internalGaming",

  /*
    Azok a csatornák, ahol működjön.
    Ha üres, akkor a kategóriák alapján működik.
  */
  SUPPORT_CHANNEL_IDS: [
     "1492932668495499304"
  ],

  /*
    Ticket / support kategóriák.
  */
  SUPPORT_CATEGORY_IDS: [
    // "123456789012345678"
  ],

  /*
    Ha valamit nem tud, ezt a role-t pingeli.
  */
  SUPPORT_ROLE_ID: "1403401954712883200",

  /*
    Staff szerepek.
    Ha staff ír, az AI háttérbe húzódik.
  */
  STAFF_ROLE_IDS: [
    // "123456789012345678"
  ],

  /*
    Olyan csatornák / kategóriák, ahol ne működjön.
  */
  EXEMPT_CHANNEL_IDS: [],
  EXEMPT_CATEGORY_IDS: [],

  /*
    Memória / kontextus.
  */
  MAX_CONTEXT_MESSAGES: 14,
  MAX_RECENT_FAQ_ENTRIES: 100,
  FAQ_CACHE_TTL_MS: 2 * 60 * 60 * 1000,

  /*
    Anti-spam / kontroll.
  */
  ESCALATION_COOLDOWN_MS: 45_000,
  GREETING_COOLDOWN_MS: 45_000,
  MIN_REAL_QUESTION_LENGTH: 6,
  MAX_REPLY_CHARS: 1600,

  /*
    Ha staff üzent a csatornában, ennyi ideig az AI hallgat.
  */
  STAFF_TAKEOVER_WINDOW_MS: 5 * 60 * 1000,

  /*
    Rövid köszönésekre válaszoljon-e.
  */
  REPLY_TO_GREETINGS: true,

  /*
    Köszire / bye-ra általában ne válaszoljon.
  */
  IGNORE_THANKS: false,

  /*
    Ha nincs OpenAI, legyen fallback.
  */
  ENABLE_FALLBACK: true,

  /*
    Részletes szabályzatfájlok.
  */
  RULE_FILES: [
    "./Szerverszabályzat v2 (1).txt",
    "./serverRules.txt",
    "./szerverszabalyzat.txt",
    "./rules.txt",
  ],
};

/* =========================================================
   DISCORD SZABÁLYZAT
========================================================= */

const DISCORD_RULES_TEXT = `
Discord szabályzat:

1. Általános magatartás
- Tiszteld a többi játékost.
- Tilos a sértegetés, fenyegetés, zaklatás, rasszizmus vagy szexizmus.
- Kulturált kommunikáció elvárt minden csatornán.
- A veszekedés és provokáció szigorúan tiltott.

2. Spam és flood
- Tilos az indokolatlan emoji- vagy GIF-spamelés.
- Ugyanazon üzenet ismételt küldése nem megengedett.

3. Név és profil
- A név nem lehet sértő, obszcén vagy megtévesztő.
- A profilkép nem tartalmazhat NSFW vagy erőszakos tartalmat.

4. Csatornák használata
- Minden csatornát rendeltetésszerűen használj.
- A ticket rendszert csak valós problémák esetén vedd igénybe.

5. Hirdetés és reklám
- Más szerverek, oldalak és Discord linkek reklámozása tilos.
- Ez DM-re is vonatkozik.

6. Hangcsatornák
- Zajkeltés, soundboard túlzásba vitele tilos.
- Ne zavard a többi játékos nyugalmát.

7. NSFW tartalom
- NSFW tartalom megosztása szigorúan tilos.

Büntetések:
- Figyelmeztetés, mute, kick vagy ban a súlyosságtól függően.
`;

/* =========================================================
   ÁLLAPOT
========================================================= */

let listenersRegistered = false;

const state = {
  channelStates: new Map(),
  faqCache: new Map(),
};

/* =========================================================
   SEGÉDEK
========================================================= */

function now() {
  return Date.now();
}

function cleanText(text, max = 1800) {
  const safe = String(text || "").replace(/\s+/g, " ").trim();
  if (!safe) return "";
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function truncate(text, max = CONFIG.MAX_REPLY_CHARS) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function lower(text) {
  return cleanText(text).toLowerCase();
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return "{}";
  }
  return raw.slice(firstBrace, lastBrace + 1);
}

function normalizeForCache(text) {
  return lower(text)
    .replace(/[?!.,:;()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadRuleText() {
  for (const filePath of CONFIG.RULE_FILES) {
    try {
      const abs = path.resolve(process.cwd(), filePath);
      if (fs.existsSync(abs)) {
        return fs.readFileSync(abs, "utf8");
      }
    } catch {
      // ignore
    }
  }
  return "";
}

function buildKnowledgeBase() {
  const detailedRules = loadRuleText();

  return [
    `Szerver neve: ${CONFIG.SERVER_NAME}`,
    "",
    "DISCORD SZABÁLYZAT:",
    DISCORD_RULES_TEXT,
    "",
    detailedRules
      ? `RÉSZLETES SZERVER SZABÁLYZAT:\n${detailedRules}`
      : "RÉSZLETES SZERVER SZABÁLYZAT: nincs külön fájl betöltve.",
    "",
    "VÁLASZADÁSI ELVEK:",
    "- Csak arra válaszolj biztosan, amit a szabályzat tényleg lefed.",
    "- Ha nem egyértelmű, ne találj ki semmit.",
    "- Ha egyedi staff döntés kell, inkább add át embernek.",
    "- Röviden, emberien, felesleges rizsa nélkül írj.",
    "- Ha a user csak beszélgetést kezdeményez, legyél normális, de tömör.",
  ].join("\n");
}

function getChannelState(channelId) {
  if (!state.channelStates.has(channelId)) {
    state.channelStates.set(channelId, {
      recentMessages: [],
      lastEscalationAt: 0,
      lastGreetingAtByUser: new Map(),
      lastStaffMessageAt: 0,
      lastAiReplyAt: 0,
    });
  }
  return state.channelStates.get(channelId);
}

function pushRecentMessage(channelId, role, text, meta = {}) {
  const st = getChannelState(channelId);
  st.recentMessages.push({
    role,
    text: truncate(cleanText(text), 900),
    at: new Date().toISOString(),
    ...meta,
  });

  if (st.recentMessages.length > CONFIG.MAX_CONTEXT_MESSAGES) {
    st.recentMessages.shift();
  }
}

function isSupportChannel(channel) {
  if (!channel) return false;

  if (CONFIG.EXEMPT_CHANNEL_IDS.includes(channel.id)) return false;
  if (channel.parentId && CONFIG.EXEMPT_CATEGORY_IDS.includes(channel.parentId)) return false;

  if (CONFIG.SUPPORT_CHANNEL_IDS.length && CONFIG.SUPPORT_CHANNEL_IDS.includes(channel.id)) {
    return true;
  }

  if (
    CONFIG.SUPPORT_CATEGORY_IDS.length &&
    channel.parentId &&
    CONFIG.SUPPORT_CATEGORY_IDS.includes(channel.parentId)
  ) {
    return true;
  }

  return false;
}

function hasStaffRole(member) {
  if (!member?.roles?.cache) return false;
  if (!CONFIG.STAFF_ROLE_IDS.length) return false;
  return CONFIG.STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function wasStaffTakeoverRecent(channelId) {
  const st = getChannelState(channelId);
  return now() - Number(st.lastStaffMessageAt || 0) < CONFIG.STAFF_TAKEOVER_WINDOW_MS;
}

function markStaffActivity(channelId) {
  const st = getChannelState(channelId);
  st.lastStaffMessageAt = now();
}

function markAiReply(channelId) {
  const st = getChannelState(channelId);
  st.lastAiReplyAt = now();
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/\S+/gi)].map((m) => m[0]);
}

function looksLikeGreeting(text) {
  const t = lower(text);
  return /^(szia+|sziasztok|hello|helló|helo|hali|szevasz|jó reggelt|jo reggelt|jó estét|jo estet|jónapot|yo|hey)\s*!*$/i.test(t);
}

function looksLikeThanks(text) {
  const t = lower(text);
  return /^(köszi|koszi|köszönöm|koszonom|thx|thanks|nagyon köszi|oké köszi|oke koszi)\s*!*$/i.test(t);
}

function looksLikeBye(text) {
  const t = lower(text);
  return /^(viszlát|viszlat|bye|csá|csa|na csá|na csa)\s*!*$/i.test(t);
}

function looksLikeNonsense(text) {
  const t = lower(text);

  if (!t) return true;

  const exact = new Set([
    "xd", "xddd", "lol", "teszt", "test", "alma", "aaa", "aaaa", "asd", "ok",
    "oke", "oké", "aha", "ja", "hm", "bruh", "na", "hehe", "yo"
  ]);

  if (exact.has(t)) return true;
  if (t.length < 3) return true;
  if (/^(asd+|qwe+|123+|aaa+|bbb+|hehe+|xd+)$/i.test(t)) return true;

  return false;
}

function looksAbusive(text) {
  const t = lower(text);
  return /(kurva|fasz|geci|szar|retard|idióta|idiota|hülye|hulye|bazd|anyád|anyad|szopj|dögölj|dogolj|bohóc|bohoc)/i.test(t);
}

function looksLikeRealQuestion(text) {
  const raw = cleanText(text);
  const t = lower(text);

  if (!raw) return false;
  if (raw.length < CONFIG.MIN_REAL_QUESTION_LENGTH) return false;
  if (looksLikeNonsense(raw)) return false;

  if (raw.includes("?")) return true;

  const starters = [
    "mi ",
    "mit ",
    "hogyan",
    "hogy ",
    "mikor",
    "mennyi",
    "miért",
    "miert",
    "lehet ",
    "szabad ",
    "tudok ",
    "tudom ",
    "nem tudom",
    "segíts",
    "segits",
    "segítesz",
    "segitesz",
    "hol ",
    "van-e",
    "jár-e",
    "tilos",
    "szabály",
    "szabaly",
  ];

  if (starters.some((s) => t.startsWith(s))) return true;

  const supportKeywords = [
    "ticket",
    "szabály",
    "szabaly",
    "ban",
    "mute",
    "warn",
    "reklám",
    "reklam",
    "discord link",
    "nsfw",
    "hangcsatorna",
    "profilkép",
    "profilkep",
    "név",
    "nev",
    "admin",
    "report",
    "hirdetés",
    "hirdetes",
    "farm",
    "rablás",
    "rablas",
    "mg",
    "dm",
    "rk",
    "fearrp",
    "character kill",
    "ck",
    "metagaming",
    "powergaming",
    "frakció",
    "frakcio",
    "dark web",
    "fegyver",
    "helikopter",
    "pit",
    "bodycam",
    "cctv",
    "dashcam",
    "rendszám",
    "rendszam",
    "járműlopás",
    "jarmulopas",
    "hirdetésből",
    "hirdetesbol",
    "emberrablás",
    "emberrablas",
  ];

  return supportKeywords.some((k) => t.includes(k));
}

function getGreetingReply() {
  const replies = [
    "Szia, miben tudok segíteni?",
    "Szia. Írd le röviden, mi a kérdés.",
    "Szia, mondd nyugodtan miben kell segítség.",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function getFaqCacheKey(text) {
  return normalizeForCache(text);
}

function getCachedFaqAnswer(text) {
  const key = getFaqCacheKey(text);
  const item = state.faqCache.get(key);
  if (!item) return null;

  if (now() - item.createdAt > CONFIG.FAQ_CACHE_TTL_MS) {
    state.faqCache.delete(key);
    return null;
  }

  return item;
}

function setCachedFaqAnswer(text, value) {
  const key = getFaqCacheKey(text);

  if (state.faqCache.size >= CONFIG.MAX_RECENT_FAQ_ENTRIES) {
    const oldestKey = state.faqCache.keys().next().value;
    if (oldestKey) state.faqCache.delete(oldestKey);
  }

  state.faqCache.set(key, {
    ...value,
    createdAt: now(),
  });
}

/* =========================================================
   OPENAI DÖNTÉS
========================================================= */

function normalizeAiDecision(parsed) {
  const action = ["answer", "escalate", "ignore", "greet"].includes(parsed?.action)
    ? parsed.action
    : "ignore";

  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed?.confidence || 0))));

  return {
    action,
    confidence,
    reply: cleanText(parsed?.reply || "", CONFIG.MAX_REPLY_CHARS),
    reason: cleanText(parsed?.reason || "", 400),
    should_ping_role: Boolean(parsed?.should_ping_role),
    faq_worthy: Boolean(parsed?.faq_worthy),
  };
}

async function classifyAndAnswerWithAI({ messageText, knowledgeBase, recentMessages }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const system = `
Te egy Discordos ügyfélszolgálatos AI vagy.

Feladat:
- normálisan tudsz beszélni
- ha a user köszön, emberien köszönj vissza
- ha a user valódi kérdést tesz fel, röviden válaszolj
- ha a user hülyeséget, trollkodást, sértegetést vagy üres spamet ír, ne kezeld valódi kérdésként
- ne fecsegj
- ne legyél diplomatikus
- ne találj ki semmit
- csak a megadott szabályzatból és biztos tudásból válaszolj
- ha a kérdés egyedi staff döntést igényel vagy nem vagy biztos, akkor eszkalálj
- ha staff már jelen van és láthatóan átvette az ügyet, akkor inkább ne okoskodj

Kimenet: csak JSON

Formátum:
{
  "action": "answer|escalate|ignore|greet",
  "confidence": 0,
  "reply": "rövid magyar szöveg",
  "reason": "rövid belső ok",
  "should_ping_role": true,
  "faq_worthy": false
}

Szabályok:
- "szia" és hasonlók => greet
- köszönetre általában ignore
- troll / sértő / értelmetlen / spam jelleg => ignore
- szabályból egyértelmű kérdés => answer
- bizonytalan vagy staff döntéses kérdés => escalate
- a válasz legyen rövid, emberi, nem modoros
- ha nem vagy biztos, ne kamuzz
`;

  const inputPayload = {
    user_message: messageText,
    recent_messages: recentMessages.slice(-10),
    knowledge_base: knowledgeBase,
  };

  const response = await openai.responses.create({
    model: CONFIG.AI_MODEL,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(inputPayload) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "support_ai_v3_decision",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string" },
            confidence: { type: "number" },
            reply: { type: "string" },
            reason: { type: "string" },
            should_ping_role: { type: "boolean" },
            faq_worthy: { type: "boolean" },
          },
          required: ["action", "confidence", "reply", "reason", "should_ping_role", "faq_worthy"],
        },
      },
    },
  });

  const outputText = response.output_text || "{}";
  const parsed = safeJsonParse(extractJson(outputText), {});
  return normalizeAiDecision(parsed);
}

/* =========================================================
   FALLBACK DÖNTÉS
========================================================= */

function fallbackDecision(messageText) {
  const text = cleanText(messageText);

  if (looksLikeGreeting(text)) {
    return {
      action: "greet",
      confidence: 95,
      reply: getGreetingReply(),
      reason: "simple_greeting",
      should_ping_role: false,
      faq_worthy: false,
    };
  }

  if (looksLikeThanks(text) || looksLikeBye(text)) {
    return {
      action: "ignore",
      confidence: 95,
      reply: "",
      reason: "short_non_support_message",
      should_ping_role: false,
      faq_worthy: false,
    };
  }

  if (looksAbusive(text)) {
    return {
      action: "ignore",
      confidence: 96,
      reply: "",
      reason: "abusive_or_troll",
      should_ping_role: false,
      faq_worthy: false,
    };
  }

  if (looksLikeNonsense(text)) {
    return {
      action: "ignore",
      confidence: 94,
      reply: "",
      reason: "nonsense",
      should_ping_role: false,
      faq_worthy: false,
    };
  }

  if (looksLikeRealQuestion(text)) {
    return {
      action: "escalate",
      confidence: 55,
      reply: "Erre inkább ránéz valaki a csapatból.",
      reason: "real_question_but_no_ai_answer",
      should_ping_role: true,
      faq_worthy: false,
    };
  }

  return {
    action: "ignore",
    confidence: 70,
    reply: "",
    reason: "not_clear_enough",
    should_ping_role: false,
    faq_worthy: false,
  };
}

/* =========================================================
   VÁLASZLOGIKA
========================================================= */

function shouldReplyToGreeting(channelId, userId) {
  const st = getChannelState(channelId);
  const last = st.lastGreetingAtByUser.get(userId) || 0;

  if (now() - last < CONFIG.GREETING_COOLDOWN_MS) {
    return false;
  }

  st.lastGreetingAtByUser.set(userId, now());
  return true;
}

async function sendNormalReply(message, content) {
  if (!content) return;

  await message.reply({
    content: truncate(content, CONFIG.MAX_REPLY_CHARS),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function sendEscalationReply(message, baseReply, shouldPingRole) {
  const st = getChannelState(message.channel.id);

  if (now() - st.lastEscalationAt < CONFIG.ESCALATION_COOLDOWN_MS) {
    if (baseReply) {
      await sendNormalReply(message, baseReply);
    }
    return;
  }

  st.lastEscalationAt = now();

  const validRole =
    CONFIG.SUPPORT_ROLE_ID &&
    CONFIG.SUPPORT_ROLE_ID !== "IDE_A_SUPPORT_ROLE_ID";

  let content = baseReply || "Erre nézzen rá valaki a csapatból.";

  if (shouldPingRole && validRole) {
    content = `<@&${CONFIG.SUPPORT_ROLE_ID}> ${content}`;
  }

  await message.reply({
    content: truncate(content, CONFIG.MAX_REPLY_CHARS),
    allowedMentions: {
      parse: [],
      roles: shouldPingRole && validRole ? [CONFIG.SUPPORT_ROLE_ID] : [],
    },
  }).catch(() => null);
}

/* =========================================================
   FŐ KEZELŐ
========================================================= */

async function handleSupportMessage(client, message) {
  if (!message?.guild) return;
  if (!isSupportChannel(message.channel)) return;
  if (message.author?.bot) return;

  const text = cleanText(message.content || "");
  const attachmentCount = message.attachments?.size || 0;

  pushRecentMessage(message.channel.id, "user", text || `[csatolmány: ${attachmentCount}]`, {
    userId: message.author.id,
  });

  /*
    Staff activity tracking
  */
  if (hasStaffRole(message.member)) {
    markStaffActivity(message.channel.id);
    return;
  }

  if (!text && !attachmentCount) {
    return;
  }

  /*
    Ha staff nemrég válaszolt, az AI maradjon háttérben.
  */
  if (wasStaffTakeoverRecent(message.channel.id)) {
    return;
  }

  /*
    Rövid cache a gyakori szabálykérdésekre.
  */
  const cached = getCachedFaqAnswer(text);
  if (cached && cached.action === "answer" && cached.reply) {
    await sendNormalReply(message, cached.reply);
    markAiReply(message.channel.id);
    pushRecentMessage(message.channel.id, "assistant", cached.reply, { cached: true });
    return;
  }

  let decision = null;

  try {
    if (process.env.OPENAI_API_KEY) {
      decision = await classifyAndAnswerWithAI({
        messageText: text,
        knowledgeBase: buildKnowledgeBase(),
        recentMessages: getChannelState(message.channel.id).recentMessages,
      });
    }
  } catch (error) {
    console.error("[SUPPORT AI] OpenAI hiba:", error?.message || error);
    decision = null;
  }

  if (!decision && CONFIG.ENABLE_FALLBACK) {
    decision = fallbackDecision(text);
  }

  if (!decision) return;

  pushRecentMessage(
    message.channel.id,
    "assistant_decision",
    JSON.stringify({
      action: decision.action,
      confidence: decision.confidence,
      reason: decision.reason,
    })
  );

  switch (decision.action) {
    case "ignore": {
      return;
    }

    case "greet": {
      if (!CONFIG.REPLY_TO_GREETINGS) return;
      if (!shouldReplyToGreeting(message.channel.id, message.author.id)) return;

      const reply = decision.reply || getGreetingReply();
      await sendNormalReply(message, reply);
      markAiReply(message.channel.id);
      pushRecentMessage(message.channel.id, "assistant", reply);
      return;
    }

    case "answer": {
      if (!decision.reply) return;

      await sendNormalReply(message, decision.reply);
      markAiReply(message.channel.id);
      pushRecentMessage(message.channel.id, "assistant", decision.reply);

      if (decision.faq_worthy) {
        setCachedFaqAnswer(text, {
          action: "answer",
          reply: decision.reply,
        });
      }
      return;
    }

    case "escalate": {
      await sendEscalationReply(
        message,
        decision.reply || "Erre inkább ránéz valaki a csapatból.",
        decision.should_ping_role
      );
      markAiReply(message.channel.id);
      pushRecentMessage(
        message.channel.id,
        "assistant",
        decision.reply || "Erre inkább ránéz valaki a csapatból."
      );
      return;
    }

    default:
      return;
  }
}

/* =========================================================
   REGISZTRÁLÁS
========================================================= */

function registerSupportAI(client) {
  if (listenersRegistered) return;
  listenersRegistered = true;

  client.on("messageCreate", async (message) => {
    await handleSupportMessage(client, message);
  });

  client.once("ready", () => {
    console.log("✅ [SUPPORT AI V3] Next level ügyfélszolgálatos AI aktív.");
  });
}

module.exports = {
  registerSupportAI,
};