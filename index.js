import { OpenSeaStreamClient } from "@opensea/stream-js";
import WebSocket from "ws";
import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

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

function getPayload(event) {
  return event?.payload || event;
}

function getTokenInfo(payload) {
  const nftId = payload?.item?.nft_id || "";
  const parts = nftId.split("/");

  return {
    contract: parts[1] || payload?.item?.contract_address,
    tokenId: parts[2] || parts.pop(),
  };
}

async function getBestImage(contract, tokenId) {
  try {
    const res = await axios.get(
      `https://api.opensea.io/api/v2/chain/polygon/contract/${contract}/nfts/${tokenId}`,
      { headers: { "x-api-key": OPENSEA_API_KEY } }
    );

    return (
      res.data?.nft?.image_url ||
      res.data?.nft?.display_image_url ||
      ""
    );
  } catch {
    return "";
  }
}

async function getFloor(slug) {
  try {
    const res = await axios.get(
      `https://api.opensea.io/api/v2/collections/${slug}/stats`,
      { headers: { "x-api-key": OPENSEA_API_KEY } }
    );

    return res.data?.total?.floor_price || 0;
  } catch {
    return 0;
  }
}

function getPrice(payload) {
  const raw = Number(payload?.sale_price || 0);
  const decimals = payload?.payment_token?.decimals || 18;
  const symbol = payload?.payment_token?.symbol || "POL";

  return {
    value: raw / Math.pow(10, decimals),
    symbol,
  };
}

function formatPct(diff, floor) {
  if (!floor) return "N/A";

  const pct = ((diff / floor) * 100).toFixed(2);

  if (pct > 0) return `📈 +${pct}% Above Floor`;
  if (pct < 0) return `📉 ${pct}% Below Floor`;
  return "➖ At Floor";
}

async function sendPhoto(imageUrl, caption) {
  const img = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    headers: { "User-Agent": "Mozilla/5.0" }
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
}

async function sendText(caption) {
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text: caption,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }
  );
}

async function handleSale(slug, event) {
  const config = COLLECTIONS[slug];
  if (!config) return;

  const payload = getPayload(event);
  const { contract, tokenId } = getTokenInfo(payload);

  const priceData = getPrice(payload);
  const floor = await getFloor(slug);

  const diff = priceData.value - floor;

  const imageUrl = await getBestImage(contract, tokenId);

  const nftUrl = `https://opensea.io/item/polygon/${contract}/${tokenId}`;
  const txHash = payload?.transaction?.transaction_hash;
  const saleUrl = txHash
    ? `https://polygonscan.com/tx/${txHash}`
    : nftUrl;

  const caption = `${config.headline}

<b>${config.tokenLabel} #${tokenId}</b> just sold on OpenSea

💰 <b>Sale:</b> ${priceData.value.toFixed(2)} ${priceData.symbol}
🏷 <b>Floor:</b> ${floor.toFixed(2)} ${priceData.symbol}
${formatPct(diff, floor)}

<a href="${nftUrl}">🔗 View NFT</a>
<a href="${saleUrl}">🧾 View Sale</a>`;

  try {
    await sendPhoto(imageUrl, caption);
    console.log("Posted sale with image");
  } catch (err) {
    console.log("Image failed, sending text fallback");
    await sendText(caption);
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
