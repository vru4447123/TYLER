const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, MessageFlags,
} = require('discord.js');
require('dotenv').config();

// ══════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════
const COIN = '🪙';
function fmt(n) { return `${COIN} **${Number(n).toLocaleString()} Coins**`; }

// ══════════════════════════════════════════════════════════════════
//  JSONBIN DATABASE
//  Set these in Railway / .env:
//    JSONBIN_BIN_ID   — the bin ID (after you create a bin)
//    JSONBIN_API_KEY  — your JSONBin secret key ($2a$10$...)
// ══════════════════════════════════════════════════════════════════
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}`;
const JSONBIN_HEADERS = {
  'Content-Type': 'application/json',
  'X-Master-Key': process.env.JSONBIN_API_KEY,
  'X-Bin-Versioning': 'false',
};

let _cache = null;

async function loadDB() {
  if (_cache) return _cache;
  try {
    const res  = await fetch(JSONBIN_URL, { headers: JSONBIN_HEADERS });
    const json = await res.json();
    _cache = json.record || json;
    if (!_cache.users)        _cache.users        = {};
    if (!_cache.warnings)     _cache.warnings     = {};
    if (!_cache.codes)        _cache.codes        = {};
    if (!_cache.shopItems)    _cache.shopItems    = [];
    if (!_cache.stockMessages)_cache.stockMessages= {};
    if (!_cache.codeChannel)  _cache.codeChannel  = null;
    if (!_cache.redeems)      _cache.redeems      = {};
    if (!_cache.redeemCounter)_cache.redeemCounter= 1;
    if (!_cache.invites)      _cache.invites      = {};
    if (!_cache.hasJoined)    _cache.hasJoined    = {};
  } catch (err) {
    console.error('JSONBin load failed:', err.message);
    _cache = {
      users: {}, warnings: {}, codes: {}, shopItems: [],
      stockMessages: {}, codeChannel: null, redeems: {}, redeemCounter: 1, invites: {}, hasJoined: {},
    };
  }
  return _cache;
}

async function saveDB() {
  try {
    await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: JSONBIN_HEADERS,
      body: JSON.stringify(_cache),
    });
  } catch (err) {
    console.error('JSONBin save failed:', err.message);
  }
}

// ── users ─────────────────────────────────────────────────────────
async function getUser(uid, username) {
  const db = await loadDB();
  if (!db.users[uid]) {
    db.users[uid] = { username: username || 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
    await saveDB();
  }
  return db.users[uid];
}
async function dbAddCoins(uid, username, amt) {
  const db = await loadDB();
  if (!db.users[uid]) db.users[uid] = { username: username || 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
  db.users[uid].balance += amt;
  await saveDB();
  return db.users[uid].balance;
}
async function dbRemoveCoins(uid, amt) {
  const db = await loadDB();
  if (!db.users[uid]) db.users[uid] = { username: 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
  db.users[uid].balance = Math.max(0, db.users[uid].balance - amt);
  await saveDB();
  return db.users[uid].balance;
}
async function dbSetCoins(uid, username, amt) {
  const db = await loadDB();
  if (!db.users[uid]) db.users[uid] = { username: username || 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
  db.users[uid].balance = amt;
  await saveDB();
}
async function dbSetLastDaily(uid, ts) {
  const db = await loadDB();
  if (!db.users[uid]) db.users[uid] = { username: 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
  db.users[uid].lastDaily = ts === undefined ? Date.now() : ts;
  await saveDB();
}
async function dbAddInventory(uid, item) {
  const db = await loadDB();
  if (!db.users[uid]) db.users[uid] = { username: 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
  db.users[uid].inventory.push(item);
  await saveDB();
}
async function dbRemoveInventory(uid, item) {
  const db = await loadDB();
  if (!db.users[uid]) return false;
  const idx = db.users[uid].inventory.findIndex(i => i.toLowerCase().includes(item.toLowerCase()));
  if (idx === -1) return false;
  db.users[uid].inventory.splice(idx, 1);
  await saveDB();
  return true;
}
async function dbClearInventory(uid) {
  const db = await loadDB();
  if (db.users[uid]) { db.users[uid].inventory = []; await saveDB(); }
}
async function dbGetInventory(uid) {
  const db = await loadDB();
  return db.users[uid]?.inventory || [];
}
async function dbLeaderboard(n) {
  const db = await loadDB();
  return Object.entries(db.users)
    .map(([userId, d]) => ({ userId, balance: d.balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, n);
}

// ── warnings ──────────────────────────────────────────────────────
async function dbAddWarning(uid, username, reason, by) {
  const db = await loadDB();
  if (!db.warnings[uid]) db.warnings[uid] = [];
  db.warnings[uid].push({ reason, by });
  await saveDB();
  return db.warnings[uid].length;
}
async function dbGetWarnings(uid) {
  const db = await loadDB();
  return db.warnings[uid] || [];
}
async function dbClearWarnings(uid) {
  const db = await loadDB();
  db.warnings[uid] = [];
  await saveDB();
}

// ── shop items ────────────────────────────────────────────────────
async function dbGetShopItems() { const db = await loadDB(); return db.shopItems || []; }
async function dbAddShopItem(item) { const db = await loadDB(); db.shopItems.push(item); await saveDB(); }
async function dbRemoveShopItem(name) {
  const db = await loadDB();
  const idx = db.shopItems.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return false;
  db.shopItems.splice(idx, 1); await saveDB(); return true;
}
async function dbDecrementStock(name) {
  const db = await loadDB();
  const item = db.shopItems.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (item && item.stock > 0) { item.stock--; await saveDB(); }
}

// ── stock messages ────────────────────────────────────────────────
async function dbGetStockMsg(channelId) { const db = await loadDB(); return db.stockMessages[channelId] || null; }
async function dbSetStockMsg(channelId, msgId) {
  const db = await loadDB(); db.stockMessages[channelId] = msgId; await saveDB();
}

// ── codes ─────────────────────────────────────────────────────────
async function dbGetCode(code) { const db = await loadDB(); return db.codes[code] || null; }
async function dbGetAllCodes() { const db = await loadDB(); return Object.values(db.codes); }
async function dbAddCode(entry) { const db = await loadDB(); db.codes[entry.code] = entry; await saveDB(); }
async function dbRemoveCode(code) { const db = await loadDB(); delete db.codes[code]; await saveDB(); }
async function dbRedeemCode(code, uid) {
  const db = await loadDB();
  if (!db.codes[code]) return;
  db.codes[code].uses++;
  db.codes[code].usedBy.push(uid);
  await saveDB();
}
async function dbGetCodeChannel() { const db = await loadDB(); return db.codeChannel || null; }
async function dbSetCodeChannel(id) { const db = await loadDB(); db.codeChannel = id; await saveDB(); }

// ── redeems ───────────────────────────────────────────────────────
async function dbAddRedeem(data) {
  const db = await loadDB();
  const id = db.redeemCounter++;
  db.redeems[id] = { id, ...data, status: 'pending' };
  await saveDB();
  return id;
}
async function dbGetRedeem(id) { const db = await loadDB(); return db.redeems[id] || null; }
async function dbGetPendingRedeems() {
  const db = await loadDB();
  return Object.values(db.redeems).filter(r => r.status === 'pending');
}
async function dbMarkRedeemDone(id, by) {
  const db = await loadDB();
  if (!db.redeems[id]) return;
  db.redeems[id].status = 'paid';
  db.redeems[id].processedBy = by;
  await saveDB();
}

// ══════════════════════════════════════════════════════════════════
//  CODE EXPIRY CHECKER
//  Runs every 30 seconds — when a code expires it edits the
//  announcement message to show it has ended.
// ══════════════════════════════════════════════════════════════════
async function checkCodeExpiry() {
  const db = await loadDB();
  const now = Date.now();
  let changed = false;

  for (const code of Object.values(db.codes)) {
    if (code.expired) continue;
    const expiredByTime  = code.expiresAt && now > code.expiresAt;
    const expiredByUses  = code.maxUses > 0 && code.uses >= code.maxUses;
    if (expiredByTime || expiredByUses) {
      code.expired = true;
      changed = true;

      // Edit the announcement message if we stored its ID
      if (code.announceChannelId && code.announceMessageId) {
        try {
          const channel = await client.channels.fetch(code.announceChannelId);
          const msg     = await channel.messages.fetch(code.announceMessageId);
          const expiredAt = code.expiresAt ? Math.floor(code.expiresAt / 1000) : Math.floor(Date.now() / 1000);
        const expiredEmbed = new EmbedBuilder()
            .setColor(0x888888)
            .setTitle('❌ Code Expired')
            .setDescription(
              `~~**Code:** \`${code.code}\`~~\n` +
              `**Reward:** ${fmt(code.reward)}\n` +
              `Expired: <t:${expiredAt}:F>\n` +
              `**Total uses:** ${code.uses}`
            );
          await msg.edit({ embeds: [expiredEmbed] });
        } catch { /* message deleted or no perms */ }
      }
    }
  }

  if (changed) await saveDB();
}

// ══════════════════════════════════════════════════════════════════
//  SHOP PACKAGES
// ══════════════════════════════════════════════════════════════════
const SHOP_PACKAGES = [
  { name: '125m Brainrot', coins: 1500 },
  { name: '150m Brainrot', coins: 2000 },
  { name: '175m Brainrot', coins: 2500 },
  { name: '200m Brainrot', coins: 3000 },
  { name: '100m Garama',   coins: 5000 },
];

// ══════════════════════════════════════════════════════════════════
//  PERMISSION GUARDS
// ══════════════════════════════════════════════════════════════════
function stripRole(name) {
  // Remove emojis, symbols, pipes, dashes, extra spaces — keep only plain letters/numbers
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')  // replace non-alphanumeric with space
    .replace(/\s+/g, ' ')          // collapse multiple spaces
    .trim();
}

function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => stripRole(r.name).includes('admin perm'));
}
function isOwnerOrCoOwner(member) {
  if (!member) return false;
  return member.roles.cache.some(r => {
    const n = stripRole(r.name);
    return n === 'owner' || n.includes('co owner') || n.includes('co-owner') || n.includes('coowner');
  });
}
function isVerified(member) {
  if (!member) return false;
  return member.roles.cache.some(r => stripRole(r.name) === 'verified');
}
async function guardDebt(i) {
  const user = await getUser(i.user.id, i.user.username);
  if (user.balance < 0) {
    await i.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔒 Account Locked — You Are in Debt!')
        .setDescription(
          `Your balance is ${COIN} **${user.balance.toLocaleString()} Coins** (negative).\n\n` +
          `Your shop, inventory and purchases are **locked** until you get out of debt.\n\n` +
          `**How to get out of debt:**\n` +
          `• Invite new members to the server — each valid invite gives you **+100 Coins**\n` +
          `• Send messages to earn **1 Coin** per message\n` +
          `• Use \`/daily\` for **+100 Coins** every 24h`
        )],
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

async function guardAdmin(i) {
  if (!isAdmin(i.member)) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🚫 Access Denied')
      .setDescription('You need the **Admin Perm** role or **Administrator** permission.')], flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}
async function guardOwner(i) {
  if (!isOwnerOrCoOwner(i.member)) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🚫 Access Denied')
      .setDescription('Only **Owner** or **Co-Owner** can use this.')], flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  SLASH COMMAND DEFINITIONS
