module.exports = {
  serverName: "internalGaming RP",

  assistantIdentity: `
Te az internalGaming RP hivatalos AI ügyintéző asszisztense vagy.
A ticketek normál szöveges csatornában futnak, nem fórumbejegyzésben.

A feladatod:
- megérteni a játékos problémáját
- röviden és tisztán válaszolni
- szükség esetén visszakérdezni
- összegyűjteni a staff számára hasznos információkat
- egyszerű segítségkéréseknél eligazítást adni
- komoly, vitás vagy jogosultságot igénylő ügyeknél staffot hívni

Nem vagy admin, nem vagy végső döntéshozó, nem ítélkezhetsz.
`,

  safetyRules: [
    "Soha ne hozz végleges staff döntést.",
    "Soha ne ígérj unbant, büntetést, kompenzációt, CK-t vagy jóváírást.",
    "Soha ne állapítsd meg biztosan, hogy ki a hibás egy vitában.",
    "Ha bizonytalan vagy, kérdezz vissza vagy eszkalálj.",
    "Mindig magyarul válaszolj.",
    "Mindig GTA 5 RP szerver kontextusban válaszolj, ne IRL ügyintézésként.",
    "Ne chatelj feleslegesen, ne menj bele small talkba.",
    "Ha a kérdés érzékeny, vitás, szabályértelmezős vagy bizonyítékot igényel, adj rövid választ és hívd a staffot.",
    "A játékos felé mindig egyértelműen jelezd, hogy nem vagy végső döntéshozó."
  ],

  hardLimits: [
    "Nem dönthetsz reportban.",
    "Nem dönthetsz admin panaszban.",
    "Nem dönthetsz unban vagy enyhítési kérelem ügyében.",
    "Nem dönthetsz Character Kill ügyben.",
    "Nem dönthetsz frakcióbuktatásban.",
    "Nem dönthetsz CCTV vagy bodycam vita esetén.",
    "Nem dönthetsz PayPal / támogatói tárgy elvétel vagy visszaadás ügyében.",
    "Nem mondhatod azt, hogy valami biztosan DM, RK, MG, ForceRP vagy FearRP, csak azt, hogy gyanú lehet és staff ellenőrzés szükséges."
  ],

  ruleSummary: {
    general: [
      "Ha valamire nincs külön szabály, a józan ész elve az irányadó.",
      "A szerver célja nem a valóság teljes szimulációja, hanem a jó minőségű és élvezetes RP.",
      "A szabályok mindenkire egyformán vonatkoznak."
    ],

    ooc: [
      "OOC kommunikációban kötelező a tiszteletteljes viselkedés.",
      "Admin ügyintézés során az admin utasításait követni kell.",
      "Admin ügyintézés OOC chatben történik, nem kötelező voice-ban.",
      "Sérelmes intézkedés esetén hivatalos panasz tehető a fórumon."
    ],

    buguse: [
      "Bármilyen bug kihasználása vagy azzal való visszaélés tilos.",
      "A hibákat be kell jelenteni.",
      "Ha nem egyértelmű, hogy bugról van-e szó, az admin jelenlétében reprodukálható."
    ],

    character: [
      "A karakternek illeszkednie kell a szerverkörnyezethez.",
      "A névnek amerikai formátumúnak kell lennie és nem lehet mém vagy híresség neve.",
      "A karakterek nem kapcsolódhatnak össze szabálytalanul, CK után sem."
    ],

    roleplay: [
      "Kötelező szerepben maradni.",
      "A szituációt nem szabad önkényesen megszakítani.",
      "Súlyos sérüléseket és komoly eseményeket RP-zni kell.",
      "Az immerzió rombolása tilos.",
      "A FearRP kötelező."
    ],

    coreViolations: [
      "DM: indok nélküli vagy aránytalan ölés.",
      "RK: halál utáni bosszú vagy eseménybe való túl korai visszatérés.",
      "MG: OOC információ IC felhasználása.",
      "ForceRP: másra ráerőltetett, érdemben nem kezelhető RP.",
      "Powergaming: fizikailag lehetetlen vagy irreális cselekedet."
    ],

    robbery: [
      "Forgalmas helyeken tilos rabolni vagy ölni, kivéve bizonyos szűk esetekben.",
      "Kezdő játékos 15 játszott óráig nem rabolható.",
      "Ha az áldozat teljesen együttműködik, általában tilos megölni.",
      "Chain robbing tilos."
    ],

    oocTrade: [
      "OOC kereskedelem minden formája tilos.",
      "Vagyon alt karakterek közötti mozgatása szabályozott és visszaélés esetén tiltott.",
      "PayPal itemekkel kapcsolatos elvételhez admin jóváhagyás és bizonyíték kell."
    ],

    ck: [
      "CK esetén teljesen új identitás kell.",
      "Más játékos CK-zásához általában vezetőségi jóváhagyás szükséges.",
      "A vezetőség döntése végleges lehet ezekben az ügyekben."
    ],

    cameras: [
      "Dashcam, bodycam és CCTV használata vitás esetben admin döntést igényelhet.",
      "A scriptelt CCTV élő képet adhat, de a konkrét felhasználás vitás esetben nem az AI dolga eldönteni."
    ],

    vehicles: [
      "Járműlopás és bizonyos nagyobb cselekmények elő-RP-t igényelnek.",
      "PIT manővert csak rendvédelem alkalmazhat meghatározott feltételekkel.",
      "Mozgó járműből lövés csak meghatározott módon engedett."
    ]
  },

  categories: {
    vezetoseg: {
      label: "Vezetőségi ügyek",
      staffRequired: true,
      hints: [
        "vezetőség",
        "vezetoseg",
        "felsővezetés",
        "felettes",
        "vezetői panasz",
        "forum panasz",
        "fórum panasz",
        "ck",
        "character kill",
        "frakcióbuktatás",
        "frakciobuktatas",
        "egyedi döntés",
        "egyedi dontes",
        "cctv",
        "bodycam",
        "dashcam"
      ],
      collect: [
        "Mi a probléma röviden?",
        "Pontosan mikor történt?",
        "Kik érintettek az ügyben?",
        "Van-e screenshot, videó, log vagy más bizonyíték?",
        "Miért igényel szerinted vezetőségi vagy magasabb szintű elbírálást?"
      ]
    },

    frakcio: {
      label: "Frakció ügyek",
      staffRequired: true,
      hints: [
        "frakció",
        "frakcio",
        "bcso",
        "lspd",
        "ems",
        "bcfd",
        "kormány",
        "kormany",
        "frakcióvezető",
        "frakciovezeto",
        "frakció panasz",
        "frakcio panasz",
        "rang",
        "előléptetés",
        "eloleptetes"
      ],
      collect: [
        "Melyik frakcióról van szó?",
        "Mi történt pontosan?",
        "Kik érintettek?",
        "Van-e bizonyíték vagy előzmény?",
        "Ez szabályszegés, belső panasz vagy információkérés?"
      ]
    },

    jatekosreport: {
      label: "Játékos report",
      staffRequired: true,
      hints: [
        "report",
        "játékos report",
        "jatekos report",
        "dm",
        "rdm",
        "rk",
        "revenge kill",
        "mg",
        "metagaming",
        "powergaming",
        "force rp",
        "forcerp",
        "fearrp",
        "szabályszegés",
        "szabalyszeges",
        "megölt",
        "megolt",
        "ok nélkül",
        "ok nelkul",
        "spawn kill"
      ],
      collect: [
        "Mi történt pontosan?",
        "Mikor történt?",
        "Kik voltak jelen?",
        "Van-e videó, kép vagy más bizonyíték?",
        "Mi alapján gondolod, hogy szabályszegés történt?"
      ]
    },

    adminreport: {
      label: "Admin report",
      staffRequired: true,
      hints: [
        "admin report",
        "admin panasz",
        "staff panasz",
        "adminnal baj",
        "admin visszaélt",
        "admin visszaelt",
        "rossz admin döntés",
        "rossz admin dontes",
        "jogtalan admin",
        "panaszkönyv",
        "panaszkonyv"
      ],
      collect: [
        "Melyik staff taggal kapcsolatos az ügy?",
        "Mi történt pontosan?",
        "Mikor történt?",
        "Van-e screenshot, log vagy más bizonyíték?",
        "Miért tartod problémásnak az intézkedést?"
      ]
    },

    segitseg: {
      label: "Segítségkérés",
      staffRequired: false,
      hints: [
        "hol",
        "hogyan",
        "merre",
        "miért",
        "miert",
        "segítség",
        "segitseg",
        "kezdő vagyok",
        "kezdo vagyok",
        "személyi",
        "szemelyi",
        "jogsi",
        "jogosítvány",
        "jogositvany",
        "bank",
        "városháza",
        "varoshaza",
        "munka",
        "kezdőmunka",
        "kezdomunka",
        "frakcióhoz csatlakozás",
        "frakciohoz csatlakozas"
      ],
      collect: [
        "Pontosan miben szeretnél segítséget?",
        "Ez információkérés, technikai gond vagy szabályértelmezési kérdés?"
      ]
    },

    vasarlasi: {
      label: "Vásárlási / támogatói ügy",
      staffRequired: true,
      hints: [
        "vásárlás",
        "vasarlas",
        "támogatás",
        "tamogatas",
        "paypal",
        "pp",
        "supporter",
        "donate",
        "nem kaptam meg",
        "csomag",
        "fizettem",
        "fizetés",
        "fizetes",
        "item",
        "pp item"
      ],
      collect: [
        "Mi volt a vásárolt csomag vagy item neve?",
        "Mikor történt a vásárlás?",
        "Mi nem érkezett meg vagy mi a probléma?",
        "Van-e róla bizonylat, screenshot vagy tranzakciós bizonyíték?"
      ]
    },

    unban: {
      label: "Unban / enyhítési kérelem",
      staffRequired: true,
      hints: [
        "unban",
        "enyhítés",
        "enyhites",
        "ban",
        "kitiltás",
        "kitiltas",
        "felülvizsgálat",
        "felulvizsgalat",
        "büntetés",
        "buntetes",
        "mute",
        "warn"
      ],
      collect: [
        "Milyen büntetésről van szó?",
        "Mikor kaptad?",
        "Miért szeretnél enyhítést vagy felülvizsgálatot?",
        "Van-e screenshot vagy pontos indoklás a büntetésről?"
      ]
    }
  },

  quickReplies: [
    {
      triggers: ["személyi", "szemelyi", "személyi igazolvány", "szemelyi igazolvany"],
      reply:
        "Ha a szerveren belüli személyi igazolványra gondolsz, azt jellemzően a megfelelő RP ügyintézési helyen, például a Városházán lehet intézni. Ha pontosabban leírod, mire gondolsz, segítek eligazodni."
    },
    {
      triggers: ["jogsi", "jogosítvány", "jogositvany"],
      reply:
        "Ha a szerveren belüli jogosítványra gondolsz, azt általában a megfelelő vizsga- vagy ügyintézési helyszínen lehet intézni. Írd meg, pontosan melyik kategóriára vagy lépésre vagy kíváncsi."
    },
    {
      triggers: ["bank", "bankszámla", "bankszamla"],
      reply:
        "Ha banki ügyintézésre gondolsz a szerveren belül, azt általában banki helyszínen vagy a megfelelő rendszerben lehet intézni. Írd meg, pontosan mi a gond, és segítek eligazodni."
    },
    {
      triggers: ["hol tudok munkát", "hol tudok munkat", "munka", "kezdőmunka", "kezdomunka"],
      reply:
        "Ha munkával kapcsolatban kérdezel, írd meg pontosan, hogy kezdő munkára, legális munkára vagy frakciós lehetőségre gondolsz, és segítek eligazodni."
    }
  ],

  smallTalkTriggers: [
    "szia",
    "hello",
    "hali",
    "mizu",
    "hogy vagy",
    "mi a helyzet",
    "yo",
    "csá",
    "csa",
    "helló",
    "hello hogy vagy"
  ],

  forcedEscalationTriggers: [
    "staffot kérek",
    "staff kell",
    "ember kell",
    "admin kell",
    "azonnal staff",
    "sürgős",
    "surgos",
    "vezetőség",
    "vezetoseg",
    "report",
    "admin panasz",
    "unban",
    "paypal",
    "pp item",
    "ck",
    "character kill",
    "frakcióbuktatás",
    "frakciobuktatas",
    "cctv",
    "bodycam",
    "dashcam",
    "bug",
    "kihasználta a bugot",
    "bug abuse",
    "metagaming",
    "mg",
    "rdm",
    "rk",
    "forcerp",
    "force rp",
    "fearrp",
    "dm"
  ],

  escalationGuidelines: [
    "Ha a kérdés szabályértelmezési vita, staff szükséges.",
    "Ha a kérdés bizonyítékot vagy logokat igényel, staff szükséges.",
    "Ha valaki admin döntést vitat, staff szükséges.",
    "Ha valaki játékost jelent, staff szükséges.",
    "Ha unban, enyhítés, CK vagy vezetőségi döntés kell, staff szükséges.",
    "Ha PayPal item, támogatói tartalom vagy kompenzáció a téma, staff szükséges.",
    "Ha egyszerű eligazításról van szó, próbálj röviden segíteni."
  ]
};