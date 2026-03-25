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
  MessageFlags,
} = require("discord.js");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

  ALLOW_DELETE: true,
  ALLOW_TIMEOUT: true,
  ALLOW_KICK: true,
  ALLOW_BAN: true,

  AI_MODEL: "gpt-5-mini",

  MAX_CONTEXT_MESSAGES: 8,
  MAX_PROFILE_INCIDENTS: 150,
  MAX_LAST_MESSAGES_PER_USER: 18,

  WATCH_THRESHOLD: 40,
  HIGH_RISK_THRESHOLD: 75,
  KICK_NEAR_THRESHOLD: 115,
  BAN_NEAR_THRESHOLD: 145,
  AUTO_BAN_READY_THRESHOLD: 185,

  MIN_AI_CONFIDENCE_FOR_TIMEOUT: 58,
  MIN_AI_CONFIDENCE_FOR_KICK: 72,
  MIN_AI_CONFIDENCE_FOR_BAN: 86,

  TIMEOUT_MINUTES_LOW: 15,
  TIMEOUT_MINUTES_MEDIUM: 60,
  TIMEOUT_MINUTES_HIGH: 360,
  TIMEOUT_MINUTES_CRITICAL: 1440,

  FLOOD_WINDOW_MS: 18_000,
  FLOOD_MESSAGE_COUNT: 5,
  DUPLICATE_WINDOW_MS: 45_000,
  DUPLICATE_MIN_COUNT: 3,
  MASS_MENTION_COUNT: 4,
  CAPS_MIN_LENGTH: 16,
  CAPS_RATIO_THRESHOLD: 0.72,
  EMOJI_SPAM_THRESHOLD: 10,
  REPEAT_CHAR_THRESHOLD: 10,

  MIN_INCIDENT_SCORE_FOR_LOG: 22,
  USER_ALERT_COOLDOWN_MS: 60 * 60 * 1000,
  USER_INCIDENT_LOG_COOLDOWN_MS: 75 * 1000,
  DEDUPE_SIMILAR_WINDOW_MS: 3 * 60 * 1000,

  DATA_FILE: path.join(__dirname, "aimoderation-data.json"),

  RULES: [
    "Tilos más felhasználók piszkálása, zaklatása, szidása, fenyegetése, lejáratása, abuzálása, kifigurázása.",
    "Tilos a szerver, adminok, fejlesztők, vezetőség obszcén, degradáló, nem szalonképes szidalmazása.",
    "Tilos mások nem publikus adatainak kiadása és felhasználása.",
    "Tilos politikai, etnikai, pornográf, NSFW, gusztustalan vagy kétértelműen tiltott tartalom.",
    "Tilos más szerverek hirdetése / szidása, linkkel, névvel, avatarban, képpel vagy más formában.",
    "Tilos floodolni, spamelni, indokolatlanul tagelni.",
    "Tilos adminnak / vezetőségnek normális indok nélkül DM-et küldeni.",
    "Tilos az OOC kereskedelem és már annak szándéka is. Ez örök kitiltást vonhat maga után.",
    "Tilos sértő, obszcén, megtévesztő név vagy staff/vezetőségi név utánzása.",
    "Hangcsatornában tilos a zavaró hangkeltés, soundboard túlhasználata, DC MG és a staff előli kilépés ügyintézés közben.",
  ],

  BLOCKED_NAME_PATTERNS: [
    /admin/i,
    /moder[aá]tor/i,
    /owner/i,
    /tulaj/i,
    /internalgaming/i,
  ],
};