// ══════════════════════════════════════════════════════════════════
const commands = [
  // Economy
  new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily 100 coins'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 richest users'),
  new SlashCommandBuilder().setName('pay').setDescription('Send coins to another user (Verified role required)')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),

  // Gambling
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin — win 2x or lose your bet')
    .addStringOption(o => o.setName('side').setDescription('heads or tails').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine!')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('blackjack').setDescription('Play Blackjack!')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  // Shop & Inventory
  new SlashCommandBuilder().setName('shop').setDescription('Browse the coin shop'),
  new SlashCommandBuilder().setName('buy').setDescription('Buy an item from the shop')
    .addStringOption(o => o.setName('item').setDescription('Item name from /shop').setRequired(true)),
  new SlashCommandBuilder().setName('inventory').setDescription('View your inventory')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),
  new SlashCommandBuilder().setName('use').setDescription('Redeem an item — enter your Roblox username')
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),

  // Redemption Admin
  new SlashCommandBuilder().setName('check-redeems').setDescription('[Admin] View all pending redemption requests'),
  new SlashCommandBuilder().setName('finish-redeem').setDescription('[Admin] Mark a redemption as done and DM the user')
    .addIntegerOption(o => o.setName('id').setDescription('Redemption ID').setRequired(true)),

  // Codes
  new SlashCommandBuilder().setName('drop-code').setDescription('[Admin] Drop a timed code that gives coins')
    .addStringOption(o => o.setName('code').setDescription('Code word').setRequired(true))
    .addIntegerOption(o => o.setName('reward').setDescription('Coins rewarded').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('minutes').setDescription('Expiry in minutes (0 = never)').setRequired(true).setMinValue(0))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to announce in (overrides default)').setRequired(false))
    .addIntegerOption(o => o.setName('max_uses').setDescription('Max uses (0 = unlimited)').setRequired(false).setMinValue(0)),
  new SlashCommandBuilder().setName('make-code').setDescription('[Admin] Create a permanent code')
    .addStringOption(o => o.setName('code').setDescription('Code word').setRequired(true))
    .addIntegerOption(o => o.setName('reward').setDescription('Coins rewarded').setRequired(true).setMinValue(1))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to announce in (overrides default)').setRequired(false))
    .addIntegerOption(o => o.setName('max_uses').setDescription('Max uses (0 = unlimited)').setRequired(false).setMinValue(0)),
  new SlashCommandBuilder().setName('remove-code').setDescription('[Admin] Delete a code')
    .addStringOption(o => o.setName('code').setDescription('Code to remove').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to announce removal (overrides default)').setRequired(false)),
  new SlashCommandBuilder().setName('redeem-code').setDescription('Redeem a code for coins')
    .addStringOption(o => o.setName('code').setDescription('The code').setRequired(true)),
  new SlashCommandBuilder().setName('codes').setDescription('[Admin] View all active codes'),
  new SlashCommandBuilder().setName('set-code-channel').setDescription('[Admin] Set default code announcement channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),

  // Info
  new SlashCommandBuilder().setName('userinfo').setDescription('View info about a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false)),
  new SlashCommandBuilder().setName('serverinfo').setDescription('View server info'),

  // Stock Admin
  new SlashCommandBuilder().setName('show-stock').setDescription('[Admin] Post a stock embed in a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Stock amount').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('set-stock').setDescription('[Admin] Update existing stock embed')
    .addChannelOption(o => o.setName('channel').setDescription('Channel with the embed').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('New amount').setRequired(true).setMinValue(0)),

  // Economy Admin
  new SlashCommandBuilder().setName('givecoin').setDescription('[Owner/Co-Owner] Add coins to a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('removecoin').setDescription('[Owner/Co-Owner] Remove coins from a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('setcoins').setDescription('[Admin] Set a user\'s exact balance')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('resetdaily').setDescription('[Admin] Reset a user\'s daily cooldown')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),

  // Shop Admin
  new SlashCommandBuilder().setName('additem').setDescription('[Admin] Add a custom item to the shop')
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
    .addIntegerOption(o => o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(false))
    .addIntegerOption(o => o.setName('stock').setDescription('Stock (-1 = unlimited)').setRequired(false)),
  new SlashCommandBuilder().setName('removeitem').setDescription('[Admin] Remove a custom item from the shop')
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder().setName('giveitem').setDescription('[Admin] Give an item directly to a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder().setName('clearinventory').setDescription('[Admin] Clear a user\'s entire inventory')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),

  // Moderation
  new SlashCommandBuilder().setName('warn').setDescription('[Admin] Warn a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('[Admin] View a user\'s warnings')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),
  new SlashCommandBuilder().setName('clearwarnings').setDescription('[Admin] Clear all warnings for a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),
  new SlashCommandBuilder().setName('timeout').setDescription('[Admin] Timeout a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('untimeout').setDescription('[Admin] Remove timeout from a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('[Admin] Kick a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('ban').setDescription('[Admin] Ban a user')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete message history (0-7 days)').setRequired(false).setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('[Admin] Unban a user by ID')
    .addStringOption(o => o.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('purge').setDescription('[Admin] Delete multiple messages')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('user').setDescription('Only delete from this user').setRequired(false)),
  new SlashCommandBuilder().setName('slowmode').setDescription('[Admin] Set channel slowmode')
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').setRequired(false)),
  new SlashCommandBuilder().setName('lock').setDescription('[Admin] Lock a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('unlock').setDescription('[Admin] Unlock a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').setRequired(false)),
  new SlashCommandBuilder().setName('announce').setDescription('[Admin] Send an announcement embed')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color e.g. ff0000').setRequired(false)),

  // Help
  new SlashCommandBuilder().setName('help').setDescription('View all commands'),
  new SlashCommandBuilder().setName('adminhelp').setDescription('[Admin] View all admin commands'),
  new SlashCommandBuilder().setName('tutorial').setDescription('How to use the bot — setup guide for new users'),
  new SlashCommandBuilder().setName('admin-tutorial').setDescription('How to set up admin roles and permissions'),
  new SlashCommandBuilder().setName('owner-tutorial').setDescription('Full bot guide — only for the bot owner'),
].map(c => c.toJSON());

// ══════════════════════════════════════════════════════════════════
//  CLIENT
// ══════════════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
});

// ── Register commands ─────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // 1. Wipe global commands
  console.log('🧹 Clearing old global commands...');
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log('✅ Global commands cleared.');
  } catch (err) { console.error('❌ Clear global failed:', err.message); }

  // 2. Wipe + re-register per guild for instant availability
  for (const [guildId] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: [] });
      console.log(`🧹 Guild ${guildId} cleared.`);
    } catch (err) { console.error(`❌ Clear guild ${guildId} failed:`, err.message); }

    try {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
      console.log(`✅ Guild ${guildId} registered.`);
    } catch (err) { console.error(`❌ Register guild ${guildId} failed:`, err.message); }
  }
  console.log('✅ All commands registered fresh!');
}

// ══════════════════════════════════════════════════════════════════
//  INVITE TRACKING
// ══════════════════════════════════════════════════════════════════

// Cache: guildId -> Map<inviteCode, { uses, inviterId }>
const inviteCache = new Map();

// Build cache for a guild
async function buildInviteCache(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.each(inv => map.set(inv.code, { uses: inv.uses, inviterId: inv.inviter?.id || null }));
    inviteCache.set(guild.id, map);
  } catch { /* no perms */ }
}

// When bot joins a new guild, cache it
client.on('guildCreate', async guild => {
  await buildInviteCache(guild);
});

// When a new invite is created, add it to cache
client.on('inviteCreate', invite => {
  const map = inviteCache.get(invite.guild.id) || new Map();
  map.set(invite.code, { uses: invite.uses, inviterId: invite.inviter?.id || null });
  inviteCache.set(invite.guild.id, map);
});

// When invite is deleted, remove from cache
client.on('inviteDelete', invite => {
  const map = inviteCache.get(invite.guild.id);
  if (map) map.delete(invite.code);
});

// Member joins — figure out which invite was used
client.on('guildMemberAdd', async member => {
  const guild = member.guild;
  const oldMap = inviteCache.get(guild.id) || new Map();

  let usedInvite = null;
  try {
    const newInvites = await guild.invites.fetch();
    newInvites.each(inv => {
      const cached = oldMap.get(inv.code);
      if (cached && inv.uses > cached.uses) {
        usedInvite = inv;
      }
    });
    // Rebuild cache with new counts
    const newMap = new Map();
    newInvites.each(inv => newMap.set(inv.code, { uses: inv.uses, inviterId: inv.inviter?.id || null }));
    inviteCache.set(guild.id, newMap);
  } catch { return; }

  if (!usedInvite || !usedInvite.inviter) return;

  const db = await loadDB();
  if (!db.invites) db.invites = {};
  if (!db.hasJoined) db.hasJoined = {};

  const inviterId = usedInvite.inviter.id;
  const inviterTag = usedInvite.inviter.tag;

  // Check if this person has joined before (rejoin detection)
  const hasJoinedBefore = db.hasJoined[member.id] === true;

  if (hasJoinedBefore) {
    // Rejoin — no coins, DM the person and the inviter
    try {
      await member.user.send({
        embeds: [new EmbedBuilder()
          .setColor(0xff8800)
          .setTitle(`👋 Welcome Back to ${guild.name}!`)
          .setDescription(
            `You rejoined **${guild.name}** using **${inviterTag}**'s invite.\n\n` +
            `⚠️ Since you've been in this server before, **no coins** were awarded to your inviter for this rejoin.`
          )
          .setThumbnail(guild.iconURL())],
      });
    } catch { /* DMs closed */ }

    try {
      const inviterUser = await client.users.fetch(inviterId);
      await inviterUser.send({
        embeds: [new EmbedBuilder()
          .setColor(0xff8800)
          .setTitle('⚠️ Rejoin — No Coins Awarded')
          .setDescription(
            `**${member.user.tag}** rejoined **${guild.name}** using your invite.\n\n` +
            `Since they were already in this server before, **no coins** were awarded for this rejoin.`
          )
          .setThumbnail(member.user.displayAvatarURL())],
      });
    } catch { /* DMs closed */ }
    return;
  }

  // First time join — award coins
  db.hasJoined[member.id] = true;
  db.invites[member.id] = { inviterId, guildId: guild.id };
  await saveDB();

  await dbAddCoins(inviterId, usedInvite.inviter.username, 100);
  const inviterBal = (await getUser(inviterId)).balance;

  // DM the inviter
  try {
    const inviterUser = await client.users.fetch(inviterId);
    await inviterUser.send({
      embeds: [new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('🎉 Someone Joined Using Your Invite!')
        .setDescription(
          `**${member.user.tag}** just joined **${guild.name}** using your invite!\n\n` +
          `${COIN} You earned **+100 Coins**\n` +
          `💰 New balance: **${inviterBal.toLocaleString()} Coins**`
        )
        .setThumbnail(member.user.displayAvatarURL())],
    });
  } catch { /* DMs closed */ }

  // DM the new member
  try {
    await member.user.send({
      embeds: [new EmbedBuilder()
        .setColor(0x00b4ff)
        .setTitle(`👋 Welcome to ${guild.name}!`)
        .setDescription(
          `You were invited by **${inviterTag}**.\n\n` +
          `Start earning coins by chatting, use \`/daily\` for free coins, and check \`/shop\` for items!\n\n` +
          `Use \`/help\` to see all available commands.`
        )
        .setThumbnail(guild.iconURL())],
    });
  } catch { /* DMs closed */ }
});
// Member leaves — remove 100 coins from the inviter
client.on('guildMemberRemove', async member => {
  const db = await loadDB();
  if (!db.invites) return;

  const record = db.invites[member.id];
  if (!record) return;

  const inviterId = record.inviterId;

  // Remove 100 coins (can go negative)
  const inviterData = await getUser(inviterId);
  inviterData.balance -= 100;
  await saveUser(inviterId, inviterData);
  const newBal = inviterData.balance;

  // Remove the record
  delete db.invites[member.id];
  await saveDB();

  // DM the inviter
  try {
    const inviterUser = await client.users.fetch(inviterId);
    await inviterUser.send({
      embeds: [new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('😔 Your Invite Left the Server')
        .setDescription(
          `**${member.user.tag}** just left **${member.guild.name}**.

` +
          `${COIN} You lost **-100 Coins**
` +
          `💰 New balance: **${newBal.toLocaleString()} Coins**${newBal < 0 ? ' ⚠️ (negative!)' : ''}`
        )
        .setThumbnail(member.user.displayAvatarURL())],
    });
  } catch { /* DMs closed */ }
});

