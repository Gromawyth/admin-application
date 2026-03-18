require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Partials,
} = require("discord.js");

const app = express();

app.use(cors({
  origin: [
    "https://gromawyth.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());
app.use(express.json());

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  ADMIN_CHANNEL_ID,
  ADMINSEGED_CHANNEL_ID,
  STAFF_ROLE_ID,
  TICKET_CATEGORY_ID,
  TICKET_STAFF_ROLE_ID
} = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel],
});

function safeValue(value) {
  if (value === null || value === undefined) return "Nincs megadva";
  const text = String(value).trim();
  return text.length ? text : "Nincs megadva";
}

function limitField(value, max = 1024) {
  const text = safeValue(value);
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function formatDiscordUser(value) {
  const text = safeValue(value);

  if (/^\d+$/.test(text)) {
    return `<@${text}>\n\`${text}\``;
  }

  return limitField(text);
}

function buildActionRow(applicationType, disabled = false) {
  const suffix = applicationType === "adminseged" ? "adminseged" : "admin";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept_${suffix}`)
      .setLabel("Elfogadás")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId(`reject_${suffix}`)
      .setLabel("Elutasítás")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildAdminEmbeds(data) {
  const discordUserId = safeValue(data.discordNev);

  return [
    new EmbedBuilder()
      .setTitle("🟢 Új Adminisztrátori jelentkezés")
      .setDescription("━━━━━━━━━━ **01. ALAPADATOK** ━━━━━━━━━━")
      .setColor(0x1f8b4c)
      .addFields(
        { name: "👤 Mi a karaktered neve?", value: limitField(data.karakterNev), inline: false },
        { name: "🆔 Discord User ID", value: formatDiscordUser(discordUserId), inline: false },
        { name: "🆔 Mi a Discord neved?", value: limitField(data.discord2), inline: false },
        { name: "🎂 Hány éves vagy?", value: limitField(data.eletkor), inline: false },
        { name: "⏱️ Mennyi ideje játszol az internalGamingen?", value: limitField(data.jatszottIdo), inline: false },
        { name: "📅 Honnan találtál rá a szerverre?", value: limitField(data.internalTalalat), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **02. IDŐBEOSZTÁS** ━━━━━━━━━━")
      .setColor(0x239b56)
      .addFields(
        { name: "🕒 Mikor szoktál általában fent lenni hétköznap?", value: limitField(data.hetkoznapAktivitas), inline: false },
        { name: "🕒 Mikor szoktál általában fent lenni hétvégén?", value: limitField(data.hetvegeAktivitas), inline: false },
        { name: "⏱️ Heti hány órát tudsz aktívan játszani?", value: limitField(data.hetiOra), inline: false },
        { name: "🛠️ Mennyi időt tudnál az Admin Staff feladataira szánni?", value: limitField(data.staffIdo), inline: false },
        { name: "🔄 Változik ez az időbeosztásod gyakran?", value: limitField(data.idobeosztasValtozas), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **03. MOTIVÁCIÓ** ━━━━━━━━━━")
      .setColor(0x27ae60)
      .addFields(
        { name: "💭 Miért szeretnél az Admin Staff tagja lenni?", value: limitField(data.motivacio), inline: false },
        { name: "⭐ Mi az, ami megfogott az internalGamingben?", value: limitField(data.miFogottMeg), inline: false },
        { name: "🛠️ Mit gondolsz, miben tudnál segíteni a szervernek?", value: limitField(data.segiteni), inline: false },
        { name: "🔧 Van olyan dolog, amit változtatnál, ha lehetne?", value: limitField(data.valtoztatna), inline: false },
        { name: "👮 Mi a véleményed a jelenlegi Admin Staffról?", value: limitField(data.staffVelemeny), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **04. TAPASZTALAT** ━━━━━━━━━━")
      .setColor(0x2ecc71)
      .addFields(
        { name: "🛡️ Voltál-e már admin vagy adminsegéd más szerveren?", value: limitField(data.voltAdmin), inline: false },
        { name: "📍 Ha igen, hol és mennyi ideig?", value: limitField(data.holAdmin), inline: false },
        { name: "❓ Miért hagytad ott, vagy miért maradtál?", value: limitField(data.miertHagytad), inline: false },
        { name: "🧠 Van olyan életbeli tapasztalatod, ami hasznos lehet itt?", value: limitField(data.eletTapasztalat), inline: false },
        { name: "🔥 Hogyan kezeled a stresszt és a nyomást?", value: limitField(data.stressz), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **05. SZITUÁCIÓK** ━━━━━━━━━━")
      .setColor(0x58d68d)
      .addFields(
        { name: "🎮 Mit tennél, ha látnád, hogy valaki metagamingel?", value: limitField(data.metagaming), inline: false },
        { name: "⚖️ Hogyan kezelnéd, ha két játékos összekülönbözne OOC-ben?", value: limitField(data.oocVita), inline: false },
        { name: "🚨 Egy új játékos folyton megszegi a szabályokat. Mi a teendő?", value: limitField(data.szabalySzeges), inline: false },
        { name: "👥 Ha egy barátod szabálytalankodna, ugyanúgy kezelnéd?", value: limitField(data.baratSzabaly), inline: false },
        { name: "📣 Valaki szerint tévedtél egy döntésben. Hogyan reagálnál?", value: limitField(data.tevdes), inline: false },
        { name: "👮 Látod, hogy egy másik staff tag hibázik. Szólnál?", value: limitField(data.staffHiba), inline: false },
        { name: "😡 Egy játékos provokál és személyeskedik veled. Mit teszel?", value: limitField(data.provokal), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **06. RÓLAD MÉLYEBBEN** ━━━━━━━━━━")
      .setColor(0x82e0aa)
      .addFields(
        { name: "⚔️ Milyen vagy konfliktushelyzetben?", value: limitField(data.konfliktus), inline: false },
        { name: "📢 Tudsz-e kritikát elfogadni?", value: limitField(data.kritika), inline: false },
        { name: "🤝 Mi az, amiben biztosan számíthatnak rád?", value: limitField(data.mibenSzamithatunk), inline: false },
        { name: "🚫 Mi az, amit nem tudsz vállalni?", value: limitField(data.nemVallal), inline: false },
        { name: "👁️ Milyen staff tag szeretnél lenni - aktív, látható vagy inkább háttérben dolgozó?", value: limitField(data.staffTipus), inline: false },
        { name: "😤 Mi az, ami ki tud hozni a sodrodból?", value: limitField(data.sodor), inline: false },
        { name: "🎮 Hogyan reagálsz, ha unatkozol a játéktól?", value: limitField(data.unatkozik), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **07. EGYÉB** ━━━━━━━━━━")
      .setColor(0xa9dfbf)
      .addFields(
        { name: "💬 Van-e olyan, amit még el szeretnél mondani?", value: limitField(data.egyeb), inline: false },
        { name: "❓ Kérdeznél bármit a vezetőségtől?", value: limitField(data.kerdes), inline: false },
        { name: "🧑‍🏫 Mennyire vagy türelmes az új játékosokkal?", value: limitField(data.turelmes), inline: false },
        { name: "⚖️ Szoktál-e figyelmeztetés előtt büntetni, vagy szigorú vagy?", value: limitField(data.buntetes), inline: false },
        { name: "📜 Mi a véleményed a jelenlegi szabályzatról?", value: limitField(data.szabalyzat), inline: false }
      )
      .setFooter({ text: "Admin jelentkezési rendszer" })
      .setTimestamp()
  ];
}

function buildAdminSegedEmbeds(data) {
  const discordUserId = safeValue(data.discordID);

  return [
    new EmbedBuilder()
      .setTitle("🟢 Új Adminsegéd jelentkezés")
      .setDescription("━━━━━━━━━━ **I. ÁLTALÁNOS KÉRDÉSEK** ━━━━━━━━━━")
      .setColor(0x2ecc71)
      .addFields(
        { name: "👤 Mi a karaktered neve?", value: limitField(data.karaktered), inline: false },
        { name: "🆔 Discord User ID", value: formatDiscordUser(discordUserId), inline: false },
        { name: "🆔 Discord neved", value: limitField(data.discord1), inline: false },
        { name: "🎂 Életkorod", value: limitField(data.eletkor), inline: false },
        { name: "⏱ Heti szinten mennyi időt tudnál az adminsegédi feladatokra fordítani?", value: limitField(data.hetiIdo), inline: false },
        { name: "👤 Önmagad rövid bemutatása", value: limitField(data.bemutatkozas), inline: false },
        { name: "🛡 Voltál-e már adminisztrátor vagy adminsegéd tag más szerveren? Ha igen, hol és milyen pozícióban?", value: limitField(data.voltStaff), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **II. SZITUÁCIÓS FELADATOK** ━━━━━━━━━━")
      .setColor(0x27ae60)
      .addFields(
        { name: "⚠ Egy játékos bizonyíthatóan visszaél egy rendszerhibával (bug), de népszerű tag. Hogyan jársz el?", value: limitField(data.bugVisszaeles), inline: false },
        { name: "🚗 Elkapsz egy ütközést. Annyi RP-t látsz, hogy /do megrázkódik vagy /do kocc. Mi itt a probléma? Hogyan jársz el? Ha szankcionálsz, miként teszed azt?", value: limitField(data.utkozesHelyzet), inline: false },
        { name: "👮 A rendvédelem valamely tagja jelez feléd, hogy direkt provokálják őket. Mit teszel?", value: limitField(data.rendvedelemProvokacio), inline: false },
        { name: "🆕 Egy új játékos sok kérdést tesz fel, de a válaszaid lassan érkeznek, ami frusztrálja őt. Hogyan reagálsz?", value: limitField(data.ujJatekosKezeles), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **III. KOMPETENCIA ÉS HOZZÁÁLLÁS** ━━━━━━━━━━")
      .setColor(0x1f8b4c)
      .addFields(
        { name: "⚖ Mit jelent számodra a pártatlan eljárás egy adminügy kapcsán?", value: limitField(data.partatlansag), inline: false },
        { name: "⭐ Szerinted jó adminisztrátor válna belőled? Indokold!", value: limitField(data.joAdminLennek), inline: false },
        { name: "🔄 Te miként definiálnád a rugalmasság fogalmát?", value: limitField(data.rugalmassag), inline: false }
      )
      .setFooter({ text: "Adminsegéd jelentkezési rendszer" })
      .setTimestamp()
  ];
}

const TICKET_TYPES = {
  vezetoseg: {
    label: "Vezetőségi ügyek",
    channelPrefix: "vezetosegi",
    description: "Unban kérelem, fórumos ügy, egyéni összegű PP vásárlás, magánbirtok, egyedi jármű, fejlesztési ötlet, elveszett tárgyak.",
    buttonStyle: ButtonStyle.Primary,
    modalTitle: "Vezetőségi ticket",
    question1: "Pontosan miben szeretnél segítséget?",
    question2: "Írd le részletesen az ügyedet"
  },
  frakcio: {
    label: "Frakció ügyek",
    channelPrefix: "frakcio",
    description: "Frakcióval kapcsolatos kérdés, probléma, jelentkezés vagy vezetőségi egyeztetés.",
    buttonStyle: ButtonStyle.Primary,
    modalTitle: "Frakció ügyek",
    question1: "Melyik frakcióról van szó?",
    question2: "Írd le részletesen az ügyedet"
  },
  jatekosreport: {
    label: "Játékos report",
    channelPrefix: "jatekos-report",
    description: "Ha egy játékost szeretnél jelenteni szabályszegés, visszaélés vagy egyéb probléma miatt.",
    buttonStyle: ButtonStyle.Danger,
    modalTitle: "Játékos report",
    question1: "Kit reportolnál?",
    question2: "Mi történt pontosan?"
  },
  adminreport: {
    label: "Admin report",
    channelPrefix: "admin-report",
    description: "Ha egy adminisztrátorral kapcsolatban szeretnél panaszt vagy észrevételt tenni.",
    buttonStyle: ButtonStyle.Danger,
    modalTitle: "Admin report",
    question1: "Melyik adminról van szó?",
    question2: "Írd le részletesen a problémát"
  },
  segitseg: {
    label: "Segítségkérés",
    channelPrefix: "segitseg",
    description: "Általános segítségkérés, elakadás, információkérés vagy technikai probléma.",
    buttonStyle: ButtonStyle.Success,
    modalTitle: "Segítségkérés",
    question1: "Miben kérsz segítséget?",
    question2: "Írd le részletesen a problémát"
  },
  vasarlasi: {
    label: "Vásárlási / támogatói ügy",
    channelPrefix: "vasarlasi",
    description: "Prémium, támogatói csomag, vásárlási probléma, jóváírás vagy fizetéssel kapcsolatos ügy.",
    buttonStyle: ButtonStyle.Success,
    modalTitle: "Vásárlási / támogatói ügy",
    question1: "Milyen vásárlási ügyed van?",
    question2: "Írd le részletesen a problémát"
  },
  unban: {
    label: "Unban / enyhítési kérelem",
    channelPrefix: "unban",
    description: "Ban, kitiltás, enyhítés, felülvizsgálat vagy döntésmódosítás kérése.",
    buttonStyle: ButtonStyle.Secondary,
    modalTitle: "Unban / enyhítési kérelem",
    question1: "Milyen büntetéssel kapcsolatban írsz?",
    question2: "Miért kérsz felülvizsgálatot vagy enyhítést?"
  }
};

function sanitizeChannelName(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildTicketOpenButton(typeKey) {
  const type = TICKET_TYPES[typeKey];

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_open_${typeKey}`)
      .setLabel("Create ticket")
      .setEmoji("📩")
      .setStyle(type.buttonStyle)
  );
}

function buildTicketCloseButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Lezárás")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildTicketPanelEmbed(typeKey) {
  const type = TICKET_TYPES[typeKey];

  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(type.label)
    .setDescription(type.description)
    .setFooter({ text: "internalGaming ticket rendszer" });
}

function buildTicketModal(typeKey) {
  const type = TICKET_TYPES[typeKey];

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${typeKey}`)
    .setTitle(type.modalTitle);

  const input1 = new TextInputBuilder()
    .setCustomId("subject")
    .setLabel(type.question1)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const input2 = new TextInputBuilder()
    .setCustomId("details")
    .setLabel(type.question2)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(input1),
    new ActionRowBuilder().addComponents(input2)
  );

  return modal;
}

function parseTicketTopic(topic) {
  const text = String(topic || "");
  const ownerMatch = text.match(/owner:(\d{16,20})/);
  const typeMatch = text.match(/type:([a-z0-9_-]+)/i);

  return {
    ownerId: ownerMatch ? ownerMatch[1] : null,
    typeKey: typeMatch ? typeMatch[1] : null,
  };
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("sendticketpanels")
      .setDescription("Kirakja a ticket paneleket ebbe a csatornába.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commandok regisztrálva");
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("❌ Slash command regisztrációs hiba:", error);
  }
});

app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "API működik" });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    botReady: client.isReady(),
    hasAdminChannelId: !!ADMIN_CHANNEL_ID,
    hasAdminSegedChannelId: !!ADMINSEGED_CHANNEL_ID,
    hasStaffRoleId: !!STAFF_ROLE_ID,
    hasTicketCategoryId: !!TICKET_CATEGORY_ID,
    hasTicketStaffRoleId: !!TICKET_STAFF_ROLE_ID
  });
});

app.get("/application", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Ez az endpoint él. Jelentkezést POST kéréssel kell küldeni."
  });
});

app.post("/application", async (req, res) => {
  try {
    if (!client.isReady()) {
      return res.status(503).json({
        success: false,
        error: "Bot még nem áll készen."
      });
    }

    const data = req.body || {};
    const applicationType =
      data.applicationType === "adminseged" ? "adminseged" : "adminisztrator";

    console.log("📥 Jelentkezés érkezett:", applicationType, Object.keys(data));

    const channelId =
      applicationType === "adminseged"
        ? ADMINSEGED_CHANNEL_ID
        : ADMIN_CHANNEL_ID;

    if (!channelId) {
      return res.status(500).json({
        success: false,
        error: "Hiányzik a megfelelő csatornaazonosító az ENV-ből."
      });
    }

    const channel = await client.channels.fetch(channelId).catch((err) => {
      console.error("❌ Channel fetch hiba:", err);
      return null;
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        error: "Nem találom a célcsatornát."
      });
    }

    if (typeof channel.send !== "function") {
      return res.status(400).json({
        success: false,
        error: "A megadott csatorna nem szöveges csatorna."
      });
    }

    const embeds =
      applicationType === "adminseged"
        ? buildAdminSegedEmbeds(data)
        : buildAdminEmbeds(data);

    const row = buildActionRow(applicationType, false);

    const message = await channel.send({
      content:
        applicationType === "adminseged"
          ? "🟢 **Új adminsegéd jelentkezés érkezett!**"
          : "📩 **Új admin jelentkezés érkezett!**",
      embeds,
      components: [row],
    });

    console.log("✅ Jelentkezés elküldve Discordra:", message.id);

    return res.status(200).json({
      success: true,
      messageId: message.id,
    });
  } catch (error) {
    console.error("❌ Hiba az /application végponton:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Belső szerverhiba."
    });
  }
});

async function handleApplicationDecision(interaction) {
  const member = interaction.member;

  if (!member || !member.roles?.cache?.has(STAFF_ROLE_ID)) {
    await interaction.reply({
      content: "Nincs jogosultságod a lap elbírálására.",
      ephemeral: true,
    });
    return;
  }

  const isAdminSeged =
    interaction.customId === "accept_adminseged" ||
    interaction.customId === "reject_adminseged";

  const isAdmin =
    interaction.customId === "accept_admin" ||
    interaction.customId === "reject_admin";

  if (!isAdminSeged && !isAdmin) {
    await interaction.reply({
      content: "Ismeretlen gomb.",
      ephemeral: true,
    });
    return;
  }

  const accepted = interaction.customId.startsWith("accept_");
  const applicationType = isAdminSeged ? "adminseged" : "adminisztrator";

  const originalEmbeds = interaction.message.embeds || [];
  const firstEmbed = originalEmbeds[0];

  if (!firstEmbed) {
    await interaction.reply({
      content: "Nem találom az eredeti embedet.",
      ephemeral: true,
    });
    return;
  }

  const applicantField = firstEmbed.fields?.find(
    (field) => field.name === "🆔 Discord User ID"
  );

  let discordUserId = "";
  if (applicantField?.value) {
    const idMatch = applicantField.value.match(/\b\d{16,20}\b/);
    discordUserId = idMatch ? idMatch[0] : "";
  }

  const dmText = accepted
    ? applicationType === "adminseged"
      ? "Szia! Örömmel értesítünk, hogy az adminsegéd jelentkezésed elfogadásra került. Kérlek keresd fel a vezetőséget privát üzenetben a további részletekért."
      : "Szia! Örömmel értesítünk, hogy az admin jelentkezésed elfogadásra került. Kérlek keresd fel a vezető adminisztrátort privát üzenetben."
    : applicationType === "adminseged"
      ? "Szia! Értesítünk, hogy az adminsegéd jelentkezésed elutasításra került. Köszönjük a jelentkezésedet és az idődet."
      : "Szia! Értesítünk, hogy az admin jelentkezésed elutasításra került. Köszönjük a jelentkezésedet és az idődet.";

  let applicantStatus = "❌ Érvénytelen vagy hiányzó Discord User ID";
  let dmStatus = "⛔ DM nem lett megkísérelve";

  if (discordUserId && /^\d+$/.test(discordUserId)) {
    try {
      const user = await client.users.fetch(discordUserId);
      applicantStatus = `✅ Jelentkező lekérve: <@${discordUserId}>`;

      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                applicationType === "adminseged"
                  ? "📨 Adminsegéd jelentkezés elbírálása"
                  : "📨 Admin jelentkezés elbírálása"
              )
              .setColor(accepted ? 0x2ecc71 : 0xe74c3c)
              .setDescription(dmText)
              .addFields(
                {
                  name: "Szerver",
                  value: safeValue(interaction.guild?.name || "internalGaming"),
                  inline: true,
                },
                {
                  name: "Elbírálta",
                  value: safeValue(interaction.user.tag),
                  inline: true,
                }
              )
              .setTimestamp()
          ],
        });

        dmStatus = "✅ DM sikeresen elküldve";
      } catch (dmError) {
        dmStatus = `❌ DM küldése sikertelen: ${limitField(dmError.message || "ismeretlen hiba")}`;
      }
    } catch (fetchError) {
      applicantStatus = `❌ A felhasználó nem kérhető le ebből az ID-ból: \`${discordUserId}\``;
      dmStatus = "⛔ DM kihagyva, mert a felhasználó lekérése sikertelen";
    }
  }

  const reviewEmbed = new EmbedBuilder()
    .setTitle(
      applicationType === "adminseged"
        ? "📋 Adminsegéd jelentkezés elbírálva"
        : "📋 Admin jelentkezés elbírálva"
    )
    .setColor(accepted ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      {
        name: "Eredmény",
        value: accepted ? "✅ **ELFOGADVA**" : "❌ **ELUTASÍTVA**",
        inline: true
      },
      {
        name: "Elbírálta",
        value: `<@${interaction.user.id}>`,
        inline: true
      },
      {
        name: "Jelentkező státusza",
        value: applicantStatus,
        inline: false
      },
      {
        name: "DM állapot",
        value: limitField(dmStatus),
        inline: false
      }
    )
    .setTimestamp();

  const disabledRow = buildActionRow(applicationType, true);

  await interaction.update({
    embeds: [...originalEmbeds, reviewEmbed],
    components: [disabledRow],
  });
}

