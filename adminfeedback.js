const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { getState } = require("./systempanel");
// =========================
// ⚙️ BEÁLLÍTÁSOK
// =========================

const LOG_CHANNEL_ID =
  process.env.ADMIN_FEEDBACK_LOG_CHANNEL_ID || "1485371309784563933";

const SUMMARY_CHANNEL_ID =
  process.env.ADMIN_FEEDBACK_SUMMARY_CHANNEL_ID || "1485392296714174544";

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");

const DATA_FILE = path.join(DATA_DIR, "adminfeedback-data.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================
// 👮 ADMINOK
// =========================
// Itt írd át az adminokat a sajátjaidra, ha kell.

const admins = [
  {
    id: "1",
    name: "Lana",
    level: "Manager",
    desc:
      "Sziasztok! Gromawyth vagyok." +
      "A szerveren Lead Administrator szerepet töltök be, ahol a fő feladatom a közösség stabil működésének fenntartása és az adminsegéd csapat koordinálása." +
      "Számomra kiemelten fontos a korrekt és átlátható döntéshozatal, ezért minden helyzetben igyekszem pártatlanul, higgadtan és a szabályoknak megfelelően eljárni. Konfliktusos esetén mindig meghallgatom az érintett feleket, és csak ezután hozok döntést." +
      "Nagy hangsúlyt fektetek arra, hogy a szerver egy élvezhető és igazságos környezet maradjon minden játékos számára. Ha kérdésed van, vagy segítségre van szükséged, nyugodtan fordulj hozzám."
  },
  {
    id: "2",
    name: "Gromawyth 2",
    level: "Administrator",
    desc:
      "Segítőkész és aktív adminisztrátor vagyok, aki igyekszik gyorsan és pontosan kezelni a felmerülő ügyeket. Fontos számomra a kulturált kommunikáció és a következetes döntéshozatal."
  },
  {
    id: "3",
    name: "Gromawyth 3",
    level: "Adminsegéd",
    desc:
      "Kiemelten figyelek az új játékosok támogatására és a kisebb ügyek gyors rendezésére. Fontosnak tartom, hogy mindenki korrekt bánásmódban részesüljön."
  },
  {
    id: "4",
    name: "Gromawyth 4",
    level: "Adminsegéd",
    desc:
      "Kiemelten figyelek az új játékosok támogatására és a kisebb ügyek gyors rendezésére. Fontosnak tartom, hogy mindenki korrekt bánásmódban részesüljön."
  },
  {
    id: "5",
    name: "Gromawyth 5",
    level: "Adminsegéd",
    desc:
      "Kiemelten figyelek az új játékosok támogatására és a kisebb ügyek gyors rendezésére. Fontosnak tartom, hogy mindenki korrekt bánásmódban részesüljön."
  }
];

// =========================
// 💾 JSON BETÖLTÉS / MENTÉS
// =========================

function getDefaultStore() {
  return {
    ratings: {},
    summaryData: {},
    summaryMessages: {},
    panelMessages: {},
    rulesMessageId: null
  };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(getDefaultStore(), null, 2),
        "utf8"
      );
      return getDefaultStore();
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) {
      return getDefaultStore();
    }

    const parsed = JSON.parse(raw);

    return {
      ratings: parsed.ratings || {},
      summaryData: parsed.summaryData || {},
      summaryMessages: parsed.summaryMessages || {},
      panelMessages: parsed.panelMessages || {},
      rulesMessageId: parsed.rulesMessageId || null
    };
  } catch (error) {
    console.error("❌ Hiba a JSON betöltésekor:", error);
    return getDefaultStore();
  }
}

let loadedData = loadData();
let data = loadedData.ratings; // resetelhető, élő adatok
let summaryData = loadedData.summaryData; // tartós, AI/összesítő adatok
let summaryMessages = loadedData.summaryMessages;
let panelMessages = loadedData.panelMessages;
let rulesMessageId = loadedData.rulesMessageId;

function saveData() {
  try {
    const payload = {
      ratings: data,
      summaryData,
      summaryMessages,
      panelMessages,
      rulesMessageId
    };

    console.log("💾 Mentés indul...");
    console.log("📁 DATA_FILE:", DATA_FILE);
    console.log("🧾 Mentett adat:", JSON.stringify(payload, null, 2));

    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("✅ JSON mentve");
  } catch (error) {
    console.error("❌ Hiba a JSON mentésekor:", error);
  }
}

