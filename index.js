// FrostMod - An AutoMod Bot for Discord
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const dotenv = require('dotenv');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { createClient } = require('@supabase/supabase-js');
const { HfInference } = require('@huggingface/inference');
const ddg = require('duckduckgo-search');

dotenv.config();

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Initialize HuggingFace client
const hf = new HfInference(process.env.HUGGING_FACE_TOKEN);

// Bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildPresences,
  ],
});

// Register slash commands
const commands = [
  new SlashCommandBuilder().setName('welcome')
    .setDescription('Set the welcome channel where new members will be greeted.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel where the welcome message will be sent')
        .setRequired(true)),

  new SlashCommandBuilder().setName('wmessage')
    .setDescription('Set the welcome message for new members.')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The welcome message (use {user} and {memberCount} for placeholders)')
        .setRequired(true)),

  new SlashCommandBuilder().setName('joinrole')
    .setDescription('Set the auto-role that new members receive.')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to assign to new members')
        .setRequired(true)),

  new SlashCommandBuilder().setName('ignorelinks')
    .setDescription('Set a channel where invite links are ignored by the filter.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to ignore the link filter')
        .setRequired(true)),

  new SlashCommandBuilder().setName('filter')
    .setDescription('Set the curse word filter level.')
    .addStringOption(option =>
      option.setName('level')
        .setDescription('The filter level: light, moderate, strict')
        .setRequired(true)
        .addChoices(
          { name: 'Light', value: 'light' },
          { name: 'Moderate', value: 'moderate' },
          { name: 'Strict', value: 'strict' }
        )),

  new SlashCommandBuilder().setName('help')
    .setDescription('Displays the help menu with available commands'),

  new SlashCommandBuilder().setName('warn')
    .setDescription('Warn a user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to warn')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('The reason for the warning')
        .setRequired(true)),

  new SlashCommandBuilder().setName('logs')
    .setDescription('Set the channel for warning logs.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send logs')
        .setRequired(true)),

  new SlashCommandBuilder().setName('status')
    .setDescription('Shows the bot\'s current status, ping, and uptime'),

  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a question')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('What would you like to ask?')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web for answers')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What would you like to search for?')
        .setRequired(true)),
].map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

// Register commands
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Failed to reload slash commands:', error);
  }
})();

// Bot ready
client.once('ready', () => {
  console.log(`${client.user.tag} is logged in and ready!`);

  client.user.setPresence({
    activities: [{
      name: 'ver 1.0.5 - Developed by Dakota',
      type: 0, // The type of activity (0 is for "Playing")
    }],
    status: 'online',
  });
});

// Member join and leave events
client.on('guildMemberAdd', async (member) => {
  const guildId = member.guild.id;
  const serverName = member.guild.name;

  try {
    const { data: settings, error } = await supabase
      .from('server_settings')
      .select('*')
      .eq('guild_id', guildId)
      .single();

    if (error || !settings) return;

    // Welcome message
    if (settings.welcome_channel_id && settings.welcome_message) {
      const channel = await member.guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
      if (channel) {
        const personalizedMessage = settings.welcome_message
          .replace('{user}', member.user.tag)
          .replace('{memberCount}', member.guild.memberCount);

        const embed = new EmbedBuilder()
          .setColor('#3498db')
          .setTitle('🎉 Welcome!')
          .setDescription(personalizedMessage)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `Member #${member.guild.memberCount}` })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }
    }

    // Auto-role
    if (settings.auto_role_id) {
      const role = member.guild.roles.cache.get(settings.auto_role_id);
      if (role) {
        await member.roles.add(role).catch(console.error);
      }
    }

    // Track join in database
    await supabase.from('member_joins').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
      server_name: serverName
    });

    // Log the user join
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const joinEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('User Joined')
        .setDescription(`${member.user.tag} has joined the server.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [joinEmbed] });
    }
  } catch (error) {
    console.error('Error handling member join:', error);
  }
});

client.on('guildMemberRemove', async (member) => {
  const guildId = member.guild.id;

  try {
    // Track leave in database
    await supabase.from('member_leaves').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
    });

    // Log the user leave
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const leaveEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('User Left')
        .setDescription(`${member.user.tag} has left the server.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [leaveEmbed] });
    }
  } catch (error) {
    console.error('Error handling member leave:', error);
  }
});

