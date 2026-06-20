import * as cheerio from "cheerio";
export function loadHtml(content) {
    return cheerio.load(content.replace(/^\uFEFF/, ""));
}
//# sourceMappingURL=html.js.map