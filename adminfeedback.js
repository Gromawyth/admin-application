const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

// Itt add meg a log csatorna ID-ját, vagy használd env-ből:
// const LOG_CHANNEL_ID = process.env.ADMIN_FEEDBACK_LOG_CHANNEL_ID;
const LOG_CHANNEL_ID = "1485371309784563933";

// Példa adminok
const admins = [
  {
    id: "1",
    name: "Teszt 1",
    level: "Főadmin",
    desc: "bemutatkozas"
  },
  {
    id: "2",
    name: "Teszt2",
    level: "Admin 2",
    desc: "bemutatkozas"
  },
  {
    id: "3",
    name: "Teszt1",
    level: "Adminsegéd",
    desc: "bemutatkozas"
  }
];

// Memóriás tárolás
let data = {};

// =========================
// SEGÉDFÜGGVÉNYEK
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

// =========================
// PANEL KÜLDÉS
// =========================

async function sendPanel(interaction) {
  for (const admin of admins) {
    const stats = getData(admin.id);

    const embed = new EmbedBuilder()
      .setTitle(`⭐ ${admin.name}`)
      .setColor(0x5865F2)
      .setDescription(
        `**Szint:** ${admin.level}\n\n${admin.desc}`
      )
      .addFields(
        {
          name: "📊 Összesítés",
          value: `👍 Pozitív: **${stats.pos}**\n👎 Negatív: **${stats.neg}**`,
          inline: false
        },
        {
          name: "📌 Szabályzat",
          value:
            "• Egy játékos havonta legfeljebb **3 értékelést** adhat ugyanarra az adminra.\n" +
            "• Az értékelésnek valós tapasztalaton kell alapulnia.\n" +
            "• Indoklás nélkül vagy troll célból ne küldj értékelést.\n" +
            "• A válaszaidat a vezetőség ellenőrizheti.",
          inline: false
        }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_pos_${admin.id}`)
        .setLabel("Pozitív értékelés")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`feedback_neg_${admin.id}`)
        .setLabel("Negatív értékelés")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });
  }

  await interaction.reply({
    content: "✅ Az admin értékelő panelek kiküldve.",
    ephemeral: true
  });
}

// =========================
// GOMBKEZELÉS
// =========================

async function handleButton(interaction) {
  if (!interaction.customId.startsWith("feedback_")) return;

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
    .setPlaceholder(`Írd le röviden, milyen helyzetben kerültél (${adminName})-al/-el kapcsolatba.`);

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
// MODAL KEZELÉS
// =========================

async function handleModal(interaction) {
  if (!interaction.customId.startsWith("feedback_modal_")) return;

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

  const stats = getData(adminId);
  const month = getMonthKey();
  const userId = interaction.user.id;

  if (!stats.userMonthly[month]) stats.userMonthly[month] = {};
  if (!stats.userMonthly[month][userId]) stats.userMonthly[month][userId] = 0;

  if (stats.userMonthly[month][userId] >= 3) {
    const totalSoFar = getUserTotalRatings(userId);

    await interaction.reply({
      content:
        `❌ Ebben a hónapban már elérted a 3 értékelést erre az adminra.\n` +
        `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`,
      ephemeral: true
    });
    return;
  }

  if (type === "pos") stats.pos++;
  else stats.neg++;

  stats.userMonthly[month][userId]++;

  stats.reviews.push({
    user: userId,
    type,
    month,
    situation,
    reason,
    strengths,
    extra,
    createdAt: new Date().toISOString()
  });

  const totalSoFar = getUserTotalRatings(userId);
  const adminName = getAdminName(adminId);

  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setTitle("📊 Új admin értékelés")
      .setColor(type === "pos" ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        {
          name: "Admin",
          value: trimText(adminName),
          inline: true
        },
        {
          name: "Típus",
          value: type === "pos" ? "Pozitív" : "Negatív",
          inline: true
        },
        {
          name: "Beküldte",
          value: `<@${userId}>`,
          inline: true
        },
        {
          name: "Milyen szituációban találkoztál vele?",
          value: trimText(situation),
          inline: false
        },
        {
          name: "Miért értékeled így az admint?",
          value: trimText(reason),
          inline: false
        },
        {
          name: "Milyen erősségei vagy hibái voltak?",
          value: trimText(strengths),
          inline: false
        },
        {
          name: "További megjegyzés",
          value: trimText(extra),
          inline: false
        },
        {
          name: "Havi limit állás ennél az adminnál",
          value: `${stats.userMonthly[month][userId]}/3`,
          inline: true
        },
        {
          name: "Felhasználó összes értékelése",
          value: `${totalSoFar}`,
          inline: true
        }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] });
  }

  await interaction.reply({
    content:
      `✅ Értékelés elküldve.\n` +
      `📌 Ennél az adminnál ebben a hónapban: **${stats.userMonthly[month][userId]}/3**\n` +
      `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`,
    ephemeral: true
  });
}

// =========================
// RESET
// =========================

async function resetData(interaction) {
  data = {};

  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

  if (logChannel) {
    await logChannel.bulkDelete(100).catch(() => {});
  }

  await interaction.reply({
    content: "🔄 Minden értékelés és log törölve.",
    ephemeral: true
  });
}

module.exports = {
  sendPanel,
  resetData,
  handleButton,
  handleModal
};