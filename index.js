import { OpenSeaStreamClient } from "@opensea/stream-js";
import WebSocket from "ws";
import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

const RARE_TRAIT_THRESHOLD = 10.5;
const MAX_RARE_TRAITS = 5;
const SEEN_SALES = new Set();

const COLLECTIONS = {
  [process.env.NEANDERBROS_SLUG]: {
    name: "NeanderBros",
    headline: "🔥 <b>NEANDERBROS SALE!</b>",
    tokenLabel: "NeanderBro",
  },
  [process.env.NEANDERGALS_SLUG]: {
    name: "NeanderGals",
    headline: "💎 <b>NEANDERGALS SALE!</b>",
    tokenLabel: "NeanderGal",
  },
};

[
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "OPENSEA_API_KEY",
  "NEANDERBROS_SLUG",
  "NEANDERGALS_SLUG",
].forEach((name) => {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
});

function getPayload(event) {
  return event?.payload || event;
}

function getTokenInfo(payload) {
  const nftId = payload?.item?.nft_id || "";
  const parts = nftId.split("/");

  return {
    contract: parts[1] || payload?.item?.contract_address || "",
    tokenId: parts[2] || parts.pop() || "",
  };
}

function getPrice(payload) {
  const raw = Number(payload?.sale_price || 0);
  const decimals = Number(payload?.payment_token?.decimals || 18);
  const symbol = payload?.payment_token?.symbol || "POL";
  const value = raw / Math.pow(10, decimals);

  return { value, symbol, raw };
}

function getSaleKey(payload, contract, tokenId, rawPrice) {
  const txHash =
    payload?.transaction?.transaction_hash ||
    payload?.transaction?.hash ||
    payload?.transaction_hash ||
    "";

  return txHash || `${contract}-${tokenId}-${rawPrice}`;
}

function isDuplicateSale(key) {
  if (SEEN_SALES.has(key)) return true;

  SEEN_SALES.add(key);

  setTimeout(() => {
    SEEN_SALES.delete(key);
  }, 1000 * 60 * 60 * 6);

  return false;
}

function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return "N/A";

  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatFloorStatus(saleUsd, floorUsd) {
  if (!floorUsd || floorUsd <= 0) return "📊 <b>Floor Status:</b> N/A";

  const pct = ((saleUsd - floorUsd) / floorUsd) * 100;

  if (Math.abs(pct) < 0.01) return "➖ <b>At Floor</b>";
  if (pct > 0) return `📈 <b>Above Floor:</b> ${formatPercent(pct)}`;
  return `📉 <b>Below Floor:</b> ${formatPercent(pct)}`;
}

async function getNftData(contract, tokenId) {
  const res = await axios.get(
    `https://api.opensea.io/api/v2/chain/polygon/contract/${contract}/nfts/${tokenId}`,
    {
      headers: { "x-api-key": OPENSEA_API_KEY },
      timeout: 30000,
    }
  );

  return res.data?.nft || {};
}

async function getCollectionStats(slug) {
  try {
    const res = await axios.get(
      `https://api.opensea.io/api/v2/collections/${slug}/stats`,
      {
        headers: { "x-api-key": OPENSEA_API_KEY },
        timeout: 30000,
      }
    );

    return {
      floorPrice: Number(res.data?.total?.floor_price || 0),
      totalSupply: Number(res.data?.total?.total_supply || 0),
    };
  } catch (err) {
    console.error("Collection stats failed:", err.response?.data || err.message);
    return { floorPrice: 0, totalSupply: 0 };
  }
}

async function getUsdRate(symbol) {
  const normalized = String(symbol || "").toUpperCase();

  const idsBySymbol = {
    POL: "polygon-ecosystem-token,matic-network",
    MATIC: "matic-network,polygon-ecosystem-token",
    WETH: "weth",
    ETH: "ethereum",
    USDC: "usd-coin",
    USDT: "tether",
  };

  const ids = idsBySymbol[normalized] || "polygon-ecosystem-token,matic-network";

  try {
    const res = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { timeout: 30000 }
    );

    for (const id of ids.split(",")) {
      const price = Number(res.data?.[id]?.usd || 0);
      if (price) return price;
    }

    return 0;
  } catch (err) {
    console.error(`${symbol}/USD fetch failed:`, err.response?.data || err.message);
    return 0;
  }
}

function getRank(nft) {
  const candidates = [
    nft?.rarity?.rank,
    nft?.rarity_rank,
    nft?.rank,
    nft?.openrarity?.rank,
    nft?.open_rarity?.rank,
  ];

  const rank = candidates.find((v) => v !== undefined && v !== null && v !== "");
  return rank ? String(rank) : "";
}

function getTraitFields(trait) {
  const type =
    trait?.trait_type ||
    trait?.traitType ||
    trait?.type ||
    trait?.trait_key ||
    trait?.key ||
    "";

  const value =
    trait?.value ||
    trait?.trait_value ||
    trait?.traitValue ||
    trait?.display_value ||
    "";

  const count = Number(
    trait?.count ||
      trait?.trait_count ||
      trait?.traitCount ||
      trait?.value_count ||
      trait?.valueCount ||
      0
  );

  return { type, value, count };
}

