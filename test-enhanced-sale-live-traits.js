import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

// ENV (same as your main bot)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

// TEST NFT (change anytime)
const CONTRACT = "0xcb124cf226f045fa49b1793031c79da517387f7f";
const TOKEN_ID = "1385"; // your test NFT

// MOCK SALE DATA
const SALE_PRICE = 0.002;
const SYMBOL = "WETH";

async function getNftData() {
  const res = await axios.get(
    `https://api.opensea.io/api/v2/chain/polygon/contract/${CONTRACT}/nfts/${TOKEN_ID}`,
    {
      headers: { "x-api-key": OPENSEA_API_KEY },
    }
  );
  return res.data.nft;
}

async function getCollectionStats(slug) {
  const res = await axios.get(
    `https://api.opensea.io/api/v2/collections/${slug}/stats`,
    {
      headers: { "x-api-key": OPENSEA_API_KEY },
    }
  );
  return res.data.total;
}

async function getUsdRate(symbol) {
  const map = {
    WETH: "ethereum",
    ETH: "ethereum",
    POL: "polygon-ecosystem-token",
    MATIC: "matic-network",
  };

  const id = map[symbol] || "ethereum";

  const res = await axios.get(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );

  return res.data[id].usd;
}

function formatNumber(n, d = 2) {
  return n.toFixed(d);
}

function getRareTraits(nft, totalSupply) {
  if (!nft.traits) return [];

  return nft.traits
    .map((t) => {
      const count = t.trait_count || t.count || 0;
      const pct = (count / totalSupply) * 100;

      return {
        type: t.trait_type,
        value: t.value,
        count,
        pct,
      };
    })
    .filter((t) => t.pct <= 10.5)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);
}

function formatTraits(traits) {
  if (!traits.length) return "";

  return `

🧬 <b>Rare Traits:</b>
${traits
  .map(
    (t) =>
      `${t.type}: ${t.value} — ${t.count} (${t.pct.toFixed(2)}%)`
  )
  .join("\n")}`;
}

async function run() {
  console.log("Running enhanced test...");

  const nft = await getNftData();
  const stats = await getCollectionStats("neanderbros");

  const usdRate = await getUsdRate(SYMBOL);

  const saleUsd = SALE_PRICE * usdRate;
  const floor = stats.floor_price;
  const floorUsd = floor * usdRate;

  const pct = ((saleUsd - floorUsd) / floorUsd) * 100;

  const imageUrl =
    nft.image_url ||
    nft.display_image_url ||
    nft.image_original_url;

  const rank =
    nft?.rarity?.rank ||
    nft?.rarity_rank ||
    "";

  const traits = getRareTraits(nft, stats.total_supply);

  const caption = `🔥 <b>TEST NEANDERBROS SALE!</b>

<b>NeanderBro #${TOKEN_ID}</b> just sold on OpenSea

💰 <b>Sale:</b> ${SALE_PRICE} ${SYMBOL}
💵 <b>USD:</b> ~$${formatNumber(saleUsd)}

🏷 <b>Floor:</b> ${formatNumber(floor, 4)} ${SYMBOL}
📈 <b>Above Floor:</b> ${pct.toFixed(2)}%

🏆 <b>Rank:</b> #${rank}${formatTraits(traits)}

<a href="https://opensea.io/item/polygon/${CONTRACT}/${TOKEN_ID}">🔗 View NFT</a>`;

  console.log("Downloading image...");

  const img = await axios.get(imageUrl, {
    responseType: "arraybuffer",
  });

  const pngBuffer = await sharp(Buffer.from(img.data))
    .png()
    .toBuffer();

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", pngBuffer, {
    filename: "nft.png",
    contentType: "image/png",
  });
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
    form,
    { headers: form.getHeaders() }
  );

  console.log("✅ TEST SENT");
}

run().catch((err) => {
  console.error("❌ ERROR:", err.response?.data || err.message);
});