// =========================
// 🧩 SEGÉDFÜGGVÉNYEK
// =========================

function getMonthKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getData(adminId) {
  if (!data[adminId]) {
    data[adminId] = {
      pos: 0,
      neg: 0,
      reviews: [],
      userMonthly: {}
    };
  }
  return data[adminId];
}

function getSummaryData(adminId) {
  if (!summaryData[adminId]) {
    summaryData[adminId] = {
      pos: 0,
      neg: 0,
      reviews: []
    };
  }
  return summaryData[adminId];
}

function getUserTotalRatings(userId) {
  let total = 0;

  for (const adminId of Object.keys(data)) {
    const adminData = data[adminId];
    if (!adminData?.reviews?.length) continue;

    for (const review of adminData.reviews) {
      if (review.user === userId) total++;
    }
  }

  return total;
}

function getAdminName(adminId) {
  const admin = admins.find(a => a.id === adminId);
  return admin ? admin.name : "Ismeretlen admin";
}

function trimText(text, max = 1024) {
  const value = String(text || "").trim() || "Nincs megadva";
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

function getPercent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function getRatingBar(pos, neg) {
  const total = pos + neg;
  if (total === 0) return "░░░░░░░░░░";

  const positiveBlocks = Math.round((pos / total) * 10);
  const negativeBlocks = 10 - positiveBlocks;

  return "🟩".repeat(positiveBlocks) + "🟥".repeat(negativeBlocks);
}

async function fetchGuildChannel(guild, channelId) {
  if (!guild || !channelId || channelId.startsWith("IDE_")) return null;

  return guild.channels.cache.get(channelId) ||
    await guild.channels.fetch(channelId).catch(() => null);
}

function getRecentSummaryReviews(adminId, limit = 20) {
  const stats = getSummaryData(adminId);

  return [...stats.reviews]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

function buildFallbackSummary(adminId) {
  const admin = admins.find(a => a.id === adminId);
  const stats = getSummaryData(adminId);
  const total = stats.pos + stats.neg;

  if (!admin || total === 0 || !stats.reviews.length) {
    return "Nincs még beérkező válasz.";
  }

  const latest = stats.reviews[stats.reviews.length - 1];
  const typeLabel = latest.type === "pos" ? "pozitív" : "negatív";
  const balanceText =
    stats.pos > stats.neg
      ? "inkább pozitív"
      : stats.neg > stats.pos
        ? "inkább negatív"
        : "vegyes";

  return (
    `${admin.name} adminról eddig ${total} értékelés érkezett, amelyek alapján már kialakítható egy kezdeti összkép. ` +
    `A visszajelzések aránya jelenleg ${balanceText}, hiszen ${stats.pos} pozitív és ${stats.neg} negatív értékelés szerepel az összesítőben. ` +
    `A legutóbbi vélemény ${typeLabel} jellegű volt, és a beküldő főként a következőket emelte ki: ${trimText(latest.strengths || "nincs megadva", 220)}. ` +
    `A leírt szituáció alapján az admin megítélésében fontos szerepet játszik a kommunikáció, a döntéshozatal gyorsasága és az ügyek kezelésének minősége. ` +
    `A jelenlegi összesítő minden eddig eltárolt véleményt figyelembe vesz, ezért az összkép folyamatosan pontosodik az új visszajelzésekkel.`
  );
}

// =========================
// 🤖 AI ÖSSZEGZÉS
// =========================

async function generateAiSummary(adminId) {
  if (!getState("adminfeedback_ai_summary")) {
    return buildFallbackSummary(adminId);
  }
  const admin = admins.find(a => a.id === adminId);
  const stats = getSummaryData(adminId);

  if (!admin || !stats.reviews.length) {
    return "Nincs még beérkező válasz.";
  }

  const recentReviews = getRecentSummaryReviews(adminId, 5);

const reviewsText = recentReviews.map((review, index) => {
  const typeLabel = review.type === "pos" ? "Pozitív" : "Negatív";

  const fullText = `
${review.situation || ""}
${review.reason || ""}
${review.strengths || ""}
${review.extra || ""}
`.trim();

  return `
${index + 1}. értékelés (${typeLabel}):
${fullText}
`;
}).join("\n\n");

  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackSummary(adminId);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `
Egy GTA RP szerver admin értékeléseit látod.

Feladat:
Írj egy rövid, tömör és konkrét véleményt az adminról maximum 4 mondatban semmiképp ne írj többet 4 mondatnál.

Fontos szabályok:
- Ne fogalmazz hivatalosan.
- Ne írj hosszú összefoglalót.
- Ne általánosságban beszélj, hanem a konkrét értékelések alapján írj.
- Az összes megadott szöveget együtt értelmezd, ne csak egy mezőt nézz.
- Ha sértő, lekezelő vagy bunkó viselkedés szerepel bármelyik értékelésben, azt mindenképp említsd meg.
- Ha pozitív és negatív dolog is van, mindkettőt röviden írd le.
- A végén legyen egyértelmű a véleményed róla.

Stílus:
- Úgy írj, mintha egy játékos mondaná.
- Legyél kritikus, őszinte és egyenes.
- Ne legyél diplomatikus, inkább kritikus!`
        },
        {
          role: "user",
          content:
            `Admin neve: ${admin.name}\n` +
            `Szint: ${admin.level}\n` +
            `Pozitív értékelések száma: ${stats.pos}\n` +
            `Negatív értékelések száma: ${stats.neg}\n\n` +
            `Összes eddigi beérkező válasz:\n${reviewsText}`
        }
      ]
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    return content || buildFallbackSummary(adminId);
  } catch (error) {
    console.error("❌ AI összegzés hiba:", error);
    return buildFallbackSummary(adminId);
  }
}