function getRareTraits(nft, totalSupply) {
  const traits = Array.isArray(nft?.traits) ? nft.traits : [];

  return traits
    .map((trait) => {
      const { type, value, count } = getTraitFields(trait);

      if (!type || !value || !count || !totalSupply) return null;

      const pct = (count / totalSupply) * 100;

      return { type, value, count, pct };
    })
    .filter(Boolean)
    .filter((trait) => trait.pct <= RARE_TRAIT_THRESHOLD)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, MAX_RARE_TRAITS);
}

function formatRareTraits(traits) {
  if (!traits.length) return "";

  return `

🧬 <b>Rare Traits:</b>
${traits.map((t) => `${t.type}: ${t.value} — ${t.count} (${t.pct.toFixed(2)}%)`).join("\n")}`;
}

function getImageUrl(nft) {
  return (
    nft?.image_url ||
    nft?.display_image_url ||
    nft?.image_original_url ||
    nft?.metadata?.image_url ||
    nft?.metadata?.image ||
    ""
  );
}

async function sendText(caption) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: caption,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function sendPhoto(imageUrl, caption) {
  if (!imageUrl) throw new Error("No image URL available");

  console.log("Downloading NFT image:", imageUrl);

  const img = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "image/*,*/*;q=0.8",
    },
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
}

async function handleSale(slug, event) {
  const config = COLLECTIONS[slug];
  if (!config) return;

  const payload = getPayload(event);
  const { contract, tokenId } = getTokenInfo(payload);
  const { value: salePrice, symbol, raw: rawPrice } = getPrice(payload);

  const saleKey = getSaleKey(payload, contract, tokenId, rawPrice);
  if (isDuplicateSale(saleKey)) {
    console.log(`Duplicate sale skipped: ${saleKey}`);
    return;
  }

  const [nft, stats, saleUsdRate] = await Promise.all([
    getNftData(contract, tokenId).catch((err) => {
      console.error("NFT data failed:", err.response?.data || err.message);
      return {};
    }),
    getCollectionStats(slug),
    getUsdRate(symbol),
  ]);

  const floorSymbol = symbol;
  const floorUsdRate = await getUsdRate(floorSymbol);

  const saleUsd = saleUsdRate ? salePrice * saleUsdRate : 0;
  const floorUsd = floorUsdRate && stats.floorPrice ? stats.floorPrice * floorUsdRate : 0;

  const imageUrl = getImageUrl(nft);
  const rank = getRank(nft);
  const rareTraits = getRareTraits(nft, stats.totalSupply);

  const nftUrl = `https://opensea.io/item/polygon/${contract}/${tokenId}`;

  const txHash =
    payload?.transaction?.transaction_hash ||
    payload?.transaction?.hash ||
    payload?.transaction_hash ||
    "";

  const txUrl = txHash ? `https://polygonscan.com/tx/${txHash}` : "";

  const usdLine = saleUsd ? `\n💵 <b>USD:</b> ~$${formatNumber(saleUsd, 2)}` : "";
  const rankLine = rank ? `\n🏆 <b>Rank:</b> #${rank}` : "";
  const floorLine = stats.floorPrice
    ? `🏷 <b>Floor:</b> ${formatNumber(stats.floorPrice, 4)} ${floorSymbol}`
    : "🏷 <b>Floor:</b> N/A";
  const txLine = txUrl ? `\n<a href="${txUrl}">🧾 View Tx</a>` : "";

  const caption = `${config.headline}

<b>${config.tokenLabel} #${tokenId}</b> just sold on OpenSea

💰 <b>Sale:</b> ${formatNumber(salePrice, 4)} ${symbol}${usdLine}
${floorLine}
${formatFloorStatus(saleUsd, floorUsd)}${rankLine}${formatRareTraits(rareTraits)}

<a href="${nftUrl}">🔗 View NFT on OpenSea</a>${txLine}`;

  try {
    await sendPhoto(imageUrl, caption);
    console.log(`Posted photo sale: ${config.name} #${tokenId} for ${salePrice} ${symbol}`);
  } catch (err) {
    console.error("Photo failed, sending text fallback:", err.response?.data || err.message);
    await sendText(caption);
    console.log(`Posted text sale: ${config.name} #${tokenId} for ${salePrice} ${symbol}`);
  }
}

const client = new OpenSeaStreamClient({
  token: OPENSEA_API_KEY,
  connectOptions: {
    transport: WebSocket,
  },
});

console.log("🚀 Listening for OpenSea sales...");

Object.keys(COLLECTIONS).forEach((slug) => {
  console.log(`Subscribing to collection: ${slug}`);

  client.onItemSold(slug, async (event) => {
    try {
      await handleSale(slug, event);
    } catch (err) {
      console.error("Error:", err.response?.data || err.message);
    }
  });
});
