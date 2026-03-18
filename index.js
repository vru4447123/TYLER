const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// ══════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════
const COIN = '🪙';
function fmt(n) { return `${COIN} **${Number(n).toLocaleString()} Coins**`; }

// ══════════════════════════════════════════════════════════════════
//  DATABASE  (flat JSON file)
// ══════════════════════════════════════════════════════════════════
const DB_PATH = path.join(__dirname, 'data.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const blank = {
      users: {}, warnings: {}, codes: {},
      shopItems: [], stockMessages: {},
      codeChannel: null, redeems: {}, redeemCounter: 1,
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(blank, null, 2));
    return blank;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// ── users ─────────────────────────────────────────────────────────
function getUser(uid, username) {
  const db = loadDB();
  if (!db.users[uid]) {
    db.users[uid] = { username: username || 'Unknown', balance: 0, inventory: [], lastDaily: 0 };
    saveDB(db);
  }
  return db.users[uid];
}
function saveUser(uid, data) { const db = loadDB(); db.users[uid] = data; saveDB(db); }
function dbAddCoins(uid, username, amt) {
  const u = getUser(uid, username); u.balance += amt; saveUser(uid, u); return u.balance;
}
function dbRemoveCoins(uid, amt) {
  const u = getUser(uid); u.balance = Math.max(0, u.balance - amt); saveUser(uid, u); return u.balance;
}
function dbSetCoins(uid, username, amt) {
  const u = getUser(uid, username); u.balance = amt; saveUser(uid, u);
}
function dbSetLastDaily(uid, ts) {
  const u = getUser(uid); u.lastDaily = (ts === undefined ? Date.now() : ts); saveUser(uid, u);
}
function dbAddInventory(uid, item) { const u = getUser(uid); u.inventory.push(item); saveUser(uid, u); }
function dbRemoveInventory(uid, item) {
  const u = getUser(uid);
  const idx = u.inventory.findIndex(i => i.toLowerCase().includes(item.toLowerCase()));
  if (idx === -1) return false;
  u.inventory.splice(idx, 1); saveUser(uid, u); return true;
}
function dbClearInventory(uid) { const u = getUser(uid); u.inventory = []; saveUser(uid, u); }
function dbGetInventory(uid) { return getUser(uid).inventory; }
function dbLeaderboard(n) {
  const db = loadDB();
  return Object.entries(db.users)
    .map(([userId, d]) => ({ userId, balance: d.balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, n);
}

// ── warnings ──────────────────────────────────────────────────────
function dbAddWarning(uid, username, reason, by) {
  const db = loadDB();
  if (!db.warnings[uid]) db.warnings[uid] = [];
  db.warnings[uid].push({ reason, by });
  saveDB(db);
  return db.warnings[uid].length;
}
function dbGetWarnings(uid) { return loadDB().warnings[uid] || []; }
function dbClearWarnings(uid) { const db = loadDB(); db.warnings[uid] = []; saveDB(db); }

// ── shop items ────────────────────────────────────────────────────
function dbGetShopItems() { return loadDB().shopItems || []; }
function dbAddShopItem(item) { const db = loadDB(); db.shopItems.push(item); saveDB(db); }
function dbRemoveShopItem(name) {
  const db = loadDB();
  const idx = db.shopItems.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return false;
  db.shopItems.splice(idx, 1); saveDB(db); return true;
}
function dbDecrementStock(name) {
  const db = loadDB();
  const item = db.shopItems.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (item && item.stock > 0) { item.stock--; saveDB(db); }
}

// ── stock messages ────────────────────────────────────────────────
function dbGetStockMsg(channelId) { return loadDB().stockMessages[channelId] || null; }
function dbSetStockMsg(channelId, msgId) {
  const db = loadDB(); db.stockMessages[channelId] = msgId; saveDB(db);
}

// ── codes ─────────────────────────────────────────────────────────
function dbGetCode(code) { return loadDB().codes[code] || null; }
function dbGetAllCodes() { return Object.values(loadDB().codes); }
function dbAddCode(entry) { const db = loadDB(); db.codes[entry.code] = entry; saveDB(db); }
function dbRemoveCode(code) { const db = loadDB(); delete db.codes[code]; saveDB(db); }
function dbRedeemCode(code, uid) {
  const db = loadDB();
  if (!db.codes[code]) return;
  db.codes[code].uses++;
  db.codes[code].usedBy.push(uid);
  saveDB(db);
}
function dbGetCodeChannel() { return loadDB().codeChannel || null; }
function dbSetCodeChannel(id) { const db = loadDB(); db.codeChannel = id; saveDB(db); }

// ── redeems ───────────────────────────────────────────────────────
function dbAddRedeem(data) {
  const db = loadDB();
  const id = db.redeemCounter++;
  db.redeems[id] = { id, ...data, status: 'pending' };
  saveDB(db);
  return id;
}
function dbGetRedeem(id) { return loadDB().redeems[id] || null; }
function dbGetPendingRedeems() {
  return Object.values(loadDB().redeems).filter(r => r.status === 'pending');
}
function dbMarkRedeemDone(id, by) {
  const db = loadDB();
  if (!db.redeems[id]) return;
  db.redeems[id].status = 'paid';
  db.redeems[id].processedBy = by;
  saveDB(db);
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
function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => r.name.toLowerCase().includes('admin perm'));
}
function isOwnerOrCoOwner(member) {
  if (!member) return false;
  return member.roles.cache.some(r => {
    const n = r.name.toLowerCase();
    return n === 'owner' || n === 'co owner' || n === 'co-owner';
  });
}
function isVerified(member) {
  if (!member) return false;
  return member.roles.cache.some(r => r.name.toLowerCase() === 'verified');
}
async function guardAdmin(i) {
  if (!isAdmin(i.member)) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🚫 Access Denied')
      .setDescription('You need the **Admin Perm** role or **Administrator** permission.')], ephemeral: true });
    return false;
  }
  return true;
}
async function guardOwner(i) {
  if (!isOwnerOrCoOwner(i.member)) {
    await i.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🚫 Access Denied')
      .setDescription('Only **Owner** or **Co-Owner** can use this.')], ephemeral: true });
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
  new SlashCommandBuilder().setName('use').setDescription('Redeem an item — opens a form for Roblox info')
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
    .addIntegerOption(o => o.setName('max_uses').setDescription('Max uses (0 = unlimited)').setRequired(false).setMinValue(0))
    .addChannelOption(o => o.setName('channel').setDescription('Announce channel').setRequired(false)),
  new SlashCommandBuilder().setName('make-code').setDescription('[Admin] Create a permanent code')
    .addStringOption(o => o.setName('code').setDescription('Code word').setRequired(true))
    .addIntegerOption(o => o.setName('reward').setDescription('Coins rewarded').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('max_uses').setDescription('Max uses (0 = unlimited)').setRequired(false).setMinValue(0))
    .addChannelOption(o => o.setName('channel').setDescription('Announce channel').setRequired(false)),
  new SlashCommandBuilder().setName('remove-code').setDescription('[Admin] Delete a code')
    .addStringOption(o => o.setName('code').setDescription('Code to remove').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Announce removal channel').setRequired(false)),
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
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes (max 40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
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
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (0 = off, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').setRequired(false)),
  new SlashCommandBuilder().setName('lock').setDescription('[Admin] Lock a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (defaults to current)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('unlock').setDescription('[Admin] Unlock a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (defaults to current)').setRequired(false)),
  new SlashCommandBuilder().setName('announce').setDescription('[Admin] Send an announcement embed')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color (e.g. ff0000)').setRequired(false)),

  // Help
  new SlashCommandBuilder().setName('help').setDescription('View all commands'),
  new SlashCommandBuilder().setName('adminhelp').setDescription('View all admin commands'),
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
  ],
});

// ── Register commands ─────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Step 1: Wipe ALL global commands first
  console.log('🧹 Clearing old global commands...');
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log('✅ Global commands cleared.');
  } catch (err) {
    console.error('❌ Failed to clear global commands:', err.message);
  }

  // Step 2: Wipe ALL guild commands in every server
  for (const [guildId] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: [] });
      console.log(`🧹 Guild ${guildId} commands cleared.`);
    } catch (err) {
      console.error(`❌ Failed to clear guild ${guildId}:`, err.message);
    }
  }

  // Step 3: Register fresh commands per-guild (instant, no 1hr wait)
  console.log(`📡 Registering ${commands.length} fresh commands...`);
  for (const [guildId] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
      console.log(`✅ Guild ${guildId} updated.`);
    } catch (err) {
      console.error(`❌ Guild ${guildId} failed:`, err.message);
    }
  }
  console.log('✅ All commands registered fresh!');
}

