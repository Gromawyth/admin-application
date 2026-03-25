"use strict";

const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========================================================
// KONFIG
// MINDENT IDE ÍRJ ÁT, OPENAI KEY KIVÉTELÉVEL
// ========================================================
const CONFIG = {
  SERVER_NAME: "internalGaming",

  // ---- LOG / STAFF ----
  MOD_LOG_CHANNEL_ID: "1485721532297908355",
  STAFF_ROLE_IDS: [
    "1403403484090470564",
    "1322545317995876397"
  ],

  // ---- KIVÉTELEK ----
  EXEMPT_ROLE_IDS: [
    // pl staff roleok, tulaj, fejlesztő
    "1403403484090470564",
    "1322545317995876397",
    "1403401954712883200",
    "1322545317995876398",
    "1322545317995876399",
    "1322545317995876401",
    "1322545317995876400",
    "1322545317995876402"
    
  ],
  EXEMPT_CHANNEL_IDS: [
    // pl bot, log, ticket, admin panel, stb
    ""
  ],
  EXEMPT_CATEGORY_IDS: [
    // pl ticket kategória, staff kategória
    "1459959093174210825",
    "1459975538717491401",
    "1459968270974324891",
    "1459941531698987171"
  ],

  // ---- BÜNTETÉSI JOGOK ----
  ALLOW_DELETE: true,
  ALLOW_TIMEOUT: true,
  ALLOW_KICK: true,
  ALLOW_BAN: true,

  // ---- AUTO DÖNTÉS FINOMHANGOLÁS ----
  MAX_CONTEXT_MESSAGES: 6,
  MAX_PROFILE_INCIDENTS: 120,
  MAX_LAST_MESSAGES_PER_USER: 12,

  // ---- RIZIKÓ KÜSZÖBÖK ----
  WATCH_THRESHOLD: 40,
  HIGH_RISK_THRESHOLD: 70,
  KICK_NEAR_THRESHOLD: 100,
  BAN_NEAR_THRESHOLD: 130,
  AUTO_BAN_READY_THRESHOLD: 170,

  // ---- AI CONFIDENCE KÜSZÖBÖK ----
  MIN_AI_CONFIDENCE_FOR_TIMEOUT: 65,
  MIN_AI_CONFIDENCE_FOR_KICK: 78,
  MIN_AI_CONFIDENCE_FOR_BAN: 88,

  // ---- TIMEOUTOK ----
  TIMEOUT_MINUTES_WARNING: 10,
  TIMEOUT_MINUTES_MEDIUM: 60,
  TIMEOUT_MINUTES_HIGH: 360,
  TIMEOUT_MINUTES_CRITICAL: 1440,

  // ---- SPAM / FLOOD ----
  FLOOD_WINDOW_MS: 18_000,
  FLOOD_MESSAGE_COUNT: 5,
  DUPLICATE_WINDOW_MS: 40_000,
  DUPLICATE_MIN_COUNT: 3,
  MASS_MENTION_COUNT: 4,
  CAPS_MIN_LENGTH: 18,
  CAPS_RATIO_THRESHOLD: 0.72,
  EMOJI_SPAM_THRESHOLD: 12,
  REPEAT_CHAR_THRESHOLD: 12,

  // ---- LOG SPAM ELLEN ----
  MIN_INCIDENT_SCORE_FOR_LOG: 18,
  MIN_ACTION_LOG_SCORE: 1,
  USER_ALERT_COOLDOWN_MS: 60 * 60 * 1000,     // 1 óra
  USER_INCIDENT_LOG_COOLDOWN_MS: 90 * 1000,   // 90 mp
  DEDUPE_SIMILAR_WINDOW_MS: 3 * 60 * 1000,    // 3 perc

  // ---- MODÁLIS MŰVELETEK ----
  UNBAN_BUTTON_ENABLED: true,

  // ---- ADATMENTÉS ----
  DATA_FILE: path.join(__dirname, "aimoderation-data.json"),

  // ---- AI MODELL ----
  AI_MODEL: "gpt-5-mini",

  // ---- SZERVER SZABÁLYZAT TÉMÁK ----
  RULES: [
    "Tilos más felhasználók zaklatása, sértegetése, fenyegetése, lejáratása, kifigurázása, abuzálása.",
    "Tilos a szerver, staff, adminok, fejlesztők, vezetőség obszcén, degradáló, nem szalonképes szidalmazása.",
    "Tilos mások nem publikus adatainak kiadása vagy felhasználása.",
    "Tilos politikai, etnikai gyűlöletkeltő, pornográf, gusztustalan vagy kétértelműen tiltott tartalom.",
    "Tilos más szerverek hirdetése vagy szidalmazása, linkkel, képpel, avatarral vagy más formában.",
    "Tilos floodolni, spamelni, indokolatlanul tagelni.",
    "Tilos adminnak / vezetőségi tagnak indokolatlan DM-et küldeni.",
    "Tilos az OOC kereskedelem és annak szándéka is. Ez örök kitiltást vonhat maga után.",
    "Tilos sértő, obszcén, megtévesztő név vagy staffnév utánzás.",
    "Hangcsatornában tilos a zavaró hangkeltés, soundboard túlhasználata, DC MG és staff előli kilépés ügyintézés közben.",
  ],

  // ---- GYANÚS KULCSSZAVAK ----
  BLOCKED_NAME_PATTERNS: [
    /admin/i,
    /mod(er[aá]tor)?/i,
    /owner/i,
    /tulaj/i,
    /internalgaming/i
  ],
};

// ========================================================
// ÁLLAPOT / JSON
// ========================================================
function getDefaultStore() {
  return {
    users: {},
    lastLogs: {},
    alertMessages: {},
    actionMessages: {},
    modActions: [],
    bannedUsers: {},
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(CONFIG.DATA_FILE)) {
      fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(getDefaultStore(), null, 2), "utf8");
      return getDefaultStore();
    }

    const raw = fs.readFileSync(CONFIG.DATA_FILE, "utf8");
    if (!raw.trim()) return getDefaultStore();

    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || {},
      lastLogs: parsed.lastLogs || {},
      alertMessages: parsed.alertMessages || {},
      actionMessages: parsed.actionMessages || {},
      modActions: parsed.modActions || [],
      bannedUsers: parsed.bannedUsers || {},
    };
  } catch (error) {
    console.error("[AIMOD] loadStore hiba:", error);
    return getDefaultStore();
  }
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("[AIMOD] saveStore hiba:", error);
  }
}