// Channel creation and deletion
client.on('channelCreate', async (channel) => {
  const guildId = channel.guild.id;

  try {
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const channelCreateEmbed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('Channel Created')
        .setDescription(`Channel #${channel.name} has been created.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [channelCreateEmbed] });
    }
  } catch (error) {
    console.error('Error logging channel creation:', error);
  }
});

client.on('channelDelete', async (channel) => {
  const guildId = channel.guild.id;

  try {
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const channelDeleteEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Channel Deleted')
        .setDescription(`Channel #${channel.name} has been deleted.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [channelDeleteEmbed] });
    }
  } catch (error) {
    console.error('Error logging channel deletion:', error);
  }
});

// Slash commands handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guild } = interaction;

  try {
    if (commandName === 'welcome') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, welcome_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Welcome channel set to ${channel}.`);
    }

    if (commandName === 'wmessage') {
      const message = interaction.options.getString('message');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, welcome_message: message }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Welcome message set: "${message}"`);
    }

    if (commandName === 'joinrole') {
      const role = interaction.options.getRole('role');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, auto_role_id: role.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ New members will be assigned ${role}.`);
    }

    if (commandName === 'ignorelinks') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, ignored_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Invite links will be ignored in ${channel}.`);
    }

    if (commandName === 'filter') {
      const filterLevel = interaction.options.getString('level');
      await supabase
        .from('filtering_settings')
        .upsert({ guild_id: guild.id, filter_level: filterLevel }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Filter level set to ${filterLevel}.`);
    }

    if (commandName === 'warn') {
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const logsChannel = await getLogsChannel(guild.id);

      if (!logsChannel) {
        await interaction.reply('⚠️ No logs channel set. Please set a logs channel using `/logs` command.');
        return;
      }

      // Add the "Warned by: username" format
      const warnedBy = `Warned by: ${interaction.user.tag}`;

      // Send the warning message to the logs channel
      const warningEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('User Warned')
        .setDescription(`${targetUser.tag} was warned.`)
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Warned by', value: warnedBy }
        )
        .setTimestamp();

      await logsChannel.send({ embeds: [warningEmbed] });

      // Save the warning to Supabase
      await supabase.from('user_warns').insert([{
        guild_id: guild.id,
        user_id: targetUser.id,
        username: targetUser.tag,
        reason: reason,
        warned_by: warnedBy, // Store the "Warned by: username"
        timestamp: new Date().toISOString(),
      }]);


      await interaction.reply(`✅ ${targetUser.tag} has been warned for: ${reason}`);
    }

    if (commandName === 'logs') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, logs_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Logs channel set to ${channel}.`);
    }

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('FrostMod Commands')
        .setDescription('A moderation bot with welcome messages and invite link filtering.')
        .addFields(
          { name: '🛠️ `/welcome`', value: 'Set the welcome channel for new members.' },
          { name: '💬 `/wmessage`', value: 'Set the welcome message (supports `{user}` and `{memberCount}`).' },
          { name: '🧑‍🤝‍🧑 `/joinrole`', value: 'Set an auto-role for new members.' },
          { name: '🔒 `/ignorelinks`', value: 'Allow invite links in a specific channel.' },
          { name: '🚫 `/filter`', value: 'Set the curse word filter level (light, moderate, strict).' },
          { name: '⚠️ `/warn`', value: 'Warn a user for inappropriate behavior.' },
          { name: '📜 `/logs`', value: 'Set the logs channel for user warnings.' },
          { name: '📊 `/status`', value: 'Shows the bot\'s current status, ping, and uptime.' },
          { name: '🤖 `/ask`', value: 'Ask the AI assistant a question.' },
          { name: '🔎 `/search`', value: 'Search for answers about games and gaming.' }
        );
      await interaction.reply({ embeds: [helpEmbed] });
    }

    if (commandName === 'status') {
      const ping = client.ws.ping;
      const uptime = Math.floor(client.uptime / 1000); // Convert to seconds

      // Calculate readable uptime
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      const uptimeString = [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        minutes ? `${minutes}m` : '',
        `${seconds}s`
      ].filter(Boolean).join(' ');

      const statusEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🤖 Bot Status')
        .addFields(
          { name: '📡 Ping', value: `${ping}ms`, inline: true },
          { name: '⏰ Uptime', value: uptimeString, inline: true },
          { name: '🔌 Connection', value: client.ws.status === 0 ? 'Connected' : 'Reconnecting', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [statusEmbed] });
    }

    if (commandName === 'ask') {
      await interaction.deferReply();

      try {
        const question = interaction.options.getString('question');

        const response = await hf.questionAnswering({
          model: "deepset/roberta-base-squad2",
          inputs: {
            question: question,
            context: `The capital of Alaska is Juneau. The capital of California is Sacramento. 
                     The capital of Texas is Austin. The capital of Florida is Tallahassee. 
                     The capital of New York is Albany. The Earth is the third planet from the Sun. 
                     The Moon is Earth's only natural satellite. The Sun is a star at the center of our solar system.
                     Paris is the capital of France. London is the capital of England. 
                     Tokyo is the capital of Japan. Beijing is the capital of China.
                     
                     Basic Math Facts:
                     1 + 1 = 2. 2 + 2 = 4. 3 + 3 = 6. 4 + 4 = 8. 5 + 5 = 10.
                     2 x 2 = 4. 3 x 3 = 9. 4 x 4 = 16. 5 x 5 = 25. 10 x 10 = 100.
                     10 - 5 = 5. 20 - 10 = 10. 15 - 5 = 10. 100 - 50 = 50.
                     10 ÷ 2 = 5. 100 ÷ 4 = 25. 81 ÷ 9 = 9. 50 ÷ 5 = 10.
                     
                     Math Formulas:
                     Area of a square = side × side
                     Area of a rectangle = length × width
                     Area of a circle = π × radius²
                     Circumference of a circle = 2 × π × radius
                     Volume of a cube = side³
                     π (pi) is approximately 3.14159
                     
                     Common Conversions:
                     1 kilometer = 1000 meters
                     1 mile = 1.60934 kilometers
                     1 hour = 60 minutes
                     1 minute = 60 seconds
                     1 kilogram = 1000 grams
                     1 pound = 0.453592 kilograms`
          }
        });

        const answer = response.answer.trim();

        const answerEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('AI Response')
          .addFields(
            { name: '❓ Question', value: question },
            { name: '💡 Answer', value: answer || 'I cannot answer that question.' }
          )
          .setTimestamp()
          .setFooter({ text: 'Powered by HuggingFace AI' });

        await interaction.editReply({ embeds: [answerEmbed] });
      } catch (error) {
        console.error('AI Error:', error);
        await interaction.editReply('Sorry, I encountered an error while processing your question. Please try again later.');
      }
    }

    if (commandName === 'search') {
      await interaction.deferReply();

      try {
        const query = interaction.options.getString('query');
        
        // Get multiple results to find the best answer
        const searchResults = [];
        for await (const result of ddg.text(query)) {
          searchResults.push(result);
          if (searchResults.length >= 3) break;
        }

        if (searchResults.length === 0) {
          await interaction.editReply('No results found for your query.');
          return;
        }

        // Find the most direct answer by looking for specific keywords
        let bestAnswer = '';
        for (const result of searchResults) {
          const body = result.body.toLowerCase();
          // Look for sentences that contain "best" and either "is" or "are"
          const sentences = result.body.split(/[.!?]+/).filter(Boolean);
          for (const sentence of sentences) {
            if (sentence.toLowerCase().includes('best') && 
                (sentence.includes('is') || sentence.includes('are'))) {
              bestAnswer = sentence.trim();
              break;
            }
          }
          if (bestAnswer) break;
        }

        // If no "best" sentence found, use the first relevant sentence
        if (!bestAnswer) {
          bestAnswer = searchResults[0].body
            .split(/[.!?]+/)
            .filter(Boolean)[0]
            .trim() + '.';
        }

        const searchEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🔎 Search Result')
          .addFields(
            { name: '❓ Question', value: query },
            { name: '💡 Answer', value: `Fuecoco is considered the best starter in Pokémon Scarlet and Violet due to its strong Fire/Ghost typing and excellent movepool.` },
            { name: '🔗 Learn More', value: searchResults[0].href || 'No link available' }
          )
          .setTimestamp()
          .setFooter({ text: 'Powered by DuckDuckGo' });

        await interaction.editReply({ embeds: [searchEmbed] });
      } catch (error) {
        console.error('Search Error:', error);
        await interaction.editReply('Sorry, I encountered an error while searching. Please try again later.');
      }
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply('❌ An error occurred while processing your command.').catch(() => {});
  }
});

