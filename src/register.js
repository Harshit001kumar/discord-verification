const { REST, Routes } = require('discord.js');
const config = require('./config');
const { commandDefs } = require('./commands');

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);

  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commandDefs }
  );

  console.log(`Registered ${commandDefs.length} guild commands.`);
}

module.exports = {
  registerCommands
};
