const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============================================================
// DATABASE (JSON file)
// ============================================================
const DB_PATH = path.join(__dirname, 'data.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: {}, redeems: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getUser(userId) {
  const db = loadDB();
  if (!db.users[userId]) {
    db.users[userId] = { coins: 0, inventory: [] };
    saveDB(db);
  }
  return db.users[userId];
}

function saveUser(userId, data) {
  const db = loadDB();
  db.users[userId] = data;
  saveDB(db);
}

function addCoins(userId, amount) {
  const user = getUser(userId);
  user.coins += amount;
  saveUser(userId, user);
  return user.coins;
}

function removeCoins(userId, amount) {
  const user = getUser(userId);
  user.coins = Math.max(0, user.coins - amount);
  saveUser(userId, user);
  return user.coins;
}

function getCoins(userId) {
  return getUser(userId).coins;
}

function addToInventory(userId, item) {
  const user = getUser(userId);
  user.inventory.push(item);
  saveUser(userId, user);
}

function getInventory(userId) {
  return getUser(userId).inventory;
}

function removeFromInventory(userId, redeemId) {
  const user = getUser(userId);
  user.inventory = user.inventory.filter(i => i.redeemId !== redeemId);
  saveUser(userId, user);
}

function createRedeem(userId, itemId, itemName, redeemId) {
  const db = loadDB();
  db.redeems[redeemId] = {
    id: redeemId,
    userId,
    itemId,
    itemName,
    status: 'pending',
    robloxUsername: null,
    gampassLink: null,
  };
  saveDB(db);
}

function getRedeem(redeemId) {
  const db = loadDB();
  return db.redeems[redeemId] || null;
}

function updateRedeem(redeemId, data) {
  const db = loadDB();
  if (!db.redeems[redeemId]) return false;
  db.redeems[redeemId] = { ...db.redeems[redeemId], ...data };
  saveDB(db);
  return true;
}

function getAllRedeems() {
  const db = loadDB();
  return db.redeems;
}

// ============================================================
// HELPERS
// ============================================================
function isAdmin(member) {
  if (member.permissions.has('Administrator')) return true;
  return member.roles.cache.some(r => r.name.toLowerCase().includes('admin perm'));
}

function isOwnerOrCoOwner(member) {
  return member.roles.cache.some(r => {
    const name = r.name.toLowerCase();
    return name === 'owner' || name === 'co owner' || name === 'co-owner';
  });
}

function isVerified(member) {
  return member.roles.cache.some(r => r.name.toLowerCase() === 'verified');
}

function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ============================================================
// SHOP ITEMS
// ============================================================
const SHOP_ITEMS = [
  { id: '1', name: '125m Brainrot', cost: 1500 },
  { id: '2', name: '150m Brainrot', cost: 2000 },
  { id: '3', name: '175m Brainrot', cost: 2500 },
  { id: '4', name: '200m Brainrot', cost: 3000 },
  { id: '5', name: '100m Garama',   cost: 5000 },
];