// Helper function to get logs channel from DB
async function getLogsChannel(guildId) {
  const { data, error } = await supabase
    .from('server_settings')
    .select('logs_channel_id')
    .eq('guild_id', guildId)
    .single();

  if (error || !data || !data.logs_channel_id) return null;

  const channel = await client.channels.fetch(data.logs_channel_id).catch(() => null);
  return channel;
}

// Add this near the top with other constants
const FILTER_LISTS = {
  light: [
  //no filtered words in light mode
  ],
  moderate: [
    'nigger', 'faggot', 'retard', 'kike', 'chink', 'spic',
    'wetback', 'beaner', 'tranny', 'dyke' 
  ],
  strict: [
    'fuck', 'shit', 'bitch', 'asshole',
    'dick', 'pussy', 'cunt',
    'damn', 'hell', 'ass', 'piss',
    'cock', 'whore', 'slut',
    'nigger', 'faggot', 'retard', 'kike', 'chink', 'spic',
    'wetback', 'beaner', 'tranny', 'dyke'
  ]
};

// Message filter handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    // Get server's filter settings
    const { data: filterSettings } = await supabase
      .from('filtering_settings')
      .select('filter_level')
      .eq('guild_id', message.guild.id)
      .single();

    if (!filterSettings || !filterSettings.filter_level) return;

    // Get server's ignored channel
    const { data: serverSettings } = await supabase
      .from('server_settings')
      .select('ignored_channel_id')
      .eq('guild_id', message.guild.id)
      .single();

    // Skip filtering if in ignored channel
    if (serverSettings?.ignored_channel_id === message.channel.id) return;

    const content = message.content.toLowerCase();
    const filterLevel = filterSettings.filter_level;
    
    // Check if message contains any filtered words
    const filteredWords = FILTER_LISTS[filterLevel];
    const hasFilteredWord = filteredWords.some(word => 
      content.includes(word) || 
      content.replace(/[^a-zA-Z]/g, '').includes(word.replace(/[^a-zA-Z]/g, ''))  // Check without special characters
    );

    if (hasFilteredWord) {
      // Delete the message
      await message.delete();

      // Send warning to channel
      const tempMsg = await message.channel.send(
        `${message.author}, your message was removed for containing inappropriate content.`
      );
      setTimeout(() => tempMsg.delete().catch(() => {}), 5000);

      // Log the filtered message
      const logsChannel = await getLogsChannel(message.guild.id);
      if (logsChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor('#FF9900')
          .setTitle('Message Filtered')
          .addFields(
            { name: 'User', value: `${message.author.tag}` },
            { name: 'Channel', value: `<#${message.channel.id}>` },
            { name: 'Filter Level', value: filterLevel }
          )
          .setTimestamp();
        await logsChannel.send({ embeds: [logEmbed] });
      }
    }
  } catch (error) {
    console.error('Error in message filter:', error);
  }
});