// ══════════════════════════════════════════════════════════════════
//  MESSAGE COUNTING  — 1 message = 1 coin
// ══════════════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  await dbAddCoins(message.author.id, message.author.username, 1);
});

// ══════════════════════════════════════════════════════════════════
//  INTERACTION ROUTER
// ══════════════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (interaction.isButton())      return handleButton(interaction);
  if (interaction.isModalSubmit()) return handleModal(interaction);
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'balance':          return cmdBalance(interaction);
      case 'daily':            return cmdDaily(interaction);
      case 'leaderboard':      return cmdLeaderboard(interaction);
      case 'pay':              return cmdPay(interaction);
      case 'coinflip':         return cmdCoinflip(interaction);
      case 'slots':            return cmdSlots(interaction);
      case 'blackjack':        return cmdBlackjack(interaction);
      case 'shop':             return cmdShop(interaction);
      case 'buy':              return cmdBuy(interaction);
      case 'inventory':        return cmdInventory(interaction);
      case 'use':              return cmdUse(interaction);
      case 'check-redeems':    return cmdCheckRedeems(interaction);
      case 'finish-redeem':    return cmdFinishRedeem(interaction);
      case 'drop-code':        return cmdDropCode(interaction);
      case 'make-code':        return cmdMakeCode(interaction);
      case 'remove-code':      return cmdRemoveCode(interaction);
      case 'redeem-code':      return cmdRedeemCode(interaction);
      case 'codes':            return cmdCodes(interaction);
      case 'set-code-channel': return cmdSetCodeChannel(interaction);
      case 'userinfo':         return cmdUserinfo(interaction);
      case 'serverinfo':       return cmdServerinfo(interaction);
      case 'show-stock':       return cmdShowStock(interaction);
      case 'set-stock':        return cmdSetStock(interaction);
      case 'givecoin':         return cmdGiveCoin(interaction);
      case 'removecoin':       return cmdRemoveCoin(interaction);
      case 'setcoins':         return cmdSetCoins(interaction);
      case 'resetdaily':       return cmdResetDaily(interaction);
      case 'additem':          return cmdAddItem(interaction);
      case 'removeitem':       return cmdRemoveItem(interaction);
      case 'giveitem':         return cmdGiveItem(interaction);
      case 'clearinventory':   return cmdClearInventory(interaction);
      case 'warn':             return cmdWarn(interaction);
      case 'warnings':         return cmdWarnings(interaction);
      case 'clearwarnings':    return cmdClearWarnings(interaction);
      case 'timeout':          return cmdTimeout(interaction);
      case 'untimeout':        return cmdUntimeout(interaction);
      case 'kick':             return cmdKick(interaction);
      case 'ban':              return cmdBan(interaction);
      case 'unban':            return cmdUnban(interaction);
      case 'purge':            return cmdPurge(interaction);
      case 'slowmode':         return cmdSlowmode(interaction);
      case 'lock':             return cmdLock(interaction);
      case 'unlock':           return cmdUnlock(interaction);
      case 'announce':         return cmdAnnounce(interaction);
      case 'help':             return cmdHelp(interaction);
      case 'adminhelp':        return cmdAdminHelp(interaction);
      case 'tutorial':         return cmdTutorial(interaction);
      case 'admin-tutorial':   return cmdAdminTutorial(interaction);
      case 'owner-tutorial':   return cmdOwnerTutorial(interaction);
    }
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const payload = { content: '⚠️ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
    interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
  }
});

// ══════════════════════════════════════════════════════════════════
//  ECONOMY COMMANDS
// ══════════════════════════════════════════════════════════════════

async function cmdBalance(i) {
  const target = i.options.getUser('user') || i.user;
  const data   = await getUser(target.id, target.username);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0xffd700).setTitle(`${COIN} ${target.username}'s Balance`)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(`**Balance:** ${fmt(data.balance)}`)
      .setFooter({ text: '1 message = 1 Coin' })],
  });
}

async function cmdDaily(i) {
  const data = await getUser(i.user.id, i.user.username);
  const now  = Date.now();
  const CD   = 24 * 60 * 60 * 1000;
  if (data.lastDaily && now - data.lastDaily < CD) {
    const nextDaily = Math.floor((data.lastDaily + CD) / 1000);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('⏰ Already Claimed')
        .setDescription(`You already claimed your daily!\nCome back <t:${nextDaily}:R> \u2014 <t:${nextDaily}:F>`)], flags: MessageFlags.Ephemeral,
    });
  }
  await dbAddCoins(i.user.id, i.user.username, 100);
  await dbSetLastDaily(i.user.id);
  const newBal = (await getUser(i.user.id)).balance;
  const nextTs = Math.floor((Date.now() + CD) / 1000);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('🎁 Daily Reward!')
      .setDescription(`You received ${fmt(100)}!\nBalance: ${fmt(newBal)}\n\nNext daily: <t:${nextTs}:R>`)
      .setThumbnail(i.user.displayAvatarURL())],
  });
}