// ══════════════════════════════════════════════════════════════════
//  MESSAGE COUNTING  — 1 message = 1 coin (original working logic)
// ══════════════════════════════════════════════════════════════════
client.on('messageCreate', message => {
  if (message.author.bot || !message.guild) return;
  dbAddCoins(message.author.id, message.author.username, 1);
});

// ══════════════════════════════════════════════════════════════════
//  INTERACTION ROUTER
// ══════════════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) return handleButton(interaction);
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
    }
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const payload = { content: '⚠️ Something went wrong. Please try again.', ephemeral: true };
    interaction.replied || interaction.deferred
      ? interaction.followUp(payload)
      : interaction.reply(payload);
  }
});

// ══════════════════════════════════════════════════════════════════
//  ECONOMY COMMANDS
// ══════════════════════════════════════════════════════════════════

async function cmdBalance(i) {
  const target = i.options.getUser('user') || i.user;
  const data = getUser(target.id, target.username);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0xffd700).setTitle(`${COIN} ${target.username}'s Balance`)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(`**Balance:** ${fmt(data.balance)}`)
      .setFooter({ text: '1 message = 1 Coin' })],
  });
}

async function cmdDaily(i) {
  const data = getUser(i.user.id, i.user.username);
  const now  = Date.now();
  const CD   = 24 * 60 * 60 * 1000;
  if (data.lastDaily && now - data.lastDaily < CD) {
    const rem = CD - (now - data.lastDaily);
    const h = Math.floor(rem / 3600000);
    const m = Math.floor((rem % 3600000) / 60000);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('⏰ Already Claimed')
        .setDescription(`Come back in **${h}h ${m}m**.`)], ephemeral: true,
    });
  }
  dbAddCoins(i.user.id, i.user.username, 100);
  dbSetLastDaily(i.user.id);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('🎁 Daily Reward!')
      .setDescription(`You received **${fmt(100)}**!\nBalance: **${fmt(getUser(i.user.id).balance)}**`)
      .setThumbnail(i.user.displayAvatarURL())
      .setFooter({ text: 'Come back in 24 hours!' })],
  });
}