// ============================================================
// COMMANDS
// ============================================================
const commands = [

  // /balance
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your coin balance')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),
    async execute(interaction) {
      const target = interaction.options.getUser('user') || interaction.user;
      const coins = getCoins(target.id);
      const embed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('💰 Coin Balance')
        .setDescription(`**${target.username}** has **${coins.toLocaleString()} coins**`);
      await interaction.reply({ embeds: [embed] });
    },
  },

  // /shop
  {
    data: new SlashCommandBuilder()
      .setName('shop')
      .setDescription('View the coin shop'),
    async execute(interaction) {
      const embed = new EmbedBuilder()
        .setColor(0x00bfff)
        .setTitle('🛒 Coin Shop')
        .setDescription('Use `/buy <id>` to purchase an item.')
        .addFields(
          SHOP_ITEMS.map(item => ({
            name: `[${item.id}] ${item.name}`,
            value: `**${item.cost.toLocaleString()} coins**`,
            inline: true,
          }))
        );
      await interaction.reply({ embeds: [embed] });
    },
  },

  // /buy
  {
    data: new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy an item from the shop')
      .addStringOption(o => o.setName('id').setDescription('Item ID from /shop').setRequired(true)),
    async execute(interaction) {
      const itemId = interaction.options.getString('id');
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (!item) return interaction.reply({ content: '❌ Invalid item ID. Use `/shop` to see items.', ephemeral: true });

      const coins = getCoins(interaction.user.id);
      if (coins < item.cost) {
        return interaction.reply({
          content: `❌ You need **${item.cost.toLocaleString()} coins** but only have **${coins.toLocaleString()}**.`,
          ephemeral: true,
        });
      }

      const redeemId = generateId();
      removeCoins(interaction.user.id, item.cost);
      addToInventory(interaction.user.id, { itemId: item.id, itemName: item.name, redeemId });
      createRedeem(interaction.user.id, item.id, item.name, redeemId);

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle('✅ Purchase Successful!')
        .setDescription(`You bought **${item.name}**!\nRedeem ID: \`${redeemId}\`\nUse \`/redeem\` to redeem it.`);
      await interaction.reply({ embeds: [embed] });
    },
  },

  // /inventory
  {
    data: new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('View your inventory'),
    async execute(interaction) {
      const inv = getInventory(interaction.user.id);
      if (!inv.length) return interaction.reply({ content: '🎒 Your inventory is empty.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎒 Your Inventory')
        .setDescription(inv.map(i => `• **${i.itemName}** — Redeem ID: \`${i.redeemId}\``).join('\n'));
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },

  // /redeem
  {
    data: new SlashCommandBuilder()
      .setName('redeem')
      .setDescription('Redeem an item from your inventory')
      .addStringOption(o => o.setName('id').setDescription('Redeem ID from your inventory').setRequired(true))
      .addStringOption(o => o.setName('roblox_username').setDescription('Your Roblox username').setRequired(true))
      .addStringOption(o => o.setName('gamepass_link').setDescription('Gamepass link').setRequired(true)),
    async execute(interaction) {
      const redeemId = interaction.options.getString('id').toUpperCase();
      const robloxUsername = interaction.options.getString('roblox_username');
      const gampassLink = interaction.options.getString('gamepass_link');

      const redeem = getRedeem(redeemId);
      if (!redeem) return interaction.reply({ content: '❌ Redeem ID not found.', ephemeral: true });
      if (redeem.userId !== interaction.user.id) return interaction.reply({ content: '❌ This redeem does not belong to you.', ephemeral: true });
      if (redeem.status !== 'pending') return interaction.reply({ content: `❌ Already processed (status: **${redeem.status}**).`, ephemeral: true });

      updateRedeem(redeemId, { robloxUsername, gampassLink, status: 'paid' });

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle('✅ Redeem Submitted!')
        .setDescription(
          `**Item:** ${redeem.itemName}\n**Redeem ID:** \`${redeemId}\`\n**Roblox Username:** ${robloxUsername}\n**Gamepass Link:** ${gampassLink}\n\nAn admin will process your redeem soon.`
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },

  // /see-redeems (admin)
  {
    data: new SlashCommandBuilder()
      .setName('see-redeems')
      .setDescription('[Admin] View all pending redeems'),
    async execute(interaction) {
      if (!isAdmin(interaction.member)) return interaction.reply({ content: '❌ You need Admin permissions.', ephemeral: true });

      const all = getAllRedeems();
      const entries = Object.values(all).filter(r => r.status === 'paid');
      if (!entries.length) return interaction.reply({ content: '📭 No pending redeems.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle('📋 Pending Redeems')
        .setDescription(
          entries.map(r =>
            `**ID:** \`${r.id}\`\n**User:** <@${r.userId}>\n**Item:** ${r.itemName}\n**Roblox:** ${r.robloxUsername}\n**Gamepass:** ${r.gampassLink}\n**Status:** ${r.status}\n──────────`
          ).join('\n')
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },

  // /finish-redeem (admin)
  {
    data: new SlashCommandBuilder()
      .setName('finish-redeem')
      .setDescription('[Admin] Mark a redeem as finished and notify the user')
      .addStringOption(o => o.setName('id').setDescription('Redeem ID').setRequired(true)),
    async execute(interaction, client) {
      if (!isAdmin(interaction.member)) return interaction.reply({ content: '❌ You need Admin permissions.', ephemeral: true });

      const redeemId = interaction.options.getString('id').toUpperCase();
      const redeem = getRedeem(redeemId);

      if (!redeem) return interaction.reply({ content: '❌ Redeem ID not found.', ephemeral: true });
      if (redeem.status === 'finished') return interaction.reply({ content: '❌ Already finished.', ephemeral: true });

      updateRedeem(redeemId, { status: 'finished' });
      removeFromInventory(redeem.userId, redeemId);

      try {
        const user = await client.users.fetch(redeem.userId);
        const dmEmbed = new EmbedBuilder()
          .setColor(0x00ff99)
          .setTitle('🎉 Your Redeem Has Been Processed!')
          .setDescription(
            `Your redeem for **${redeem.itemName}** has been completed!\n\n**Redeem ID:** \`${redeemId}\`\n**Roblox Username:** ${redeem.robloxUsername}\n\nThank you for your purchase!`
          );
        await user.send({ embeds: [dmEmbed] });
      } catch {
        // User may have DMs disabled
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle('✅ Redeem Finished')
        .setDescription(`Redeem \`${redeemId}\` marked as finished. User has been notified via DM.`);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },

  // /coinflip
  {
    data: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Bet coins on a coinflip')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(1))
      .addStringOption(o =>
        o.setName('side').setDescription('heads or tails').setRequired(true)
          .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })
      ),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const side = interaction.options.getString('side');
      const coins = getCoins(interaction.user.id);

      if (coins < amount) return interaction.reply({ content: `❌ You only have **${coins.toLocaleString()} coins**.`, ephemeral: true });

      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const won = result === side;

      if (won) addCoins(interaction.user.id, amount);
      else removeCoins(interaction.user.id, amount);

      const newBalance = getCoins(interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor(won ? 0x00ff99 : 0xff4444)
        .setTitle(won ? '🪙 You Won!' : '🪙 You Lost!')
        .setDescription(
          `The coin landed on **${result}**!\nYou chose **${side}** and ${won ? 'won' : 'lost'} **${amount.toLocaleString()} coins**.\nNew balance: **${newBalance.toLocaleString()} coins**`
        );
      await interaction.reply({ embeds: [embed] });
    },
  },

  // /give (verified only)
  {
    data: new SlashCommandBuilder()
      .setName('give')
      .setDescription('Give coins to another user (requires Verified role)')
      .addUserOption(o => o.setName('user').setDescription('User to give coins to').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount of coins').setRequired(true).setMinValue(1)),
    async execute(interaction) {
      if (!isVerified(interaction.member)) return interaction.reply({ content: '❌ You need the **Verified** role to give coins.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      if (target.id === interaction.user.id) return interaction.reply({ content: '❌ You cannot give coins to yourself.', ephemeral: true });
      if (target.bot) return interaction.reply({ content: '❌ You cannot give coins to a bot.', ephemeral: true });

      const senderCoins = getCoins(interaction.user.id);
      if (senderCoins < amount) return interaction.reply({ content: `❌ You only have **${senderCoins.toLocaleString()} coins**.`, ephemeral: true });

      removeCoins(interaction.user.id, amount);
      addCoins(target.id, amount);

      const embed = new EmbedBuilder()
        .setColor(0x00bfff)
        .setTitle('💸 Coins Transferred')
        .setDescription(`**${interaction.user.username}** gave **${amount.toLocaleString()} coins** to **${target.username}**!`);
      await interaction.reply({ embeds: [embed] });
    },
  },

  // /givecoin (owner/co-owner only)
  {
    data: new SlashCommandBuilder()
      .setName('givecoin')
      .setDescription('[Owner/Co-Owner] Give coins to a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    async execute(interaction) {
      if (!isOwnerOrCoOwner(interaction.member)) return interaction.reply({ content: '❌ Only Owner or Co-Owner can use this.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const newBalance = addCoins(target.id, amount);

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle('💸 Coins Given')
        .setDescription(`Gave **${amount.toLocaleString()} coins** to **${target.username}**.\nNew balance: **${newBalance.toLocaleString()} coins**`);
      await interaction.reply({ embeds: [embed] });
    },
  },

  // /removecoin (owner/co-owner only)
  {
    data: new SlashCommandBuilder()
      .setName('removecoin')
      .setDescription('[Owner/Co-Owner] Remove coins from a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    async execute(interaction) {
      if (!isOwnerOrCoOwner(interaction.member)) return interaction.reply({ content: '❌ Only Owner or Co-Owner can use this.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const newBalance = removeCoins(target.id, amount);

      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('🗑️ Coins Removed')
        .setDescription(`Removed **${amount.toLocaleString()} coins** from **${target.username}**.\nNew balance: **${newBalance.toLocaleString()} coins**`);
      await interaction.reply({ embeds: [embed] });
    },
  },

];

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const commandMap = new Collection();
for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

// 1 message = 1 coin
client.on('messageCreate', message => {
  if (message.author.bot || !message.guild) return;
  addCoins(message.author.id, 1);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, client);
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
    else await interaction.reply(msg);
  }
});

// Register slash commands + login
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(c => c.data.toJSON()) }
    );
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.DISCORD_TOKEN);
