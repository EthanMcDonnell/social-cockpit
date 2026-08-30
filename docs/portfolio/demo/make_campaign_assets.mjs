/**
 * Generate the original, local visual fixtures used by the portfolio demo.
 *
 * They are deliberately editorial illustrations rather than faux screenshots or
 * borrowed photography: every subject is fictional, offline, and safe to ship
 * with the repository. Run with `node docs/portfolio/demo/make_campaign_assets.mjs`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "assets/campaign");
mkdirSync(root, { recursive: true });

const covers = [
  ["portrait-sun", "portrait", "#F6B8A4", "#DC5D63", "#422748"],
  ["city-blue", "city", "#8DA6D8", "#253962", "#F3D3A1"],
  ["material-table", "process", "#D8C98F", "#A86558", "#31504D"],
  ["product-fold", "object", "#F2D3C2", "#9B5E73", "#343A62"],
  ["studio-light", "process", "#E7D7B5", "#556B8E", "#DC765E"],
  ["city-walk", "city", "#B3C7B5", "#426062", "#F0A36A"],
  ["editorial-kept", "editorial", "#F1A575", "#815C91", "#263849"],
  ["portrait-red", "portrait", "#E98378", "#9B3349", "#E9D7C0"],
  ["process-paper", "process", "#D8E1DA", "#5F8290", "#CE735B"],
  ["product-shadow", "object", "#C2B5A9", "#5B526A", "#E5A55D"],
  ["city-coffee", "city", "#D9B987", "#7A4D43", "#4A6673"],
  ["editorial-colour", "editorial", "#8BB7A5", "#406070", "#E89070"],
  ["people-rain", "portrait", "#7089A4", "#343C65", "#F2B687"],
  ["product-detail", "object", "#D5C4B2", "#8A4C56", "#516D67"],
  ["process-print", "process", "#B9B7CF", "#584E75", "#E0A75C"],
  ["city-night", "city", "#5D6E9D", "#252E4C", "#D88574"],
  ["editorial-notes", "editorial", "#D3C485", "#8D7047", "#667B70"],
  ["portrait-window", "portrait", "#C9D9DA", "#557D86", "#E9A276"],
];

function shapes(kind, a, b, c, n) {
  const shift = (n * 37) % 86;
  if (kind === "portrait") return `
    <rect x="55" y="42" width="278" height="636" rx="139" fill="${b}" opacity=".22"/>
    <path d="M0 580C118 510 193 525 292 454C391 384 521 420 720 364V720H0Z" fill="${c}" opacity=".72"/>
    <ellipse cx="${370 + shift}" cy="273" rx="106" ry="132" fill="#EBC1A3"/>
    <path d="M${280 + shift} 275C274 161 337 105 423 129C498 151 509 225 483 313C444 248 376 227 ${280 + shift} 275Z" fill="${c}"/>
    <path d="M${266 + shift} 383C335 345 432 351 498 397L543 720H208Z" fill="${b}"/>
    <path d="M120 112H219V534H120Z" fill="${a}" opacity=".54"/>
    <path d="M142 145H198M142 171H198M142 197H198" stroke="#fff" opacity=".52" stroke-width="5"/>
  `;
  if (kind === "city") return `
    <circle cx="570" cy="156" r="90" fill="${a}" opacity=".85"/>
    <path d="M0 455L128 349L216 400L335 254L430 358L557 193L720 322V720H0Z" fill="${c}" opacity=".94"/>
    <path d="M0 532L144 449L280 535L403 397L555 491L720 365V720H0Z" fill="${b}" opacity=".82"/>
    <path d="M90 720L211 314H283L327 720ZM386 720L59${shift} 286H${668 + (shift % 24)}L720 720Z" fill="#14243B" opacity=".48"/>
    <path d="M0 584L720 477" stroke="${a}" stroke-width="16" opacity=".7"/>
  `;
  if (kind === "object") return `
    <ellipse cx="355" cy="602" rx="263" ry="65" fill="#141C35" opacity=".26"/>
    <path d="M194 263L450 176L575 292L318 386Z" fill="${a}"/>
    <path d="M194 263L318 386V580L194 450Z" fill="${c}"/>
    <path d="M318 386L575 292V487L318 580Z" fill="${b}"/>
    <path d="M353 298L470 257L521 289L405 331Z" fill="#FFF4DF" opacity=".78"/>
    <path d="M318 386V580" stroke="#FFF4DF" stroke-width="7" opacity=".3"/>
    <circle cx="102" cy="142" r="48" fill="${c}" opacity=".7"/>
  `;
  if (kind === "process") return `
    <path d="M91 96H542L627 572H176Z" fill="#FAF5E9" transform="rotate(${-8 + (n % 3) * 4} 360 360)"/>
    <path d="M133 177H489M148 227H532M163 277H448" stroke="${b}" stroke-width="12" opacity=".66"/>
    <path d="M372 386C478 324 557 378 629 509C543 571 463 590 360 533Z" fill="${c}"/>
    <path d="M0 540C145 462 219 474 311 598C205 680 98 694 0 662Z" fill="${a}" opacity=".86"/>
    <circle cx="517" cy="168" r="58" fill="${a}"/>
    <path d="M183 401L326 329L363 405L220 477Z" fill="${b}" opacity=".86"/>
  `;
  return `
    <rect x="64" y="64" width="592" height="592" rx="44" fill="${c}" opacity=".84"/>
    <circle cx="212" cy="238" r="118" fill="${a}"/>
    <circle cx="510" cy="474" r="151" fill="${b}"/>
    <path d="M116 521C264 350 424 282 632 198" fill="none" stroke="#FFF4DF" stroke-width="20" opacity=".76"/>
    <path d="M111 559C296 440 469 425 619 498" fill="none" stroke="#FFF4DF" stroke-width="8" opacity=".68"/>
    <rect x="162" y="334" width="338" height="74" rx="37" fill="#FFF4DF" opacity=".82"/>
    <rect x="202" y="358" width="202" height="12" rx="6" fill="${c}" opacity=".75"/>
  `;
}

function cover([key, kind, a, b, c], index) {
  const id = `g${index}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" role="img" aria-label="Original editorial campaign illustration">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <filter id="noise${index}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${index + 11}"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .06 0"/></filter>
  </defs>
  <rect width="720" height="720" fill="url(#${id})"/>
  ${shapes(kind, a, b, c, index)}
  <rect width="720" height="720" fill="#1B2334" filter="url(#noise${index})" opacity=".35"/>
  <rect x="22" y="22" width="676" height="676" rx="10" fill="none" stroke="#FFF8ED" stroke-width="2" opacity=".44"/>
</svg>`;
}

for (const spec of covers) writeFileSync(resolve(root, `${spec[0]}.svg`), cover(spec, covers.indexOf(spec)));
console.log(`wrote ${covers.length} original campaign covers to ${root}`);