async function cmdLeaderboard(i) {
  const top  = dbLeaderboard(10);
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
    return i.reply({ content: '❌ You need the **Verified** role to send coins.', ephemeral: true });
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  if (target.id === i.user.id) return i.reply({ content: "❌ Can't pay yourself!", ephemeral: true });
  if (target.bot) return i.reply({ content: "❌ Can't pay bots!", ephemeral: true });
  const sender = getUser(i.user.id, i.user.username);
  if (sender.balance < amount)
    return i.reply({ content: `❌ You only have ${fmt(sender.balance)}.`, ephemeral: true });
  dbRemoveCoins(i.user.id, amount);
  dbAddCoins(target.id, target.username, amount);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('💸 Transfer Successful')
      .setDescription(`**${i.user.username}** sent ${fmt(amount)} to **${target.username}**`)],
  });
}

// ══════════════════════════════════════════════════════════════════
//  GAMBLING
// ══════════════════════════════════════════════════════════════════

async function cmdCoinflip(i) {
  const side = i.options.getString('side');
  const bet  = i.options.getInteger('bet');
  const user = getUser(i.user.id, i.user.username);
  if (user.balance < bet)
    return i.reply({ content: `❌ You only have ${fmt(user.balance)}.`, ephemeral: true });
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won    = result === side;
  won ? dbAddCoins(i.user.id, i.user.username, bet) : dbRemoveCoins(i.user.id, bet);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(won ? 0x00ff88 : 0xff4444)
      .setTitle(won ? '🪙 You Won!' : '🪙 You Lost!')
      .setDescription(
        `The coin landed on **${result}** ${result === 'heads' ? '👑' : '🔵'}\n` +
        `You guessed **${side}**\n\n` +
        (won ? `✅ Won ${fmt(bet)}!` : `❌ Lost ${fmt(bet)}`) +
        `\n\n💰 Balance: ${fmt(getUser(i.user.id).balance)}`
      )],
  });
}

async function cmdSlots(i) {
  const bet  = i.options.getInteger('bet');
  const user = getUser(i.user.id, i.user.username);
  if (user.balance < bet)
    return i.reply({ content: `❌ You only have ${fmt(user.balance)}.`, ephemeral: true });

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
  if (mult > 0) { win = Math.floor(bet * mult); dbAddCoins(i.user.id, i.user.username, win - bet); }
  else { dbRemoveCoins(i.user.id, bet); }
  return i.reply({
    embeds: [new EmbedBuilder().setColor(mult > 0 ? 0xffd700 : 0xff4444).setTitle('🎰 Slot Machine')
      .setDescription(
        `**[ ${reels.join(' | ')} ]**\n\n${resultText}\n\n` +
        (mult > 0 ? `✅ Won ${fmt(win)} (+${fmt(win - bet)})` : `❌ Lost ${fmt(bet)}`) +
        `\n💰 Balance: ${fmt(getUser(i.user.id).balance)}`
      )],
  });
}

// ── Blackjack ─────────────────────────────────────────────────────
const bjGames = new Map();