function getDefaultStore() {
  return {
    users: {},
    lastLogs: {},
    alertMessages: {},
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

function now() {
  return Date.now();
}

function cleanText(text, max = 1800) {
  const safe = String(text || "").replace(/\s+/g, " ").trim();
  if (!safe) return "";
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function trimField(text, max = 1024) {
  return cleanText(text, max) || "-";
}

function isStaff(member) {
  if (!member?.roles?.cache) return false;
  return CONFIG.STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function hasExemptRole(member) {
  if (!member?.roles?.cache) return false;
  return CONFIG.EXEMPT_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function isExemptChannel(channel) {
  if (!channel) return true;
  if (CONFIG.EXEMPT_CHANNEL_IDS.includes(channel.id)) return true;
  if (channel.parentId && CONFIG.EXEMPT_CATEGORY_IDS.includes(channel.parentId)) return true;
  return false;
}

function shouldIgnoreMessage(message) {
  if (!message?.guild) return true;
  if (message.author?.bot) return true;
  if (message.webhookId) return true;
  if (!message.member) return true;
  if (isStaff(message.member)) return true;
  if (hasExemptRole(message.member)) return true;
  if (isExemptChannel(message.channel)) return true;
  return false;
}

function safeMentionUser(userId) {
  return userId ? `<@${userId}>` : "Ismeretlen";
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

function getLogChannel(client) {
  if (!CONFIG.MOD_LOG_CHANNEL_ID || CONFIG.MOD_LOG_CHANNEL_ID.startsWith("IDE_")) return null;
  return client.channels.cache.get(CONFIG.MOD_LOG_CHANNEL_ID) || null;
}

function getUserProfile(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      incidents: [],
      recentMessages: [],
      lastAlertLevel: null,
      lastAlertAt: 0,
      lastIncidentLogAt: 0,
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
  const current = now();
  let risk = 0;

  for (const inc of profile.incidents || []) {
    const age = current - (inc.createdAt || current);
    let weight = 0;

    if (age <= 7 * 24 * 60 * 60 * 1000) weight = 1;
    else if (age <= 30 * 24 * 60 * 60 * 1000) weight = 0.65;
    else if (age <= 90 * 24 * 60 * 60 * 1000) weight = 0.25;
    else weight = 0.08;

    risk += (Number(inc.points || 0) * weight);
  }

  risk += (profile.totals?.timeouts || 0) * 10;
  risk += (profile.totals?.kicks || 0) * 24;
  risk += (profile.totals?.bans || 0) * 90;

  return Math.round(risk);
}

function getRecentIncidentCounts(profile) {
  const current = now();
  let last7d = 0;
  let last30d = 0;
  let serious7d = 0;
  let serious30d = 0;

  for (const inc of profile.incidents || []) {
    const age = current - (inc.createdAt || current);
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
    default: return CONFIG.TIMEOUT_MINUTES_LOW * 60 * 1000;
  }
}

function canModerateTarget(member) {
  if (!member?.guild?.members?.me) return false;
  const me = member.guild.members.me;
  if (member.id === me.id) return false;
  if (member.user?.bot) return false;
  return me.roles.highest.position > member.roles.highest.position;
}

function buildRulesText() {
  return CONFIG.RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

function similarityKey(category, reason, content) {
  return `${category || "other"}|${cleanText(reason || "", 120)}|${cleanText(content || "", 140)}`;
}

function getMessageLink(message) {
  try {
    return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
  } catch {
    return null;
  }
}

const REGEX = {
  invite: /(discord\.gg\/|discord\.com\/invite\/)/i,

  oocTrade:
    /\b(ooc keresked[eé]s|ooc trade|érdekel valakit|elad[oó] ig vagyon|ig vagyon elad[oó]|item elad[oó]|account elad[oó]|accountot eladom|veszek accountot|irl|val[óo]s ?p[eé]nz|forint|ft\b|eur[oó]|paypal|revolut|utal(ok|ás)?|bankk[aá]rtya|nitro|steam gift|giftcard|p[eé]nz[ée]rt adom|p[eé]nz[ée]rt veszem|ig vagyonért|accountért|itemért)\b/i,

  doxxing:
    /\b(facebook|fb profil|insta|instagram|telefonsz[aá]m|lakc[ií]m|c[ií]m[e]?|szem[eé]lyi|anyja neve|ad[óo]sz[aá]m|taj|priv[aá]t k[eé]p|nem publikus k[eé]p|kirakom a k[eé]p[eé]t|kirakom a facebookj[aá]t)\b/i,

  threat:
    /\b(meg[oö]llek|megverlek|sz[eé]tszedlek|kiny[ií]rlak|elkaplak|megtal[áa]llak|megkereslek|feljelentelek a csal[aá]dod|kicsinállak)\b/i,

  harassment:
    /\b(kurva any[aá]d|any[aá]d|nyomor[eé]k|retkes|patk[aá]ny|geci|id[ií]óta|majom|szarh[aá]zi|semmirekell[oő]|csicska|hülye vagy|rohadj meg|dogolj meg|dögölj meg)\b/i,

  staffAbuse:
    /\b(admin|moder[aá]tor|vezet[oő]s[eé]g|staff|fejleszt[oő]|szerver|internalgaming)\b.{0,30}\b(szar|szarh[aá]zi|retkes|nyomor[eé]k|hullad[eé]k|boh[oó]c|geci|fos|szutyok|szenny)\b/i,

  adServer:
    /\b(discord\.gg\/|discord\.com\/invite\/|gyertek|gyere fel|jöjjön mindenki|jöjjetek|gyertek át|fel mindenki|másik szerver|jobb szerver|jobb mint ez|ne legyen ezen a szerveren|itt rossz|át ide|tesztgaming|gazdagrp|szerverre|serverre)\b/i,

  nsfw:
    /\b(porn[oó]|18\+|nsfw|meztelen|szexk[eé]p|nudes?|farkad|pin[aá]|szop[aá]s|basz[aá]s|kuki|punci)\b/i,

  politics:
    /\b(n[aá]ci|zsid[oó]|cig[aá]nyok|rom[aá]k|fidesz|tisza|orb[aá]n|migr[aá]nsok)\b/i,

  vpnBanEvade:
    /\b(vpn|proxy|újra visszaj[oö]ttem|alt account|m[aá]sik account|ban evasion|bannoltak de visszaj[oö]ttem)\b/i,

  scam:
    /\b(ingyen nitro|free nitro|steam aj[aá]nd[eé]k|gift link|próbáld ki ezt a linket|token|bejelentkezés itt|login here|free csgo skin)\b/i,

  mentionAbuse: /<@!?\d+>/g,
  emoji: /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]/gu,
  repeatChars: /(.)\1{9,}/i,
};

function scanRules(message, recentSameUser = []) {
  const content = String(message.content || "");
  const lower = content.toLowerCase();

  const hits = [];
  let score = 0;

  if (!content.trim()) return { hits, score };

  if (REGEX.invite.test(content)) {
    hits.push({ key: "invite", points: 34, label: "Discord invite / reklám" });
    score += 34;
  }

  if (REGEX.oocTrade.test(content)) {
    hits.push({ key: "ooc_trade", points: 100, label: "OOC kereskedelem gyanú" });
    score += 100;
  }

  if (REGEX.doxxing.test(content)) {
    hits.push({ key: "doxxing", points: 74, label: "Privát adat / doxxing gyanú" });
    score += 74;
  }

  if (REGEX.threat.test(content)) {
    hits.push({ key: "threat", points: 60, label: "Fenyegetés gyanú" });
    score += 60;
  }

  if (REGEX.staffAbuse.test(content)) {
    hits.push({ key: "staff_abuse", points: 46, label: "Staff / szerver obszcén szidalmazása" });
    score += 46;
  }

  if (REGEX.harassment.test(content)) {
    hits.push({ key: "harassment", points: 32, label: "Célzott sértegetés / zaklatás gyanú" });
    score += 32;
  }

  if (REGEX.adServer.test(content)) {
    hits.push({ key: "ad_server", points: 55, label: "Más szerver reklám / uszítás" });
    score += 55;
  }

  if (REGEX.nsfw.test(content)) {
    hits.push({ key: "nsfw", points: 54, label: "NSFW / obszcén tartalom gyanú" });
    score += 54;
  }

  if (REGEX.politics.test(content)) {
    hits.push({ key: "politics_sensitive", points: 20, label: "Politikai / etnikai érzékeny tartalom" });
    score += 20;
  }

  if (REGEX.vpnBanEvade.test(content)) {
    hits.push({ key: "vpn_ban_evasion", points: 78, label: "VPN / ban evasion gyanú" });
    score += 78;
  }

  if (REGEX.scam.test(content)) {
    hits.push({ key: "scam", points: 90, label: "Scam / átverés gyanú" });
    score += 90;
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
        hits.push({ key: "caps_spam", points: 12, label: "Caps spam" });
        score += 12;
      }
    }
  }

  const dupes = recentSameUser.filter(
    (m) =>
      now() - (m.createdAt || 0) <= CONFIG.DUPLICATE_WINDOW_MS &&
      m.content &&
      m.content.toLowerCase() === lower &&
      lower.length >= 6
  ).length;

  if (dupes + 1 >= CONFIG.DUPLICATE_MIN_COUNT) {
    hits.push({ key: "duplicate_spam", points: 24, label: "Ismételt ugyanaz az üzenet" });
    score += 24;
  }

  const recentWindow = recentSameUser.filter(
    (m) => now() - (m.createdAt || 0) <= CONFIG.FLOOD_WINDOW_MS
  ).length;

  if (recentWindow + 1 >= CONFIG.FLOOD_MESSAGE_COUNT) {
    hits.push({ key: "flood", points: 26, label: "Flood / gyors üzenetáradat" });
    score += 26;
  }

  return { hits, score };
}

function shouldRunAi(ruleScore, content) {
  if (!content?.trim()) return false;
  if (ruleScore >= 8) return true;

  const suspiciousWords = [
    "admin", "moderátor", "szerver", "fenyeget", "megöl", "paypal",
    "revolut", "account", "pénzért", "discord.gg", "facebook",
    "telefonszám", "lakcím", "kurva", "nyomorék", "tesztgaming",
    "gazdagrp", "ooc kereskedés", "érdekel valakit", "jöjjön mindenki"
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
Te egy nagyon szigorú, nagyon figyelmes, kontextusérzékeny Discord moderációs AI vagy a(z) ${CONFIG.SERVER_NAME} szerveren.

Cél:
- Ne legyél enyhe.
- Ha a szöveg egyértelműen szabályszegő vagy erősen gyanús, azt határozottan jelöld.
- Különösen figyelj ezekre:
  1. zaklatás, sértegetés, megalázás, kifigurázás, célzott provokáció
  2. staff / admin / szerver obszcén szidalmazása
  3. fenyegetés
  4. privát adatok kiadása
  5. NSFW / obszcén tartalom
  6. más szerver hirdetése, csábítás, átcsalogatás
  7. flood / spam / tag abuse
  8. OOC kereskedelem és már annak szándéka is
  9. ban evasion / VPN / alt account gyanú
  10. scam

Szabályok:
${buildRulesText()}

Felhasználó:
- username: ${username || "ismeretlen"}
- displayName: ${displayName || "ismeretlen"}
- jelenlegi risk: ${currentRisk}
- előzmények: ${incidentSummary || "nincs"}

Szabályalapú találatok:
${JSON.stringify(ruleHits, null, 2)}

Kontextus:
${JSON.stringify(contextMessages, null, 2)}

Aktuális üzenet:
${messageContent}

Nagyon fontos:
- "ooc kereskedés", "érdekel valakit", "valós pénz", "paypal", "revolut", "account", "itemért pénz", "IG vagyonért pénz" -> erősen gyanús vagy tiltott OOC trade.
- "gyertek", "jöjjön mindenki", "gyertek át", más szervernév említése, "senki ne legyen ezen a szerveren", átcsalogatás -> reklám / uszítás.
- Staff vagy szerver obszcén minősítése -> komoly szabálysértés.
- Több kisebb szabálysértést is vehetsz komolynak, ha együtt problémás mintát adnak.

A válaszod KIZÁRÓLAG JSON legyen.
Pontozz határozottan. Ne legyél túl enyhe.

JSON:
{
  "category": "harassment | threat | staff_abuse | doxxing | nsfw | ad_server | spam | flood | ooc_trade | scam | ban_evasion | politics_sensitive | clean | other",
  "severity": "low | medium | high | critical",
  "confidence": 0,
  "points": 0,
  "targeted": false,
  "repeatOffenderWeight": 0,
  "ruleBroken": "rövid magyar szabály-megfogalmazás",
  "reason": "rövid, de határozott magyar indoklás",
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
        content: "Te csak és kizárólag érvényes JSON-t adhatsz vissza.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content?.trim() || "{}";

  try {
    return JSON.parse(content);
  } catch (error) {
    console.error("[AIMOD] AI JSON parse hiba:", error, content);
    return {
      category: "other",
      severity: "low",
      confidence: 25,
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
  return ["low", "medium", "high", "critical"].includes(value) ? value : "low";
}

function normalizeAction(value) {
  return ["ignore", "warn", "delete", "timeout", "kick", "ban"].includes(value) ? value : "ignore";
}

function finalDecision({ profile, ruleScan, aiResult }) {
  const currentRisk = getWeightedRisk(profile);
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
  if (recentCounts.serious30d >= 4) points += 24;
  if ((profile.totals?.timeouts || 0) >= 2) points += 12;
  if ((profile.totals?.kicks || 0) >= 1) points += 22;

  let action = normalizeAction(aiResult.recommendedAction);
  const confidence = Number(aiResult.confidence || 0);

  const hasImmediateTrade = ruleScan.hits.some((h) => h.key === "ooc_trade");
  const hasImmediateScam = ruleScan.hits.some((h) => h.key === "scam");
  const hasImmediateDox = ruleScan.hits.some((h) => h.key === "doxxing");
  const hasBanEvasion = ruleScan.hits.some((h) => h.key === "vpn_ban_evasion");
  const hasAdServer = ruleScan.hits.some((h) => h.key === "ad_server");
  const severe = ["high", "critical"].includes(severity);

  if (hasImmediateTrade) {
    action = "ban";
    points = Math.max(points, 100);
  }

  if (hasImmediateScam && confidence >= 70) {
    action = "ban";
    points = Math.max(points, 95);
  }

  if (hasImmediateDox && confidence >= 78) {
    action = "ban";
    points = Math.max(points, 94);
  }

  if (hasBanEvasion && confidence >= 75) {
    action = "ban";
    points = Math.max(points, 92);
  }

  if (hasAdServer && points >= 55 && action === "ignore") {
    action = "delete";
  }

  const projectedRisk = currentRisk + points;

  if (projectedRisk >= CONFIG.AUTO_BAN_READY_THRESHOLD && severe && confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_BAN) {
    action = "ban";
  } else if (projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD && severe && confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_KICK && action !== "ban") {
    action = "kick";
  } else if (projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD && confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_TIMEOUT && ["ignore", "warn", "delete"].includes(action)) {
    action = "timeout";
  }

  if (action === "ban" && !hasImmediateTrade && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_BAN) {
    action = projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD ? "kick" : "timeout";
  }

  if (action === "kick" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_KICK) {
    action = "timeout";
  }

  if (action === "timeout" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_TIMEOUT && !hasImmediateTrade) {
    action = "delete";
  }

  if (ruleScan.score >= 25 && action === "ignore") {
    action = "delete";
  }

  if (ruleScan.score >= 55 && ["ignore", "warn", "delete"].includes(action)) {
    action = "timeout";
  }

  if (ruleScan.score >= 90 && severe && confidence >= 72) {
    action = "ban";
  }

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

function buildIncidentEmbed({ message, member, final, profile, crossedStage }) {
  const risk = getWeightedRisk(profile);
  const color = colorBySeverity(final.severity);
  const emoji = emojiBySeverity(final.severity);
  const messageLink = getMessageLink(message);

  return new EmbedBuilder()
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

function buildBanActionEmbed({ guild, userId, reason, record }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aimod:unban:${userId}`)
      .setLabel("Unban")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`aimod:reviewok:${userId}`)
      .setLabel("Döntés helyes")
      .setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setColor(0xaa0000)
    .setTitle("🛑 Automata ban végrehajtva")
    .setDescription(
      [
        `**Felhasználó:** ${safeMentionUser(userId)}`,
        `**Guild:** ${trimField(guild?.name || "-", 256)}`,
        `**Végrehajtotta:** AI Moderation`,
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

async function sendOrEditAlertMessage(client, userId, embed) {
  const logChannel = getLogChannel(client);
  if (!logChannel) return null;

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
  const { userId, key, embed } = payload;
  const logChannel = getLogChannel(client);
  if (!logChannel) return null;

  const dedupeKey = `${userId}:${key}`;
  const last = store.lastLogs[dedupeKey];

  if (last && now() - last.at <= CONFIG.DEDUPE_SIMILAR_WINDOW_MS) {
    const oldMsg = await logChannel.messages.fetch(last.messageId).catch(() => null);
    if (oldMsg) {
      await oldMsg.edit({ embeds: [embed] }).catch(() => null);
      store.lastLogs[dedupeKey].at = now();
      saveStore();
      return oldMsg;
    }
  }

  const msg = await logChannel.send({ embeds: [embed] }).catch(() => null);
  if (msg) {
    store.lastLogs[dedupeKey] = {
      at: now(),
      messageId: msg.id,
    };
    saveStore();
  }

  return msg;
}

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
    await member.ban({ reason, deleteMessageSeconds });
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

  if (["delete", "timeout", "kick", "ban"].includes(final.action)) {
    deleteDone = await safeDeleteMessage(message);
    if (deleteDone) {
      profile.totals.deletions = (profile.totals.deletions || 0) + 1;
    }
  }

  if (final.action === "timeout" && canModerateTarget(member)) {
    const ok = await safeTimeout(member, final.timeoutMinutes || 60, reason);
    if (ok) {
      profile.totals.timeouts = (profile.totals.timeouts || 0) + 1;
      executedAction = "timeout";
      return { executedAction, deleteDone };
    }
  }

  if (final.action === "kick" && canModerateTarget(member)) {
    const ok = await safeKick(member, reason);
    if (ok) {
      profile.totals.kicks = (profile.totals.kicks || 0) + 1;
      executedAction = "kick";
      return { executedAction, deleteDone };
    }
  }

  if (final.action === "ban" && canModerateTarget(member)) {
    const ok = await safeBan(member, reason, 0);
    if (ok) {
      profile.totals.bans = (profile.totals.bans || 0) + 1;
      executedAction = "ban";

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
          userId: member.id,
          reason: final.reason,
          record: banRecord,
        });

        await logChannel.send({
          embeds: [embed],
          components: [row],
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
    if (!member?.guild) return;
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

async function processMessage(client, message) {
  if (shouldIgnoreMessage(message)) return;
  if (!message.content?.trim()) return;

  const member = message.member;
  const profile = getUserProfile(member.id);

  const recentSameUser = (profile.recentMessages || []).filter(
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
    severity: ruleScan.score >= 60 ? "high" : ruleScan.score >= 20 ? "medium" : "low",
    confidence: Math.min(96, Math.max(40, ruleScan.score)),
    points: ruleScan.score,
    targeted: false,
    repeatOffenderWeight: 0,
    ruleBroken: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályszegés gyanú",
    reason: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályalapú találat alapján problémás tartalom.",
    recommendedAction:
      ruleScan.score >= 90 ? "ban" :
      ruleScan.score >= 55 ? "timeout" :
      ruleScan.score >= 25 ? "delete" :
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
        return interaction.showModal(buildUnbanModal(userId));
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