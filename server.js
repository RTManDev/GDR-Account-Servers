const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');
const https = require('https');

console.log("⚙️ System starting up...");

const app = express();
app.use(cors());

// Configuration variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = '1519853703425949866';
const ALLOWED_ROLE_ID = '1527446480573698269';
const SECONDARY_CHANNEL_ID = '1529275850011312168';
const RENDER_EXTERNAL_URL = 'https://gdr-account-servers.onrender.com';

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel]
});

let messageHistory = [];

function pushToHistory(id, text) {
    messageHistory.push({ id, text });
    if (messageHistory.length > 500) {
        messageHistory.shift();
    }
}

// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Deletes all logs in this specific channel and clears all TurboWarp logs (Owner Only)'),
    new SlashCommandBuilder()
        .setName('mod')
        .setDescription('Approves a user as a moderator (Owner Only)')
        .addStringOption(option => option.setName('username').setDescription('The name of the user to approve as moderator').setRequired(true)),
    new SlashCommandBuilder()
        .setName('eldermod')
        .setDescription('Approves a user as a moderator (Owner Only)')
        .addStringOption(option => option.setName('username').setDescription('The name of the user to approve as elder moderator').setRequired(true)),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user permanently (Owner Only)')
        .addStringOption(option => option.setName('username').setDescription('The name of the user to log as banned').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('The duration of the ban in days').setRequired(true)),
    new SlashCommandBuilder()
        .setName('permban')
        .setDescription('Bans a user permanently (Owner Only)')
        .addStringOption(option => option.setName('username').setDescription('The name of the user to log as permanently banned').setRequired(true))
].map(command => command.toJSON());

// Event: Once ready
client.once('ready', async () => {
    console.log(`🤖 SUCCESS: Logged into Discord API gateway as ${client.user.tag}!`);
    
    // Register Slash Commands
    try {
        console.log('🔄 Started refreshing application (/) commands...');
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.log('❌ Error registering slash commands:', error.message);
    }

    // --- DEEP RECURSIVE HISTORY CRAWLER ---
    try {
        console.log(`🔄 Initiating deep crawl for channel: ${CHANNEL_ID}...`);
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) {
            console.log("❌ Could not find channel.");
            return;
        }

        let allFetched = [];
        let lastId = null;
        let crawling = true;

        // Keep looping backwards through time 100 messages at a time until reaching the channel beginning
        while (crawling) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) {
                crawling = false;
                break;
            }

            allFetched.push(...messages.values());
            lastId = messages.last().id;

            // Optional safety cap: Stop if history gets massive to protect memory (e.g., 500 messages)
            if (allFetched.length >= 500) {
                crawling = false;
            }
        }

        // Sort chronologically (oldest to newest) and format
        const sortedHistory = allFetched.reverse();
        const filteredHistory = sortedHistory.filter(msg => msg.content && msg.content.trim() !== '');
        
        messageHistory = filteredHistory.map(msg => ({ id: msg.id, text: msg.content }));
        console.log(`✅ Deep crawl complete! Imported ${messageHistory.length} total historical messages into memory.`);
        
    } catch (error) {
        console.log("❌ Failed to deep crawl historical messages:", error.message);
    }
});

// Event: Interaction commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID) && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    }

    if (interaction.commandName === 'clear') {
        if (interaction.channelId !== CHANNEL_ID) {
            return interaction.reply({ content: 'Sync failed.', ephemeral: true });
        }
        try {
            await interaction.deferReply({ ephemeral: true });
            messageHistory = [];
            const fetched = await interaction.channel.messages.fetch({ limit: 100 });
            if (fetched.size > 0) {
                try {
                    await interaction.channel.bulkDelete(fetched);
                } catch (bulkError) {
                    for (const msg of fetched.values()) {
                        try { await msg.delete(); } catch (e) { continue; }
                    }
                }
            }
            await interaction.editReply({ content: 'Successfully purged all logs server cache!' });
        } catch (error) {
            console.log('❌ Failed to clear logs:', error.message);
            await interaction.editReply({ content: 'An unexpected error occurred while clearing.' });
        }
        return;
    }

    await interaction.deferReply({ ephemeral: true });
    let logText = '';
    const targetedUser = interaction.options.getString('username');

    if (interaction.commandName === 'ban') {
        const duration = interaction.options.getString('duration');
        logText = `${targetedUser} has had their account suspended for ${duration} days.`;
    } else if (interaction.commandName === 'permban') {
        logText = `${targetedUser} has had their account suspended permanently.`;
    } else if (interaction.commandName === 'mod') {
        logText = `${targetedUser} has had their account promoted to Moderator.`;
    } else if (interaction.commandName === 'eldermod') {
        logText = `${targetedUser} has had their account promoted to Elder Moderator.`;
    }

    try {
        const sentMessage = await interaction.channel.send({ content: logText });
        pushToHistory(sentMessage.id, logText);
        await interaction.editReply({ content: 'Log sent and tracked successfully.' });
    } catch (error) {
        console.log('❌ Failed to execute log command:', error.message);
        await interaction.editReply({ content: 'Failed to process command.' });
    }
});

