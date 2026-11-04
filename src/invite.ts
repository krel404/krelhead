import { inviteUrl, required } from './config.js';

console.log(inviteUrl(required('DISCORD_APPLICATION_ID')));
