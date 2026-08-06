const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel]
});

const CHANNEL_ID = '1519853703425949866';
const BOT_TOKEN = 'MTUyMTM5Njg1MjQyMjA4NjcwNw.Gj3zgB.sNpAP_cucOgkKVEtMMD65E9G7XEBs6DBNMgz24'; // Put your newly reset token here!
const ALLOWED_ROLE_ID = '1527446480573698269'; // The role ID allowed to run commands
let messageHistory = []; 

async function replyOrSendAsFile(interaction, text, options = {}) {
    if (typeof text !== 'string') text = String(text);

    if (text.length <= 2000) {
        return interaction.reply({ content: text, ...options });
    }

    const buffer = Buffer.from(text, 'utf8');
    return interaction.reply({
        content: options.content ?? 'Message too long; sending as a file.',
        files: [
            ...(options.files ?? []),
            { attachment: buffer, name: 'message.txt' }
        ],
        ...options
    });
}

// --- REGISTER THE SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Deletes all logs in this specific channel and clears all TurboWarp logs (Owner Only)'),

    new SlashCommandBuilder()
        .setName('mod')
        .setDescription('Approves a user as a moderator (Owner Only)')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('The name of the user to approve as moderator')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('eldermod')
        .setDescription('Approves a user as a moderator (Owner Only)')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('The name of the user to approve as elder moderator')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user permanently (Owner Only)')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('The name of the user to log as banned')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('duration')
                .setDescription('The duration of the ban in days')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('permban')
        .setDescription('Bans a user permanently (Owner Only)')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('The name of the user to log as permanently banned')
                .setRequired(true)
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    try {
        console.log('Started refreshing application (/) commands');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    // Fetch initial history
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

    // Global Staff Role Check for all slash commands
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID) && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ 
            content: 'Only the owner can use this command, if you believe this is a mistake, please contact a Staff or Administrator member in the Geometry Dash Renovated Server.', 
            ephemeral: true 
        });
    }

    // --- COMMAND: /clearalldata ---
    if (interaction.commandName === 'clear') {
        if (interaction.channelId !== CHANNEL_ID) {
            return interaction.reply({ content: 'Sync failed.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // Clear the local TurboWarp memory immediately
            messageHistory = [];
            console.log('TurboWarp memory cleared via command');

            // Fetch up to 100 messages from the channel
            const fetched = await interaction.channel.messages.fetch({ limit: 100 });
            
            if (fetched.size > 0) {
                try {
                    // Try fast bulk deletion first (works for messages under 14 days old)
                    await interaction.channel.bulkDelete(fetched);
                } catch (bulkError) {
                    console.log('Bulk delete failed due to all data and logs over 14 days old, switching to single deletion mode.');
                    
                    // Fallback: Delete messages manually one by one (ignores the 14-day rule entirely)
                    for (const msg of fetched.values()) {
                        try {
                            await msg.delete();
                        } catch (singleDeleteError) {
                            continue; 
                        }
                    }
                }
            }

            await interaction.editReply({ content: 'Successfully purged all logs server cache!' });
        } catch (error) {
            console.error('Failed to clear logs:', error);
            await interaction.editReply({ content: 'An unexpected error occurred while clearing.' });
        }
    }

    // --- COMMAND: /banplayer ---
    if (interaction.commandName === 'ban') {
        const targetedUser = interaction.options.getString('username');
        const targetedDuration = interaction.options.getString('duration');
        const customBanText = `${targetedUser} has had their account suspended for ${targetedDuration} days.`;

        try {
            // Push it straight into your running message stream using a unique ID
            messageHistory.push({
                id: `system-ban-${Date.now()}`,
                text: customBanText
            });

            if (messageHistory.length > 50) {
                messageHistory.shift();
            }

            console.log(`🔨 Logged to TurboWarp: ${customBanText}`);
            
            // Reply publicly to the channel so it saves to the text history
            await replyOrSendAsFile(interaction, customBanText);
        } catch (error) {
            console.error('Failed to execute ban log command:', error);
            await interaction.reply({ content: 'Failed to process command.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'permban') {
        const targetedUser = interaction.options.getString('username');
        const customBanText = `${targetedUser} has had their account suspended permanently.`;

        try {
            // Push it straight into your running message stream using a unique ID
            messageHistory.push({
                id: `system-ban-${Date.now()}`,
                text: customBanText
            });

            if (messageHistory.length > 50) {
                messageHistory.shift();
            }

            console.log(`🔨 Logged to TurboWarp: ${customBanText}`);
            
            // Reply publicly to the channel so it saves to the text history
            await replyOrSendAsFile(interaction, customBanText);
        } catch (error) {
            console.error('Failed to execute ban log command:', error);
            await interaction.reply({ content: 'Failed to process command.', ephemeral: true });
        }
    }


    if (interaction.commandName === 'mod') {
        const targetedUser = interaction.options.getString('username');
        const customModText = `${targetedUser} has has their account promoted to Moderator.`;

        try {
            // Push it straight into your running message stream using a unique ID
            messageHistory.push({
                id: `system-mod-${Date.now()}`,
                text: customModText
            });

            if (messageHistory.length > 50) {
                messageHistory.shift();
            }

            console.log(`🔨 Logged to TurboWarp: ${customModText}`);
            
            // Reply publicly to the channel so it saves to the text history
            await replyOrSendAsFile(interaction, customModText);
        } catch (error) {
            console.error('Failed to execute mod log command:', error);
            await interaction.reply({ content: 'Failed to process command.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'eldermod') {
        const targetedUser = interaction.options.getString('username');
        const customModText = `${targetedUser} has has their account promoted to Elder Moderator.`;

        try {
            // Push it straight into your running message stream using a unique ID
            messageHistory.push({
                id: `system-eldermod-${Date.now()}`,
                text: customModText
            });

            if (messageHistory.length > 50) {
                messageHistory.shift();
            }

            console.log(`🔨 Logged to TurboWarp: ${customModText}`);
            
            // Reply publicly to the channel so it saves to the text history
            await replyOrSendAsFile(interaction, customModText);
        } catch (error) {
            console.error('Failed to execute eldermod log command:', error);
            await interaction.reply({ content: 'Failed to process command.', ephemeral: true });
        }
    }

});

// --- LIVE CHAT LISTENERS ---
client.on('messageCreate', (message) => {
    if (message.channel.id === CHANNEL_ID || message.channel.id === '1529275850011312168') {
        if (!message.content || message.content.trim() === '') return;

        messageHistory.push({
            id: message.id,
            text: `${message.author.username}: ${message.content}`
        });

        if (messageHistory.length > 50) {
            messageHistory.shift(); 
        }
    }
});

client.on('messageDelete', (deletedMessage) => {
    if (deletedMessage.channel.id === CHANNEL_ID || deletedMessage.channel.id === '1529275850011312168') {
        messageHistory = messageHistory.filter(msg => msg.id !== deletedMessage.id);
        console.log(`Removed deleted message (ID: ${deletedMessage.id}) from cache.`);
    }
});

client.on('messageDeleteBulk', (deletedMessages) => {
    const firstMsg = deletedMessages.first();
    if (firstMsg && (firstMsg.channel.id === CHANNEL_ID || firstMsg.channel.id === '1529275850011312168')) {
        const deletedIds = deletedMessages.map(msg => msg.id);
        messageHistory = messageHistory.filter(msg => !deletedIds.includes(msg.id));
        console.log(`Bulk removed ${deletedMessages.size} messages from cache.`);
    }
});

// --- HTTP SERVER ---
app.get('/msg', (req, res) => {
    const stringMessages = messageHistory.map(msg => msg.text);
    res.json({ messages: stringMessages }); 
});

client.login(BOT_TOKEN);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Middleman server running on port ${PORT}`));