async function handleSendTicketPanels(interaction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      content: "Ehhez admin jogosultság kell.",
      ephemeral: true
    });
    return;
  }

  const order = [
    "vezetoseg",
    "frakcio",
    "jatekosreport",
    "adminreport",
    "segitseg",
    "vasarlasi",
    "unban"
  ];

  for (const key of order) {
    const embed = buildTicketPanelEmbed(key);
    const row = buildTicketOpenButton(key);

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });
  }

  await interaction.reply({
    content: "✅ A ticket panelek ki lettek küldve ebbe a csatornába.",
    ephemeral: true
  });
}

async function handleTicketOpenButton(interaction) {
  const typeKey = interaction.customId.replace("ticket_open_", "");
  const type = TICKET_TYPES[typeKey];

  if (!type) {
    await interaction.reply({
      content: "Ismeretlen ticket típus.",
      ephemeral: true
    });
    return;
  }

  await interaction.showModal(buildTicketModal(typeKey));
}

async function handleTicketModalSubmit(interaction) {
  const typeKey = interaction.customId.replace("ticket_modal_", "");
  const type = TICKET_TYPES[typeKey];

  if (!type) {
    await interaction.reply({
      content: "Ismeretlen ticket típus.",
      ephemeral: true
    });
    return;
  }

  if (!TICKET_CATEGORY_ID || !TICKET_STAFF_ROLE_ID) {
    await interaction.reply({
      content: "Hiányzik a ticket rendszer valamelyik ENV változója.",
      ephemeral: true
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "Ez csak szerveren használható.",
      ephemeral: true
    });
    return;
  }

  const category = guild.channels.cache.get(TICKET_CATEGORY_ID)
    || await guild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);

  if (!category) {
    await interaction.reply({
      content: "A ticket kategória nem található.",
      ephemeral: true
    });
    return;
  }

  const existing = guild.channels.cache.find((ch) => {
    if (ch.parentId !== TICKET_CATEGORY_ID) return false;
    const parsed = parseTicketTopic(ch.topic);
    return parsed.ownerId === interaction.user.id;
  });

  if (existing) {
    await interaction.reply({
      content: `Már van nyitott ticketed: ${existing}`,
      ephemeral: true
    });
    return;
  }

  const subject = interaction.fields.getTextInputValue("subject");
  const details = interaction.fields.getTextInputValue("details");

  const usernamePart = sanitizeChannelName(interaction.user.username || "user");
  const channelName = sanitizeChannelName(`${type.channelPrefix}-${usernamePart}`) || `ticket-${interaction.user.id}`;

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    topic: `owner:${interaction.user.id} | type:${typeKey}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
      {
        id: TICKET_STAFF_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
    ],
  });

  const ticketEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🎫 ${type.label}`)
    .setDescription("Új ticket érkezett.")
    .addFields(
      {
        name: "Létrehozó",
        value: `${interaction.user} (\`${interaction.user.id}\`)`,
        inline: false
      },
      {
        name: "Téma",
        value: limitField(subject),
        inline: false
      },
      {
        name: "Leírás",
        value: limitField(details),
        inline: false
      }
    )
    .setTimestamp();

  await ticketChannel.send({
    content: `<@&${TICKET_STAFF_ROLE_ID}> ${interaction.user}`,
    embeds: [ticketEmbed],
    components: [buildTicketCloseButton()]
  });

  await interaction.reply({
    content: `✅ A ticketed létrejött: ${ticketChannel}`,
    ephemeral: true
  });
}