async function cmdBlackjack(i) {
  const bet  = i.options.getInteger('bet');
  const user = getUser(i.user.id, i.user.username);
  if (user.balance < bet)
    return i.reply({ content: `❌ You only have ${fmt(user.balance)}.`, ephemeral: true });

  const deck = buildDeck();
  const ph   = [drawCard(deck), drawCard(deck)];
  const dh   = [drawCard(deck), drawCard(deck)];
  bjGames.set(i.user.id, { bet, deck, ph, dh });
  dbRemoveCoins(i.user.id, bet);

  if (handValue(ph) === 21) {
    const win = Math.floor(bet * 2.5);
    dbAddCoins(i.user.id, i.user.username, win);
    bjGames.delete(i.user.id);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('🃏 NATURAL BLACKJACK!')
        .setDescription(`**Your hand:** ${handStr(ph)} = **21**\n\n🎉 Won ${fmt(win)} (2.5×)\n💰 Balance: ${fmt(getUser(i.user.id).balance)}`)],
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
  if (!state) return i.reply({ content: 'No active game.', ephemeral: true });
  if (i.user.id !== userId) return i.reply({ content: "This isn't your game!", ephemeral: true });
  await i.deferUpdate();

  if (action === 'double') {
    const u = getUser(userId, i.user.username);
    if (u.balance >= state.bet) { dbRemoveCoins(userId, state.bet); state.bet *= 2; }
  }
  if (action === 'hit' || action === 'double') {
    state.ph.push(drawCard(state.deck));
    const v = handValue(state.ph);
    if (v > 21) {
      bjGames.delete(userId);
      return i.editReply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🃏 BUST!')
          .setDescription(`**Your hand:** ${handStr(state.ph)} = **${v}** — BUST!\n❌ Lost ${fmt(state.bet)}\n💰 Balance: ${fmt(getUser(userId).balance)}`)],
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
  if (payout > 0) dbAddCoins(userId, i.user.username, payout);
  bjGames.delete(userId);
  return i.editReply({
    embeds: [new EmbedBuilder().setColor(color).setTitle('🃏 Blackjack — Result')
      .setDescription(`**Your hand:** ${handStr(state.ph)} = **${pv}**\n**Dealer:** ${handStr(state.dh)} = **${dv}**\n\n${result}\n💰 Balance: ${fmt(getUser(userId).balance)}`)],
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
  const extras = dbGetShopItems();
  const embed  = new EmbedBuilder().setColor(0x00b4ff).setTitle('🛒 Coin Shop')
    .setDescription('Use `/buy <name>` to purchase.\n\u200B');
  SHOP_PACKAGES.forEach(p => {
    embed.addFields({ name: `📦 ${p.name}`, value: `${fmt(p.coins)}\n\`/buy ${p.name}\``, inline: true });
  });
  if (extras.length) {
    embed.addFields({ name: '\u200B', value: '**— Extra Items —**' });
    extras.forEach(it => {
      const stock = it.stock === -1 ? '∞' : it.stock === 0 ? '❌ Out of stock' : `${it.stock} left`;
      embed.addFields({
        name: `${it.emoji || '📦'} ${it.name} — ${fmt(it.price)}`,
        value: `${it.description}\nStock: ${stock}\n\`/buy ${it.name}\``,
        inline: true,
      });
    });
  }
  embed.setFooter({ text: 'Contact staff after purchase to receive your item' });
  return i.reply({ embeds: [embed] });
}

async function cmdBuy(i) {
  const input = i.options.getString('item').toLowerCase().trim();
  const pkg   = SHOP_PACKAGES.find(p => p.name.toLowerCase() === input);
  if (pkg) {
    const user = getUser(i.user.id, i.user.username);
    if (user.balance < pkg.coins)
      return i.reply({ content: `❌ Need ${fmt(pkg.coins)} — you have ${fmt(user.balance)}.`, ephemeral: true });
    dbRemoveCoins(i.user.id, pkg.coins);
    dbAddInventory(i.user.id, pkg.name);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ Purchase Successful!')
        .setDescription(`Bought **${pkg.name}** for ${fmt(pkg.coins)}\n💰 Balance: ${fmt(getUser(i.user.id).balance)}\n\n> 📩 Use \`/use ${pkg.name}\` to redeem!`)],
    });
  }
  const items = dbGetShopItems();
  const item  = items.find(it => it.name.toLowerCase() === input);
  if (!item) return i.reply({ content: '❌ Item not found. Check `/shop`.', ephemeral: true });
  if (item.stock === 0) return i.reply({ content: '❌ Out of stock!', ephemeral: true });
  const user = getUser(i.user.id, i.user.username);
  if (user.balance < item.price)
    return i.reply({ content: `❌ Need ${fmt(item.price)} — you have ${fmt(user.balance)}.`, ephemeral: true });
  dbRemoveCoins(i.user.id, item.price);
  dbAddInventory(i.user.id, item.name);
  if (item.stock > 0) dbDecrementStock(item.name);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ Purchase Successful!')
      .setDescription(`Bought **${item.emoji || '📦'} ${item.name}** for ${fmt(item.price)}\n💰 Balance: ${fmt(getUser(i.user.id).balance)}`)],
  });
}

async function cmdInventory(i) {
  const target = i.options.getUser('user') || i.user;
  const inv    = dbGetInventory(target.id);
  if (!inv.length) return i.reply({
    embeds: [new EmbedBuilder().setColor(0x7289da).setTitle(`🎒 ${target.username}'s Inventory`)
      .setDescription('Empty! Use `/shop` to browse.')],
  });
  const grouped = {};
  inv.forEach(it => { grouped[it] = (grouped[it] || 0) + 1; });
  const desc = Object.entries(grouped).map(([n, q]) => `• **${n}** × ${q}`).join('\n');
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x7289da).setTitle(`🎒 ${target.username}'s Inventory`)
      .setDescription(desc).setThumbnail(target.displayAvatarURL())
      .setFooter({ text: `${inv.length} total items` })],
  });
}

async function cmdUse(i) {
  const input = i.options.getString('item').toLowerCase();
  const inv   = dbGetInventory(i.user.id);
  const idx   = inv.findIndex(it => it.toLowerCase().includes(input));
  if (idx === -1) return i.reply({ content: "❌ You don't have that item. Check `/inventory`.", ephemeral: true });
  const itemName = inv[idx];

  const modal = new ModalBuilder()
    .setCustomId(`redeem_modal_${i.user.id}_${encodeURIComponent(itemName)}`)
    .setTitle('Redemption Form');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('roblox_username').setLabel('Your Roblox Username')
        .setStyle(TextInputStyle.Short).setPlaceholder('e.g. Builderman').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('gamepass_link').setLabel('Gamepass Link')
        .setStyle(TextInputStyle.Short).setPlaceholder('https://www.roblox.com/game-pass/...').setRequired(true)
    )
  );
  return i.showModal(modal);
}

async function handleModal(i) {
  if (!i.customId.startsWith('redeem_modal_')) return;
  const parts    = i.customId.split('_');
  const userId   = parts[2];
  const itemName = decodeURIComponent(parts.slice(3).join('_'));
  if (i.user.id !== userId) return i.reply({ content: "❌ This form isn't for you.", ephemeral: true });

  const robloxUsername = i.fields.getTextInputValue('roblox_username').trim();
  const gampassLink    = i.fields.getTextInputValue('gamepass_link').trim();
  if (!gampassLink.includes('roblox.com'))
    return i.reply({ content: '❌ Invalid Roblox gamepass link. Try `/use` again.', ephemeral: true });

  dbRemoveInventory(userId, itemName);
  const requestId = dbAddRedeem({ userId, username: i.user.username, itemName, robloxUsername, gampassLink });

  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ Redemption Submitted!')
      .setDescription(
        `Your request has been submitted! Staff will process it soon.\n\n` +
        `**Item:** ${itemName}\n**Roblox Username:** ${robloxUsername}\n**Gamepass Link:** ${gampassLink}\n\n` +
        `**Request ID:** \`#${requestId}\`\n\n> You'll receive a DM when done!`
      )],
    ephemeral: true,
  });
}

