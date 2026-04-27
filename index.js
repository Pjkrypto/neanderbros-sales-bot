import { OpenSeaStreamClient } from "@opensea/stream-js";
import WebSocket from "ws";
import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

function required(name) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

[
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "OPENSEA_API_KEY",
  "NEANDERBROS_SLUG",
  "NEANDERGALS_SLUG",
].forEach(required);

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

function getImageUrl(payload) {
  return (
    payload?.item?.metadata?.image_url ||
    payload?.item?.metadata?.image ||
    payload?.item?.image_url ||
    payload?.item?.display_image_url ||
    ""
  );
}

function getPrice(payload) {
  const raw = Number(payload?.sale_price || 0);
  const decimals = Number(payload?.payment_token?.decimals || 18);
  const symbol = payload?.payment_token?.symbol || "POL";
  const value = raw / Math.pow(10, decimals);

  return {
    price: value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }),
    symbol,
  };
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
  if (!imageUrl) {
    throw new Error("No image URL available");
  }

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

  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000,
    }
  );
}

async function handleSale(slug, event) {
  const config = COLLECTIONS[slug];
  if (!config) return;

  const payload = getPayload(event);
  const { contract, tokenId } = getTokenInfo(payload);
  const imageUrl = getImageUrl(payload);
  const { price, symbol } = getPrice(payload);

  const nftUrl = `https://opensea.io/item/polygon/${contract}/${tokenId}`;

  const caption = `${config.headline}

<b>${config.tokenLabel} #${tokenId}</b> just sold on OpenSea

💰 <b>Price:</b> ${price} ${symbol}

<a href="${nftUrl}">🔗 View NFT on OpenSea</a>`;

  try {
    await sendPhoto(imageUrl, caption);
    console.log(`Posted photo sale: ${config.name} #${tokenId} for ${price} ${symbol}`);
  } catch (photoErr) {
    console.error("Photo failed, sending text instead:", photoErr.response?.data || photoErr.message);
    await sendText(caption);
    console.log(`Posted text sale: ${config.name} #${tokenId} for ${price} ${symbol}`);
  }
}

const client = new OpenSeaStreamClient({
  token: process.env.OPENSEA_API_KEY,
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
      console.error("Error posting sale:", err.response?.data || err.message);
    }
  });
});