async function handleTicketClose(interaction) {
  const channel = interaction.channel;
  const parsed = parseTicketTopic(channel?.topic);
  const isOwner = parsed.ownerId === interaction.user.id;
  const isTicketStaff = interaction.member?.roles?.cache?.has(TICKET_STAFF_ROLE_ID);

  if (!isOwner && !isTicketStaff) {
    await interaction.reply({
      content: "Nincs jogosultságod a ticket lezárásához.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: "🔒 A ticket lezárásra került. A csatorna törlődik...",
    ephemeral: true
  });

  setTimeout(async () => {
    try {
      await channel.delete("Ticket lezárva");
    } catch (error) {
      console.error("❌ Ticket törlési hiba:", error);
    }
  }, 1500);
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "sendticketpanels") {
        await handleSendTicketPanels(interaction);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("ticket_modal_")) {
        await handleTicketModalSubmit(interaction);
        return;
      }
    }

    if (interaction.isButton()) {
      if (
        interaction.customId === "accept_adminseged" ||
        interaction.customId === "reject_adminseged" ||
        interaction.customId === "accept_admin" ||
        interaction.customId === "reject_admin"
      ) {
        await handleApplicationDecision(interaction);
        return;
      }

      if (interaction.customId.startsWith("ticket_open_")) {
        await handleTicketOpenButton(interaction);
        return;
      }

      if (interaction.customId === "ticket_close") {
        await handleTicketClose(interaction);
        return;
      }

      await interaction.reply({
        content: "Ismeretlen gomb.",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("❌ Hiba interactionCreate közben:", error);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "Hiba történt a művelet feldolgozása közben.",
          ephemeral: true,
        });
      } catch {}
    }
  }
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP szerver fut a ${PORT} porton`);
});

console.log("DISCORD_TOKEN megvan:", !!DISCORD_TOKEN);
console.log("DISCORD_TOKEN hossza:", DISCORD_TOKEN ? DISCORD_TOKEN.length : 0);
console.log("DISCORD_TOKEN eleje:", DISCORD_TOKEN ? DISCORD_TOKEN.slice(0, 10) : "nincs");

client.login(DISCORD_TOKEN);
//FEJLESZTÉS ALATT
// =========================
// /dev SLASH COMMAND
// =========================

client.once(Events.ClientReady, async () => {
  try {
    const commands = [
      new SlashCommandBuilder()
        .setName("dev")
        .setDescription("Fejlesztés alatt embed küldése")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("✅ /dev slash command regisztrálva");
  } catch (error) {
    console.error("❌ /dev slash command hiba:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "dev") return;

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      await interaction.reply({
        content: "Ehhez admin jogosultság szükséges.",
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🚧 FEJLESZTÉS ALATT 🚧")
      .setDescription(
        "Ez a Discord csatorna jelenleg fejlesztés alatt áll, ezért a tartalom és a működés folyamatosan változhat.\n\n" +
        "Előfordulhatnak hibák, hiányzó funkciók vagy ideiglenes megoldások.\n\n" +
        "Kérlek, légy türelemmel, amíg a rendszer végleges formát kap.\n\n" +
        "Köszönöm a megértést!"
      )
      .setFooter({ text: "internalGaming" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("❌ Hiba a /dev parancs közben:", error);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "Hiba történt a parancs végrehajtása közben.",
          ephemeral: true
        });
      } catch {}
    }
  }
});