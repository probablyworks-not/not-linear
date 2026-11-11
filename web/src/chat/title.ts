import { cleanThreadTitle } from '../db/thread-ops';

/** app.js:1228 titleFromPrompt. */
export function titleFromPrompt(text: string): string {
  let title = cleanThreadTitle(text)
    .replace(/[.?!]+$/g, '')
    .replace(/^(i\s+)?(want|wanna|need|would like)\s+(to\s+)?(understand|learn about|research|explore|know about)\s+/i, '')
    .replace(/^help me\s+(understand|research|explore|with)\s+/i, '');
  title = cleanThreadTitle(title);
  return title.length > 64 ? title.slice(0, 63).trim() + '…' : title;
}
