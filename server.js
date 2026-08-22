const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// FORCE GLOBAL READ FROM RENDER SETTINGS:
const BOT_TOKEN = process.env.BOT_TOKEN; 
const CHANNEL_ID = '1519853703425949866';
const ALLOWED_ROLE_ID = '1527446480573698269';

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
    if (messageHistory.length > 50) {
        messageHistory.shift();
    }
}

// --- REGISTER THE SLASH COMMANDS ---
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

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    try {
        console.log('Started refreshing application (/) commands');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        const fetchedMessages = await channel.messages.fetch({ limit: 50 });
        const reverseHistory = Array.from(fetchedMessages.values()).reverse();
        const filteredHistory = reverseHistory.filter(msg => msg.content && msg.content.trim() !== '');
        
        messageHistory = filteredHistory.map(msg => ({ id: msg.id, text: msg.content }));
        console.log(`Successfully imported ${messageHistory.length} historical text messages!`);
    } catch (error) {
        console.error("Failed to fetch historical messages:", error);
    }
});

// --- LISTEN FOR SLASH COMMAND INTERACTIONS ---
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
            console.error('Failed to clear logs:', error);
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
        console.error('Failed to execute log command:', error);
        await interaction.editReply({ content: 'Failed to process command.' });
    }
});

// --- LIVE CHAT LISTENERS ---
client.on('messageCreate', (message) => {
    if (message.channel.id === CHANNEL_ID || message.channel.id === '1529275850011312168') {
        if (!message.content || message.content.trim() === '') return;
        if (messageHistory.some(msg => msg.id === message.id)) return;
        pushToHistory(message.id, message.content);
    }
});

client.on('messageDelete', (deletedMessage) => {
    if (deletedMessage.channel.id === CHANNEL_ID || deletedMessage.channel.id === '1529275850011312168') {
        messageHistory = messageHistory.filter(msg => msg.id !== deletedMessage.id);
    }
});

client.on('messageDeleteBulk', (deletedMessages) => {
    const firstMsg = deletedMessages.first();
    if (firstMsg && (firstMsg.channel.id === CHANNEL_ID || firstMsg.channel.id === '1529275850011312168')) {
        const deletedIds = deletedMessages.map(msg => msg.id);
        messageHistory = messageHistory.filter(msg => !deletedIds.includes(msg.id));
    }
});

// --- HTTP SERVER FORMATTED FOR YOUR CUSTOM EXTENSION RAW STRING EXPECTATION ---
app.get('/msg', (req, res) => {
    const rawMessages = messageHistory.map(msg => msg.text);
    const quotedMessages = rawMessages.map(text => `"${text}"`);
    const arrayString = `[${quotedMessages.join(',')}]`;
    const finalOutput = `{"messages":${arrayString}}`;
    
    res.setHeader('Content-Type', 'text/plain');
    res.send(finalOutput);
});

// STARTUP INTEGRITY AND ATTEMPT LOGIN LOGS:
console.log("Token Integrity Test Length:", BOT_TOKEN ? BOT_TOKEN.length : "ZERO / UNDEFINED");

client.login(BOT_TOKEN).catch(err => {
    console.error("DISCORD GATEWAY REJECTED LOGIN:", err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Middleman server running on port ${PORT}`));