async function cmdLeaderboard(i) {
  const top  = await dbLeaderboard(10);
  const desc = top.map((u, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**${idx + 1}.**`;
    return `${medal} <@${u.userId}> — ${fmt(u.balance)}`;
  }).join('\n') || 'No users yet!';
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0xffd700).setTitle(`${COIN} Coin Leaderboard`).setDescription(desc)],
  });
}

async function cmdPay(i) {
  if (!isVerified(i.member))
    return i.reply({ content: '❌ You need the **Verified** role to send coins.', flags: MessageFlags.Ephemeral });
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  if (target.id === i.user.id) return i.reply({ content: "❌ Can't pay yourself!", flags: MessageFlags.Ephemeral });
  if (target.bot) return i.reply({ content: "❌ Can't pay bots!", flags: MessageFlags.Ephemeral });
  const sender = await getUser(i.user.id, i.user.username);
  if (sender.balance < amount)
    return i.reply({ content: `❌ You only have ${fmt(sender.balance)}.`, flags: MessageFlags.Ephemeral });
  await dbRemoveCoins(i.user.id, amount);
  await dbAddCoins(target.id, target.username, amount);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('💸 Transfer Successful')
      .setDescription(`**${i.user.username}** sent ${fmt(amount)} to **${target.username}**`)],
  });
}

// ══════════════════════════════════════════════════════════════════
//  GAMBLING
// ══════════════════════════════════════════════════════════════════

async function cmdCoinflip(i) {
  if (!await guardDebt(i)) return;
  const side = i.options.getString('side');
  const bet  = i.options.getInteger('bet');
  const user = await getUser(i.user.id, i.user.username);
  if (user.balance < bet)
    return i.reply({ content: `❌ You only have ${fmt(user.balance)}.`, flags: MessageFlags.Ephemeral });
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won    = result === side;
  won ? await dbAddCoins(i.user.id, i.user.username, bet) : await dbRemoveCoins(i.user.id, bet);
  const newBal = (await getUser(i.user.id)).balance;
  return i.reply({
    embeds: [new EmbedBuilder().setColor(won ? 0x00ff88 : 0xff4444)
      .setTitle(won ? '🪙 You Won!' : '🪙 You Lost!')
      .setDescription(
        `The coin landed on **${result}** ${result === 'heads' ? '👑' : '🔵'}\n` +
        `You guessed **${side}**\n\n` +
        (won ? `✅ Won ${fmt(bet)}!` : `❌ Lost ${fmt(bet)}`) +
        `\n\n💰 Balance: ${fmt(newBal)}`
      )],
  });
}

async function cmdSlots(i) {
  if (!await guardDebt(i)) return;
  const bet  = i.options.getInteger('bet');
  const user = await getUser(i.user.id, i.user.username);
  if (user.balance < bet)
    return i.reply({ content: `❌ You only have ${fmt(user.balance)}.`, flags: MessageFlags.Ephemeral });
  const symbols = ['🍒','🍋','🍊','🍇','⭐','💎','7️⃣'];
  const weights = [30, 20, 20, 15, 10, 4, 1];
  function spin() {
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let j = 0; j < symbols.length; j++) { r -= weights[j]; if (r <= 0) return symbols[j]; }
    return symbols[0];
  }
  const reels = [spin(), spin(), spin()];
  let mult = 0, resultText = '❌ No match — better luck next time!';
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    if      (reels[0] === '7️⃣') { mult = 20; resultText = '🎰 **JACKPOT! 7-7-7!** 20×!'; }
    else if (reels[0] === '💎')  { mult = 10; resultText = '💎 **Triple Diamonds!** 10×!'; }
    else if (reels[0] === '⭐')  { mult = 5;  resultText = '⭐ **Triple Stars!** 5×!'; }
    else                          { mult = 3;  resultText = `🎉 **Triple ${reels[0]}!** 3×!`; }
  } else if (reels[0]===reels[1] || reels[1]===reels[2] || reels[0]===reels[2]) {
    mult = 1.5; resultText = '✨ Two of a kind! 1.5×!';
  }
  let win = 0;
  if (mult > 0) { win = Math.floor(bet * mult); await dbAddCoins(i.user.id, i.user.username, win - bet); }
  else { await dbRemoveCoins(i.user.id, bet); }
  const newBal = (await getUser(i.user.id)).balance;
  return i.reply({
    embeds: [new EmbedBuilder().setColor(mult > 0 ? 0xffd700 : 0xff4444).setTitle('🎰 Slot Machine')
      .setDescription(
        `**[ ${reels.join(' | ')} ]**\n\n${resultText}\n\n` +
        (mult > 0 ? `✅ Won ${fmt(win)} (+${fmt(win - bet)})` : `❌ Lost ${fmt(bet)}`) +
        `\n💰 Balance: ${fmt(newBal)}`
      )],
  });
}

// ── Blackjack ─────────────────────────────────────────────────────
const bjGames = new Map();

async function cmdBlackjack(i) {
  if (!await guardDebt(i)) return;
  const bet  = i.options.getInteger('bet');
  const user = await getUser(i.user.id, i.user.username);
  if (user.balance < bet)
    return i.reply({ content: `❌ You only have ${fmt(user.balance)}.`, flags: MessageFlags.Ephemeral });
  const deck = buildDeck();
  const ph   = [drawCard(deck), drawCard(deck)];
  const dh   = [drawCard(deck), drawCard(deck)];
  bjGames.set(i.user.id, { bet, deck, ph, dh });
  await dbRemoveCoins(i.user.id, bet);
  if (handValue(ph) === 21) {
    const win = Math.floor(bet * 2.5);
    await dbAddCoins(i.user.id, i.user.username, win);
    bjGames.delete(i.user.id);
    const newBal = (await getUser(i.user.id)).balance;
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('🃏 NATURAL BLACKJACK!')
        .setDescription(`**Your hand:** ${handStr(ph)} = **21**\n\n🎉 Won ${fmt(win)} (2.5×)\n💰 Balance: ${fmt(newBal)}`)],
    });
  }
  return i.reply({
    embeds: [bjEmbed(ph, dh, bet, 'Your turn! Hit, Stand, or Double Down.')],
    components: [bjRow(i.user.id, true)],
  });
}

async function handleButton(i) {
  const p = i.customId.split('_');
  if (p[0] !== 'bj') return;
  const action = p[1], userId = p[2];
  const state  = bjGames.get(userId);
  if (!state) return i.reply({ content: 'No active game.', flags: MessageFlags.Ephemeral });
  if (i.user.id !== userId) return i.reply({ content: "This isn't your game!", flags: MessageFlags.Ephemeral });
  await i.deferUpdate();
  if (action === 'double') {
    const u = await getUser(userId, i.user.username);
    if (u.balance >= state.bet) { await dbRemoveCoins(userId, state.bet); state.bet *= 2; }
  }
  if (action === 'hit' || action === 'double') {
    state.ph.push(drawCard(state.deck));
    const v = handValue(state.ph);
    if (v > 21) {
      bjGames.delete(userId);
      const newBal = (await getUser(userId)).balance;
      return i.editReply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🃏 BUST!')
          .setDescription(`**Your hand:** ${handStr(state.ph)} = **${v}** — BUST!\n❌ Lost ${fmt(state.bet)}\n💰 Balance: ${fmt(newBal)}`)],
        components: [],
      });
    }
    if (v === 21 || action === 'double') return resolveDealer(i, userId, state);
    return i.editReply({
      embeds: [bjEmbed(state.ph, state.dh, state.bet, `Your total: **${v}**. Continue?`)],
      components: [bjRow(userId, false)],
    });
  }
  if (action === 'stand') return resolveDealer(i, userId, state);
}

async function resolveDealer(i, userId, state) {
  while (handValue(state.dh) < 17) state.dh.push(drawCard(state.deck));
  const pv = handValue(state.ph), dv = handValue(state.dh);
  let result, color, payout = 0;
  if (dv > 21 || pv > dv) {
    payout = state.bet * 2; result = `🏆 **You Win!** Dealer: ${dv}. Won ${fmt(payout)}!`; color = 0x00ff88;
  } else if (pv === dv) {
    payout = state.bet; result = `🤝 **Push!** Bet returned.`; color = 0xffaa00;
  } else {
    result = `😞 **Dealer wins** (${dv}). Lost ${fmt(state.bet)}.`; color = 0xff4444;
  }
  if (payout > 0) await dbAddCoins(userId, i.user.username, payout);
  bjGames.delete(userId);
  const newBal = (await getUser(userId)).balance;
  return i.editReply({
    embeds: [new EmbedBuilder().setColor(color).setTitle('🃏 Blackjack — Result')
      .setDescription(`**Your hand:** ${handStr(state.ph)} = **${pv}**\n**Dealer:** ${handStr(state.dh)} = **${dv}**\n\n${result}\n💰 Balance: ${fmt(newBal)}`)],
    components: [],
  });
}

function bjRow(uid, showDouble) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bj_hit_${uid}`).setLabel('Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bj_stand_${uid}`).setLabel('Stand').setStyle(ButtonStyle.Danger)
  );
  if (showDouble) row.addComponents(
    new ButtonBuilder().setCustomId(`bj_double_${uid}`).setLabel('Double Down').setStyle(ButtonStyle.Primary)
  );
  return row;
}
function bjEmbed(ph, dh, bet, status) {
  return new EmbedBuilder().setColor(0x1a1a2e).setTitle('🃏 Blackjack')
    .setDescription(`**Your hand:** ${handStr(ph)} = **${handValue(ph)}**\n**Dealer shows:** ${dh[0].display} | 🂠\n\n**Bet:** ${fmt(bet)}\n\n${status}`);
}

// ══════════════════════════════════════════════════════════════════
//  SHOP & INVENTORY
// ══════════════════════════════════════════════════════════════════

async function cmdShop(i) {
  const extras = await dbGetShopItems();
  const embed  = new EmbedBuilder().setColor(0x00b4ff).setTitle('🛒 Coin Shop')
    .setDescription('Use `/buy <item>` to purchase.\n\u200B');
  SHOP_PACKAGES.forEach(p => {
    embed.addFields({ name: `📦 ${p.name}`, value: `${fmt(p.coins)}\n\`/buy ${p.name}\``, inline: true });
  });
  if (extras.length) {
    embed.addFields({ name: '\u200B', value: '**— Extra Items —**' });
    extras.forEach(it => {
      const stock = it.stock === -1 ? '∞' : it.stock === 0 ? '❌ Out of stock' : `${it.stock} left`;
      embed.addFields({ name: `${it.emoji || '📦'} ${it.name} — ${fmt(it.price)}`, value: `${it.description}\nStock: ${stock}\n\`/buy ${it.name}\``, inline: true });
    });
  }
  embed.setFooter({ text: 'Contact staff after purchase to receive your item' });
  return i.reply({ embeds: [embed] });
}

async function cmdBuy(i) {
  if (!await guardDebt(i)) return;
  const input = i.options.getString('item').toLowerCase().trim();
  const pkg   = SHOP_PACKAGES.find(p => p.name.toLowerCase() === input);
  if (pkg) {
    const user = await getUser(i.user.id, i.user.username);
    if (user.balance < pkg.coins)
      return i.reply({ content: `❌ Need ${fmt(pkg.coins)} — you have ${fmt(user.balance)}.`, flags: MessageFlags.Ephemeral });
    await dbRemoveCoins(i.user.id, pkg.coins);
    await dbAddInventory(i.user.id, pkg.name);
    const newBal = (await getUser(i.user.id)).balance;
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ Purchase Successful!')
        .setDescription(`Bought **${pkg.name}** for ${fmt(pkg.coins)}\n💰 Balance: ${fmt(newBal)}\n\n> Use \`/use ${pkg.name}\` to redeem!`)],
    });
  }
  const items = await dbGetShopItems();
  const item  = items.find(it => it.name.toLowerCase() === input);
  if (!item) return i.reply({ content: '❌ Item not found. Check `/shop`.', flags: MessageFlags.Ephemeral });
  if (item.stock === 0) return i.reply({ content: '❌ Out of stock!', flags: MessageFlags.Ephemeral });
  const user = await getUser(i.user.id, i.user.username);
  if (user.balance < item.price)
    return i.reply({ content: `❌ Need ${fmt(item.price)} — you have ${fmt(user.balance)}.`, flags: MessageFlags.Ephemeral });
  await dbRemoveCoins(i.user.id, item.price);
  await dbAddInventory(i.user.id, item.name);
  if (item.stock > 0) await dbDecrementStock(item.name);
  const newBal = (await getUser(i.user.id)).balance;
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ Purchase Successful!')
      .setDescription(`Bought **${item.emoji || '📦'} ${item.name}** for ${fmt(item.price)}\n💰 Balance: ${fmt(newBal)}`)],
  });
}

async function cmdInventory(i) {
  const target   = i.options.getUser('user') || i.user;
  const inv      = await dbGetInventory(target.id);
  const userData = await getUser(target.id, target.username);
  const inDebt   = userData.balance < 0;

  if (!inv.length) return i.reply({
    embeds: [new EmbedBuilder().setColor(0x7289da).setTitle(`🎒 ${target.username}'s Inventory`)
      .setDescription('Empty! Use `/shop` to browse.')],
  });
  const grouped = {};
  inv.forEach(it => { grouped[it] = (grouped[it] || 0) + 1; });
  const desc = Object.entries(grouped).map(([n, q]) => `• **${n}** × ${q}`).join('\n');
  const embed = new EmbedBuilder().setColor(inDebt ? 0xff0000 : 0x7289da)
    .setTitle(`🎒 ${target.username}'s Inventory${inDebt ? ' 🔒' : ''}`)
    .setDescription(desc + (inDebt ? '\n\n🔒 **Inventory locked — account is in debt. Invite members to recover!**' : ''))
    .setThumbnail(target.displayAvatarURL())
    .setFooter({ text: `${inv.length} total items${inDebt ? ' • Locked until out of debt' : ''}` });
  return i.reply({ embeds: [embed] });
}

async function cmdUse(i) {
  if (!await guardDebt(i)) return;
  const input = i.options.getString('item').toLowerCase();
  const inv   = await dbGetInventory(i.user.id);
  const idx   = inv.findIndex(it => it.toLowerCase().includes(input));
  if (idx === -1) return i.reply({ content: "❌ You don't have that item. Check `/inventory`.", flags: MessageFlags.Ephemeral });
  const itemName = inv[idx];

  // Show modal — username only
  const modal = new ModalBuilder()
    .setCustomId(`redeem_modal_${i.user.id}_${encodeURIComponent(itemName)}`)
    .setTitle('Redemption Form');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('roblox_username').setLabel('Your Roblox Username')
        .setStyle(TextInputStyle.Short).setPlaceholder('e.g. Builderman').setRequired(true)
    )
  );
  return i.showModal(modal);
}

async function handleModal(i) {
  if (!i.customId.startsWith('redeem_modal_')) return;
  const parts        = i.customId.split('_');
  const userId       = parts[2];
  const itemName     = decodeURIComponent(parts.slice(3).join('_'));
  if (i.user.id !== userId) return i.reply({ content: "❌ This form isn't for you.", flags: MessageFlags.Ephemeral });

  const robloxUsername = i.fields.getTextInputValue('roblox_username').trim();

  await dbRemoveInventory(userId, itemName);
  const requestId = await dbAddRedeem({ userId, username: i.user.username, itemName, robloxUsername });

  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ Redemption Submitted!')
      .setDescription(
        `Your request has been submitted! Staff will process it soon.\n\n` +
        `**Item:** ${itemName}\n**Roblox Username:** ${robloxUsername}\n\n` +
        `**Request ID:** \`#${requestId}\`\n\n> You'll receive a DM when it's done!`
      )],
    flags: MessageFlags.Ephemeral,
  });
}

async function cmdCheckRedeems(i) {
  if (!await guardAdmin(i)) return;
  const pending = await dbGetPendingRedeems();
  if (!pending.length) return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ No Pending Requests')
      .setDescription('No pending redemptions right now.')], flags: MessageFlags.Ephemeral,
  });
  const embed = new EmbedBuilder().setColor(0x00b4ff).setTitle(`📋 Pending Redemptions (${pending.length})`);
  pending.forEach(r => {
    embed.addFields({
      name:  `#${r.id} — ${r.itemName}`,
      value: `👤 **Discord:** <@${r.userId}> (${r.username})\n🎮 **Roblox:** \`${r.robloxUsername}\`\n> Use \`/finish-redeem ${r.id}\` to mark as done`,
      inline: false,
    });
  });
  return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function cmdFinishRedeem(i) {
  if (!await guardAdmin(i)) return;
  const requestId = i.options.getInteger('id');
  const request   = await dbGetRedeem(requestId);
  if (!request) return i.reply({ content: `❌ No redemption found with ID **#${requestId}**.`, flags: MessageFlags.Ephemeral });
  if (request.status === 'paid') return i.reply({ content: `❌ Request **#${requestId}** is already done.`, flags: MessageFlags.Ephemeral });
  await dbMarkRedeemDone(requestId, i.user.tag);
  try {
    const user = await client.users.fetch(request.userId);
    await user.send({
      embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('🎉 Your Redemption Has Been Processed!')
        .setDescription(
          `Your request has been fulfilled!\n\n**Item:** ${request.itemName}\n` +
          `**Roblox Username:** ${request.robloxUsername}\n\n` +
          `**Request ID:** \`#${requestId}\`\n**Processed by:** ${i.user.tag}\n\n> Thank you for your purchase!`
        )],
    });
    return i.reply({ embeds: [adminEmbed(`✅ Request **#${requestId}** marked as done!\n\n**User:** <@${request.userId}>\n**Item:** ${request.itemName}\n\n📩 DM sent successfully.`)] });
  } catch {
    return i.reply({ embeds: [adminEmbed(`✅ Request **#${requestId}** marked as done!\n\n**User:** <@${request.userId}>\n**Item:** ${request.itemName}\n\n⚠️ Could not DM — user may have DMs disabled.`)] });
  }
}

