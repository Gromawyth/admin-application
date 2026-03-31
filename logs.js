const {
  EmbedBuilder,
  AuditLogEvent,
  ChannelType,
  PermissionsBitField,
  MessageFlags
} = require("discord.js");
const { getState } = require("./systempanel");
/**
 * =========================
 *        BEÁLLÍTÁSOK
 * =========================
 */
const CONFIG = {
  TAG_LOG_CSATORNA_ID: "1459991439822815333",
  MOD_LOG_CSATORNA_ID: "1485721532297908355",
  UZENET_LOG_CSATORNA_ID: "1485721582616838385",
  CSATORNA_LOG_CSATORNA_ID: "1485721638006816778",
  RANG_LOG_CSATORNA_ID: "1485721832672985339",
  TICKET_LOG_CSATORNA_ID: "1485721884313129242",
  VOICE_LOG_CSATORNA_ID: "1485721923550838924",
  INTERAKCIO_LOG_CSATORNA_ID: "1485721973945532557",
  ASSET_LOG_CSATORNA_ID: "1485722116811788338",
  STAT_LOG_CSATORNA_ID: "1485707724514660453",
  ALTALANOS_LOG_CSATORNA_ID: "1485722992502898738",

  TICKET_KATEGORIA_ID: "1460215371666686077",
  TICKET_PREFIXEK: ["ticket-", "admin-", "help-", "support-", "report-", "unban-"],

  AUDIT_EGYEZES_MS: 30000,
  AUDIT_VARAKOZASOK_MS: [1200, 2500, 4000],
  MAX_MEZO_HOSSZ: 1000,
  UZENET_CACHE_LIMIT: 3000
};

/**
 * =========================
 *     NAPI STATISZTIKÁK
 * =========================
 */
const napiStatisztika = new Map();
const uzenetCache = new Map();