// Real-time Event Listeners
client.on('messageCreate', (message) => {
    if (message.channel.id === CHANNEL_ID || message.channel.id === SECONDARY_CHANNEL_ID) {
        if (!message.content || message.content.trim() === '') return;
        if (messageHistory.some(msg => msg.id === message.id)) return;
        pushToHistory(message.id, message.content);
    }
});

client.on('messageDelete', (deletedMessage) => {
    if (deletedMessage.channel.id === CHANNEL_ID || deletedMessage.channel.id === SECONDARY_CHANNEL_ID) {
        messageHistory = messageHistory.filter(msg => msg.id !== deletedMessage.id);
    }
});

client.on('messageDeleteBulk', (deletedMessages) => {
    const firstMsg = deletedMessages.first();
    if (firstMsg && (firstMsg.channel.id === CHANNEL_ID || firstMsg.channel.id === SECONDARY_CHANNEL_ID)) {
        const deletedIds = deletedMessages.map(msg => msg.id);
        messageHistory = messageHistory.filter(msg => !deletedIds.includes(msg.id));
    }
});

// API Routes
app.get('/msg', (req, res) => {
    const rawMessages = messageHistory.map(msg => msg.text);
    const cleanOutput = JSON.stringify({ messages: rawMessages });
    res.setHeader('Content-Type', 'text/plain');
    res.send(cleanOutput);
});

app.get('/', (req, res) => {
    res.send('Middleman web architecture server is healthy and listening!');
});

// Start listening and initialization
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Express server successfully opened port ${PORT}`);
    
    // Connect to Discord
    connectDiscord();
    
    // Self-ping loop
    setInterval(() => {
        https.get(RENDER_EXTERNAL_URL, (res) => {
            console.log(`⏰ Self-ping successful. Status code: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log('⚠️ Self-pinging process warning:', err.message);
        });
    }, 600000); 
});

async function connectDiscord() {
    console.log("🔗 Initiating connection sequence to Discord WebSocket API...");
    
    if (!BOT_TOKEN) {
        console.log("❌ CRITICAL ERROR: BOT_TOKEN is missing or empty inside Render Environment Variables!");
        return;
    }
    
    console.log(`Token presence verified. Length: ${BOT_TOKEN.length} characters.`);
    
    try {
        await client.login(BOT_TOKEN);
    } catch (loginError) {
        console.log("❌ DISCORD LOGIN REJECTED CRITICALLY:");
        console.log(loginError);
    }
}

client.on('debug', (info) => console.log(`🔍 [Discord Debug]: ${info}`));
client.on('warn', (warning) => console.log(`⚠️ [Discord Warn]: ${warning}`));
client.on('error', (error) => console.log(`❌ [Discord Client Error]: ${error.message}`));
client.on('shardError', (error, shardId) => console.log(`❌ [Shard ${shardId} Error]: ${error.message}`));

// --- AUTO KEEP-ALIVE SYSTEM ---
// Replace this placeholder string with your literal live Render web application URL
const APP_URL = "https://gdr-servers.onrender.com"; 

setInterval(async () => {
    try {
        // Force the app to fetch its own root endpoint over the network
        const response = await fetch(APP_URL);
        console.log(`🔄 Keep-Alive Sync: Ping sent to infrastructure. Status: ${response.status}`);
    } catch (pingError) {
        console.error("⚠️ Keep-Alive Sync Warning: Local ping attempt failed:", pingError.message);
    }
}, 13 * 60 * 1000); // Triggers automatically every 13 minutes (13m * 60s * 1000ms)
