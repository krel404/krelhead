export function inviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=309237763072`;
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill in your Discord application settings.`);
  return value;
}