function maiKulcs(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statObjektum() {
  return {
    datum: maiKulcs(),
    csatlakozas: 0,
    kilepes: 0,
    kick: 0,
    ban: 0,
    unban: 0,
    toroltUzenet: 0,
    szerkesztettUzenet: 0,
    ticketEsemeny: 0,
    voiceBe: 0,
    voiceKi: 0
  };
}

function guildStat(guildId) {
  if (!napiStatisztika.has(guildId)) {
    napiStatisztika.set(guildId, statObjektum());
  }

  const adat = napiStatisztika.get(guildId);
  const ma = maiKulcs();

  if (adat.datum !== ma) {
    napiStatisztika.set(guildId, statObjektum());
  }

  return napiStatisztika.get(guildId);
}

/**
 * =========================
 *         SZÍNEK
 * =========================
 */
const SZINEK = {
  INFO: 0x0f172a,
  SIKER: 0x15803d,
  FIGYELMEZTETES: 0xd97706,
  HIBA: 0xdc2626,
  MODOSITAS: 0x2563eb,
  TICKET: 0x0891b2,
  INTERNAL_ZOLD: 0x16a34a
};

/**
 * =========================
 *   DISCORD JOGOSULTSÁGOK HU
 * =========================
 */
const PERMISSION_HU = {
  CreateInstantInvite: "Azonnali meghívó létrehozása",
  KickMembers: "Tagok kirúgása",
  BanMembers: "Tagok kitiltása",
  Administrator: "Adminisztrátor",
  ManageChannels: "Csatornák kezelése",
  ManageGuild: "Szerver kezelése",
  AddReactions: "Reakciók hozzáadása",
  ViewAuditLog: "Auditnapló megtekintése",
  PrioritySpeaker: "Elsőbbségi beszélő",
  Stream: "Képernyőmegosztás / stream",
  ViewChannel: "Csatorna megtekintése",
  SendMessages: "Üzenetek küldése",
  SendTTSMessages: "TTS üzenetek küldése",
  ManageMessages: "Üzenetek kezelése",
  EmbedLinks: "Linkek beágyazása",
  AttachFiles: "Fájlok csatolása",
  ReadMessageHistory: "Üzenetelőzmények megtekintése",
  MentionEveryone: "@everyone és @here említése",
  UseExternalEmojis: "Külső emojik használata",
  ViewGuildInsights: "Szerverstatisztikák megtekintése",
  Connect: "Csatlakozás voice csatornához",
  Speak: "Beszéd voice csatornában",
  MuteMembers: "Tagok némítása",
  DeafenMembers: "Tagok süketítése",
  MoveMembers: "Tagok áthelyezése",
  UseVAD: "Hangérzékelés használata",
  ChangeNickname: "Saját becenév módosítása",
  ManageNicknames: "Becenevek kezelése",
  ManageRoles: "Rangok kezelése",
  ManageWebhooks: "Webhookok kezelése",
  ManageEmojisAndStickers: "Emojik és matricák kezelése",
  ManageGuildExpressions: "Szerverkifejezések kezelése",
  UseApplicationCommands: "Parancsok használata",
  RequestToSpeak: "Beszédkérés",
  ManageEvents: "Események kezelése",
  ManageThreads: "Threadek kezelése",
  CreatePublicThreads: "Nyilvános thread létrehozása",
  CreatePrivateThreads: "Privát thread létrehozása",
  UseExternalStickers: "Külső matricák használata",
  SendMessagesInThreads: "Üzenetküldés threadekben",
  UseEmbeddedActivities: "Beágyazott aktivitások használata",
  ModerateMembers: "Tagok időkorlátozása",
  ViewCreatorMonetizationAnalytics: "Monetizációs statisztikák megtekintése",
  UseSoundboard: "Soundboard használata",
  CreateGuildExpressions: "Emojik / matricák létrehozása",
  CreateEvents: "Események létrehozása",
  UseExternalSounds: "Külső hangok használata",
  SendVoiceMessages: "Hangüzenetek küldése",
  SendPolls: "Szavazások küldése",
  UseExternalApps: "Külső alkalmazások használata",
  PinMessages: "Üzenetek kitűzése",
  BypassSlowmode: "Lassítás megkerülése"
};

/**
 * =========================
 *        SEGÉDEK
 * =========================
 */
function levag(szoveg, max = CONFIG.MAX_MEZO_HOSSZ) {
  if (szoveg === null || szoveg === undefined || szoveg === "") return "Nincs";
  const s = String(szoveg);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function spoilerSzoveg(szoveg, max = CONFIG.MAX_MEZO_HOSSZ) {
  const text = levag(szoveg, max - 4).replace(/`/g, "ˋ");
  return `\`${text}\``;
}

function igenNem(ertek) {
  return ertek ? "Igen" : "Nem";
}

function felhasznaloSzoveg(user) {
  if (!user) return "Ismeretlen";
  return `${user.tag || "Ismeretlen"} (${user.id || "?"})`;
}

function idoBelyeg(ms) {
  if (!ms) return "Ismeretlen";
  return `<t:${Math.floor(ms / 1000)}:F>`;
}

function internalEmbed(cim, szin, ikon = "🟢") {
  return new EmbedBuilder()
    .setColor(szin)
    .setTitle(`${ikon} internalGaming • ${cim}`)
    .setFooter({ text: "internalGaming • Naplózási rendszer" })
    .setTimestamp();
}

function alvas(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mentsUzenetCachebe(message) {
  if (!message?.id || message.author?.bot) return;

  uzenetCache.set(message.id, {
    content: message.content || "",
    authorId: message.author?.id || null,
    authorTag: message.author?.tag || "Ismeretlen",
    channelId: message.channel?.id || null,
    guildId: message.guild?.id || null,
    timestamp: Date.now()
  });

  if (uzenetCache.size > CONFIG.UZENET_CACHE_LIMIT) {
    const elsoKulcs = uzenetCache.keys().next().value;
    if (elsoKulcs) uzenetCache.delete(elsoKulcs);
  }
}

function torolUzenetCachebol(messageId) {
  if (messageId) uzenetCache.delete(messageId);
}

async function csatornaBetolt(client, csatornaId) {
  try {
    if (!csatornaId) return null;
    return await client.channels.fetch(csatornaId);
  } catch {
    return null;
  }
}

function celCsatornaId(kulcs) {
  const map = {
    tag: CONFIG.TAG_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    mod: CONFIG.MOD_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    uzenet: CONFIG.UZENET_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    csatorna: CONFIG.CSATORNA_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    rang: CONFIG.RANG_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    ticket: CONFIG.TICKET_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    voice: CONFIG.VOICE_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    interakcio: CONFIG.INTERAKCIO_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    asset: CONFIG.ASSET_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID,
    stat: CONFIG.STAT_LOG_CSATORNA_ID || CONFIG.ALTALANOS_LOG_CSATORNA_ID
  };

  return map[kulcs] || CONFIG.ALTALANOS_LOG_CSATORNA_ID || null;
}

async function kuldEmbed(client, logTipus, embed) {
    if (!getState("logs_enabled") && logTipus !== "stat") return;
  if (logTipus === "stat" && !getState("logs_daily_stats")) return;

  if (logTipus === "uzenet" && !getState("logs_message")) return;
  if (logTipus === "voice" && !getState("logs_voice")) return;
  if (logTipus === "ticket" && !getState("logs_ticket")) return;
  if (logTipus === "mod" && !getState("logs_moderation")) return;
  try {
    const csatornaId = celCsatornaId(logTipus);
    const ch = await csatornaBetolt(client, csatornaId);
    if (!ch || !ch.isTextBased()) return;
    await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[LOG][${logTipus}] Embed küldési hiba:`, err);
  }
}

function ticketCsatorna(csatorna) {
  if (!csatorna) return false;

  if (CONFIG.TICKET_KATEGORIA_ID && csatorna.parentId === CONFIG.TICKET_KATEGORIA_ID) {
    return true;
  }

  const nev = csatorna.name?.toLowerCase?.() || "";
  return CONFIG.TICKET_PREFIXEK.some((p) => nev.startsWith(p));
}

async function auditKereses(guild, tipus, targetId, maxKor = CONFIG.AUDIT_EGYEZES_MS) {
  try {
    const fetched = await guild.fetchAuditLogs({ type: tipus, limit: 10 });
    const now = Date.now();

    const talalat = fetched.entries.find((e) => {
      const joTarget = !targetId || e.target?.id === targetId;
      const friss = now - e.createdTimestamp < maxKor;
      return joTarget && friss;
    });

    return talalat || null;
  } catch {
    return null;
  }
}

async function auditKeresesKesleltetve(guild, tipus, targetId, maxKor = CONFIG.AUDIT_EGYEZES_MS) {
  for (const ido of CONFIG.AUDIT_VARAKOZASOK_MS) {
    await alvas(ido);
    const talalat = await auditKereses(guild, tipus, targetId, maxKor);
    if (talalat) return talalat;
  }
  return null;
}

function rangValtozasok(regiMember, ujMember) {
  const hozzaadva = [];
  const elveve = [];

  for (const [id, role] of ujMember.roles.cache) {
    if (!regiMember.roles.cache.has(id) && id !== ujMember.guild.id) {
      hozzaadva.push(role);
    }
  }

  for (const [id, role] of regiMember.roles.cache) {
    if (!ujMember.roles.cache.has(id) && id !== ujMember.guild.id) {
      elveve.push(role);
    }
  }

  return { hozzaadva, elveve };
}

function magyarJogosultsagNev(nev) {
  return PERMISSION_HU[nev] || nev;
}

function jogosultsagDiff(regiRole, ujRole) {
  const regi = new PermissionsBitField(regiRole.permissions.bitfield);
  const uj = new PermissionsBitField(ujRole.permissions.bitfield);

  const kapott = [];
  const elvesztett = [];

  for (const [nev, bit] of Object.entries(PermissionsBitField.Flags)) {
    const regiVolt = regi.has(bit);
    const ujVan = uj.has(bit);

    if (!regiVolt && ujVan) kapott.push(magyarJogosultsagNev(nev));
    if (regiVolt && !ujVan) elvesztett.push(magyarJogosultsagNev(nev));
  }

  return { kapott, elvesztett };
}

function csatornaTipusSzoveg(channel) {
  if (!channel) return "Ismeretlen";

  switch (channel.type) {
    case ChannelType.GuildText: return "Szöveges csatorna";
    case ChannelType.GuildVoice: return "Voice csatorna";
    case ChannelType.GuildCategory: return "Kategória";
    case ChannelType.GuildAnnouncement: return "Hír csatorna";
    case ChannelType.PublicThread: return "Nyilvános thread";
    case ChannelType.PrivateThread: return "Privát thread";
    case ChannelType.AnnouncementThread: return "Hír thread";
    case ChannelType.GuildStageVoice: return "Stage csatorna";
    case ChannelType.GuildForum: return "Fórum csatorna";
    default: return `Típus: ${channel.type}`;
  }
}

function diffSor(label, regi, uj) {
  return `⚪ **Módosítva** • ${label}\n> ${regi} → ${uj}`;
}

function hozzaadvaSor(label, ertekek) {
  if (!ertekek?.length) return null;
  return `🟢 **Hozzáadva** • ${label}\n> ${ertekek.join(", ")}`;
}

function elveveSor(label, ertekek) {
  if (!ertekek?.length) return null;
  return `🔴 **Elvéve** • ${label}\n> ${ertekek.join(", ")}`;
}

function buildStatEmbed(guild, stat, cim = "Napi szerverstatisztika", leiras = "Az aktuális összesített forgalmi és aktivitási adatok.") {
  const egyenleg = stat.csatlakozas - stat.kilepes;
  const szin =
    egyenleg > 0 ? SZINEK.SIKER :
    egyenleg < 0 ? SZINEK.HIBA :
    SZINEK.FIGYELMEZTETES;

  const aktivitasiSzint =
    stat.csatlakozas + stat.kilepes >= 20 ? "Magas" :
    stat.csatlakozas + stat.kilepes >= 8 ? "Közepes" :
    "Alacsony";

  return internalEmbed(cim, szin, "📊")
    .setDescription(leiras)
    .addFields(
      { name: "📅 Dátum", value: stat.datum, inline: true },
      { name: "📈 Aktivitási szint", value: aktivitasiSzint, inline: true },
      { name: "📌 Szerver", value: guild.name, inline: true },

      { name: "📥 Csatlakozások", value: String(stat.csatlakozas), inline: true },
      { name: "📤 Kilépések", value: String(stat.kilepes), inline: true },
      { name: "👢 Kickek", value: String(stat.kick), inline: true },

      { name: "🔨 Banok", value: String(stat.ban), inline: true },
      { name: "🔓 Unbanok", value: String(stat.unban), inline: true },
      { name: "➕ Napi egyenleg", value: `${egyenleg >= 0 ? "+" : ""}${egyenleg}`, inline: true },

      { name: "🗑️ Törölt üzenetek", value: String(stat.toroltUzenet), inline: true },
      { name: "✏️ Szerkesztett üzenetek", value: String(stat.szerkesztettUzenet), inline: true },
      { name: "🎫 Ticket események", value: String(stat.ticketEsemeny), inline: true },

      { name: "🔊 Voice belépések", value: String(stat.voiceBe), inline: true },
      { name: "🔇 Voice kilépések", value: String(stat.voiceKi), inline: true }
    );
}

/**
 * =========================
 *   NAPI STAT KÜLDÉSE
 * =========================
 */
async function napiStatKuldes(client) {
  for (const [guildId, stat] of napiStatisztika.entries()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const embed = buildStatEmbed(
      guild,
      stat,
      "Napi szerverstatisztika",
      "Az elmúlt nap összesített forgalmi és aktivitási adatai."
    );

    await kuldEmbed(client, "stat", embed);
    napiStatisztika.set(guildId, statObjektum());
  }
}

function msEjfelig() {
  const most = new Date();
  const kov = new Date(most);
  kov.setHours(24, 0, 5, 0);
  return kov.getTime() - most.getTime();
}

let napiStatTimeout = null;
let napiStatInterval = null;

function napiStatLeallitas() {
  if (napiStatTimeout) {
    clearTimeout(napiStatTimeout);
    napiStatTimeout = null;
  }

  if (napiStatInterval) {
    clearInterval(napiStatInterval);
    napiStatInterval = null;
  }
}

function napiStatIdozites(client) {
  napiStatLeallitas();

  if (!getState("logs_daily_stats")) {
    console.log("[LOG] A napi statisztika rendszer jelenleg ki van kapcsolva.");
    return;
  }

  napiStatTimeout = setTimeout(() => {
    if (getState("logs_daily_stats")) {
      napiStatKuldes(client).catch(console.error);
    }

    napiStatInterval = setInterval(() => {
      if (!getState("logs_daily_stats")) return;
      napiStatKuldes(client).catch(console.error);
    }, 24 * 60 * 60 * 1000);
  }, msEjfelig());
}

/**
 * =========================
 *        EXPORT
 * =========================
 */
module.exports = function registerLogs(client) {
  client.once("ready", () => {
      client.on("systempanel:logsDailyStatsChanged", async () => {
    try {
      napiStatIdozites(client);
      console.log("[LOG] Napi stat időzítés frissítve a panelből.");
    } catch (error) {
      console.error("[LOG] Napi stat újraütemezési hiba:", error);
    }
  });
    if (getState("logs_enabled")) {
      console.log("[LOG] internalGaming naplózási rendszer elindult.");
    } else {
      console.log("[LOG] A log rendszer jelenleg ki van kapcsolva.");
    }

    napiStatIdozites(client);
  });
  client.on("systempanel:sendManualStats", async (interaction) => {
    try {
      if (!interaction.guild) return;

      const stat = guildStat(interaction.guild.id);
      const embed = buildStatEmbed(
        interaction.guild,
        stat,
        "Kézi szerverstatisztika",
        "A vezérlőpultból kézzel lekért aktuális statisztika."
      );

      await kuldEmbed(client, "stat", embed);
    } catch (error) {
      console.error("[LOG] systempanel:sendManualStats hiba:", error);
    }
  });
  /**
   * ÜZENET CACHE
   */
  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;
      mentsUzenetCachebe(message);
    } catch (error) {
      console.error("[LOG] messageCreate cache hiba:", error);
    }
  });

  /**
   * TAGOK
   */
  client.on("guildMemberAdd", async (member) => {
    const stat = guildStat(member.guild.id);
    stat.csatlakozas++;

    const embed = internalEmbed("Új tag csatlakozott", SZINEK.SIKER, "📥")
      .setDescription(`${member.user} csatlakozott a szerverhez.`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "👤 Felhasználó", value: member.user.tag, inline: true },
        { name: "🆔 ID", value: member.id, inline: true },
        { name: "🕒 Fiók létrehozva", value: idoBelyeg(member.user.createdTimestamp), inline: false }
      );

    await kuldEmbed(client, "tag", embed);
  });

  client.on("guildMemberRemove", async (member) => {
    const stat = guildStat(member.guild.id);
    stat.kilepes++;

    const kick = await auditKeresesKesleltetve(member.guild, AuditLogEvent.MemberKick, member.id);

    if (kick) {
      stat.kick++;

      const embed = internalEmbed("Tag kickelve", SZINEK.FIGYELMEZTETES, "👢")
        .setDescription(`${member.user} eltávolításra került a szerverről.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "👤 Felhasználó", value: member.user.tag, inline: true },
          { name: "🆔 ID", value: member.id, inline: true },
          { name: "🛠️ Végrehajtotta", value: kick.executor ? felhasznaloSzoveg(kick.executor) : "Ismeretlen", inline: false },
          { name: "📄 Indok", value: kick.reason || "Nincs megadva", inline: false }
        );

      await kuldEmbed(client, "mod", embed);
      return;
    }

    const embed = internalEmbed("Tag kilépett", SZINEK.INFO, "📤")
      .setDescription(`${member.user} kilépett a szerverről.`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "👤 Felhasználó", value: member.user.tag, inline: true },
        { name: "🆔 ID", value: member.id, inline: true }
      );

    await kuldEmbed(client, "tag", embed);
  });

  /**
   * MODERÁCIÓ
   */
  client.on("guildBanAdd", async (ban) => {
    const stat = guildStat(ban.guild.id);
    stat.ban++;

    const entry = await auditKeresesKesleltetve(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    const embed = internalEmbed("Ban végrehajtva", SZINEK.HIBA, "🔨")
      .setDescription(`${ban.user} bannt kapott.`)
      .addFields(
        { name: "👤 Felhasználó", value: felhasznaloSzoveg(ban.user), inline: false },
        { name: "🛠️ Végrehajtotta", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false },
        { name: "📄 Indok", value: entry?.reason || "Nincs megadva", inline: false }
      );

    await kuldEmbed(client, "mod", embed);
  });

  client.on("guildBanRemove", async (ban) => {
    const stat = guildStat(ban.guild.id);
    stat.unban++;

    const entry = await auditKeresesKesleltetve(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);

    const embed = internalEmbed("Unban végrehajtva", SZINEK.SIKER, "🔓")
      .setDescription(`${ban.user} unbant kapott.`)
      .addFields(
        { name: "👤 Felhasználó", value: felhasznaloSzoveg(ban.user), inline: false },
        { name: "🛠️ Végrehajtotta", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "mod", embed);
  });

  /**
   * ÜZENETEK
   */
  client.on("messageDelete", async (message) => {
    try {
      if (!message.guild) return;

      if (message.partial) {
        await message.fetch().catch(() => null);
      }

      if (message.author?.bot) return;

      const stat = guildStat(message.guild.id);
      stat.toroltUzenet++;

      const ticket = ticketCsatorna(message.channel);
      if (ticket) stat.ticketEsemeny++;

      const cached = uzenetCache.get(message.id);

      const authorTag = message?.author?.tag || cached?.authorTag || "Ismeretlen";
      const authorId = message?.author?.id || cached?.authorId || "?";
      const channelText = message?.channel ? `${message.channel}` : "Ismeretlen csatorna";
      const tartalom =
        message?.content ||
        cached?.content ||
        "Nincs szöveges tartalom";

      const mezok = [
        { name: "👤 Felhasználó", value: `${authorTag} (${authorId})`, inline: false },
        { name: "💬 Csatorna", value: channelText, inline: true },
        { name: "📝 Törölt tartalom", value: spoilerSzoveg(tartalom), inline: false }
      ];

      if (ticket) {
        mezok.splice(2, 0, { name: "🎫 Ticket csatorna", value: "Igen", inline: true });
      }

      const embed = internalEmbed("Üzenet törölve", SZINEK.HIBA, "🗑️").addFields(...mezok);

      await kuldEmbed(client, ticket ? "ticket" : "uzenet", embed);
      torolUzenetCachebol(message.id);
    } catch (error) {
      console.error("[LOGS] messageDelete hiba:", error);
    }
  });

  client.on("messageUpdate", async (regi, uj) => {
    try {
      if (!uj.guild || uj.author?.bot) return;

      const regiTartalom = regi.content || uzenetCache.get(uj.id)?.content || "Nincs elérhető régi tartalom";
      const ujTartalom = uj.content || "Nincs tartalom";

      if (regiTartalom === ujTartalom) {
        mentsUzenetCachebe(uj);
        return;
      }

      const stat = guildStat(uj.guild.id);
      stat.szerkesztettUzenet++;

      const ticket = ticketCsatorna(uj.channel);
      if (ticket) stat.ticketEsemeny++;

      const mezok = [
        { name: "👤 Felhasználó", value: `${uj.author?.tag || "Ismeretlen"} (${uj.author?.id || "?"})`, inline: false },
        { name: "💬 Csatorna", value: `${uj.channel}`, inline: true },
        { name: "📄 Régi üzenet", value: spoilerSzoveg(regiTartalom), inline: false },
        { name: "📄 Új üzenet", value: spoilerSzoveg(ujTartalom), inline: false }
      ];

      if (ticket) {
        mezok.splice(2, 0, { name: "🎫 Ticket csatorna", value: "Igen", inline: true });
      }

      const embed = internalEmbed("Üzenet szerkesztve", SZINEK.MODOSITAS, "✏️").addFields(...mezok);

      await kuldEmbed(client, ticket ? "ticket" : "uzenet", embed);
      mentsUzenetCachebe(uj);
    } catch (error) {
      console.error("[LOGS] messageUpdate hiba:", error);
    }
  });

  /**
   * INTERAKCIÓK + KÉZI STAT PARANCS
   */
  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "discordstats") {
                if (!getState("logs_daily_stats")) {
          await interaction.reply({
            content: "❌ A napi statisztika rendszer jelenleg ki van kapcsolva.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }
        if (!interaction.guild) {
          await interaction.reply({
            content: "Ez a parancs csak szerveren használható.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const stat = guildStat(interaction.guild.id);
        const embed = buildStatEmbed(
          interaction.guild,
          stat,
          "Kézzel lekért szerverstatisztika",
          "Ez egy manuálisan kiküldött statisztika. A napi automatikus küldés ettől még külön, éjfél után 5 perccel fut le."
        );

        await kuldEmbed(client, "stat", embed);

        await interaction.reply({
          content: "✅ A statisztika elküldve a statisztika csatornába.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const mezok = [
        { name: "👤 Felhasználó", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
        { name: "🏠 Szerver", value: interaction.guild?.name || "DM", inline: true },
        { name: "💬 Csatorna", value: interaction.channel ? `<#${interaction.channel.id}>` : "Ismeretlen", inline: true }
      ];

      let cim = "Interakció";
      let ikon = "🧩";

      if (interaction.isChatInputCommand()) {
        cim = "Slash parancs használva";
        ikon = "⌨️";
        mezok.push({ name: "📌 Parancs", value: `/${interaction.commandName}`, inline: false });
      } else if (interaction.isButton()) {
        cim = "Gomb interakció";
        ikon = "🔘";
        mezok.push({ name: "🆔 Custom ID", value: interaction.customId || "Nincs", inline: false });
      } else if (interaction.isModalSubmit()) {
        cim = "Modal beküldés";
        ikon = "📝";
        mezok.push({ name: "🆔 Custom ID", value: interaction.customId || "Nincs", inline: false });
      } else if (interaction.isStringSelectMenu()) {
        cim = "Select menü használva";
        ikon = "📚";
        mezok.push({ name: "🆔 Custom ID", value: interaction.customId || "Nincs", inline: false });
      } else {
        return;
      }

      const ticket = (
        (interaction.channel && ticketCsatorna(interaction.channel)) ||
        interaction.customId?.toLowerCase?.().includes("ticket")
      );

      if (ticket) {
        const stat = interaction.guild ? guildStat(interaction.guild.id) : null;
        if (stat) stat.ticketEsemeny++;
        mezok.push({ name: "🎫 Ticket kapcsolat", value: "Igen", inline: true });
      }

      const embed = internalEmbed(cim, SZINEK.INTERNAL_ZOLD, ikon).addFields(...mezok);
      await kuldEmbed(client, ticket ? "ticket" : "interakcio", embed);
    } catch (error) {
      console.error("[LOGS] interactionCreate hiba:", error);
    }
  });

  /**
   * VOICE
   */
  client.on("voiceStateUpdate", async (regi, uj) => {
    try {
      const member = uj.member || regi.member;
      if (!member || !member.guild) return;

      const stat = guildStat(member.guild.id);
      let embed = null;

      if (!regi.channelId && uj.channelId) {
        stat.voiceBe++;
        embed = internalEmbed("Voice csatlakozás", SZINEK.SIKER, "🔊")
          .setDescription(`${member.user} belépett egy voice csatornába.`)
          .addFields(
            { name: "👤 Felhasználó", value: `${member.user.tag} (${member.id})`, inline: false },
            { name: "🎤 Csatorna", value: `<#${uj.channelId}>`, inline: false }
          );
      } else if (regi.channelId && !uj.channelId) {
        stat.voiceKi++;
        embed = internalEmbed("Voice kilépés", SZINEK.HIBA, "🔇")
          .setDescription(`${member.user} kilépett egy voice csatornából.`)
          .addFields(
            { name: "👤 Felhasználó", value: `${member.user.tag} (${member.id})`, inline: false },
            { name: "🎤 Csatorna", value: `<#${regi.channelId}>`, inline: false }
          );
      } else if (regi.channelId !== uj.channelId) {
        embed = internalEmbed("Voice csatorna váltás", SZINEK.FIGYELMEZTETES, "🔁")
          .addFields(
            { name: "👤 Felhasználó", value: `${member.user.tag} (${member.id})`, inline: false },
            { name: "⬅️ Előző", value: `<#${regi.channelId}>`, inline: true },
            { name: "➡️ Új", value: `<#${uj.channelId}>`, inline: true }
          );
      } else {
        const valtozasok = [];

        if (regi.serverMute !== uj.serverMute) {
          valtozasok.push(diffSor("Szerver némítás", igenNem(regi.serverMute), igenNem(uj.serverMute)));
        }
        if (regi.serverDeaf !== uj.serverDeaf) {
          valtozasok.push(diffSor("Szerver süketítés", igenNem(regi.serverDeaf), igenNem(uj.serverDeaf)));
        }
        if (regi.selfMute !== uj.selfMute) {
          valtozasok.push(diffSor("Ön némítás", igenNem(regi.selfMute), igenNem(uj.selfMute)));
        }
        if (regi.selfDeaf !== uj.selfDeaf) {
          valtozasok.push(diffSor("Ön süketítés", igenNem(regi.selfDeaf), igenNem(uj.selfDeaf)));
        }
        if (regi.streaming !== uj.streaming) {
          valtozasok.push(diffSor("Közvetítés", igenNem(regi.streaming), igenNem(uj.streaming)));
        }
        if (regi.selfVideo !== uj.selfVideo) {
          valtozasok.push(diffSor("Kamera", igenNem(regi.selfVideo), igenNem(uj.selfVideo)));
        }

        if (valtozasok.length) {
          embed = internalEmbed("Voice állapot módosult", SZINEK.MODOSITAS, "🎙️")
            .setDescription(valtozasok.join("\n\n"))
            .addFields({
              name: "👤 Felhasználó",
              value: `${member.user.tag} (${member.id})`,
              inline: false
            });
        }
      }

      if (embed) {
        await kuldEmbed(client, "voice", embed);
      }
    } catch (error) {
      console.error("[LOGS] voiceStateUpdate hiba:", error);
    }
  });

  /**
   * CSATORNÁK
   */
  client.on("channelCreate", async (channel) => {
    if (!channel.guild) return;

    const entry = await auditKeresesKesleltetve(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const ticket = ticketCsatorna(channel);
    if (ticket) guildStat(channel.guild.id).ticketEsemeny++;

    const embed = internalEmbed(
      ticket ? "Ticket csatorna létrehozva" : "Csatorna létrehozva",
      ticket ? SZINEK.TICKET : SZINEK.SIKER,
      ticket ? "🎫" : "📁"
    ).addFields(
      { name: "📌 Név", value: channel.name || "Ismeretlen", inline: true },
      { name: "🆔 ID", value: channel.id, inline: true },
      { name: "🧱 Típus", value: csatornaTipusSzoveg(channel), inline: true },
      { name: "🛠️ Létrehozta", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
    );

    await kuldEmbed(client, ticket ? "ticket" : "csatorna", embed);
  });

  client.on("channelDelete", async (channel) => {
    if (!channel.guild) return;

    const entry = await auditKeresesKesleltetve(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const ticket = ticketCsatorna(channel);
    if (ticket) guildStat(channel.guild.id).ticketEsemeny++;

    const embed = internalEmbed(
      ticket ? "Ticket csatorna törölve" : "Csatorna törölve",
      SZINEK.HIBA,
      ticket ? "🎫" : "🗑️"
    ).addFields(
      { name: "📌 Név", value: channel.name || "Ismeretlen", inline: true },
      { name: "🆔 ID", value: channel.id, inline: true },
      { name: "🧱 Típus", value: csatornaTipusSzoveg(channel), inline: true },
      { name: "🛠️ Törölte", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
    );

    await kuldEmbed(client, ticket ? "ticket" : "csatorna", embed);
  });

  client.on("channelUpdate", async (regi, uj) => {
    if (!uj.guild) return;

    const valtozasok = [];

    if (regi.name !== uj.name) {
      valtozasok.push(diffSor("Név", regi.name || "Nincs", uj.name || "Nincs"));
    }

    if ("topic" in regi && regi.topic !== uj.topic) {
      valtozasok.push(diffSor("Topic", regi.topic || "Nincs", uj.topic || "Nincs"));
    }

    if ("nsfw" in regi && regi.nsfw !== uj.nsfw) {
      valtozasok.push(diffSor("NSFW", igenNem(regi.nsfw), igenNem(uj.nsfw)));
    }

    if (regi.parentId !== uj.parentId) {
      valtozasok.push(diffSor("Kategória ID", regi.parentId || "Nincs", uj.parentId || "Nincs"));
    }

    if (!valtozasok.length) return;

    const entry = await auditKeresesKesleltetve(uj.guild, AuditLogEvent.ChannelUpdate, uj.id);
    const ticket = ticketCsatorna(uj);
    if (ticket) guildStat(uj.guild.id).ticketEsemeny++;

    const embed = internalEmbed(
      ticket ? "Ticket csatorna módosítva" : "Csatorna módosítva",
      ticket ? SZINEK.TICKET : SZINEK.MODOSITAS,
      ticket ? "🎫" : "✏️"
    )
      .setDescription(valtozasok.join("\n\n"))
      .addFields(
        { name: "💬 Csatorna", value: `${uj.name} (${uj.id})`, inline: false },
        { name: "🛠️ Módosította", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, ticket ? "ticket" : "csatorna", embed);
  });

  /**
   * THREAD
   */
  client.on("threadCreate", async (thread) => {
    if (!thread.guild) return;

    const embed = internalEmbed("Thread létrehozva", SZINEK.SIKER, "🧵")
      .addFields(
        { name: "📌 Név", value: thread.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: thread.id, inline: true },
        { name: "📂 Szülő csatorna", value: thread.parentId ? `<#${thread.parentId}>` : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, ticketCsatorna(thread.parent) ? "ticket" : "csatorna", embed);
  });

  client.on("threadDelete", async (thread) => {
    if (!thread.guild) return;

    const embed = internalEmbed("Thread törölve", SZINEK.HIBA, "🧵")
      .addFields(
        { name: "📌 Név", value: thread.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: thread.id, inline: true }
      );

    await kuldEmbed(client, "csatorna", embed);
  });

  client.on("threadUpdate", async (regi, uj) => {
    if (!uj.guild) return;

    const valtozasok = [];
    if (regi.name !== uj.name) valtozasok.push(diffSor("Név", regi.name || "Nincs", uj.name || "Nincs"));
    if (regi.archived !== uj.archived) valtozasok.push(diffSor("Archivált", igenNem(regi.archived), igenNem(uj.archived)));
    if (regi.locked !== uj.locked) valtozasok.push(diffSor("Zárolt", igenNem(regi.locked), igenNem(uj.locked)));

    if (!valtozasok.length) return;

    const embed = internalEmbed("Thread módosítva", SZINEK.MODOSITAS, "🧵")
      .setDescription(valtozasok.join("\n\n"))
      .addFields(
        { name: "📌 Thread", value: `${uj.name || "Ismeretlen"} (${uj.id})`, inline: false }
      );

    await kuldEmbed(client, "csatorna", embed);
  });

  /**
   * RANGOK
   */
  client.on("roleCreate", async (role) => {
    const entry = await auditKeresesKesleltetve(role.guild, AuditLogEvent.RoleCreate, role.id);

    const embed = internalEmbed("Rang létrehozva", SZINEK.SIKER, "🆕")
      .addFields(
        { name: "🏷️ Rang", value: role.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: role.id, inline: true },
        { name: "🛠️ Létrehozta", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "rang", embed);
  });

  client.on("roleDelete", async (role) => {
    const entry = await auditKeresesKesleltetve(role.guild, AuditLogEvent.RoleDelete, role.id);

    const embed = internalEmbed("Rang törölve", SZINEK.HIBA, "🗑️")
      .addFields(
        { name: "🏷️ Rang", value: role.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: role.id, inline: true },
        { name: "🛠️ Törölte", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "rang", embed);
  });

  client.on("roleUpdate", async (regi, uj) => {
    const valtozasok = [];

    if (regi.name !== uj.name) {
      valtozasok.push(diffSor("Rang neve", regi.name || "Nincs", uj.name || "Nincs"));
    }

    if (regi.hexColor !== uj.hexColor) {
      valtozasok.push(diffSor("Szín", regi.hexColor || "Nincs", uj.hexColor || "Nincs"));
    }

    if (regi.hoist !== uj.hoist) {
      valtozasok.push(diffSor("Külön megjelenítés", igenNem(regi.hoist), igenNem(uj.hoist)));
    }

    if (regi.mentionable !== uj.mentionable) {
      valtozasok.push(diffSor("Megemlíthető", igenNem(regi.mentionable), igenNem(uj.mentionable)));
    }

    const diff = jogosultsagDiff(regi, uj);

    const hozzaadva = hozzaadvaSor("Jogosultságok", diff.kapott);
    const elveve = elveveSor("Jogosultságok", diff.elvesztett);

    if (hozzaadva) valtozasok.push(hozzaadva);
    if (elveve) valtozasok.push(elveve);

    if (!valtozasok.length) return;

    const entry = await auditKeresesKesleltetve(uj.guild, AuditLogEvent.RoleUpdate, uj.id);

    const embed = internalEmbed("Rang / jogosultság módosítva", SZINEK.MODOSITAS, "🛡️")
      .setDescription(valtozasok.join("\n\n"))
      .addFields(
        { name: "🏷️ Rang", value: `${uj.name || "Ismeretlen"} (${uj.id})`, inline: false },
        { name: "🛠️ Módosította", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "rang", embed);
  });

  /**
   * TAG MÓDOSÍTÁSOK
   */
  client.on("guildMemberUpdate", async (regi, uj) => {
    const { hozzaadva, elveve } = rangValtozasok(regi, uj);

    if (hozzaadva.length || elveve.length) {
      const entry = await auditKeresesKesleltetve(uj.guild, AuditLogEvent.MemberRoleUpdate, uj.id);

      const sorok = [];
      const hozza = hozzaadvaSor("Rangok", hozzaadva.map((r) => `${r}`));
      const elv = elveveSor("Rangok", elveve.map((r) => `${r}`));

      if (hozza) sorok.push(hozza);
      if (elv) sorok.push(elv);

      const embed = internalEmbed("Tag rangjai módosultak", SZINEK.MODOSITAS, "👤")
        .setDescription(sorok.join("\n\n"))
        .addFields(
          { name: "👤 Érintett tag", value: `${uj.user.tag} (${uj.id})`, inline: false },
          { name: "🛠️ Módosította", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
        );

      await kuldEmbed(client, "rang", embed);
    }

    if (regi.nickname !== uj.nickname) {
      const entry = await auditKeresesKesleltetve(uj.guild, AuditLogEvent.MemberUpdate, uj.id);

      const embed = internalEmbed("Nick módosítás", SZINEK.MODOSITAS, "🧑‍💻")
        .setDescription(diffSor("Becenév", regi.nickname || "Nincs", uj.nickname || "Nincs"))
        .addFields(
          { name: "👤 Felhasználó", value: `${uj.user.tag} (${uj.id})`, inline: false },
          { name: "🛠️ Módosította", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
        );

      await kuldEmbed(client, "tag", embed);
    }
  });

  /**
   * EMOJI
   */
  client.on("emojiCreate", async (emoji) => {
    const entry = await auditKeresesKesleltetve(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);

    const embed = internalEmbed("Emoji létrehozva", SZINEK.SIKER, "😀")
      .addFields(
        { name: "😀 Emoji", value: `${emoji}`, inline: true },
        { name: "📌 Név", value: emoji.name || "Ismeretlen", inline: true },
        { name: "🛠️ Létrehozta", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "asset", embed);
  });

  client.on("emojiDelete", async (emoji) => {
    const entry = await auditKeresesKesleltetve(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);

    const embed = internalEmbed("Emoji törölve", SZINEK.HIBA, "😀")
      .addFields(
        { name: "📌 Név", value: emoji.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: emoji.id, inline: true },
        { name: "🛠️ Törölte", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "asset", embed);
  });

  client.on("emojiUpdate", async (regi, uj) => {
    const entry = await auditKeresesKesleltetve(uj.guild, AuditLogEvent.EmojiUpdate, uj.id);

    const embed = internalEmbed("Emoji módosítva", SZINEK.MODOSITAS, "😀")
      .setDescription(diffSor("Emoji neve", regi.name || "Ismeretlen", uj.name || "Ismeretlen"))
      .addFields(
        { name: "🛠️ Módosította", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "asset", embed);
  });

  /**
   * STICKER
   */
  client.on("stickerCreate", async (sticker) => {
    const entry = await auditKeresesKesleltetve(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);

    const embed = internalEmbed("Sticker létrehozva", SZINEK.SIKER, "🧷")
      .addFields(
        { name: "📌 Név", value: sticker.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: sticker.id, inline: true },
        { name: "🛠️ Létrehozta", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "asset", embed);
  });

  client.on("stickerDelete", async (sticker) => {
    const entry = await auditKeresesKesleltetve(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);

    const embed = internalEmbed("Sticker törölve", SZINEK.HIBA, "🧷")
      .addFields(
        { name: "📌 Név", value: sticker.name || "Ismeretlen", inline: true },
        { name: "🆔 ID", value: sticker.id, inline: true },
        { name: "🛠️ Törölte", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "asset", embed);
  });

  client.on("stickerUpdate", async (regi, uj) => {
    const entry = await auditKeresesKesleltetve(uj.guild, AuditLogEvent.StickerUpdate, uj.id);

    const embed = internalEmbed("Sticker módosítva", SZINEK.MODOSITAS, "🧷")
      .setDescription(diffSor("Sticker neve", regi.name || "Ismeretlen", uj.name || "Ismeretlen"))
      .addFields(
        { name: "🛠️ Módosította", value: entry?.executor ? felhasznaloSzoveg(entry.executor) : "Ismeretlen", inline: false }
      );

    await kuldEmbed(client, "asset", embed);
  });
};