// ══════════════════════════════════════════════════════════════════
//  CODES
// ══════════════════════════════════════════════════════════════════

async function getAnnounceChannel(optionChannel) {
  if (optionChannel) return optionChannel;
  const defaultId = await dbGetCodeChannel();
  if (defaultId) return client.channels.fetch(defaultId).catch(() => null);
  return null;
}

async function cmdDropCode(i) {
  if (!await guardAdmin(i)) return;
  const code    = i.options.getString('code').toUpperCase().trim();
  const reward  = i.options.getInteger('reward');
  const minutes = i.options.getInteger('minutes');
  const maxUses = i.options.getInteger('max_uses') ?? 0;
  const channel = i.options.getChannel('channel');
  if (await dbGetCode(code)) return i.reply({ content: `❌ Code **${code}** already exists.`, flags: MessageFlags.Ephemeral });
  const expiresAt = minutes > 0 ? Date.now() + minutes * 60 * 1000 : null;

  const announceChannel = await getAnnounceChannel(channel);

  const embed = new EmbedBuilder().setColor(0xffd700).setTitle('🎉 Code Dropped!')
    .setDescription(
      `**Code:** ||\`${code}\`||\n**Reward:** ${fmt(reward)}\n` +
      `${expiresAt ? `⏰ Expires <t:${Math.floor(expiresAt/1000)}:R> — <t:${Math.floor(expiresAt/1000)}:F>` : '⏰ No expiry'}\n` +
      `${maxUses > 0 ? `👥 Max uses: **${maxUses}**` : '👥 Unlimited uses'}\n\n` +
      `Use \`/redeem-code ${code}\` to claim!`
    );

  let announceMessageId = null;
  let announceChannelId = null;

  if (announceChannel) {
    const msg = await announceChannel.send({ embeds: [embed] });
    announceMessageId = msg.id;
    announceChannelId = announceChannel.id;
  }

  await dbAddCode({
    code, reward, maxUses, uses: 0, expiresAt,
    permanent: false, createdBy: i.user.tag, usedBy: [],
    expired: false, announceMessageId, announceChannelId,
  });

  if (announceChannel) return i.reply({ content: `✅ Code **${code}** dropped in <#${announceChannel.id}>!`, flags: MessageFlags.Ephemeral });
  return i.reply({ embeds: [embed] });
}

async function cmdMakeCode(i) {
  if (!await guardAdmin(i)) return;
  const code    = i.options.getString('code').toUpperCase().trim();
  const reward  = i.options.getInteger('reward');
  const maxUses = i.options.getInteger('max_uses') ?? 0;
  const channel = i.options.getChannel('channel');
  if (await dbGetCode(code)) return i.reply({ content: `❌ Code **${code}** already exists.`, flags: MessageFlags.Ephemeral });

  const announceChannel = await getAnnounceChannel(channel);

  const embed = new EmbedBuilder().setColor(0x00b4ff).setTitle('📌 Permanent Code Created!')
    .setDescription(
      `**Code:** ||\`${code}\`||\n**Reward:** ${fmt(reward)}\n⏰ Never expires\n` +
      `${maxUses > 0 ? `👥 Max uses: **${maxUses}**` : '👥 Unlimited uses'}\n\n` +
      `Use \`/redeem-code ${code}\` to claim!`
    );

  let announceMessageId = null;
  let announceChannelId = null;

  if (announceChannel) {
    const msg = await announceChannel.send({ embeds: [embed] });
    announceMessageId = msg.id;
    announceChannelId = announceChannel.id;
  }

  await dbAddCode({
    code, reward, maxUses, uses: 0, expiresAt: null,
    permanent: true, createdBy: i.user.tag, usedBy: [],
    expired: false, announceMessageId, announceChannelId,
  });

  if (announceChannel) return i.reply({ content: `✅ Permanent code **${code}** created in <#${announceChannel.id}>!`, flags: MessageFlags.Ephemeral });
  return i.reply({ embeds: [embed] });
}

async function cmdRemoveCode(i) {
  if (!await guardAdmin(i)) return;
  const code    = i.options.getString('code').toUpperCase().trim();
  const channel = i.options.getChannel('channel');
  const existing = await dbGetCode(code);
  if (!existing) return i.reply({ content: `❌ No code **${code}** found.`, flags: MessageFlags.Ephemeral });
  await dbRemoveCode(code);
  const embed = new EmbedBuilder().setColor(0xff4444).setTitle('🗑️ Code Removed')
    .setDescription(`Code **\`${code}\`** has been removed.\nIt was used **${existing.uses}** time(s).`);
  const announceChannel = await getAnnounceChannel(channel);
  if (announceChannel) { await announceChannel.send({ embeds: [embed] }); return i.reply({ content: `✅ Announced in <#${announceChannel.id}>.`, flags: MessageFlags.Ephemeral }); }
  return i.reply({ embeds: [embed] });
}

async function cmdRedeemCode(i) {
  const code  = i.options.getString('code').toUpperCase().trim();
  const entry = await dbGetCode(code);
  if (!entry)                                          return i.reply({ content: '❌ Invalid code.', flags: MessageFlags.Ephemeral });
  if (entry.expired)                                   return i.reply({ content: '❌ This code has expired.', flags: MessageFlags.Ephemeral });
  if (entry.expiresAt && Date.now() > entry.expiresAt) return i.reply({ content: '❌ This code has expired.', flags: MessageFlags.Ephemeral });
  if (entry.maxUses > 0 && entry.uses >= entry.maxUses) return i.reply({ content: '❌ This code has reached its maximum uses.', flags: MessageFlags.Ephemeral });
  if (entry.usedBy.includes(i.user.id))                return i.reply({ content: '❌ You have already redeemed this code.', flags: MessageFlags.Ephemeral });

  await dbRedeemCode(code, i.user.id);
  await dbAddCoins(i.user.id, i.user.username, entry.reward);

  // Check if code just hit max uses now and mark expired
  const updated = await dbGetCode(code);
  if (updated && updated.maxUses > 0 && updated.uses >= updated.maxUses) {
    const db = await loadDB();
    db.codes[code].expired = true;
    await saveDB();
    // Edit the announcement message
    if (updated.announceChannelId && updated.announceMessageId) {
      try {
        const ch  = await client.channels.fetch(updated.announceChannelId);
        const msg = await ch.messages.fetch(updated.announceMessageId);
        const usedUpTs = Math.floor(Date.now() / 1000);
        await msg.edit({
          embeds: [new EmbedBuilder().setColor(0x888888).setTitle('❌ Code Expired')
            .setDescription(`~~**Code:** \`${code}\`~~\n**Reward:** ${fmt(entry.reward)}\nExpired: <t:${usedUpTs}:F>\n**Total uses:** ${updated.uses}`)],
        });
      } catch { /* ignore */ }
    }
  }

  const newBal = (await getUser(i.user.id)).balance;
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('🎉 Code Redeemed!')
      .setDescription(`You redeemed **\`${code}\`**!\n\nYou received ${fmt(entry.reward)}\n💰 New balance: ${fmt(newBal)}`)],
    flags: MessageFlags.Ephemeral,
  });
}

