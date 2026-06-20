import * as cheerio from "cheerio";

export function loadHtml(content: string): cheerio.CheerioAPI {
  return cheerio.load(content.replace(/^\uFEFF/, ""));
}
