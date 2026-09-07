import en from '../content/en.json';
import hi from '../content/hi.json';
import es from '../content/es.json';
import pt from '../content/pt-br.json';
import fr from '../content/fr.json';
import de from '../content/de.json';
import id from '../content/id.json';
import ar from '../content/ar.json';
import ja from '../content/ja.json';
import zh from '../content/zh-cn.json';
import type { Locale } from './locales';
export type Copy = typeof en;
export const content: Record<Locale, Copy> = {
  en,
  hi,
  es,
  'pt-br': pt,
  fr,
  de,
  id,
  ar,
  ja,
  'zh-cn': zh,
};