async function cmdCodes(i) {
  if (!await guardAdmin(i)) return;
  const codes = await dbGetAllCodes();
  const active = codes.filter(c => !c.expired);
  if (!active.length) return i.reply({ content: '📭 No active codes.', flags: MessageFlags.Ephemeral });
  const embed = new EmbedBuilder().setColor(0x7289da).setTitle('🎟️ All Active Codes');
  active.forEach(c => {
    const expiry = c.expiresAt ? `<t:${Math.floor(c.expiresAt / 1000)}:R> (<t:${Math.floor(c.expiresAt / 1000)}:F>)` : 'Never';
    const uses   = c.maxUses > 0 ? `${c.uses}/${c.maxUses}` : `${c.uses}/∞`;
    embed.addFields({
      name:  `\`${c.code}\` — ${fmt(c.reward)}`,
      value: `${c.permanent ? '📌 Permanent' : '⏰ Timed'} • Uses: ${uses} • Expires: ${expiry}\nCreated by: ${c.createdBy}`,
      inline: false,
    });
  });
  return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function cmdSetCodeChannel(i) {
  if (!await guardAdmin(i)) return;
  const channel = i.options.getChannel('channel');
  await dbSetCodeChannel(channel.id);
  return i.reply({ embeds: [adminEmbed(`✅ Default code channel set to <#${channel.id}>`)] });
}

// ══════════════════════════════════════════════════════════════════
//  INFO
// ══════════════════════════════════════════════════════════════════

async function cmdUserinfo(i) {
  const target  = i.options.getMember('user') || i.member;
  const user    = target.user;
  const warns   = (await dbGetWarnings(user.id)).length;
  const balance = (await getUser(user.id, user.username)).balance;
  const roles   = target.roles.cache.filter(r => r.id !== i.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'None';
  return i.reply({
    embeds: [new EmbedBuilder().setColor(target.displayHexColor || 0x7289da).setTitle(`👤 ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🪪 ID',      value: user.id,     inline: true },
        { name: '💰 Balance', value: fmt(balance), inline: true },
        { name: '⚠️ Warns',  value: `${warns}`,   inline: true },
        { name: `🎭 Roles (${target.roles.cache.size - 1})`, value: roles.length > 1024 ? 'Too many to display' : roles, inline: false },
      )],
  });
}

async function cmdServerinfo(i) {
  const g = i.guild; await g.fetch();
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x7289da).setTitle(`🏠 ${g.name}`).setThumbnail(g.iconURL())
      .addFields(
        { name: '🪪 ID',       value: g.id,                                                            inline: true },
        { name: '👑 Owner',    value: `<@${g.ownerId}>`,                                              inline: true },
        { name: '👥 Members',  value: g.memberCount.toLocaleString(),                                 inline: true },
        { name: '💬 Channels', value: g.channels.cache.size.toLocaleString(),                         inline: true },
        { name: '🎭 Roles',    value: g.roles.cache.size.toLocaleString(),                            inline: true },
        { name: '😀 Emojis',   value: g.emojis.cache.size.toLocaleString(),                           inline: true },
        { name: '💎 Boost',    value: `Tier ${g.premiumTier} (${g.premiumSubscriptionCount} boosts)`, inline: true },
      )],
  });
}

// ══════════════════════════════════════════════════════════════════
//  STOCK
// ══════════════════════════════════════════════════════════════════

async function cmdShowStock(i) {
  if (!await guardAdmin(i)) return;
  const channel  = i.options.getChannel('channel');
  const amount   = i.options.getInteger('amount');
  const embed    = buildStockEmbed(amount, i.user);
  const existing = await dbGetStockMsg(channel.id);
  if (existing) {
    try { const msg = await channel.messages.fetch(existing); await msg.edit({ embeds: [embed] }); return i.reply({ content: `✅ Stock updated in <#${channel.id}> → **${amount.toLocaleString()}**`, flags: MessageFlags.Ephemeral }); }
    catch { /* post fresh */ }
  }
  const msg = await channel.send({ embeds: [embed] });
  await dbSetStockMsg(channel.id, msg.id);
  return i.reply({ content: `✅ Stock embed posted in <#${channel.id}> → **${amount.toLocaleString()}**`, flags: MessageFlags.Ephemeral });
}

async function cmdSetStock(i) {
  if (!await guardAdmin(i)) return;
  const channel  = i.options.getChannel('channel');
  const amount   = i.options.getInteger('amount');
  const existing = await dbGetStockMsg(channel.id);
  if (!existing) return i.reply({ content: `❌ No stock embed in <#${channel.id}>. Use \`/show-stock\` first.`, flags: MessageFlags.Ephemeral });
  try {
    const msg = await channel.messages.fetch(existing);
    await msg.edit({ embeds: [buildStockEmbed(amount, i.user)] });
    return i.reply({ content: `✅ Stock updated → **${amount.toLocaleString()}** in <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  } catch {
    await dbSetStockMsg(channel.id, null);
    return i.reply({ content: `❌ Embed not found. Use \`/show-stock\` to post a new one.`, flags: MessageFlags.Ephemeral });
  }
}

function buildStockEmbed(amount, updatedBy) {
  const oos    = amount === 0;
  const low    = amount > 0 && amount < 100;
  const color  = oos ? 0xff4444 : low ? 0xffaa00 : 0x00e676;
  const status = oos ? '🔴 **OUT OF STOCK**' : low ? '🟡 **LOW STOCK**' : '🟢 **IN STOCK**';
  return new EmbedBuilder().setColor(color).setTitle('📦 STOCK')
    .setDescription(`${status}\n\u200B`)
    .addFields(
      { name: 'Amount in Stock', value: `\`\`\`${amount.toLocaleString()}\`\`\``, inline: false },
      { name: '🛒 How to Buy',   value: '`/shop` then `/buy <item>`',             inline: true },
    )
    .setFooter({ text: `Last updated by ${updatedBy?.username ?? 'Admin'}` });
}

// ══════════════════════════════════════════════════════════════════
//  ECONOMY ADMIN
// ══════════════════════════════════════════════════════════════════

async function cmdGiveCoin(i) {
  if (!await guardOwner(i)) return;
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  await dbAddCoins(target.id, target.username, amount);
  const newBal = (await getUser(target.id)).balance;
  return i.reply({ embeds: [adminEmbed(`✅ Added ${fmt(amount)} to **${target.username}**\nNew balance: ${fmt(newBal)}`)] });
}

async function cmdRemoveCoin(i) {
  if (!await guardOwner(i)) return;
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  await dbRemoveCoins(target.id, amount);
  const newBal = (await getUser(target.id)).balance;
  return i.reply({ embeds: [adminEmbed(`✅ Removed ${fmt(amount)} from **${target.username}**\nNew balance: ${fmt(newBal)}`)] });
}

async function cmdSetCoins(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  await dbSetCoins(target.id, target.username, amount);
  return i.reply({ embeds: [adminEmbed(`✅ Set **${target.username}**'s balance to ${fmt(amount)}`)] });
}

async function cmdResetDaily(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  await dbSetLastDaily(target.id, 0);
  return i.reply({ embeds: [adminEmbed(`✅ Reset daily for **${target.username}**`)] });
}

// ══════════════════════════════════════════════════════════════════
//  SHOP ADMIN
// ══════════════════════════════════════════════════════════════════

async function cmdAddItem(i) {
  if (!await guardAdmin(i)) return;
  const item = {
    name: i.options.getString('name'), price: i.options.getInteger('price'),
    description: i.options.getString('description'),
    emoji: i.options.getString('emoji') || '📦',
    stock: i.options.getInteger('stock') ?? -1,
  };
  await dbAddShopItem(item);
  return i.reply({ embeds: [adminEmbed(`✅ Added **${item.emoji} ${item.name}** — ${fmt(item.price)} (Stock: ${item.stock === -1 ? '∞' : item.stock})`)] });
}

async function cmdRemoveItem(i) {
  if (!await guardAdmin(i)) return;
  const name = i.options.getString('name');
  const ok   = await dbRemoveShopItem(name);
  if (!ok) return i.reply({ content: '❌ Item not found.', flags: MessageFlags.Ephemeral });
  return i.reply({ embeds: [adminEmbed(`✅ Removed **${name}** from the shop`)] });
}

async function cmdGiveItem(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  const item   = i.options.getString('item');
  await dbAddInventory(target.id, item);
  return i.reply({ embeds: [adminEmbed(`✅ Gave **${item}** to **${target.username}**`)] });
}

async function cmdClearInventory(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  await dbClearInventory(target.id);
  return i.reply({ embeds: [adminEmbed(`✅ Cleared **${target.username}**'s inventory`)] });
}

// ══════════════════════════════════════════════════════════════════
//  MODERATION
// ══════════════════════════════════════════════════════════════════

async function cmdWarn(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  const reason = i.options.getString('reason');
  const count  = await dbAddWarning(target.id, target.username, reason, i.user.tag);
  try {
    await target.send({
      embeds: [new EmbedBuilder().setColor(0xffaa00).setTitle(`⚠️ You have been warned in ${i.guild.name}`)
        .addFields({ name: 'Reason', value: reason, inline: false }, { name: 'Warned by', value: i.user.tag, inline: true }, { name: 'Total Warnings', value: `${count}`, inline: true })],
    });
  } catch { /* DMs closed */ }
  return i.reply({ embeds: [modEmbed('⚠️ User Warned', `**User:** ${target.tag}\n**Reason:** ${reason}\n**Total:** ${count}\n**By:** ${i.user.tag}`, 0xffaa00)] });
}

async function cmdWarnings(i) {
  if (!await guardAdmin(i)) return;
  const target   = i.options.getUser('user');
  const warnings = await dbGetWarnings(target.id);
  if (!warnings.length) return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle(`⚠️ ${target.username}'s Warnings`).setDescription('No warnings on record.')],
  });
  const desc = warnings.map((w, idx) => `**${idx + 1}.** ${w.reason}\n> By ${w.by}`).join('\n\n');
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0xffaa00).setTitle(`⚠️ ${target.username}'s Warnings (${warnings.length})`).setDescription(desc).setThumbnail(target.displayAvatarURL())],
  });
}

async function cmdClearWarnings(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  await dbClearWarnings(target.id);
  return i.reply({ embeds: [adminEmbed(`✅ Cleared all warnings for **${target.username}**`)] });
}

async function cmdTimeout(i) {
  if (!await guardAdmin(i)) return;
  const target  = i.options.getMember('user');
  const minutes = i.options.getInteger('minutes');
  const reason  = i.options.getString('reason') || 'No reason provided';
  if (!target) return i.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
  if (target.id === i.user.id) return i.reply({ content: "❌ Can't timeout yourself.", flags: MessageFlags.Ephemeral });
  if (!target.moderatable) return i.reply({ content: '❌ I cannot timeout this user.', flags: MessageFlags.Ephemeral });
  await target.timeout(minutes * 60 * 1000, reason);
  const unmuteTs = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
  return i.reply({ embeds: [modEmbed('🔇 User Timed Out', `**User:** ${target.user.tag}\n**Duration:** ${minutes} minute(s)\n**Expires:** <t:${unmuteTs}:R> \u2014 <t:${unmuteTs}:F>\n**Reason:** ${reason}\n**By:** ${i.user.tag}`, 0xff8800)] });
}

async function cmdUntimeout(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getMember('user');
  if (!target) return i.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
  await target.timeout(null);
  return i.reply({ embeds: [modEmbed('🔊 Timeout Removed', `**User:** ${target.user.tag}\n**By:** ${i.user.tag}`, 0x00ff88)] });
}

async function cmdKick(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getMember('user');
  const reason = i.options.getString('reason') || 'No reason provided';
  if (!target) return i.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
  if (!target.kickable) return i.reply({ content: "❌ I can't kick this user.", flags: MessageFlags.Ephemeral });
  try { await target.user.send({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle(`👢 You were kicked from ${i.guild.name}`).setDescription(`**Reason:** ${reason}`)] }); } catch { /* DMs closed */ }
  await target.kick(reason);
  return i.reply({ embeds: [modEmbed('👢 User Kicked', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**By:** ${i.user.tag}`, 0xff4444)] });
}

async function cmdBan(i) {
  if (!await guardAdmin(i)) return;
  const target  = i.options.getMember('user');
  const reason  = i.options.getString('reason') || 'No reason provided';
  const delDays = i.options.getInteger('delete_days') ?? 0;
  if (!target) return i.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
  if (!target.bannable) return i.reply({ content: "❌ I can't ban this user.", flags: MessageFlags.Ephemeral });
  try { await target.user.send({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle(`🔨 You were banned from ${i.guild.name}`).setDescription(`**Reason:** ${reason}`)] }); } catch { /* DMs closed */ }
  await target.ban({ reason, deleteMessageDays: delDays });
  return i.reply({ embeds: [modEmbed('🔨 User Banned', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**Msgs deleted:** ${delDays}d\n**By:** ${i.user.tag}`, 0xff0000)] });
}

async function cmdUnban(i) {
  if (!await guardAdmin(i)) return;
  const userId = i.options.getString('userid');
  const reason = i.options.getString('reason') || 'No reason provided';
  try {
    await i.guild.members.unban(userId, reason);
    return i.reply({ embeds: [modEmbed('✅ User Unbanned', `**User ID:** ${userId}\n**Reason:** ${reason}\n**By:** ${i.user.tag}`, 0x00ff88)] });
  } catch { return i.reply({ content: "❌ Couldn't unban — invalid ID or user isn't banned.", flags: MessageFlags.Ephemeral }); }
}

async function cmdPurge(i) {
  if (!await guardAdmin(i)) return;
  const amount = i.options.getInteger('amount');
  const filter = i.options.getUser('user');
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  let messages = await i.channel.messages.fetch({ limit: 100 });
  if (filter) messages = messages.filter(m => m.author.id === filter.id);
  const toDelete = [...messages.values()].slice(0, amount).filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
  const deleted  = await i.channel.bulkDelete(toDelete, true);
  return i.editReply({ content: `🗑️ Deleted **${deleted.size}** message(s).` });
}

async function cmdSlowmode(i) {
  if (!await guardAdmin(i)) return;
  const seconds = i.options.getInteger('seconds');
  const channel = i.options.getChannel('channel') || i.channel;
  await channel.setRateLimitPerUser(seconds);
  return i.reply({ embeds: [adminEmbed(`⏱️ Slowmode ${seconds === 0 ? '**disabled**' : `set to **${seconds}s**`} in <#${channel.id}>`)] });
}

async function cmdLock(i) {
  if (!await guardAdmin(i)) return;
  const channel = i.options.getChannel('channel') || i.channel;
  const reason  = i.options.getString('reason') || 'No reason provided';
  await channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false });
  return i.reply({ embeds: [modEmbed('🔒 Channel Locked', `<#${channel.id}> locked.\n**Reason:** ${reason}`, 0xff4444)] });
}

async function cmdUnlock(i) {
  if (!await guardAdmin(i)) return;
  const channel = i.options.getChannel('channel') || i.channel;
  await channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null });
  return i.reply({ embeds: [modEmbed('🔓 Channel Unlocked', `<#${channel.id}> is now open.`, 0x00ff88)] });
}