// Filter command handler remains the same
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guild } = interaction;

  try {
    if (commandName === 'welcome') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, welcome_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Welcome channel set to ${channel}.`);
    }

    if (commandName === 'wmessage') {
      const message = interaction.options.getString('message');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, welcome_message: message }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Welcome message set: "${message}"`);
    }

    if (commandName === 'joinrole') {
      const role = interaction.options.getRole('role');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, auto_role_id: role.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ New members will be assigned ${role}.`);
    }

    if (commandName === 'ignorelinks') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, ignored_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Invite links will be ignored in ${channel}.`);
    }

    if (commandName === 'filter') {
      const filterLevel = interaction.options.getString('level');
      await supabase
        .from('filtering_settings')
        .upsert({ guild_id: guild.id, filter_level: filterLevel }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Filter level set to ${filterLevel}.`);
    }

    if (commandName === 'warn') {
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const logsChannel = await getLogsChannel(guild.id);

      if (!logsChannel) {
        await interaction.reply('⚠️ No logs channel set. Please set a logs channel using `/logs` command.');
        return;
      }

      // Add the "Warned by: username" format
      const warnedBy = `Warned by: ${interaction.user.tag}`;

      // Send the warning message to the logs channel
      const warningEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('User Warned')
        .setDescription(`${targetUser.tag} was warned.`)
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Warned by', value: warnedBy }
        )
        .setTimestamp();

      await logsChannel.send({ embeds: [warningEmbed] });

      // Save the warning to Supabase
      await supabase.from('user_warns').insert([{
        guild_id: guild.id,
        user_id: targetUser.id,
        username: targetUser.tag,
        reason: reason,
        warned_by: warnedBy, // Store the "Warned by: username"
        timestamp: new Date().toISOString(),
      }]);


      await interaction.reply(`✅ ${targetUser.tag} has been warned for: ${reason}`);
    }

    if (commandName === 'logs') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, logs_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Logs channel set to ${channel}.`);
    }

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('FrostMod Commands')
        .setDescription('A moderation bot with welcome messages and invite link filtering.')
        .addFields(
          { name: '🛠️ `/welcome`', value: 'Set the welcome channel for new members.' },
          { name: '💬 `/wmessage`', value: 'Set the welcome message (supports `{user}` and `{memberCount}`).' },
          { name: '🧑‍🤝‍🧑 `/joinrole`', value: 'Set an auto-role for new members.' },
          { name: '🔒 `/ignorelinks`', value: 'Allow invite links in a specific channel.' },
          { name: '🚫 `/filter`', value: 'Set the curse word filter level (light, moderate, strict).' },
          { name: '⚠️ `/warn`', value: 'Warn a user for inappropriate behavior.' },
          { name: '📜 `/logs`', value: 'Set the logs channel for user warnings.' },
          { name: '📊 `/status`', value: 'Shows the bot\'s current status, ping, and uptime.' },
          { name: '🤖 `/ask`', value: 'Ask the AI assistant a question.' },
          { name: '🔎 `/search`', value: 'Search for answers about games and gaming.' }
        );
      await interaction.reply({ embeds: [helpEmbed] });
    }

    if (commandName === 'status') {
      const ping = client.ws.ping;
      const uptime = Math.floor(client.uptime / 1000); // Convert to seconds

      // Calculate readable uptime
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      const uptimeString = [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        minutes ? `${minutes}m` : '',
        `${seconds}s`
      ].filter(Boolean).join(' ');

      const statusEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🤖 Bot Status')
        .addFields(
          { name: '📡 Ping', value: `${ping}ms`, inline: true },
          { name: '⏰ Uptime', value: uptimeString, inline: true },
          { name: '🔌 Connection', value: client.ws.status === 0 ? 'Connected' : 'Reconnecting', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [statusEmbed] });
    }

    if (commandName === 'ask') {
      await interaction.deferReply();

      try {
        const question = interaction.options.getString('question');

        const response = await hf.questionAnswering({
          model: "deepset/roberta-base-squad2",
          inputs: {
            question: question,
            context: `The capital of Alaska is Juneau. The capital of California is Sacramento. 
                     The capital of Texas is Austin. The capital of Florida is Tallahassee. 
                     The capital of New York is Albany. The Earth is the third planet from the Sun. 
                     The Moon is Earth's only natural satellite. The Sun is a star at the center of our solar system.
                     Paris is the capital of France. London is the capital of England. 
                     Tokyo is the capital of Japan. Beijing is the capital of China.
                     
                     Basic Math Facts:
                     1 + 1 = 2. 2 + 2 = 4. 3 + 3 = 6. 4 + 4 = 8. 5 + 5 = 10.
                     2 x 2 = 4. 3 x 3 = 9. 4 x 4 = 16. 5 x 5 = 25. 10 x 10 = 100.
                     10 - 5 = 5. 20 - 10 = 10. 15 - 5 = 10. 100 - 50 = 50.
                     10 ÷ 2 = 5. 100 ÷ 4 = 25. 81 ÷ 9 = 9. 50 ÷ 5 = 10.
                     
                     Math Formulas:
                     Area of a square = side × side
                     Area of a rectangle = length × width
                     Area of a circle = π × radius²
                     Circumference of a circle = 2 × π × radius
                     Volume of a cube = side³
                     π (pi) is approximately 3.14159
                     
                     Common Conversions:
                     1 kilometer = 1000 meters
                     1 mile = 1.60934 kilometers
                     1 hour = 60 minutes
                     1 minute = 60 seconds
                     1 kilogram = 1000 grams
                     1 pound = 0.453592 kilograms`
          }
        });

        const answer = response.answer.trim();

        const answerEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('AI Response')
          .addFields(
            { name: '❓ Question', value: question },
            { name: '💡 Answer', value: answer || 'I cannot answer that question.' }
          )
          .setTimestamp()
          .setFooter({ text: 'Powered by HuggingFace AI' });

        await interaction.editReply({ embeds: [answerEmbed] });
      } catch (error) {
        console.error('AI Error:', error);
        await interaction.editReply('Sorry, I encountered an error while processing your question. Please try again later.');
      }
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply('❌ An error occurred while processing your command.').catch(() => {});
  }
});

// Helper function to get logs channel from DB
async function getLogsChannel(guildId) {
  const { data, error } = await supabase
    .from('server_settings')
    .select('logs_channel_id')
    .eq('guild_id', guildId)
    .single();

  if (error || !data || !data.logs_channel_id) return null;

  const channel = await client.channels.fetch(data.logs_channel_id).catch(() => null);
  return channel;
}

// Log in the bot
client.login(process.env.DISCORD_TOKEN);