// =========================
// 🎨 EMBED ÉPÍTŐK
// =========================

function buildRulesEmbed() {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("📜 Értékelési szabályzat")
    .setDescription("🧾 Kérünk, hogy minden véleményt kulturáltan, valós tapasztalat alapján írj meg.")
    .addFields(
      {
        name: "⚖️ Alapelvek",
        value:
          "• Egy játékos havonta legfeljebb **3 értékelést** adhat ugyanarra az adminra.\n" +
          "• Az értékelésnek valódi tapasztalaton kell alapulnia.\n" +
          "• Indoklás nélkül vagy troll célból ne küldj értékelést.",
        inline: false
      },
      {
        name: "🔍 Fontos tudnivalók",
        value:
          "• A válaszok a vezetőség számára láthatók.\n" +
          "• A visszaélések szankciót vonhatnak maguk után.\n" +
          "• Minden beküldés naplózásra kerül.",
        inline: false
      }
    )
    .setFooter({ text: "🙏 Köszönjük a kulturált és őszinte visszajelzéseket." });
}

function buildAdminPanelEmbed(admin, stats) {
  const total = stats.pos + stats.neg;
  const posPercent = getPercent(stats.pos, total);
  const negPercent = getPercent(stats.neg, total);
  const bar = getRatingBar(stats.pos, stats.neg);

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`⭐ ${admin.name}`)
    .setDescription(
      `🏷️ **Szint:** ${admin.level}\n\n💬 **Bemutatkozás:**\n${admin.desc}`
    )
    .addFields(
      {
        name: "📊 Értékelési összesítés",
        value:
          `🟢 Pozitív: **${stats.pos}** (${posPercent}%)\n` +
          `🔴 Negatív: **${stats.neg}** (${negPercent}%)\n` +
          `📦 Összes értékelés: **${total}**`,
        inline: true
      },
      {
        name: "📈 Visszajelzési arány",
        value: `${bar}`,
        inline: true
      }
    )
    .setFooter({ text: "👇 Válassz alul pozitív vagy negatív értékelést." });
}

function buildAdminButtons(adminId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`feedback_pos_${adminId}`)
      .setLabel("Pozitív értékelés")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`feedback_neg_${adminId}`)
      .setLabel("Negatív értékelés")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildSummaryEmbed(admin, stats, aiSummary) {
  const total = stats.pos + stats.neg;
  const posPercent = getPercent(stats.pos, total);
  const negPercent = getPercent(stats.neg, total);
  const bar = getRatingBar(stats.pos, stats.neg);

  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`📌 ${admin.name}`)
    .setDescription(
      `🏷️ **Szint:** ${admin.level}\n` +
      `🔄 **Állapot:** Folyamatosan frissülő összesítő`
    )
    .addFields(
      {
        name: "📊 Értékelési összesítés",
        value:
          `🟢 Pozitív: **${stats.pos}** (${posPercent}%)\n` +
          `🔴 Negatív: **${stats.neg}** (${negPercent}%)\n` +
          `📦 Összes: **${total}**`,
        inline: true
      },
      {
        name: "📈 Arány",
        value: `${bar}`,
        inline: true
      },
      {
        name: "🤖 AI leírás",
        value: trimText(aiSummary || "Nincs még beérkező válasz.", 1024),
        inline: false
      }
    )
    .setFooter({ text: "📘 Admin értékelési összesítő" })
    .setTimestamp();
}

