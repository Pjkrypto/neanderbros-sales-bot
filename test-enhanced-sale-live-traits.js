import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

const CONTRACT = "0xcb124cf226f045fa49b1793031c79da517387f7f";
const TOKEN_ID = "1385";

const COLLECTION_SLUG = "neanderbros";
const COLLECTION_LABEL = "NeanderBro";

const SALE_PRICE = 0.002;
const SYMBOL = "WETH";

const RARE_TRAIT_THRESHOLD = 15;
const MAX_RARE_TRAITS = 5;

function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return "N/A";

  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatFloorStatus(saleUsd, floorUsd) {
  if (!floorUsd || floorUsd <= 0) return "📊 <b>Floor Status:</b> N/A";

  const pct = ((saleUsd - floorUsd) / floorUsd) * 100;

  if (Math.abs(pct) < 0.01) return "➖ <b>At Floor</b>";
  if (pct > 0) return `📈 <b>Above Floor:</b> +${pct.toFixed(2)}%`;
  return `📉 <b>Below Floor:</b> ${pct.toFixed(2)}%`;
}

async function getNftData() {
  const res = await axios.get(
    `https://api.opensea.io/api/v2/chain/polygon/contract/${CONTRACT}/nfts/${TOKEN_ID}`,
    {
      headers: { "x-api-key": OPENSEA_API_KEY },
      timeout: 30000,
    }
  );

  return res.data.nft;
}

async function getCollectionStats() {
  const res = await axios.get(
    `https://api.opensea.io/api/v2/collections/${COLLECTION_SLUG}/stats`,
    {
      headers: { "x-api-key": OPENSEA_API_KEY },
      timeout: 30000,
    }
  );

  return res.data.total;
}

async function getUsdRate(symbol) {
  const idsBySymbol = {
    WETH: "weth,ethereum",
    ETH: "ethereum",
    POL: "polygon-ecosystem-token,matic-network",
    MATIC: "matic-network,polygon-ecosystem-token",
    USDC: "usd-coin",
    USDT: "tether",
  };

  const ids = idsBySymbol[String(symbol).toUpperCase()] || "ethereum";

  const res = await axios.get(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    { timeout: 30000 }
  );

  for (const id of ids.split(",")) {
    const price = Number(res.data?.[id]?.usd || 0);
    if (price) return price;
  }

  return 0;
}

function getRank(nft) {
  const rank =
    nft?.rarity?.rank ||
    nft?.rarity_rank ||
    nft?.rank ||
    nft?.openrarity?.rank ||
    nft?.open_rarity?.rank ||
    "";

  return rank ? String(rank) : "";
}

function getTraitFields(trait) {
  return {
    type:
      trait?.trait_type ||
      trait?.traitType ||
      trait?.type ||
      trait?.trait_key ||
      trait?.key ||
      "",
    value:
      trait?.value ||
      trait?.trait_value ||
      trait?.traitValue ||
      trait?.display_value ||
      "",
    count: Number(
      trait?.count ||
        trait?.trait_count ||
        trait?.traitCount ||
        trait?.value_count ||
        trait?.valueCount ||
        0
    ),
  };
}

function getRareTraits(nft, totalSupply) {
  const traits = Array.isArray(nft?.traits) ? nft.traits : [];

  const allTraits = traits
    .map((trait) => {
      const { type, value, count } = getTraitFields(trait);
      if (!type || !value || !count || !totalSupply) return null;

      return {
        type,
        value,
        count,
        pct: (count / totalSupply) * 100,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pct - b.pct);

  const rareTraits = allTraits.filter((trait) => trait.pct <= RARE_TRAIT_THRESHOLD);

  if (rareTraits.length) {
    return rareTraits.slice(0, MAX_RARE_TRAITS);
  }

  return allTraits.slice(0, 3);
}

function formatTraits(traits) {
  if (!traits.length) return "";

  return `

🧬 <b>Top Traits:</b>
${traits
  .map((t) => `${t.type}: ${t.value} — ${t.count} (${t.pct.toFixed(2)}%)`)
  .join("\n")}`;
}

async function run() {
  console.log("Running enhanced live trait test...");

  const [nft, stats, usdRate] = await Promise.all([
    getNftData(),
    getCollectionStats(),
    getUsdRate(SYMBOL),
  ]);

  const totalSupply = Number(stats?.total_supply || stats?.count || 0);
  const floorPrice = Number(stats?.floor_price || 0);

  const saleUsd = SALE_PRICE * usdRate;
  const floorUsd = floorPrice * usdRate;

  const imageUrl =
    nft?.image_url ||
    nft?.display_image_url ||
    nft?.image_original_url ||
    "";

  const rank = getRank(nft);
  const traits = getRareTraits(nft, totalSupply);

  const nftUrl = `https://opensea.io/item/polygon/${CONTRACT}/${TOKEN_ID}`;
  const txUrl =
    "https://polygonscan.com/tx/0x0000000000000000000000000000000000000000000000000000000000000000";

  const rankLine = rank ? `\n🏆 <b>Rank:</b> #${rank}` : "";

  const caption = `🔥 <b>TEST NEANDERBROS SALE!</b>

<b>${COLLECTION_LABEL} #${TOKEN_ID}</b> just sold on OpenSea

💰 <b>Sale:</b> ${formatNumber(SALE_PRICE, 4)} ${SYMBOL}
💵 <b>USD:</b> ~$${formatNumber(saleUsd, 2)}

🏷 <b>Floor:</b> ${formatNumber(floorPrice, 4)} ${SYMBOL}
${formatFloorStatus(saleUsd, floorUsd)}${rankLine}${formatTraits(traits)}

<a href="${nftUrl}">🔗 View NFT on OpenSea</a>
<a href="${txUrl}">🧾 View Tx</a>`;

  console.log("Image URL:", imageUrl);
  console.log("Total supply:", totalSupply);
  console.log("Rank:", rank || "N/A");
  console.log("Traits:", traits);

  const img = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const pngBuffer = await sharp(Buffer.from(img.data)).png().toBuffer();

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", pngBuffer, {
    filename: "nft.png",
    contentType: "image/png",
  });
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });

  console.log("Enhanced live trait test sent");
}

run().catch((err) => {
  console.error("ERROR:", err.response?.data || err.message);
});
