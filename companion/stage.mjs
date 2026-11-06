import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir(new URL('lib/', import.meta.url), { recursive: true });
await mkdir(new URL('resources/', import.meta.url), { recursive: true });
await copyFile(new URL('../uploader/tome-uploader.mjs', import.meta.url), new URL('lib/tome-uploader.mjs', import.meta.url));
await cp(new URL('../addon/TomeSnapshot/', import.meta.url), new URL('resources/TomeSnapshot/', import.meta.url), { recursive: true });
await copyFile(new URL('../assets/tome-spellbook-avatar-circle.png', import.meta.url), new URL('resources/book.png', import.meta.url));