// ========================================================
// SEGÉDEK
// ========================================================
function now() {
  return Date.now();
}

function cleanText(text, max = 1800) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

function trimField(text, max = 1024) {
  const value = cleanText(text, max);
  return value || "-";
}

function chunkText(text, max = 1024) {
  const safe = cleanText(text, max);
  return safe || "-";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isStaff(member) {
  if (!member || !member.roles?.cache) return false;
  return CONFIG.STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function hasExemptRole(member) {
  if (!member || !member.roles?.cache) return false;
  return CONFIG.EXEMPT_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function isExemptChannel(channel) {
  if (!channel) return true;
  if (CONFIG.EXEMPT_CHANNEL_IDS.includes(channel.id)) return true;
  if (channel.parentId && CONFIG.EXEMPT_CATEGORY_IDS.includes(channel.parentId)) return true;
  return false;
}

function shouldIgnoreMessage(message) {
  if (!message || !message.guild) return true;
  if (message.author?.bot) return true;
  if (message.webhookId) return true;
  if (!message.member) return true;
  if (isExemptChannel(message.channel)) return true;
  if (isStaff(message.member)) return true;
  if (hasExemptRole(message.member)) return true;
  return false;
}

function safeMentionUser(userId) {
  return userId ? `<@${userId}>` : "Ismeretlen";
}

function formatTs(timestamp) {
  if (!timestamp) return "-";
  return `<t:${Math.floor(timestamp / 1000)}:f>`;
}

function getLogChannel(client) {
  if (!CONFIG.MOD_LOG_CHANNEL_ID || CONFIG.MOD_LOG_CHANNEL_ID.startsWith("IDE_")) return null;
  return client.channels.cache.get(CONFIG.MOD_LOG_CHANNEL_ID) || null;
}

function colorBySeverity(severity) {
  switch (severity) {
    case "critical": return 0xaa0000;
    case "high": return 0xd63c3c;
    case "medium": return 0xff8a00;
    case "low": return 0xf0c419;
    default: return 0x2f3136;
  }
}

function emojiBySeverity(severity) {
  switch (severity) {
    case "critical": return "🛑";
    case "high": return "🚨";
    case "medium": return "⚠️";
    case "low": return "🟡";
    default: return "ℹ️";
  }
}

function getUserProfile(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      incidents: [],
      recentMessages: [],
      lastAlertLevel: null,
      lastAlertAt: 0,
      lastIncidentLogAt: 0,
      escalationMultiplier: 1,
      lastActionAt: 0,
      totals: {
        warnings: 0,
        deletions: 0,
        timeouts: 0,
        kicks: 0,
        bans: 0,
      },
    };
  }
  return store.users[userId];
}

function pushRecentMessage(userId, message) {
  const profile = getUserProfile(userId);
  profile.recentMessages.push({
    id: message.id,
    content: cleanText(message.content || "", 500),
    createdAt: message.createdTimestamp || Date.now(),
    channelId: message.channelId,
  });

  if (profile.recentMessages.length > CONFIG.MAX_LAST_MESSAGES_PER_USER) {
    profile.recentMessages = profile.recentMessages.slice(-CONFIG.MAX_LAST_MESSAGES_PER_USER);
  }
}

function addIncident(userId, incident) {
  const profile = getUserProfile(userId);
  profile.incidents.push(incident);
  if (profile.incidents.length > CONFIG.MAX_PROFILE_INCIDENTS) {
    profile.incidents = profile.incidents.slice(-CONFIG.MAX_PROFILE_INCIDENTS);
  }
}

function getWeightedRisk(profile) {
  const t = now();
  let risk = 0;

  for (const inc of safeArray(profile.incidents)) {
    const age = t - (inc.createdAt || t);
    let weight = 0;

    if (age <= 7 * 24 * 60 * 60 * 1000) weight = 1;
    else if (age <= 30 * 24 * 60 * 60 * 1000) weight = 0.65;
    else if (age <= 90 * 24 * 60 * 60 * 1000) weight = 0.25;
    else weight = 0.08;

    risk += (Number(inc.points || 0) * weight);
  }

  const escalationBonus =
    (profile.totals?.timeouts || 0) * 10 +
    (profile.totals?.kicks || 0) * 22 +
    (profile.totals?.bans || 0) * 80;

  return Math.round(risk + escalationBonus);
}

function getRecentIncidentCounts(profile) {
  const t = now();
  let last7d = 0;
  let last30d = 0;
  let serious7d = 0;
  let serious30d = 0;

  for (const inc of safeArray(profile.incidents)) {
    const age = t - (inc.createdAt || t);
    const severe = ["medium", "high", "critical"].includes(inc.severity);

    if (age <= 7 * 24 * 60 * 60 * 1000) {
      last7d++;
      if (severe) serious7d++;
    }
    if (age <= 30 * 24 * 60 * 60 * 1000) {
      last30d++;
      if (severe) serious30d++;
    }
  }

  return { last7d, last30d, serious7d, serious30d };
}

function riskStage(risk) {
  if (risk >= CONFIG.AUTO_BAN_READY_THRESHOLD) return "auto_ban_ready";
  if (risk >= CONFIG.BAN_NEAR_THRESHOLD) return "ban_near";
  if (risk >= CONFIG.KICK_NEAR_THRESHOLD) return "kick_near";
  if (risk >= CONFIG.HIGH_RISK_THRESHOLD) return "high_risk";
  if (risk >= CONFIG.WATCH_THRESHOLD) return "watch";
  return "normal";
}

function stageLabel(stage) {
  switch (stage) {
    case "watch": return "Figyelendő";
    case "high_risk": return "Magas kockázat";
    case "kick_near": return "Kick közelében";
    case "ban_near": return "Ban közelében";
    case "auto_ban_ready": return "Automata ban küszöb";
    default: return "Normál";
  }
}

function actionToLabel(action) {
  switch (action) {
    case "ignore": return "Nincs automata lépés";
    case "warn": return "Figyelmeztetés";
    case "delete": return "Üzenet törlése";
    case "timeout": return "Timeout / mute";
    case "kick": return "Kick";
    case "ban": return "Ban";
    default: return "Nincs";
  }
}

function timeoutMsForSeverity(severity) {
  switch (severity) {
    case "critical": return CONFIG.TIMEOUT_MINUTES_CRITICAL * 60 * 1000;
    case "high": return CONFIG.TIMEOUT_MINUTES_HIGH * 60 * 1000;
    case "medium": return CONFIG.TIMEOUT_MINUTES_MEDIUM * 60 * 1000;
    default: return CONFIG.TIMEOUT_MINUTES_WARNING * 60 * 1000;
  }
}

function canModerateTarget(member) {
  if (!member || !member.guild || !member.guild.members?.me) return false;
  const me = member.guild.members.me;
  if (!me) return false;
  if (member.id === me.id) return false;
  if (member.user?.bot) return false;
  if (member.roles?.highest && me.roles?.highest) {
    return me.roles.highest.position > member.roles.highest.position;
  }
  return true;
}

function buildRulesText() {
  return CONFIG.RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

function similarityKey(category, reason, content) {
  return `${category || "other"}|${cleanText(reason || "", 120)}|${cleanText(content || "", 140)}`;
}

function getMessageLink(message) {
  try {
    if (!message.guildId || !message.channelId || !message.id) return null;
    return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
  } catch {
    return null;
  }
}

// ========================================================
// REGEX / GYORS FELISMERÉS
// ========================================================
const REGEX = {
  invite: /(discord\.gg\/|discord\.com\/invite\/)/i,
  oocTrade:
    /\b(irl|val[óo]s ?p[eé]nz|forint|ft\b|eur[oó]|paypal|revolut|utal(ok|ás)?|bankk[aá]rtya|nitro|steam gift|giftcard|account(eladás|ot)?|eladom az account|veszek accountot|p[eé]nz[ée]rt adom|p[eé]nz[ée]rt veszem)\b/i,
  doxxing:
    /\b(facebook|fb profil|insta|instagram|telefonsz[aá]m|lakc[ií]m|c[ií]m[e]?|szem[eé]lyi|anyja neve|ad[óo]sz[aá]m|taj|priv[aá]t k[eé]p|nem publikus k[eé]p)\b/i,
  threat:
    /\b(meg[oö]llek|megverlek|kiny[ií]rlak|sz[eé]tszedlek|megtal[áa]llak|elkaplak|feljelentelek a csal[aá]dod|kiteszlek mindenhova)\b/i,
  harassment:
    /\b(kurva any[aá]d|any[aá]d|h[uü]lye vagy|nyomor[eé]k|patk[aá]ny|geci|retkes|szarh[aá]zi|id[ií]óta|szopj le|d[g]egl[eé]gy|majom)\b/i,
  staffAbuse:
    /\b(admin|moder[aá]tor|vezet[oő]s[eé]g|staff|fejleszt[oő]|szerver)\b.{0,24}\b(szar|szarh[aá]zi|retkes|nyomor[eé]k|hullad[eé]k|boh[oó]c|szar szerver|geci)\b/i,
  adServer:
    /\b(másik szerver|gyertek [a-z0-9_ -]+(?:rp|server|szerver)|jobb mint ez a szerver|gyertek át)\b/i,
  nsfw:
    /\b(porn[oó]|18\+|nsfw|meztelen|szexk[eé]p|nudes?|farkad|pin[aá]|szop[aá]s|basz[aá]s)\b/i,
  politics:
    /\b(n[aá]ci|zsid[oó]|cig[aá]nyok|rom[aá]k|fidesz|tisza|orb[aá]n|migr[aá]nsok)\b/i,
  vpnBanEvade:
    /\b(vpn|proxy|újra visszaj[oö]ttem|alt account|m[aá]sik account|ban evasion|bannoltak de visszaj[oö]ttem)\b/i,
  scam:
    /\b(ingyen nitro|free nitro|steam aj[aá]nd[eé]k|gift link|próbáld ki ezt a linket|token|bejelentkezés itt)\b/i,
  mentionAbuse:
    /<@!?\d+>/g,
  emoji:
    /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]/gu,
  repeatChars: /(.)\1{11,}/i,
};

function scanRules(message, recentSameUser = []) {
  const content = String(message.content || "");
  const lower = content.toLowerCase();

  const hits = [];
  let score = 0;

  if (!content.trim()) return { hits, score };

  if (REGEX.invite.test(content)) {
    hits.push({ key: "invite", points: 28, label: "Discord invite / reklám" });
    score += 28;
  }

  if (REGEX.oocTrade.test(content)) {
    hits.push({ key: "ooc_trade", points: 90, label: "OOC kereskedelem gyanú" });
    score += 90;
  }

  if (REGEX.doxxing.test(content)) {
    hits.push({ key: "doxxing", points: 68, label: "Privát adat / doxxing gyanú" });
    score += 68;
  }

  if (REGEX.threat.test(content)) {
    hits.push({ key: "threat", points: 56, label: "Fenyegetés gyanú" });
    score += 56;
  }

  if (REGEX.staffAbuse.test(content)) {
    hits.push({ key: "staff_abuse", points: 38, label: "Staff / szerver obszcén szidalmazása" });
    score += 38;
  }

  if (REGEX.harassment.test(content)) {
    hits.push({ key: "harassment", points: 28, label: "Célzott sértegetés / zaklatás gyanú" });
    score += 28;
  }

  if (REGEX.adServer.test(content)) {
    hits.push({ key: "ad_server", points: 32, label: "Más szerver reklám / uszítás" });
    score += 32;
  }

  if (REGEX.nsfw.test(content)) {
    hits.push({ key: "nsfw", points: 52, label: "NSFW / obszcén tartalom gyanú" });
    score += 52;
  }

  if (REGEX.politics.test(content)) {
    hits.push({ key: "politics_sensitive", points: 18, label: "Politikai / etnikai érzékeny tartalom" });
    score += 18;
  }

  if (REGEX.vpnBanEvade.test(content)) {
    hits.push({ key: "vpn_ban_evasion", points: 70, label: "VPN / ban evasion gyanú" });
    score += 70;
  }

  if (REGEX.scam.test(content)) {
    hits.push({ key: "scam", points: 85, label: "Scam / átverés gyanú" });
    score += 85;
  }

  const mentionCount = (content.match(REGEX.mentionAbuse) || []).length;
  if (mentionCount >= CONFIG.MASS_MENTION_COUNT) {
    hits.push({ key: "mass_mentions", points: 20, label: "Indokolatlan tömeges tagelés" });
    score += 20;
  }

  const emojiCount = (content.match(REGEX.emoji) || []).length;
  if (emojiCount >= CONFIG.EMOJI_SPAM_THRESHOLD) {
    hits.push({ key: "emoji_spam", points: 12, label: "Emoji / GIF spam gyanú" });
    score += 12;
  }

  if (REGEX.repeatChars.test(content)) {
    hits.push({ key: "repeat_chars", points: 10, label: "Karakter spam" });
    score += 10;
  }

  if (content.length >= CONFIG.CAPS_MIN_LENGTH) {
    const letters = content.replace(/[^a-zA-ZÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g, "");
    if (letters.length >= CONFIG.CAPS_MIN_LENGTH) {
      const upper = letters.replace(/[^A-ZÁÉÍÓÖŐÚÜŰ]/g, "").length;
      const ratio = upper / letters.length;
      if (ratio >= CONFIG.CAPS_RATIO_THRESHOLD) {
        hits.push({ key: "caps_spam", points: 10, label: "Caps spam" });
        score += 10;
      }
    }
  }

  // ugyanaz az üzenet ismételve
  const dupes = recentSameUser.filter(
    (m) =>
      now() - (m.createdAt || 0) <= CONFIG.DUPLICATE_WINDOW_MS &&
      m.content &&
      m.content.toLowerCase() === lower &&
      lower.length >= 6
  ).length;

  if (dupes + 1 >= CONFIG.DUPLICATE_MIN_COUNT) {
    hits.push({ key: "duplicate_spam", points: 22, label: "Ismételt ugyanaz az üzenet" });
    score += 22;
  }

  // flood
  const recentWindow = recentSameUser.filter(
    (m) =>
      now() - (m.createdAt || 0) <= CONFIG.FLOOD_WINDOW_MS
  ).length;

  if (recentWindow + 1 >= CONFIG.FLOOD_MESSAGE_COUNT) {
    hits.push({ key: "flood", points: 24, label: "Flood / gyors üzenetáradat" });
    score += 24;
  }

  return { hits, score };
}

// ========================================================
// AI
// ========================================================
function shouldRunAi(ruleScore, content) {
  if (!content || !content.trim()) return false;
  if (ruleScore >= 10) return true;

  const suspiciousWords = [
    "admin", "moderátor", "szerver", "fenyeget", "megöl",
    "paypal", "revolut", "account", "pénzért", "discord.gg",
    "facebook", "telefonszám", "lakcím", "kurva", "nyomorék"
  ];

  const lower = content.toLowerCase();
  return suspiciousWords.some((w) => lower.includes(w));
}

async function aiAnalyzeModeration(payload) {
  const {
    messageContent,
    contextMessages,
    ruleHits,
    currentRisk,
    incidentSummary,
    username,
    displayName,
  } = payload;

  const prompt = `
Te egy nagyon szigorú, de igazságos Discord moderációs AI vagy a(z) ${CONFIG.SERVER_NAME} szerveren.

Feladatod:
- Elemezd az adott üzenetet.
- Vedd figyelembe a kontextust, a korábbi szabálysértési mintát és a szerver szabályait.
- Kifejezetten figyelj a következőkre:
  - zaklatás, sértegetés, fenyegetés
  - staff / szerver obszcén szidalmazása
  - privát adatok kiadása
  - NSFW / pornográf / gusztustalan tartalom
  - más szerver reklám / invite
  - flood / spam / indokolatlan tagelés
  - OOC kereskedelem és annak szándéka is
  - VPN / ban evasion gyanú
  - provokáció, visszaeső toxikus minta

A szabályok:
${buildRulesText()}

Felhasználó:
- username: ${username || "ismeretlen"}
- displayName: ${displayName || "ismeretlen"}
- jelenlegi kockázati pont: ${currentRisk}
- közelmúltbeli összefoglaló: ${incidentSummary || "nincs"}

Szabályalapú találatok:
${JSON.stringify(ruleHits, null, 2)}

Kontextus üzenetek:
${JSON.stringify(contextMessages, null, 2)}

Vizsgált üzenet:
${messageContent}

Nagyon fontos:
- Ha valami csak enyhe vagy bizonytalan, ne javasolj túl erős büntetést.
- Ha OOC kereskedelem szándéka, súlyos doxxing, extrém scam, extrém gyűlöletkeltés vagy visszaeső súlyos szabálysértés látszik, lehet "ban" javaslat.
- Ha inkább köztes lépés kell, javasolj timeoutot vagy kicket.
- A válasz KIZÁRÓLAG JSON legyen.

Elvárt JSON forma:
{
  "category": "harassment | threat | staff_abuse | doxxing | nsfw | ad_server | spam | flood | ooc_trade | scam | ban_evasion | politics_sensitive | clean | other",
  "severity": "low | medium | high | critical",
  "confidence": 0-100,
  "points": 0-100,
  "targeted": true,
  "repeatOffenderWeight": 0-50,
  "ruleBroken": "rövid magyar megfogalmazás",
  "reason": "részletes rövid magyar indoklás",
  "recommendedAction": "ignore | warn | delete | timeout | kick | ban",
  "timeoutMinutes": 0,
  "shouldImmediateBan": false,
  "shouldNotifyStaff": true
}
`;

  const response = await openai.chat.completions.create({
    model: CONFIG.AI_MODEL,
    messages: [
      {
        role: "system",
        content: "Te csak érvényes JSON-t adhatsz vissza, más szöveget nem.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.15,
  });

  const content = response.choices?.[0]?.message?.content?.trim() || "{}";

  try {
    return JSON.parse(content);
  } catch (error) {
    console.error("[AIMOD] AI JSON parse hiba:", error, content);
    return {
      category: "other",
      severity: "low",
      confidence: 20,
      points: 0,
      targeted: false,
      repeatOffenderWeight: 0,
      ruleBroken: "Nem sikerült biztosan azonosítani.",
      reason: "Az AI válasza nem volt biztonságosan feldolgozható.",
      recommendedAction: "ignore",
      timeoutMinutes: 0,
      shouldImmediateBan: false,
      shouldNotifyStaff: false,
    };
  }
}

// ========================================================
// DÖNTÉSI LOGIKA
// ========================================================
function summarizeIncidents(profile) {
  const counts = getRecentIncidentCounts(profile);
  const totals = profile.totals || {};
  return `7 nap: ${counts.last7d} incidens / ${counts.serious7d} komoly, 30 nap: ${counts.last30d} incidens / ${counts.serious30d} komoly, timeout: ${totals.timeouts || 0}, kick: ${totals.kicks || 0}, ban: ${totals.bans || 0}`;
}

function pickHighestRuleHit(ruleHits) {
  if (!Array.isArray(ruleHits) || !ruleHits.length) return null;
  return [...ruleHits].sort((a, b) => (b.points || 0) - (a.points || 0))[0];
}

function normalizeSeverity(value) {
  if (["low", "medium", "high", "critical"].includes(value)) return value;
  return "low";
}

function normalizeAction(value) {
  if (["ignore", "warn", "delete", "timeout", "kick", "ban"].includes(value)) return value;
  return "ignore";
}

function finalDecision({ profile, ruleScan, aiResult }) {
  const risk = getWeightedRisk(profile);
  const severity = normalizeSeverity(aiResult.severity);
  const highestRule = pickHighestRuleHit(ruleScan.hits);

  let points = Math.max(
    Number(aiResult.points || 0),
    Number(ruleScan.score || 0),
    Number(highestRule?.points || 0)
  );

  points += Math.min(Number(aiResult.repeatOffenderWeight || 0), 50);

  const recentCounts = getRecentIncidentCounts(profile);
  if (recentCounts.serious7d >= 2) points += 18;
  if (recentCounts.serious30d >= 4) points += 22;
  if ((profile.totals?.timeouts || 0) >= 2) points += 10;
  if ((profile.totals?.kicks || 0) >= 1) points += 20;

  let action = normalizeAction(aiResult.recommendedAction);
  const confidence = Number(aiResult.confidence || 0);

  // nagyon súlyos szabályalapú helyzetek
  const hasImmediateTrade = ruleScan.hits.some((h) => h.key === "ooc_trade");
  const hasImmediateScam = ruleScan.hits.some((h) => h.key === "scam");
  const hasImmediateDox = ruleScan.hits.some((h) => h.key === "doxxing");
  const hasBanEvasion = ruleScan.hits.some((h) => h.key === "vpn_ban_evasion");

  if (hasImmediateTrade || hasImmediateScam) {
    if (confidence >= 70) {
      action = "ban";
      points = Math.max(points, 95);
    }
  }

  if (hasImmediateDox && confidence >= 80) {
    action = "ban";
    points = Math.max(points, 92);
  }

  if (hasBanEvasion && confidence >= 78) {
    action = "ban";
    points = Math.max(points, 90);
  }

  // kockázati szint beleszól
  const projectedRisk = risk + points;
  const severe = ["high", "critical"].includes(severity);

  if (projectedRisk >= CONFIG.AUTO_BAN_READY_THRESHOLD && severe && confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_BAN) {
    action = "ban";
  } else if (projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD && severe && confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_KICK && action !== "ban") {
    action = "kick";
  } else if (projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD && confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_TIMEOUT && ["ignore", "warn", "delete"].includes(action)) {
    action = "timeout";
  }

  // confidence korlátozás
  if (action === "ban" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_BAN) {
    action = projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD ? "kick" : "timeout";
  }
  if (action === "kick" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_KICK) {
    action = "timeout";
  }
  if (action === "timeout" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_TIMEOUT) {
    action = "delete";
  }

  // rule-only finomítás
  if (ruleScan.score >= 24 && action === "ignore") {
    action = "delete";
  }
  if (ruleScan.score >= 45 && ["ignore", "warn", "delete"].includes(action)) {
    action = "timeout";
  }
  if (ruleScan.score >= 80 && severe && confidence >= 75) {
    action = "ban";
  }

  // végső biztonság
  if (points < 10 && confidence < 40) {
    action = "ignore";
  }

  return {
    action,
    severity,
    confidence,
    points,
    projectedRisk,
    category: aiResult.category || highestRule?.key || "other",
    ruleBroken: aiResult.ruleBroken || highestRule?.label || "Szabályszegés gyanú",
    reason:
      aiResult.reason ||
      highestRule?.label ||
      "Az AI és a szabályalapú ellenőrzés problémás mintát jelzett.",
    timeoutMinutes:
      Number(aiResult.timeoutMinutes || 0) > 0
        ? Number(aiResult.timeoutMinutes)
        : Math.round(timeoutMsForSeverity(severity) / 60000),
    shouldNotifyStaff:
      Boolean(aiResult.shouldNotifyStaff) ||
      points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG ||
      ["timeout", "kick", "ban"].includes(action),
  };
}

// ========================================================
// EMBEDEK
// ========================================================
function buildIncidentEmbed({ message, member, final, profile, crossedStage }) {
  const risk = getWeightedRisk(profile);
  const color = colorBySeverity(final.severity);
  const emoji = emojiBySeverity(final.severity);
  const messageLink = getMessageLink(message);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} AI Moderációs incidens`)
    .setDescription(
      [
        `**Felhasználó:** ${safeMentionUser(member?.id)}`,
        `**Név:** ${trimField(member?.user?.tag || member?.user?.username || "Ismeretlen", 256)}`,
        `**Csatorna:** ${message?.channel ? `${message.channel}` : "-"}`,
        `**Akció:** **${actionToLabel(final.action)}**`,
        `**Súlyosság:** **${final.severity}**`,
        `**Kategória:** **${trimField(final.category, 128)}**`,
        messageLink ? `**Üzenet:** [Megnyitás](${messageLink})` : null,
      ].filter(Boolean).join("\n")
    )
    .addFields(
      {
        name: "🧠 AI indoklás",
        value: trimField(final.reason, 1024),
        inline: false,
      },
      {
        name: "📜 Érintett szabály",
        value: trimField(final.ruleBroken, 1024),
        inline: false,
      },
      {
        name: "💬 Vizsgált üzenet",
        value: trimField(message?.content || "(nem szöveges vagy üres üzenet)", 1024),
        inline: false,
      },
      {
        name: "📊 Pontok",
        value: `Incidens: **${final.points}**\nJelenlegi kockázat: **${risk}**\nIncidens után becsült: **${final.projectedRisk}**`,
        inline: true,
      },
      {
        name: "🎯 AI bizonyosság",
        value: `${final.confidence}%`,
        inline: true,
      },
      {
        name: "📈 Státusz",
        value: crossedStage ? `Küszöb átlépve: **${stageLabel(crossedStage)}**` : stageLabel(riskStage(risk)),
        inline: true,
      },
      {
        name: "🗂️ Előzmények",
        value: trimField(summarizeIncidents(profile), 1024),
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return embed;
}

function buildThresholdEmbed({ member, profile, stage, reasonText }) {
  const risk = getWeightedRisk(profile);
  const severity =
    stage === "ban_near" || stage === "auto_ban_ready" ? "critical"
      : stage === "kick_near" ? "high"
      : "medium";

  return new EmbedBuilder()
    .setColor(colorBySeverity(severity))
    .setTitle(`${emojiBySeverity(severity)} AI kockázati figyelmeztetés`)
    .setDescription(
      [
        `**Felhasználó:** ${safeMentionUser(member?.id)}`,
        `**Név:** ${trimField(member?.user?.tag || member?.user?.username || "Ismeretlen", 256)}`,
        `**Állapot:** **${stageLabel(stage)}**`,
        `**Jelenlegi kockázat:** **${risk}**`,
      ].join("\n")
    )
    .addFields(
      {
        name: "📌 Miért kapta ezt az állapotot?",
        value: trimField(reasonText || "Az AI szerint a felhasználó ismétlődő vagy egyre súlyosabb szabálysértési mintát mutat.", 1024),
        inline: false,
      },
      {
        name: "🗂️ Közelmúlt összegzés",
        value: trimField(summarizeIncidents(profile), 1024),
        inline: false,
      }
    )
    .setFooter({ text: `AI Risk Alert • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());
}

function buildBanActionEmbed({ guild, moderator, userId, reason, record }) {
  const row = CONFIG.UNBAN_BUTTON_ENABLED
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`aimod:unban:${userId}`)
          .setLabel("Unban")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`aimod:reviewok:${userId}`)
          .setLabel("Döntés helyes")
          .setStyle(ButtonStyle.Secondary),
      )
    : null;

  const embed = new EmbedBuilder()
    .setColor(0xaa0000)
    .setTitle("🛑 Automata ban végrehajtva")
    .setDescription(
      [
        `**Felhasználó:** ${safeMentionUser(userId)}`,
        `**Guild:** ${trimField(guild?.name || "-", 256)}`,
        `**Végrehajtotta:** ${moderator ? safeMentionUser(moderator.id) : "AI Moderation"}`,
      ].join("\n")
    )
    .addFields(
      {
        name: "📜 Indok",
        value: trimField(reason, 1024),
        inline: false,
      },
      {
        name: "📊 Előzmény adatok",
        value: trimField(record || "-", 1024),
        inline: false,
      }
    )
    .setFooter({ text: `Ban log • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return { embed, row };
}

function buildUnbanModal(userId) {
  const input = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Unban indoklás")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(700)
    .setPlaceholder("Pl.: AI túl szigorú volt, téves kontextus, staff felülbírálat.");

  return new ModalBuilder()
    .setCustomId(`aimod:unban_modal:${userId}`)
    .setTitle("Feloldás / Unban")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

// ========================================================
// LOGOLÁS
// ========================================================
async function sendOrEditAlertMessage(client, userId, embed) {
  const logChannel = getLogChannel(client);
  if (!logChannel) return;

  const existingId = store.alertMessages[userId];
  if (existingId) {
    const existing = await logChannel.messages.fetch(existingId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [embed] }).catch(() => null);
      return existing;
    }
  }

  const msg = await logChannel.send({ embeds: [embed] }).catch(() => null);
  if (msg) {
    store.alertMessages[userId] = msg.id;
    saveStore();
  }
  return msg;
}

async function logIncident(client, payload) {
  const { userId, key, embed, components } = payload;
  const logChannel = getLogChannel(client);
  if (!logChannel) return null;

  const dedupeKey = `${userId}:${key}`;
  const last = store.lastLogs[dedupeKey];

  if (last && now() - last.at <= CONFIG.DEDUPE_SIMILAR_WINDOW_MS) {
    const oldMsg = await logChannel.messages.fetch(last.messageId).catch(() => null);
    if (oldMsg) {
      await oldMsg.edit({
        embeds: [embed],
        components: components ? [components] : [],
      }).catch(() => null);
      store.lastLogs[dedupeKey].at = now();
      saveStore();
      return oldMsg;
    }
  }

  const msg = await logChannel.send({
    embeds: [embed],
    components: components ? [components] : [],
  }).catch(() => null);

  if (msg) {
    store.lastLogs[dedupeKey] = {
      at: now(),
      messageId: msg.id,
    };
    saveStore();
  }

  return msg;
}

// ========================================================
// MODERÁCIÓS AKCIÓK
// ========================================================
async function safeDeleteMessage(message) {
  try {
    if (!CONFIG.ALLOW_DELETE) return false;
    if (!message?.deletable) return false;
    await message.delete().catch(() => null);
    return true;
  } catch {
    return false;
  }
}

async function safeTimeout(member, minutes, reason) {
  try {
    if (!CONFIG.ALLOW_TIMEOUT) return false;
    if (!member?.moderatable) return false;
    const ms = Math.max(60_000, Number(minutes || 1) * 60_000);
    await member.timeout(ms, reason);
    return true;
  } catch (error) {
    console.error("[AIMOD] timeout hiba:", error);
    return false;
  }
}

async function safeKick(member, reason) {
  try {
    if (!CONFIG.ALLOW_KICK) return false;
    if (!member?.kickable) return false;
    await member.kick(reason);
    return true;
  } catch (error) {
    console.error("[AIMOD] kick hiba:", error);
    return false;
  }
}

async function safeBan(member, reason, deleteMessageSeconds = 0) {
  try {
    if (!CONFIG.ALLOW_BAN) return false;
    if (!member?.bannable) return false;
    await member.ban({
      reason,
      deleteMessageSeconds,
    });
    return true;
  } catch (error) {
    console.error("[AIMOD] ban hiba:", error);
    return false;
  }
}

async function applyDecision(client, message, member, final, profile) {
  let executedAction = "ignore";
  let deleteDone = false;

  const reason = `[AI Moderation] ${cleanText(final.reason, 300)}`;

  // delete
  if (["delete", "timeout", "kick", "ban"].includes(final.action)) {
    deleteDone = await safeDeleteMessage(message);
    if (deleteDone) {
      profile.totals.deletions = (profile.totals.deletions || 0) + 1;
    }
  }

  // timeout
  if (final.action === "timeout" && canModerateTarget(member)) {
    const ok = await safeTimeout(member, final.timeoutMinutes || 60, reason);
    if (ok) {
      profile.totals.timeouts = (profile.totals.timeouts || 0) + 1;
      executedAction = "timeout";
      profile.lastActionAt = now();
      return { executedAction, deleteDone };
    }
  }

  // kick
  if (final.action === "kick" && canModerateTarget(member)) {
    const ok = await safeKick(member, reason);
    if (ok) {
      profile.totals.kicks = (profile.totals.kicks || 0) + 1;
      executedAction = "kick";
      profile.lastActionAt = now();
      return { executedAction, deleteDone };
    }
  }

  // ban
  if (final.action === "ban" && canModerateTarget(member)) {
    const ok = await safeBan(member, reason, 0);
    if (ok) {
      profile.totals.bans = (profile.totals.bans || 0) + 1;
      executedAction = "ban";
      profile.lastActionAt = now();

      store.bannedUsers[member.id] = {
        userId: member.id,
        username: member.user?.tag || member.user?.username || "Ismeretlen",
        reason: final.reason,
        ruleBroken: final.ruleBroken,
        bannedAt: now(),
        by: "AI Moderation",
      };
      saveStore();

      const logChannel = getLogChannel(client);
      if (logChannel) {
        const banRecord = `Kockázat: ${getWeightedRisk(profile)} | Timeout: ${profile.totals.timeouts || 0} | Kick: ${profile.totals.kicks || 0} | Ban: ${profile.totals.bans || 0}`;
        const { embed, row } = buildBanActionEmbed({
          guild: member.guild,
          moderator: null,
          userId: member.id,
          reason: final.reason,
          record: banRecord,
        });

        await logChannel.send({
          embeds: [embed],
          components: row ? [row] : [],
        }).catch(() => null);
      }

      return { executedAction, deleteDone };
    }
  }

  if (final.action === "delete" && deleteDone) {
    executedAction = "delete";
  }

  if (final.action === "warn") {
    executedAction = "warn";
    profile.totals.warnings = (profile.totals.warnings || 0) + 1;
  }

  return { executedAction, deleteDone };
}

// ========================================================
// NÉVELLENŐRZÉS
// ========================================================
function scanMemberNames(member) {
  const hits = [];
  const username = `${member?.user?.username || ""} ${member?.displayName || ""}`;

  for (const pattern of CONFIG.BLOCKED_NAME_PATTERNS) {
    if (pattern.test(username)) {
      hits.push("Megtévesztő staff / szerver jellegű név");
      break;
    }
  }

  if (/(kurva|geci|szar|fasz|retkes|nyomor[eé]k)/i.test(username)) {
    hits.push("Sértő / obszcén név");
  }

  return hits;
}

async function handleMemberNameCheck(client, member, source = "memberAdd") {
  try {
    if (!member || !member.guild) return;
    if (member.user?.bot) return;
    if (isStaff(member) || hasExemptRole(member)) return;

    const hits = scanMemberNames(member);
    if (!hits.length) return;

    const profile = getUserProfile(member.id);
    const points = hits.some((h) => h.includes("obszcén")) ? 24 : 18;

    addIncident(member.id, {
      type: "name_violation",
      category: "name_profile",
      severity: "medium",
      points,
      confidence: 90,
      reason: hits.join(", "),
      ruleBroken: "Tiltott, sértő vagy megtévesztő név/profil",
      createdAt: now(),
      source,
    });

    saveStore();

    const logChannel = getLogChannel(client);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(0xff8a00)
      .setTitle("⚠️ Név / profil gyanú")
      .setDescription(
        [
          `**Felhasználó:** ${safeMentionUser(member.id)}`,
          `**Username:** ${trimField(member.user?.username || "-", 256)}`,
          `**Display név:** ${trimField(member.displayName || "-", 256)}`
        ].join("\n")
      )
      .addFields(
        {
          name: "📜 Gyanú oka",
          value: trimField(hits.join(", "), 1024),
          inline: false,
        },
        {
          name: "📊 Kockázati pont",
          value: String(getWeightedRisk(profile)),
          inline: true,
        }
      )
      .setFooter({ text: `AI Name Check • ${CONFIG.SERVER_NAME}` })
      .setTimestamp(new Date());

    await sendOrEditAlertMessage(client, `name_${member.id}`, embed);
  } catch (error) {
    console.error("[AIMOD] handleMemberNameCheck hiba:", error);
  }
}

// ========================================================
// FŐ ELEMZÉS
// ========================================================
async function processMessage(client, message) {
  if (shouldIgnoreMessage(message)) return;
  if (!message.content?.trim()) return;

  const member = message.member;
  const profile = getUserProfile(member.id);

  const recentSameUser = safeArray(profile.recentMessages).filter(
    (m) => m.channelId === message.channelId
  );

  const ruleScan = scanRules(message, recentSameUser);
  pushRecentMessage(member.id, message);

  if (!shouldRunAi(ruleScan.score, message.content)) {
    saveStore();
    return;
  }

  const channelMessages = await message.channel.messages.fetch({ limit: CONFIG.MAX_CONTEXT_MESSAGES }).catch(() => null);
  const contextMessages = channelMessages
    ? [...channelMessages.values()]
        .filter((m) => !m.author?.bot)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((m) => ({
          author: m.author?.tag || m.author?.username || "Ismeretlen",
          authorId: m.author?.id || "",
          content: cleanText(m.content || "", 400),
          isTarget: m.id === message.id,
        }))
        .slice(-CONFIG.MAX_CONTEXT_MESSAGES)
    : [];

  const currentRisk = getWeightedRisk(profile);
  const incidentSummary = summarizeIncidents(profile);

  let aiResult = {
    category: "other",
    severity: ruleScan.score >= 50 ? "high" : ruleScan.score >= 20 ? "medium" : "low",
    confidence: Math.min(95, Math.max(35, ruleScan.score)),
    points: ruleScan.score,
    targeted: false,
    repeatOffenderWeight: 0,
    ruleBroken: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályszegés gyanú",
    reason: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályalapú találat alapján problémás tartalom.",
    recommendedAction:
      ruleScan.score >= 80 ? "ban" :
      ruleScan.score >= 55 ? "timeout" :
      ruleScan.score >= 22 ? "delete" :
      "ignore",
    timeoutMinutes: 60,
    shouldImmediateBan: false,
    shouldNotifyStaff: ruleScan.score >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG,
  };

  try {
    aiResult = await aiAnalyzeModeration({
      messageContent: cleanText(message.content, 1500),
      contextMessages,
      ruleHits: ruleScan.hits,
      currentRisk,
      incidentSummary,
      username: member.user?.username || "",
      displayName: member.displayName || "",
    });
  } catch (error) {
    console.error("[AIMOD] aiAnalyzeModeration hiba:", error);
  }

  const beforeStage = riskStage(currentRisk);
  const final = finalDecision({ profile, ruleScan, aiResult });

  addIncident(member.id, {
    type: "message_incident",
    category: final.category,
    severity: final.severity,
    points: final.points,
    confidence: final.confidence,
    reason: final.reason,
    ruleBroken: final.ruleBroken,
    messageId: message.id,
    channelId: message.channelId,
    content: cleanText(message.content, 400),
    createdAt: now(),
  });

  const actionResult = await applyDecision(client, message, member, final, profile);
  final.action = actionResult.executedAction || final.action;

  const newRisk = getWeightedRisk(profile);
  const afterStage = riskStage(newRisk);
  const crossedStage = beforeStage !== afterStage ? afterStage : null;

  saveStore();

  const shouldIncidentLog =
    final.shouldNotifyStaff &&
    (
      final.points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG ||
      ["delete", "timeout", "kick", "ban"].includes(final.action)
    );

  if (shouldIncidentLog) {
    if (!profile.lastIncidentLogAt || now() - profile.lastIncidentLogAt >= CONFIG.USER_INCIDENT_LOG_COOLDOWN_MS) {
      const embed = buildIncidentEmbed({
        message,
        member,
        final,
        profile,
        crossedStage,
      });

      const key = similarityKey(final.category, final.reason, message.content);

      await logIncident(client, {
        userId: member.id,
        key,
        embed,
      });

      profile.lastIncidentLogAt = now();
      saveStore();
    }
  }

  // csak küszöbátlépésnél / ritkán menjen külön risk alert
  if (crossedStage && ["watch", "high_risk", "kick_near", "ban_near", "auto_ban_ready"].includes(crossedStage)) {
    if (!profile.lastAlertAt || now() - profile.lastAlertAt >= CONFIG.USER_ALERT_COOLDOWN_MS || profile.lastAlertLevel !== crossedStage) {
      const alertEmbed = buildThresholdEmbed({
        member,
        profile,
        stage: crossedStage,
        reasonText: final.reason,
      });

      await sendOrEditAlertMessage(client, member.id, alertEmbed);
      profile.lastAlertAt = now();
      profile.lastAlertLevel = crossedStage;
      saveStore();
    }
  }
}

// ========================================================
// INTERAKCIÓK
// ========================================================
function hasStaffPermission(interaction) {
  if (!interaction?.member) return false;

  const hasRole =
    interaction.member.roles?.cache &&
    CONFIG.STAFF_ROLE_IDS.some((id) => interaction.member.roles.cache.has(id));

  const hasAdmin = interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator);
  const hasBanPerm = interaction.member.permissions?.has(PermissionsBitField.Flags.BanMembers);

  return Boolean(hasRole || hasAdmin || hasBanPerm);
}

async function handleInteraction(client, interaction) {
  try {
    if (interaction.isButton()) {
      if (!interaction.customId.startsWith("aimod:")) return;

      if (!hasStaffPermission(interaction)) {
        return interaction.reply({
          content: "Ehhez staff jogosultság kell.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const parts = interaction.customId.split(":");
      const action = parts[1];
      const userId = parts[2];

      if (action === "unban") {
        const modal = buildUnbanModal(userId);
        return interaction.showModal(modal);
      }

      if (action === "reviewok") {
        return interaction.reply({
          content: "✅ A döntés helyesként lett megjelölve.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content: "Ismeretlen AI moderációs gomb.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith("aimod:unban_modal:")) return;

      if (!hasStaffPermission(interaction)) {
        return interaction.reply({
          content: "Ehhez staff jogosultság kell.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const userId = interaction.customId.split(":")[2];
      const reason = cleanText(interaction.fields.getTextInputValue("reason") || "Nincs megadva", 700);

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guild = interaction.guild;
      if (!guild) {
        return interaction.editReply("Ez csak szerveren használható.");
      }

      try {
        await guild.members.unban(userId, `[AI Moderation Unban] ${reason}`);
      } catch (error) {
        console.error("[AIMOD] unban hiba:", error);
        return interaction.editReply("❌ Nem sikerült az unban.");
      }

      delete store.bannedUsers[userId];
      saveStore();

      const logChannel = getLogChannel(client);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x1f8b4c)
          .setTitle("🔓 Unban végrehajtva")
          .setDescription(
            [
              `**Felhasználó:** ${safeMentionUser(userId)}`,
              `**Feloldotta:** ${safeMentionUser(interaction.user.id)}`
            ].join("\n")
          )
          .addFields({
            name: "📝 Indok",
            value: trimField(reason, 1024),
            inline: false,
          })
          .setFooter({ text: `AI Moderation Unban • ${CONFIG.SERVER_NAME}` })
          .setTimestamp(new Date());

        await logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      return interaction.editReply("✅ A felhasználó unbanolva lett.");
    }
  } catch (error) {
    console.error("[AIMOD] interaction hiba:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("Hiba történt a művelet közben.");
      } else if (interaction.isRepliable()) {
        await interaction.reply({
          content: "Hiba történt a művelet közben.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {}
  }
}

// ========================================================
// REGISZTRÁLÁS
// ========================================================
function registerAiModeration(client) {
  client.once("ready", () => {
    console.log(`[AIMOD] AI Moderation betöltve • ${CONFIG.SERVER_NAME}`);
    console.log(`[AIMOD] DATA_FILE: ${CONFIG.DATA_FILE}`);
  });

  client.on("messageCreate", async (message) => {
    try {
      await processMessage(client, message);
    } catch (error) {
      console.error("[AIMOD] messageCreate hiba:", error);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      await handleMemberNameCheck(client, member, "memberAdd");
    } catch (error) {
      console.error("[AIMOD] guildMemberAdd hiba:", error);
    }
  });

  client.on("guildMemberUpdate", async (_oldMember, newMember) => {
    try {
      await handleMemberNameCheck(client, newMember, "guildMemberUpdate");
    } catch (error) {
      console.error("[AIMOD] guildMemberUpdate hiba:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    await handleInteraction(client, interaction);
  });
}

module.exports = {
  registerAiModeration,
};