async function cmdCheckRedeems(i) {
  if (!await guardAdmin(i)) return;
  const pending = dbGetPendingRedeems();
  if (!pending.length) return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('✅ No Pending Requests')
      .setDescription('There are no pending redemptions right now.')], ephemeral: true,
  });
  const embed = new EmbedBuilder().setColor(0x00b4ff).setTitle(`📋 Pending Redemptions (${pending.length})`);
  pending.forEach(r => {
    embed.addFields({
      name: `#${r.id} — ${r.itemName}`,
      value: `👤 **Discord:** <@${r.userId}> (${r.username})\n🎮 **Roblox:** \`${r.robloxUsername}\`\n🔗 **Gamepass:** ${r.gampassLink}\n> Use \`/finish-redeem ${r.id}\` to mark as done`,
      inline: false,
    });
  });
  return i.reply({ embeds: [embed], ephemeral: true });
}

async function cmdFinishRedeem(i) {
  if (!await guardAdmin(i)) return;
  const requestId = i.options.getInteger('id');
  const request   = dbGetRedeem(requestId);
  if (!request) return i.reply({ content: `❌ No redemption found with ID **#${requestId}**.`, ephemeral: true });
  if (request.status === 'paid') return i.reply({ content: `❌ Request **#${requestId}** is already marked as done.`, ephemeral: true });

  dbMarkRedeemDone(requestId, i.user.tag);

  try {
    const user = await client.users.fetch(request.userId);
    await user.send({
      embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('🎉 Your Redemption Has Been Processed!')
        .setDescription(
          `Your request has been fulfilled!\n\n**Item:** ${request.itemName}\n` +
          `**Roblox Username:** ${request.robloxUsername}\n**Gamepass Link:** ${request.gampassLink}\n\n` +
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

async function cmdDropCode(i) {
  if (!await guardAdmin(i)) return;
  const code    = i.options.getString('code').toUpperCase().trim();
  const reward  = i.options.getInteger('reward');
  const minutes = i.options.getInteger('minutes');
  const maxUses = i.options.getInteger('max_uses') ?? 0;
  const channel = i.options.getChannel('channel');
  if (dbGetCode(code)) return i.reply({ content: `❌ Code **${code}** already exists.`, ephemeral: true });
  const expiresAt = minutes > 0 ? Date.now() + minutes * 60 * 1000 : null;
  dbAddCode({ code, reward, maxUses, uses: 0, expiresAt, permanent: false, createdBy: i.user.tag, usedBy: [] });
  const embed = new EmbedBuilder().setColor(0xffd700).setTitle('🎉 Code Dropped!')
    .setDescription(
      `**Code:** ||\`${code}\`||\n**Reward:** ${fmt(reward)}\n` +
      `${minutes > 0 ? `⏰ Expires in **${minutes} minute(s)**` : '⏰ No expiry'}\n` +
      `${maxUses > 0 ? `👥 Max uses: **${maxUses}**` : '👥 Unlimited uses'}\n\n` +
      `Use \`/redeem-code ${code}\` to claim!`
    );
  const announceChannel = channel || (dbGetCodeChannel() ? await client.channels.fetch(dbGetCodeChannel()).catch(() => null) : null);
  if (announceChannel) { await announceChannel.send({ embeds: [embed] }); return i.reply({ content: `✅ Code dropped in <#${announceChannel.id}>!`, ephemeral: true }); }
  return i.reply({ embeds: [embed] });
}

async function cmdMakeCode(i) {
  if (!await guardAdmin(i)) return;
  const code    = i.options.getString('code').toUpperCase().trim();
  const reward  = i.options.getInteger('reward');
  const maxUses = i.options.getInteger('max_uses') ?? 0;
  const channel = i.options.getChannel('channel');
  if (dbGetCode(code)) return i.reply({ content: `❌ Code **${code}** already exists.`, ephemeral: true });
  dbAddCode({ code, reward, maxUses, uses: 0, expiresAt: null, permanent: true, createdBy: i.user.tag, usedBy: [] });
  const embed = new EmbedBuilder().setColor(0x00b4ff).setTitle('📌 Permanent Code Created!')
    .setDescription(
      `**Code:** ||\`${code}\`||\n**Reward:** ${fmt(reward)}\n⏰ Never expires\n` +
      `${maxUses > 0 ? `👥 Max uses: **${maxUses}**` : '👥 Unlimited uses'}\n\n` +
      `Use \`/redeem-code ${code}\` to claim!`
    );
  const announceChannel = channel || (dbGetCodeChannel() ? await client.channels.fetch(dbGetCodeChannel()).catch(() => null) : null);
  if (announceChannel) { await announceChannel.send({ embeds: [embed] }); return i.reply({ content: `✅ Code created in <#${announceChannel.id}>!`, ephemeral: true }); }
  return i.reply({ embeds: [embed] });
}

async function cmdRemoveCode(i) {
  if (!await guardAdmin(i)) return;
  const code    = i.options.getString('code').toUpperCase().trim();
  const channel = i.options.getChannel('channel');
  const existing = dbGetCode(code);
  if (!existing) return i.reply({ content: `❌ No code **${code}** found.`, ephemeral: true });
  dbRemoveCode(code);
  const embed = new EmbedBuilder().setColor(0xff4444).setTitle('🗑️ Code Removed')
    .setDescription(`Code **\`${code}\`** removed. It was used **${existing.uses}** time(s).`);
  const announceChannel = channel || (dbGetCodeChannel() ? await client.channels.fetch(dbGetCodeChannel()).catch(() => null) : null);
  if (announceChannel) { await announceChannel.send({ embeds: [embed] }); return i.reply({ content: `✅ Announced in <#${announceChannel.id}>.`, ephemeral: true }); }
  return i.reply({ embeds: [embed] });
}

async function cmdRedeemCode(i) {
  const code  = i.options.getString('code').toUpperCase().trim();
  const entry = dbGetCode(code);
  if (!entry) return i.reply({ content: '❌ Invalid code.', ephemeral: true });
  if (entry.expiresAt && Date.now() > entry.expiresAt) return i.reply({ content: '❌ This code has expired.', ephemeral: true });
  if (entry.maxUses > 0 && entry.uses >= entry.maxUses) return i.reply({ content: '❌ This code has reached its maximum uses.', ephemeral: true });
  if (entry.usedBy.includes(i.user.id)) return i.reply({ content: '❌ You already redeemed this code.', ephemeral: true });
  dbRedeemCode(code, i.user.id);
  dbAddCoins(i.user.id, i.user.username, entry.reward);
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('🎉 Code Redeemed!')
      .setDescription(`You redeemed **\`${code}\`**!\n\nYou received ${fmt(entry.reward)}\n💰 New balance: ${fmt(getUser(i.user.id).balance)}`)],
    ephemeral: true,
  });
}

async function cmdCodes(i) {
  if (!await guardAdmin(i)) return;
  const codes = dbGetAllCodes();
  if (!codes.length) return i.reply({ content: '📭 No active codes.', ephemeral: true });
  const embed = new EmbedBuilder().setColor(0x7289da).setTitle('🎟️ All Active Codes');
  codes.forEach(c => {
    const expiry = c.expiresAt ? `<t:${Math.floor(c.expiresAt / 1000)}:R>` : 'Never';
    const uses   = c.maxUses > 0 ? `${c.uses}/${c.maxUses}` : `${c.uses}/∞`;
    embed.addFields({
      name:  `\`${c.code}\` — ${fmt(c.reward)}`,
      value: `${c.permanent ? '📌 Permanent' : '⏰ Timed'} • Uses: ${uses} • Expires: ${expiry}\nCreated by: ${c.createdBy}`,
      inline: false,
    });
  });
  return i.reply({ embeds: [embed], ephemeral: true });
}

async function cmdSetCodeChannel(i) {
  if (!await guardAdmin(i)) return;
  const channel = i.options.getChannel('channel');
  dbSetCodeChannel(channel.id);
  return i.reply({ embeds: [adminEmbed(`✅ Code announcement channel set to <#${channel.id}>`)] });
}

// ══════════════════════════════════════════════════════════════════
//  INFO
// ══════════════════════════════════════════════════════════════════

async function cmdUserinfo(i) {
  const target  = i.options.getMember('user') || i.member;
  const user    = target.user;
  const warns   = dbGetWarnings(user.id).length;
  const balance = getUser(user.id, user.username).balance;
  const roles   = target.roles.cache.filter(r => r.id !== i.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'None';
  return i.reply({
    embeds: [new EmbedBuilder().setColor(target.displayHexColor || 0x7289da).setTitle(`👤 ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🪪 ID',      value: user.id,          inline: true },
        { name: '💰 Balance', value: fmt(balance),      inline: true },
        { name: '⚠️ Warns',  value: `${warns}`,        inline: true },
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
  const channel = i.options.getChannel('channel');
  const amount  = i.options.getInteger('amount');
  const embed   = buildStockEmbed(amount, i.user);
  const existing = dbGetStockMsg(channel.id);
  if (existing) {
    try { const msg = await channel.messages.fetch(existing); await msg.edit({ embeds: [embed] }); return i.reply({ content: `✅ Stock updated in <#${channel.id}> → **${amount.toLocaleString()}**`, ephemeral: true }); }
    catch { /* post fresh */ }
  }
  const msg = await channel.send({ embeds: [embed] });
  dbSetStockMsg(channel.id, msg.id);
  return i.reply({ content: `✅ Stock embed posted in <#${channel.id}> → **${amount.toLocaleString()}**`, ephemeral: true });
}

async function cmdSetStock(i) {
  if (!await guardAdmin(i)) return;
  const channel  = i.options.getChannel('channel');
  const amount   = i.options.getInteger('amount');
  const existing = dbGetStockMsg(channel.id);
  if (!existing) return i.reply({ content: `❌ No stock embed in <#${channel.id}>. Use \`/show-stock\` first.`, ephemeral: true });
  try {
    const msg = await channel.messages.fetch(existing);
    await msg.edit({ embeds: [buildStockEmbed(amount, i.user)] });
    return i.reply({ content: `✅ Stock updated → **${amount.toLocaleString()}** in <#${channel.id}>`, ephemeral: true });
  } catch {
    dbSetStockMsg(channel.id, null);
    return i.reply({ content: `❌ Embed not found. Use \`/show-stock\` to post a new one.`, ephemeral: true });
  }
}

function buildStockEmbed(amount, updatedBy) {
  const oos   = amount === 0;
  const low   = amount > 0 && amount < 100;
  const color  = oos ? 0xff4444 : low ? 0xffaa00 : 0x00e676;
  const status = oos ? '🔴 **OUT OF STOCK**' : low ? '🟡 **LOW STOCK**' : '🟢 **IN STOCK**';
  return new EmbedBuilder().setColor(color).setTitle('📦 STOCK')
    .setDescription(`${status}\n\u200B`)
    .addFields(
      { name: 'Amount in Stock', value: `\`\`\`${amount.toLocaleString()}\`\`\``, inline: false },
      { name: '🛒 How to Buy',   value: '`/shop` then `/buy <item>`',             inline: true  },
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
  dbAddCoins(target.id, target.username, amount);
  return i.reply({ embeds: [adminEmbed(`✅ Added ${fmt(amount)} to **${target.username}**\nNew balance: ${fmt(getUser(target.id).balance)}`)] });
}

async function cmdRemoveCoin(i) {
  if (!await guardOwner(i)) return;
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  dbRemoveCoins(target.id, amount);
  return i.reply({ embeds: [adminEmbed(`✅ Removed ${fmt(amount)} from **${target.username}**\nNew balance: ${fmt(getUser(target.id).balance)}`)] });
}

async function cmdSetCoins(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  const amount = i.options.getInteger('amount');
  dbSetCoins(target.id, target.username, amount);
  return i.reply({ embeds: [adminEmbed(`✅ Set **${target.username}**'s balance to ${fmt(amount)}`)] });
}

async function cmdResetDaily(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  dbSetLastDaily(target.id, 0);
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
  dbAddShopItem(item);
  return i.reply({ embeds: [adminEmbed(`✅ Added **${item.emoji} ${item.name}** — ${fmt(item.price)} (Stock: ${item.stock === -1 ? '∞' : item.stock})`)] });
}

async function cmdRemoveItem(i) {
  if (!await guardAdmin(i)) return;
  const name = i.options.getString('name');
  const ok   = dbRemoveShopItem(name);
  if (!ok) return i.reply({ content: '❌ Item not found.', ephemeral: true });
  return i.reply({ embeds: [adminEmbed(`✅ Removed **${name}** from the shop`)] });
}

async function cmdGiveItem(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  const item   = i.options.getString('item');
  dbAddInventory(target.id, item);
  return i.reply({ embeds: [adminEmbed(`✅ Gave **${item}** to **${target.username}**`)] });
}

async function cmdClearInventory(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  dbClearInventory(target.id);
  return i.reply({ embeds: [adminEmbed(`✅ Cleared **${target.username}**'s inventory`)] });
}

// ══════════════════════════════════════════════════════════════════
//  MODERATION
// ══════════════════════════════════════════════════════════════════

async function cmdWarn(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getUser('user');
  const reason = i.options.getString('reason');
  const count  = dbAddWarning(target.id, target.username, reason, i.user.tag);
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
  const warnings = dbGetWarnings(target.id);
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
  dbClearWarnings(target.id);
  return i.reply({ embeds: [adminEmbed(`✅ Cleared all warnings for **${target.username}**`)] });
}

async function cmdTimeout(i) {
  if (!await guardAdmin(i)) return;
  const target  = i.options.getMember('user');
  const minutes = i.options.getInteger('minutes');
  const reason  = i.options.getString('reason') || 'No reason provided';
  if (!target) return i.reply({ content: '❌ User not found.', ephemeral: true });
  if (target.id === i.user.id) return i.reply({ content: "❌ Can't timeout yourself.", ephemeral: true });
  if (!target.moderatable) return i.reply({ content: '❌ I cannot timeout this user.', ephemeral: true });
  await target.timeout(minutes * 60 * 1000, reason);
  return i.reply({ embeds: [modEmbed('🔇 User Timed Out', `**User:** ${target.user.tag}\n**Duration:** ${minutes} minute(s)\n**Reason:** ${reason}\n**By:** ${i.user.tag}`, 0xff8800)] });
}

async function cmdUntimeout(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getMember('user');
  if (!target) return i.reply({ content: '❌ User not found.', ephemeral: true });
  await target.timeout(null);
  return i.reply({ embeds: [modEmbed('🔊 Timeout Removed', `**User:** ${target.user.tag}\n**By:** ${i.user.tag}`, 0x00ff88)] });
}

async function cmdKick(i) {
  if (!await guardAdmin(i)) return;
  const target = i.options.getMember('user');
  const reason = i.options.getString('reason') || 'No reason provided';
  if (!target) return i.reply({ content: '❌ User not found.', ephemeral: true });
  if (!target.kickable) return i.reply({ content: "❌ I can't kick this user.", ephemeral: true });
  try { await target.user.send({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle(`👢 You were kicked from ${i.guild.name}`).setDescription(`**Reason:** ${reason}`)] }); } catch { /* DMs closed */ }
  await target.kick(reason);
  return i.reply({ embeds: [modEmbed('👢 User Kicked', `**User:** ${target.user.tag}\n**Reason:** ${reason}\n**By:** ${i.user.tag}`, 0xff4444)] });
}

async function cmdBan(i) {
  if (!await guardAdmin(i)) return;
  const target  = i.options.getMember('user');
  const reason  = i.options.getString('reason') || 'No reason provided';
  const delDays = i.options.getInteger('delete_days') ?? 0;
  if (!target) return i.reply({ content: '❌ User not found.', ephemeral: true });
  if (!target.bannable) return i.reply({ content: "❌ I can't ban this user.", ephemeral: true });
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
  } catch {
    return i.reply({ content: "❌ Couldn't unban — invalid ID or user isn't banned.", ephemeral: true });
  }
}

async function cmdPurge(i) {
  if (!await guardAdmin(i)) return;
  const amount = i.options.getInteger('amount');
  const filter = i.options.getUser('user');
  await i.deferReply({ ephemeral: true });
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
  return i.reply({ embeds: [modEmbed('🔒 Channel Locked', `<#${channel.id}> has been locked.\n**Reason:** ${reason}`, 0xff4444)] });
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
  return i.reply({ content: `✅ Announcement sent to <#${channel.id}>`, ephemeral: true });
}

// ══════════════════════════════════════════════════════════════════
//  HELP
// ══════════════════════════════════════════════════════════════════

async function cmdHelp(i) {
  return i.reply({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${COIN} Coin Bot — Commands`)
      .setDescription('Here\'s everything you can do!\n\u200B')
      .addFields(
        { name: '💰 Economy', inline: false, value: [
          '`/balance [user]` — Check your or someone\'s balance',
          '`/daily` — Claim 100 free coins every 24h',
          '`/pay <user> <amount>` — Send coins (Verified role required)',
          '`/leaderboard` — Top 10 richest users',
        ].join('\n') },
        { name: '🎰 Gambling', inline: false, value: [
          '`/coinflip <heads|tails> <bet>` — 50/50, win 2×',
          '`/slots <bet>` — Spin the slots (up to 20× jackpot!)',
          '`/blackjack <bet>` — Hit, Stand or Double Down',
        ].join('\n') },
        { name: '🛒 Shop', inline: false, value: [
          '`/shop` — Browse the coin shop',
          '`/buy <item>` — Buy an item',
          '`/inventory [user]` — View your items',
          '`/use <item>` — Redeem an item (opens a form)',
        ].join('\n') },
        { name: '🎟️ Codes', inline: false, value: [
          '`/redeem-code <code>` — Redeem a code for coins',
        ].join('\n') },
        { name: 'ℹ️ Info', inline: false, value: [
          '`/userinfo [user]` — View info about a user',
          '`/serverinfo` — View server stats',
          '`/help` — This menu',
        ].join('\n') },
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
        { name: '📦 Stock', inline: false, value: [
          '`/show-stock <channel> <amount>` — Post stock embed',
          '`/set-stock <channel> <amount>` — Update existing stock embed',
        ].join('\n') },
        { name: '🎟️ Codes', inline: false, value: [
          '`/drop-code <code> <reward> <minutes>` — Drop a timed code',
          '`/make-code <code> <reward>` — Create a permanent code',
          '`/remove-code <code>` — Delete a code',
          '`/codes` — View all active codes',
          '`/set-code-channel <channel>` — Set default announce channel',
        ].join('\n') },
        { name: '💰 Economy', inline: false, value: [
          '`/givecoin <user> <amount>` — Add coins [Owner/Co-Owner]',
          '`/removecoin <user> <amount>` — Remove coins [Owner/Co-Owner]',
          '`/setcoins <user> <amount>` — Set exact balance',
          '`/resetdaily <user>` — Reset daily cooldown',
        ].join('\n') },
        { name: '🛒 Shop', inline: false, value: [
          '`/additem <name> <price> <desc>` — Add custom shop item',
          '`/removeitem <name>` — Remove shop item',
          '`/giveitem <user> <item>` — Give item directly',
          '`/clearinventory <user>` — Wipe user\'s inventory',
        ].join('\n') },
        { name: '📋 Redemptions', inline: false, value: [
          '`/check-redeems` — View pending redemptions',
          '`/finish-redeem <id>` — Mark done & DM user',
        ].join('\n') },
        { name: '🔨 Moderation', inline: false, value: [
          '`/warn <user> <reason>` — Warn a user',
          '`/warnings <user>` — View warnings',
          '`/clearwarnings <user>` — Clear warnings',
          '`/timeout <user> <minutes>` — Timeout a user',
          '`/untimeout <user>` — Remove timeout',
          '`/kick <user>` — Kick from server',
          '`/ban <user>` — Ban from server',
          '`/unban <userid>` — Unban by ID',
          '`/purge <amount>` — Bulk delete messages',
          '`/slowmode <seconds>` — Set channel slowmode',
          '`/lock [channel]` — Lock a channel',
          '`/unlock [channel]` — Unlock a channel',
          '`/announce <channel> <title> <msg>` — Send announcement',
        ].join('\n') },
      )
      .setFooter({ text: 'Admin Perm role or Administrator permission required' })],
    ephemeral: true,
  });
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
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  client.user.setActivity('Coin Economy | /shop', { type: 3 });
});

client.login(process.env.DISCORD_TOKEN);
