'use strict';

/**
 * price.js — جلب سعر USDT/EGP من Binance P2P
 *
 * يستخدم Binance P2P API (public endpoint, لا يحتاج API key)
 * يجلب متوسط أفضل 5 أسعار شراء USDT مقابل EGP
 * بدون فلتر طريقة دفع (EXPRESS مش متاح في مصر حالياً)
 * مع cache لمدة 5 دقائق لتقليل الطلبات
 */

const https = require('https');

// ─────────────────────────────────────────────
//  Cache
// ─────────────────────────────────────────────
let _cache = { rate: null, fetchedAt: 0 };
const CACHE_TTL_MS  = 5 * 60 * 1000;   // 5 دقائق
const FALLBACK_RATE = 51;               // سعر احتياطي لو فشل الطلب

// ─────────────────────────────────────────────
//  Binance P2P API
// ─────────────────────────────────────────────

function fetchFromBinance() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      fiat:                       'EGP',
      page:                       1,
      rows:                       5,
      tradeType:                  'BUY',   // سعر شراء USDT بالـ EGP
      asset:                      'USDT',
      countries:                  [],
      proMerchantAds:             false,
      shieldMerchantAds:          false,
      filterType:                 'all',
      periods:                    [],
      additionalKycVerifyFilter:  0,
      publisherType:              null,
      payTypes:                   [],      // كل طرق الدفع (EXPRESS غير متاح في مصر)
      classifies:                 ['mass', 'profession'],
    });

    const options = {
      hostname: 'p2p.binance.com',
      path:     '/bapi/c2c/v2/friendly/c2c/adv/search',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'Mozilla/5.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json   = JSON.parse(data);
          const ads    = json?.data;
          if (!ads || ads.length === 0) return reject(new Error('No P2P ads found'));
          const prices = ads.map(ad => parseFloat(ad.adv?.price || 0)).filter(p => p > 0);
          if (prices.length === 0) return reject(new Error('No valid prices'));
          // متوسط أفضل الأسعار (أكثر دقة من MAX وحده)
          const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
          resolve(Math.round(avg * 100) / 100);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

/**
 * يرجع سعر 1 USDT بالـ EGP
 * مع cache لمدة 5 دقائق
 * @returns {Promise<number>}
 */
async function getUsdtEgpRate() {
  const now = Date.now();
  if (_cache.rate && (now - _cache.fetchedAt) < CACHE_TTL_MS) {
    return _cache.rate;
  }
  try {
    const rate = await fetchFromBinance();
    _cache = { rate, fetchedAt: now };
    console.log(`[Price] USDT/EGP = ${rate} (fetched from Binance P2P)`);
    return rate;
  } catch (err) {
    console.warn(`[Price] Failed to fetch rate: ${err.message}. Using cached/fallback.`);
    return _cache.rate || FALLBACK_RATE;
  }
}

// ── جلب تلقائي كل 5 دقائق في الخلفية ──────
function startAutoRefresh() {
  const refresh = async () => {
    try {
      const rate = await fetchFromBinance();
      _cache = { rate, fetchedAt: Date.now() };
      console.log(`[Price] Auto-refresh: USDT/EGP = ${rate}`);
    } catch (err) {
      console.warn(`[Price] Auto-refresh failed: ${err.message}`);
    }
  };
  // أول جلب فوري
  refresh();
  // ثم كل 5 دقائق
  setInterval(refresh, CACHE_TTL_MS);
}

/**
 * يحوّل مبلغ EGP → USDT
 * @param {number} egp
 * @returns {Promise<{usdt: number, rate: number}>}
 */
async function egpToUsdt(egp) {
  const rate = await getUsdtEgpRate();
  return { usdt: Math.round((egp / rate) * 10000) / 10000, rate };
}

/**
 * يحوّل مبلغ USDT → EGP
 * @param {number} usdt
 * @returns {Promise<{egp: number, rate: number}>}
 */
async function usdtToEgp(usdt) {
  const rate = await getUsdtEgpRate();
  return { egp: Math.round(usdt * rate * 100) / 100, rate };
}

/**
 * يعرض المبلغ بالعملتين
 * @param {number} amountEgp   المبلغ الأصلي بالـ EGP
 * @param {string} currency    'egp' | 'usdt'
 */
async function formatAmount(amountEgp, currency = 'egp') {
  if (currency === 'usdt') {
    const { usdt, rate } = await egpToUsdt(amountEgp);
    return { display: usdt, symbol: 'USDT', rate, raw: amountEgp };
  }
  return { display: amountEgp, symbol: 'EGP', rate: 1, raw: amountEgp };
}

/**
 * آخر سعر محفوظ (بدون fetch)
 */
function getCachedRate() {
  return _cache.rate || FALLBACK_RATE;
}

module.exports = { getUsdtEgpRate, egpToUsdt, usdtToEgp, formatAmount, getCachedRate, startAutoRefresh };