function buildLogEmbed({
  type,
  adminName,
  userId,
  situation,
  reason,
  strengths,
  extra,
  userMonthlyCount,
  totalSoFar
}) {
  return new EmbedBuilder()
    .setColor(type === "pos" ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${type === "pos" ? "🟢 Pozitív" : "🔴 Negatív"} admin értékelés`)
    .setDescription(
      `👮 **Admin neve:** ${trimText(adminName)}\n` +
      `👤 **Beküldte:** <@${userId}>\n` +
      `🏷️ **Típus:** ${type === "pos" ? "Pozitív" : "Negatív"}`
    )
    .addFields(
      {
        name: "🧩 Milyen szituációban találkoztál vele?",
        value: trimText(situation),
        inline: false
      },
      {
        name: "💭 Miért értékeled így az admint?",
        value: trimText(reason),
        inline: false
      },
      {
        name: "⭐ Milyen erősségei vagy hibái voltak?",
        value: trimText(strengths),
        inline: false
      },
      {
        name: "📝 További megjegyzés",
        value: trimText(extra),
        inline: false
      },
      {
        name: "📊 Statisztika",
        value:
          `• Ennél az adminnál ebben a hónapban: **${userMonthlyCount}/3**\n` +
          `• Felhasználó összes értékelése: **${totalSoFar}**`,
        inline: false
      }
    )
    .setFooter({ text: "📚 Admin értékelési napló" })
    .setTimestamp();
}

// =========================
// 📌 ÖSSZESÍTŐ CSATORNA
// =========================

async function createOrUpdateSummary(guild, adminId) {
  const channel = await fetchGuildChannel(guild, SUMMARY_CHANNEL_ID);
  if (!channel) return;

  const admin = admins.find(a => a.id === adminId);
  if (!admin) return;

  const stats = getSummaryData(adminId);
  const aiSummary = await generateAiSummary(adminId);
  const embed = buildSummaryEmbed(admin, stats, aiSummary);

  if (!summaryMessages[adminId]) {
    const msg = await channel.send({ embeds: [embed] });
    summaryMessages[adminId] = msg.id;
    saveData();
    return;
  }

  try {
    const msg = await channel.messages.fetch(summaryMessages[adminId]);
    await msg.edit({ embeds: [embed] });
  } catch {
    const msg = await channel.send({ embeds: [embed] });
    summaryMessages[adminId] = msg.id;
    saveData();
  }
}

async function rebuildAllSummaries(guild) {
  if (!getState("adminfeedback_enabled")) return;
  for (const admin of admins) {
    await createOrUpdateSummary(guild, admin.id);
  }
}

// =========================
// 📤 PANEL KÜLDÉS
// =========================
console.log("📤 /adminpanel elindult");
console.log("📁 Mentési útvonal:", DATA_FILE);
async function sendPanel(interaction) {
  if (!getState("adminfeedback_enabled")) {
    await interaction.reply({
      content: "❌ Az admin feedback rendszer jelenleg ki van kapcsolva.",
      ephemeral: true
    }).catch(() => {});
    return;
  }
  for (const admin of admins) {
    const stats = getData(admin.id);
    const embed = buildAdminPanelEmbed(admin, stats);
    const row = buildAdminButtons(admin.id);

    if (!panelMessages[admin.id]) {
      const msg = await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });
      panelMessages[admin.id] = msg.id;
      saveData();
    } else {
      try {
        const msg = await interaction.channel.messages.fetch(panelMessages[admin.id]);
        await msg.edit({
          embeds: [embed],
          components: [row]
        });
      } catch {
        const msg = await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });
        panelMessages[admin.id] = msg.id;
        saveData();
      }
    }

    await createOrUpdateSummary(interaction.guild, admin.id);
  }

  const rulesEmbed = buildRulesEmbed();

  if (!rulesMessageId) {
    const msg = await interaction.channel.send({
      embeds: [rulesEmbed]
    });
    rulesMessageId = msg.id;
    saveData();
  } else {
    try {
      const msg = await interaction.channel.messages.fetch(rulesMessageId);
      await msg.edit({ embeds: [rulesEmbed] });
    } catch {
      const msg = await interaction.channel.send({
        embeds: [rulesEmbed]
      });
      rulesMessageId = msg.id;
      saveData();
    }
  }

  await interaction.reply({
    content: "✅ Az admin értékelő panelek kiküldve és frissítve.",
    ephemeral: true
  });
}

// =========================
// 🔘 GOMBKEZELÉS
// =========================

async function handleButton(interaction) {
  if (!getState("adminfeedback_enabled")) {
    return;
  }

  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("feedback_")) return;

  if (!getState("adminfeedback_accept_new_reviews")) {
    await interaction.reply({
      content: "❌ Új admin értékelések jelenleg fel vannak függesztve.",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  const [, type, adminId] = interaction.customId.split("_");
  const adminName = getAdminName(adminId);

  const modal = new ModalBuilder()
    .setCustomId(`feedback_modal_${type}_${adminId}`)
    .setTitle(`${type === "pos" ? "Pozitív" : "Negatív"} értékelés`);

  const input1 = new TextInputBuilder()
    .setCustomId("situation")
    .setLabel("Milyen szituációban találkoztál vele?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder(`Írd le röviden, milyen helyzetben kerültél kapcsolatba vele (${adminName}).`);

  const input2 = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Miért értékeled így az admint?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder("Írd le röviden, mi alapján alakult ki a véleményed.");

  const input3 = new TextInputBuilder()
    .setCustomId("strengths")
    .setLabel("Milyen erősségei vagy hibái voltak?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder("Pl. gyors, türelmes, segítőkész / lassú, lekezelő, pontatlan.");

  const input4 = new TextInputBuilder()
    .setCustomId("extra")
    .setLabel("Van még valami fontos, amit hozzátennél?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Ez a mező opcionális.");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input1),
    new ActionRowBuilder().addComponents(input2),
    new ActionRowBuilder().addComponents(input3),
    new ActionRowBuilder().addComponents(input4)
  );

  await interaction.showModal(modal);
}

// =========================
// 📩 MODAL KEZELÉS
// =========================

async function handleModal(interaction) {
    if (!getState("adminfeedback_enabled")) {
    return;
  }

  if (!getState("adminfeedback_accept_new_reviews")) {
    await interaction.reply({
      content: "❌ Új admin értékelések jelenleg fel vannak függesztve.",
      ephemeral: true
    }).catch(() => {});
    return;
  }
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("feedback_modal_")) return;

  await interaction.deferReply({ ephemeral: true });

  const [, , type, adminId] = interaction.customId.split("_");

  const situation = interaction.fields.getTextInputValue("situation");
  const reason = interaction.fields.getTextInputValue("reason");
  const strengths = interaction.fields.getTextInputValue("strengths");

  let extra = "Nincs megadva";
  try {
    extra = interaction.fields.getTextInputValue("extra") || "Nincs megadva";
  } catch {
    extra = "Nincs megadva";
  }

  const stats = getData(adminId); // resetelhető élő adatok
  const summaryStats = getSummaryData(adminId); // tartós adatok az AI-hoz
  const month = getMonthKey();
  const userId = interaction.user.id;

  if (!stats.userMonthly[month]) stats.userMonthly[month] = {};
  if (!stats.userMonthly[month][userId]) stats.userMonthly[month][userId] = 0;

  if (stats.userMonthly[month][userId] >= 3) {
    const totalSoFar = getUserTotalRatings(userId);

    await interaction.editReply({
      content:
        `❌ Ebben a hónapban már elérted a 3 értékelést erre az adminra.\n` +
        `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`
    });
    return;
  }

  if (type === "pos") {
    stats.pos++;
    summaryStats.pos++;
  } else {
    stats.neg++;
    summaryStats.neg++;
  }

  stats.userMonthly[month][userId]++;

  const reviewEntry = {
    user: userId,
    type,
    month,
    situation,
    reason,
    strengths,
    extra,
    createdAt: new Date().toISOString()
  };

  stats.reviews.push(reviewEntry);
  summaryStats.reviews.push(reviewEntry);

  saveData();

  const totalSoFar = getUserTotalRatings(userId);
  const adminName = getAdminName(adminId);

  const logChannel = await fetchGuildChannel(interaction.guild, LOG_CHANNEL_ID);

  if (logChannel) {
    const logEmbed = buildLogEmbed({
      type,
      adminName,
      userId,
      situation,
      reason,
      strengths,
      extra,
      userMonthlyCount: stats.userMonthly[month][userId],
      totalSoFar
    });

    await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
  }

  await interaction.editReply({
    content:
      `✅ Értékelés elküldve.\n` +
      `📌 Ennél az adminnál ebben a hónapban: **${stats.userMonthly[month][userId]}/3**\n` +
      `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`
  });

  createOrUpdateSummary(interaction.guild, adminId).catch(console.error);
  refreshPublicPanel(interaction.guild, adminId).catch(console.error);
}

// =========================
// 🌐 PUBLIKUS PANEL FRISSÍTÉS
// =========================

async function refreshPublicPanel(guild, adminId) {
    if (!getState("adminfeedback_enabled")) return;
  const msgId = panelMessages[adminId];
  if (!msgId) return;

  const admin = admins.find(a => a.id === adminId);
  if (!admin) return;

  for (const channel of guild.channels.cache.values()) {
    if (!channel || typeof channel.messages?.fetch !== "function") continue;

    try {
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (!msg) continue;

      const stats = getData(adminId);
      await msg.edit({
        embeds: [buildAdminPanelEmbed(admin, stats)],
        components: [buildAdminButtons(admin.id)]
      });
      return;
    } catch {}
  }
}

// =========================
// 🔄 RESET
// =========================
// Kért működés:
// - admin-ertekeles csatorna nullázódjon
// - admin-ertekeles-log törlődjön
// - admin-osszesito maradjon
// - AI maradjon, summaryData maradjon

async function resetData(interaction) {
  if (!getState("adminfeedback_enabled")) {
    await interaction.reply({
      content: "❌ Az admin feedback rendszer jelenleg ki van kapcsolva.",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  // 1) Élő, resetelhető értékelések nullázása
  data = {};

  for (const admin of admins) {
    getData(admin.id);
  }

  saveData();

  // 2) Publikus panelek frissítése 0 értékre
  for (const admin of admins) {
    await refreshPublicPanel(interaction.guild, admin.id);
  }

  // 3) Log csatorna teljes ürítése biztonságosan
  const logChannel = await fetchGuildChannel(interaction.guild, LOG_CHANNEL_ID);

  if (logChannel) {
    while (true) {
      const fetched = await logChannel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched || fetched.size === 0) break;

      const youngerThan14Days = fetched.filter(
        msg => Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
      );

      const olderThan14Days = fetched.filter(
        msg => Date.now() - msg.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
      );

      if (youngerThan14Days.size > 0) {
        await logChannel.bulkDelete(youngerThan14Days, true).catch(() => {});
      }

      for (const msg of olderThan14Days.values()) {
        await msg.delete().catch(() => {});
      }

      if (youngerThan14Days.size === 0 && olderThan14Days.size === 0) {
        break;
      }
    }
  }

  await interaction.editReply({
    content:
      "🔄 Az admin értékelések és a logok törölve lettek. " +
      "Az admin összesítő és az AI adatok megmaradtak."
  }).catch(() => {});
}

async function rebuildEmbeds(interaction) {
  if (!getState("adminfeedback_enabled")) {
    await interaction.reply({
      content: "❌ Az admin feedback rendszer jelenleg ki van kapcsolva.",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  panelMessages = {};
  summaryMessages = {};
  rulesMessageId = null;

  saveData();

  for (const admin of admins) {
    const stats = getData(admin.id);
    const embed = buildAdminPanelEmbed(admin, stats);
    const row = buildAdminButtons(admin.id);

    const msg = await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });

    panelMessages[admin.id] = msg.id;
    saveData();

    await createOrUpdateSummary(interaction.guild, admin.id);
  }

  const rulesMsg = await interaction.channel.send({
    embeds: [buildRulesEmbed()]
  });

  rulesMessageId = rulesMsg.id;
  saveData();

  await interaction.editReply({
    content: "✅ Az admin panelek és összesítők újra lettek építve, az adatok megmaradtak."
  }).catch(() => {});
}
module.exports = {
  sendPanel,
  resetData,
  rebuildEmbeds,
  handleButton,
  handleModal,
  rebuildAllSummaries,
  refreshPublicPanel
};