async function cmdAnnounce(i) {
  if (!await guardAdmin(i)) return;
  const channel  = i.options.getChannel('channel');
  const title    = i.options.getString('title');
  const message  = i.options.getString('message');
  const colorHex = i.options.getString('color');
  let color = 0x5865f2;
  if (colorHex) { const p = parseInt(colorHex.replace('#', ''), 16); if (!isNaN(p)) color = p; }
  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setTitle(`📢 ${title}`).setDescription(message)
      .setFooter({ text: `Announced by ${i.user.username}` })],
  });
  return i.reply({ content: `✅ Announcement sent to <#${channel.id}>`, flags: MessageFlags.Ephemeral });
}

// ══════════════════════════════════════════════════════════════════
//  HELP
// ══════════════════════════════════════════════════════════════════

async function cmdHelp(i) {
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${COIN} Coin Bot — Commands`)
      .setDescription('Here\'s everything you can do!\n\u200B')
      .addFields(
        { name: '💰 Economy', inline: false, value: ['`/balance [user]` — Check balance', '`/daily` — Claim 100 free coins every 24h', '`/pay <user> <amount>` — Send coins (Verified role required)', '`/leaderboard` — Top 10 richest users'].join('\n') },
        { name: '🎰 Gambling', inline: false, value: ['`/coinflip <heads|tails> <bet>` — 50/50, win 2×', '`/slots <bet>` — Spin the slots (up to 20× jackpot!)', '`/blackjack <bet>` — Hit, Stand or Double Down'].join('\n') },
        { name: '🛒 Shop', inline: false, value: ['`/shop` — Browse the shop', '`/buy <item>` — Buy an item', '`/inventory [user]` — View your items', '`/use <item>` — Redeem an item (enter Roblox username)'].join('\n') },
        { name: '🎟️ Codes', inline: false, value: ['`/redeem-code <code>` — Redeem a code for coins'].join('\n') },
        { name: 'ℹ️ Info', inline: false, value: ['`/userinfo [user]` — View user info', '`/serverinfo` — View server stats', '`/help` — This menu'].join('\n') },
      )
      .setFooter({ text: '1 message = 1 Coin' })],
  });
}

async function cmdAdminHelp(i) {
  if (!await guardAdmin(i)) return;
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🔧 Admin Commands')
      .setDescription('Requires **Admin Perm** role or **Administrator** permission.\n\u200B')
      .addFields(
        { name: '📦 Stock', inline: false, value: ['`/show-stock <channel> <amount>` — Post stock embed', '`/set-stock <channel> <amount>` — Update stock embed'].join('\n') },
        { name: '🎟️ Codes', inline: false, value: ['`/drop-code <code> <reward> <minutes> [channel]` — Drop timed code', '`/make-code <code> <reward> [channel]` — Permanent code', '`/remove-code <code> [channel]` — Delete a code', '`/codes` — View all active codes', '`/set-code-channel <channel>` — Set default announce channel'].join('\n') },
        { name: '💰 Economy', inline: false, value: ['`/givecoin <user> <amount>` — Add coins [Owner/Co-Owner]', '`/removecoin <user> <amount>` — Remove coins [Owner/Co-Owner]', '`/setcoins <user> <amount>` — Set exact balance', '`/resetdaily <user>` — Reset daily cooldown'].join('\n') },
        { name: '🛒 Shop', inline: false, value: ['`/additem <name> <price> <desc>` — Add shop item', '`/removeitem <name>` — Remove shop item', '`/giveitem <user> <item>` — Give item directly', '`/clearinventory <user>` — Wipe inventory'].join('\n') },
        { name: '📋 Redemptions', inline: false, value: ['`/check-redeems` — View pending redemptions', '`/finish-redeem <id>` — Mark done & DM user'].join('\n') },
        { name: '🔨 Moderation', inline: false, value: ['`/warn` `/warnings` `/clearwarnings`', '`/timeout` `/untimeout`', '`/kick` `/ban` `/unban`', '`/purge` `/slowmode` `/lock` `/unlock` `/announce`'].join('\n') },
      )
      .setFooter({ text: 'Admin Perm role or Administrator permission required' })],
    flags: MessageFlags.Ephemeral,
  });
}

// ══════════════════════════════════════════════════════════════════
//  TUTORIAL COMMANDS
// ══════════════════════════════════════════════════════════════════

async function cmdTutorial(i) {
  return i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📖 Bot Tutorial — Getting Started')
        .setDescription('Welcome! Here\'s everything you need to know to get started.\n​')
        .addFields(
          {
            name: '🪙 Step 1 — Earn Coins',
            value: [
              'Simply **send messages** in any channel — every message gives you **1 coin** automatically.',
              'You can also use `/daily` once every 24 hours to claim **100 free coins**.',
              'Use `/balance` at any time to check how many coins you have.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🛒 Step 2 — Buy Items',
            value: [
              'Use `/shop` to see all available items and their prices.',
              'Once you have enough coins, use `/buy <item name>` to purchase it.',
              'Your purchased items will appear in `/inventory`.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📦 Step 3 — Redeem Your Item',
            value: [
              'Use `/use <item name>` to redeem an item from your inventory.',
              'A form will pop up asking for your **Roblox Username**.',
              'Fill it in and submit — staff will process your request and DM you when done.',
              'You can check your request status by asking staff.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🎰 Step 4 — Gambling (Optional)',
            value: [
              '`/coinflip <heads|tails> <bet>` — 50/50 chance to double your coins.',
              '`/slots <bet>` — Spin the slots for up to **20× your bet** on a jackpot!',
              '`/blackjack <bet>` — Play Blackjack with Hit, Stand, and Double Down.',
              '⚠️ Only bet what you can afford to lose!',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🎟️ Step 5 — Codes',
            value: [
              'Staff sometimes drop codes in the server.',
              'Use `/redeem-code <code>` to claim free coins.',
              'Each code can only be redeemed **once per person**.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '💸 Sending Coins',
            value: [
              'If you have the **Verified** role, you can send coins to others.',
              'Use `/pay <@user> <amount>` to transfer coins.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📊 Other Useful Commands',
            value: [
              '`/leaderboard` — See the top 10 richest users',
              '`/userinfo [user]` — View info about yourself or someone else',
              '`/serverinfo` — View server stats',
              '`/help` — Full command list',
            ].join('\n'),
            inline: false,
          },
        )
        .setFooter({ text: 'Need help? Ask a staff member!' }),
    ],
  });
}

async function cmdAdminTutorial(i) {
  return i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('🔧 Admin Setup Tutorial')
        .setDescription('How to set up admin roles and use admin commands.\n​')
        .addFields(
          {
            name: '👑 Step 1 — Create the Admin Role',
            value: [
              '1. Go to your **Server Settings** → **Roles**',
              '2. Click **"Create Role"**',
              '3. Name it exactly: **`Admin Perm`**',
              '> ⚠️ The name must be exactly `Admin Perm` (case-insensitive) for the bot to recognise it.',
              '4. Give the role whatever Discord permissions you want (e.g. Manage Messages, Kick Members etc.)',
              '5. Click **Save Changes**',
            ].join('\n'),
            inline: false,
          },
          {
            name: '👤 Step 2 — Assign the Role',
            value: [
              '1. Right-click a member in the server',
              '2. Click **"Roles"**',
              '3. Toggle on **`Admin Perm`**',
              'That member can now use all admin bot commands.',
              '',
              '> Alternatively: users with Discord\'s built-in **Administrator** permission also get full access automatically.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '👑 Step 3 — Owner / Co-Owner Role',
            value: [
              'Create a role named exactly **`Owner`** or **`Co Owner`** (or `Co-Owner`).',
              'Members with this role can use `/givecoin` and `/removecoin`.',
              'These are separate from the Admin Perm role — you can have both.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '✅ Step 4 — Verified Role (for /pay)',
            value: [
              'Create a role named exactly **`Verified`**.',
              'Only members with this role can use `/pay` to send coins to others.',
              'This prevents random users from transferring coins freely.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📋 Step 5 — Set Up Code Announcements',
            value: [
              'Use `/set-code-channel <#channel>` to set a default channel for code drops.',
              'When you use `/drop-code` or `/make-code`, the bot will announce there by default.',
              'You can override it per-command with the optional `channel` argument.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📦 Step 6 — Manage the Shop',
            value: [
              '`/additem <name> <price> <description>` — Add a custom item',
              '`/removeitem <name>` — Remove an item',
              '`/giveitem <user> <item>` — Give an item directly to someone',
              'The default shop packages (125m Brainrot etc.) are always there and cannot be removed.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📬 Step 7 — Processing Redemptions',
            value: [
              'When a user uses `/use <item>`, they fill in their Roblox username.',
              'Use `/check-redeems` to see all pending requests.',
              'Once you\'ve sent the item, use `/finish-redeem <id>` to mark it as done.',
              'The bot will automatically **DM the user** to let them know it\'s been processed.',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📢 Other Admin Commands',
            value: [
              '`/announce <#channel> <title> <message>` — Send a formatted announcement',
              '`/show-stock <#channel> <amount>` — Post a live stock embed',
              '`/set-stock <#channel> <amount>` — Update the stock embed',
              '`/drop-code <code> <reward> <minutes>` — Drop a timed code',
              '`/adminhelp` — Full list of every admin command',
            ].join('\n'),
            inline: false,
          },
        )
        .setFooter({ text: 'Role names are case-insensitive • Admin Perm | Owner | Co Owner | Verified' }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function cmdOwnerTutorial(i) {
  if (i.user.username.toLowerCase() !== 'kosai06913') {
    return i.reply({ content: '❌ This command is only available to the bot owner.', flags: MessageFlags.Ephemeral });
  }

  const pages = [
    new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('📖 Full Bot Guide — Page 1/6 — Roles Setup')
      .setDescription('Everything you need to know to run this bot. Only you can see this.\n​')
      .addFields(
        {
          name: '👑 Owner / Co-Owner Role',
          value: [
            'Create a role named **`Owner`** (for yourself) and/or **`Co Owner`** or **`Co-Owner`** for trusted staff.',
            'Members with these roles can use:',
            '• `/givecoin <user> <amount>` — Add coins to anyone',
            '• `/removecoin <user> <amount>` — Remove coins from anyone',
            '> These are the most powerful economy commands — only give this role to people you 100% trust.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🔧 Admin Perm Role',
          value: [
            'Create a role named **`Admin Perm`** (exact name, case-insensitive).',
            'Members with this role (or Discord\'s built-in Administrator permission) can use ALL admin commands:',
            '• `/check-redeems` — View pending redemptions',
            '• `/finish-redeem <id>` — Mark redemption done + DM user',
            '• `/drop-code` `/make-code` `/remove-code` `/codes`',
            '• `/show-stock` `/set-stock` `/announce`',
            '• `/warn` `/kick` `/ban` `/timeout` `/purge` `/lock` `/slowmode` etc.',
            '• `/additem` `/removeitem` `/giveitem` `/clearinventory`',
            '• `/setcoins` `/resetdaily` `/adminhelp`',
          ].join('\n'),
          inline: false,
        },
        {
          name: '✅ Verified Role',
          value: [
            'Create a role named **`Verified`** (exact name, case-insensitive).',
            'Only members with this role can use `/pay <user> <amount>` to send coins to others.',
            'Without this role, `/pay` will be blocked.',
            '> This prevents random unverified users from moving coins around.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '⚠️ Important Notes on Role Names',
          value: [
            'The bot checks role names — they must match **exactly** (case-insensitive):',
            '• `Admin Perm` → admin commands',
            '• `Owner` → givecoin / removecoin',
            '• `Co Owner` or `Co-Owner` → givecoin / removecoin',
            '• `Verified` → /pay',
            'You can have multiple roles that qualify — e.g. someone can have both Owner and Admin Perm.',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Page 1/6 — Roles Setup' }),

    new EmbedBuilder()
      .setColor(0x00b4ff)
      .setTitle('📖 Full Bot Guide — Page 2/6 — Coins & Economy')
      .addFields(
        {
          name: '🪙 How Coins Are Earned',
          value: [
            '**Messages:** Every message sent in any server channel gives **1 coin** automatically. No cooldown.',
            '**Daily:** `/daily` gives **100 coins** every 24 hours. The bot shows a Discord timestamp for when the next daily is available.',
            '**Codes:** Staff can drop codes that give coins — users claim them with `/redeem-code <code>`.',
            '**Admin add:** `/givecoin <user> <amount>` adds coins directly (Owner/Co-Owner only).',
          ].join('\n'),
          inline: false,
        },
        {
          name: '💰 Balance & Leaderboard',
          value: [
            '`/balance [user]` — Check your own or anyone else\'s coin balance.',
            '`/leaderboard` — Shows the top 10 richest users in the server.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '💸 Transferring Coins',
          value: [
            '`/pay <user> <amount>` — Send coins to another user.',
            '> Only works if the sender has the **Verified** role.',
            '> Cannot pay yourself or bots.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🔧 Admin Economy Commands',
          value: [
            '`/givecoin <user> <amount>` — Add coins [Owner/Co-Owner only]',
            '`/removecoin <user> <amount>` — Remove coins [Owner/Co-Owner only]',
            '`/setcoins <user> <amount>` — Set exact balance [Admin]',
            '`/resetdaily <user>` — Reset someone\'s daily cooldown [Admin]',
          ].join('\n'),
          inline: false,
        },
        {
          name: '💾 Where Data is Saved',
          value: [
            'All data (coins, inventory, warnings, codes, redeems) is saved to **JSONBin**.',
            'This means data persists even when Railway restarts the bot.',
            'You need `JSONBIN_BIN_ID` and `JSONBIN_API_KEY` in your Railway env vars.',
            'Initial bin content: `{"users":{},"warnings":{},"codes":{},"shopItems":[],"stockMessages":{},"codeChannel":null,"redeems":{},"redeemCounter":1}`',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Page 2/6 — Coins & Economy' }),

    new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle('📖 Full Bot Guide — Page 3/6 — Shop & Redemptions')
      .addFields(
        {
          name: '🛒 Default Shop Packages',
          value: [
            'These are hardcoded and always in the shop:',
            '• **125m Brainrot** — 1,500 coins',
            '• **150m Brainrot** — 2,000 coins',
            '• **175m Brainrot** — 2,500 coins',
            '• **200m Brainrot** — 3,000 coins',
            '• **100m Garama** — 5,000 coins',
            'Users buy with `/buy <item name>` — it goes to their `/inventory`.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📦 Custom Shop Items (Admin)',
          value: [
            '`/additem <name> <price> <description> [emoji] [stock]` — Add a custom item.',
            '`/removeitem <name>` — Remove a custom item.',
            '`/giveitem <user> <item>` — Give an item directly without purchase.',
            '`/clearinventory <user>` — Wipe someone\'s entire inventory.',
            '> Stock of `-1` means unlimited.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📬 Redemption Flow — Step by Step',
          value: [
            '**1.** User buys an item → goes to their inventory.',
            '**2.** User runs `/use <item name>`.',
            '**3.** A modal pops up asking for their **Roblox Username** (only field).',
            '**4.** User submits → bot saves the request with an ID and confirms privately.',
            '**5.** You (admin) run `/check-redeems` to see all pending requests.',
            '**6.** After sending the item in-game, run `/finish-redeem <id>`.',
            '**7.** Bot marks it done and **DMs the user** automatically to confirm.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📋 check-redeems Shows',
          value: [
            '• Request ID number',
            '• Discord user (mention + username)',
            '• Their Roblox username',
            '• Item they bought',
            '> Only pending (not yet processed) requests appear.',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Page 3/6 — Shop & Redemptions' }),

    new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('📖 Full Bot Guide — Page 4/6 — Codes System')
      .addFields(
        {
          name: '🎟️ How Codes Work',
          value: [
            'Codes give coins to users who redeem them with `/redeem-code <code>`.',
            '**Each user can only redeem each code once.**',
            'Once a code expires (by time or max uses), the announcement message in the channel automatically updates to show ❌ Expired.',
            'The check runs every 30 seconds.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '⏰ /drop-code — Timed Code',
          value: [
            '`/drop-code <code> <reward> <minutes> [channel] [max_uses]`',
            '• `code` — The word users type (auto-uppercased)',
            '• `reward` — How many coins it gives',
            '• `minutes` — How long until it expires (0 = never expires)',
            '• `channel` — Where to announce it (overrides default channel)',
            '• `max_uses` — Max total redemptions (0 = unlimited)',
            '> The code is shown as a spoiler `||CODE||` in the announcement.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📌 /make-code — Permanent Code',
          value: [
            '`/make-code <code> <reward> [channel] [max_uses]`',
            'Same as drop-code but never expires by time.',
            'Still expires if max_uses is hit.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🗑️ /remove-code — Delete a Code',
          value: [
            '`/remove-code <code> [channel]`',
            'Removes the code from the database immediately.',
            'Optionally announces the removal in a channel.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📡 Default Code Channel',
          value: [
            '`/set-code-channel <#channel>` — Sets the default channel for all code announcements.',
            'You can override it per command with the optional `channel` argument.',
            '`/codes` — Lists all currently active codes (admin only).',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Page 4/6 — Codes System' }),

    new EmbedBuilder()
      .setColor(0xff8800)
      .setTitle('📖 Full Bot Guide — Page 5/6 — Gambling & Stock')
      .addFields(
        {
          name: '🪙 /coinflip',
          value: [
            '`/coinflip <heads|tails> <bet>`',
            '50/50 chance. Win = get your bet back + same amount (2× total).',
            'Lose = lose your bet.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🎰 /slots',
          value: [
            '`/slots <bet>`',
            'Spin 3 reels. Payouts:',
            '• Three 7️⃣ → **20× jackpot**',
            '• Three 💎 → 10×',
            '• Three ⭐ → 5×',
            '• Three of anything else → 3×',
            '• Two of a kind → 1.5×',
            '• No match → lose bet',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🃏 /blackjack',
          value: [
            '`/blackjack <bet>`',
            'Standard Blackjack rules. Buttons appear for Hit / Stand / Double Down.',
            '• Natural 21 → win 2.5×',
            '• Beat dealer → win 2×',
            '• Push (tie) → bet returned',
            '• Bust or dealer wins → lose bet',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📦 Stock Embeds',
          value: [
            '`/show-stock <#channel> <amount>` — Posts a live stock embed. Shows 🟢 IN STOCK, 🟡 LOW STOCK, or 🔴 OUT OF STOCK.',
            '`/set-stock <#channel> <amount>` — Updates the existing embed with a new amount.',
            '> The embed is stored by channel ID so it always edits the same message.',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Page 5/6 — Gambling & Stock' }),

    new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle('📖 Full Bot Guide — Page 6/6 — Moderation & Setup')
      .addFields(
        {
          name: '🔨 Moderation Commands (Admin Perm required)',
          value: [
            '`/warn <user> <reason>` — Warn a user. They get a DM. Stored in database.',
            '`/warnings <user>` — View all warnings for a user.',
            '`/clearwarnings <user>` — Delete all warnings.',
            '`/timeout <user> <minutes> [reason]` — Mute a user. Shows Discord timestamp for when it ends.',
            '`/untimeout <user>` — Remove a timeout.',
            '`/kick <user> [reason]` — Kick. DMs the user before kicking.',
            '`/ban <user> [reason] [delete_days]` — Ban. DMs the user before banning.',
            '`/unban <userid> [reason]` — Unban by Discord user ID.',
            '`/purge <amount> [user]` — Bulk delete up to 100 messages. Can filter by user.',
            '`/slowmode <seconds> [#channel]` — Set slowmode (0 = off).',
            '`/lock [#channel] [reason]` — Prevent @everyone from sending messages.',
            '`/unlock [#channel]` — Re-enable sending.',
            '`/announce <#channel> <title> <message> [color]` — Send a formatted embed announcement.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '⚙️ Railway Environment Variables',
          value: [
            'You need these set in Railway (no .env file needed on Railway):',
            '• `DISCORD_TOKEN` — Your bot token from Discord Developer Portal',
            '• `CLIENT_ID` — Your application\'s client ID',
            '• `JSONBIN_BIN_ID` — The bin ID from jsonbin.io',
            '• `JSONBIN_API_KEY` — Your JSONBin secret key ($2a$10$...)',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🚀 Command Registration',
          value: [
            'Every time the bot starts, it:',
            '1. Clears ALL old global commands',
            '2. Clears ALL old guild (server) commands',
            '3. Registers fresh commands per guild (instant, no 1hr wait)',
            '> This prevents duplicate commands showing up.',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📖 Help Commands (for everyone)',
          value: [
            '`/help` — Shows all user-facing commands',
            '`/adminhelp` — Shows all admin commands (Admin Perm required)',
            '`/tutorial` — General bot guide for regular users',
            '`/admin-tutorial` — Role setup guide for admins (ephemeral)',
            '`/owner-tutorial` — This full guide (only you, kosai06913)',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Page 6/6 — You know everything now! 🎉' }),
  ];

  // Send all 6 pages
  await i.reply({ embeds: [pages[0]], flags: MessageFlags.Ephemeral });
  for (let idx = 1; idx < pages.length; idx++) {
    await i.followUp({ embeds: [pages[idx]], flags: MessageFlags.Ephemeral });
  }
}

// ══════════════════════════════════════════════════════════════════
//  EMBED HELPERS
// ══════════════════════════════════════════════════════════════════
function adminEmbed(desc) {
  return new EmbedBuilder().setColor(0x7289da).setTitle('🔧 Admin Action').setDescription(desc);
}
function modEmbed(title, desc, color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
}

// ══════════════════════════════════════════════════════════════════
//  BLACKJACK HELPERS
// ══════════════════════════════════════════════════════════════════
function buildDeck() {
  const suits = ['♠','♥','♦','♣'], ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'], deck = [];
  for (const s of suits) for (const r of ranks)
    deck.push({ display: `${r}${s}`, value: r === 'A' ? 11 : ['J','Q','K'].includes(r) ? 10 : parseInt(r), rank: r });
  for (let n = deck.length - 1; n > 0; n--) { const k = Math.floor(Math.random() * (n + 1)); [deck[n], deck[k]] = [deck[k], deck[n]]; }
  return deck;
}
function drawCard(deck) { return deck.pop(); }
function handValue(h) {
  let t = h.reduce((s, c) => s + c.value, 0), a = h.filter(c => c.rank === 'A').length;
  while (t > 21 && a > 0) { t -= 10; a--; }
  return t;
}
function handStr(h) { return h.map(c => c.display).join(' '); }

// ══════════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════════
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await loadDB(); // warm up cache
  await registerCommands();
  // Cache all guild invites for tracking
  for (const guild of client.guilds.cache.values()) {
    await buildInviteCache(guild);
  }
  client.user.setActivity('Coin Economy | /shop', { type: 3 });
  // Check code expiry every 30 seconds
  setInterval(checkCodeExpiry, 30 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
