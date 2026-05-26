// ═══════════════════════════════════════════════════════════════════════
// Order Flow API v3
// Tek kaynak: get_book_summary_by_currency (1 API çağrısı)
//
// Sol: Net GEX per strike (canlı opsiyonlar)
// Sağ: 24h Buy/Sell Volume per strike (VolumeProfile formatı)
//
// VolumeProfile veri formatı (tasarım dosyasıyla birebir):
//   callsBuy, putsBuy, callBuyBlocked, putBuyBlocked   → yukarı
//   callsSell, putsSell, callSellBlocked, putSellBlocked → aşağı
//
// Buy/Sell tahmini:
//   Deribit'te direction yok → mark/bid/ask spread kullanılır:
//   buyRatio = (mark - bid) / (ask - bid) → 0.15-0.85 arası
//   Blocked: volume içindeki büyük lot tahmini (sabit %15)
//
// GEX formülü (gex.js ile birebir):
//   Gamma = N'(d1) / (S × σ × √T)
//   GEX   = Gamma × OI × S² × 0.01 × sign
//   gammaUnit = GEX / (S² × 0.01) = Gamma × OI × sign
// ═══════════════════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "OpsiyonMasasi/1.0" };
const TO  = 20000;

async function deribit(method, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `https://www.deribit.com/api/v2/public/${method}${qs?"?"+qs:""}`;
  try {
    const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(TO) });
    if (!r.ok) { console.error(`Deribit ${method} → ${r.status}`); return null; }
    const d = await r.json();
    if (d.error) { console.error(`Deribit ${method}:`, d.error); return null; }
    return d.result;
  } catch(e) { console.error(`Deribit ${method}:`, e.message); return null; }
}

// Black-Scholes Gamma (gex.js ile birebir)
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function bsGamma(S,K,T,sigma){
  if(T<=0||sigma<=0||S<=0||K<=0) return 0;
  const sqrtT=Math.sqrt(T);
  const d1=(Math.log(S/K)+0.5*sigma*sigma*T)/(sigma*sqrtT);
  return normPDF(d1)/(S*sigma*sqrtT);
}

// Expiry parse: "28MAR25" → UTC timestamp
const MON={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
function parseExpiry(s){
  if(!s||s.length<7) return null;
  const d=parseInt(s.slice(0,2)), m=MON[s.slice(2,5)], y=2000+parseInt(s.slice(5,7));
  if(isNaN(d)||m===undefined||isNaN(y)) return null;
  return Date.UTC(y,m,d,8,0,0);
}

// Instrument parse: "BTC-28MAR25-100000-C"
function parseInst(name){
  const p=name.split("-");
  if(p.length<4) return null;
  const strike=parseFloat(p[2]);
  if(!strike||isNaN(strike)) return null;
  return { strike, tip: p[p.length-1]==="C"?"call":"put", expStr: p[1] };
}

export default async function handler(req,res){
  const {currency="BTC"} = req.query;
  const cur = currency.toUpperCase();
  if(!["BTC","ETH"].includes(cur))
    return res.status(400).json({error:"currency must be BTC or ETH"});

  try {
    // 1. Spot + book summary paralel
    const [spotRes, summary] = await Promise.all([
      deribit("get_index_price",{index_name:`${cur.toLowerCase()}_usd`}),
      deribit("get_book_summary_by_currency",{currency:cur,kind:"option"}),
    ]);

    const spot = parseFloat(spotRes?.index_price||0);
    if(!spot) return res.status(503).json({error:"Spot alınamadı"});
    if(!summary?.length) return res.status(503).json({error:"Book summary alınamadı"});

    console.log(`[orderflow] ${cur} spot=${spot} instruments=${summary.length}`);

    const now = Date.now();
    const lo  = spot*0.55, hi = spot*1.35;
    const byStrike = {};

    for(const inst of summary){
      const p = parseInst(inst.instrument_name);
      if(!p) continue;
      const {strike,tip,expStr} = p;
      if(strike<lo||strike>hi) continue;

      const oi     = parseFloat(inst.open_interest||0);
      const markIV = parseFloat(inst.mark_iv||50)/100;
      const vol24h = parseFloat(inst.volume_24h||0);
      const bid    = parseFloat(inst.best_bid_price||0);
      const ask    = parseFloat(inst.best_ask_price||0);
      const mark   = parseFloat(inst.mark_price||0);

      // Vade süresi
      const expTs = parseExpiry(expStr);
      const T = expTs ? Math.max((expTs-now)/(365.25*24*3600*1000),0.00001) : 0.01;

      // GEX
      const gamma     = bsGamma(spot,strike,T,Math.max(markIV,0.05));
      const sign      = tip==="call"?1:-1;
      const gammaUnit = gamma*oi*sign;

      // 24h hacim — buy/sell tahmini
      let buyRatio = 0.5;
      if(bid>0&&ask>0&&ask>bid)
        buyRatio = Math.max(0.15,Math.min(0.85,(mark-bid)/(ask-bid)));

      const totalVol  = vol24h;
      // "Blocked" = kurumsal büyük lot tahmini ~%15
      const blockPct  = 0.15;
      const normalPct = 1 - blockPct;

      const buyNorm   = totalVol * buyRatio   * normalPct;
      const buyBlock  = totalVol * buyRatio   * blockPct;
      const sellNorm  = totalVol * (1-buyRatio) * normalPct;
      const sellBlock = totalVol * (1-buyRatio) * blockPct;

      if(!byStrike[strike]) byStrike[strike]={
        strike,
        callGamma:0,putGamma:0,net:0,
        callOI:0,putOI:0,
        // VolumeProfile formatı
        callsBuy:0,putsBuy:0,callBuyBlocked:0,putBuyBlocked:0,
        callsSell:0,putsSell:0,callSellBlocked:0,putSellBlocked:0,
      };
      const b=byStrike[strike];

      if(tip==="call"){
        b.callGamma+=gammaUnit; b.callOI+=oi;
        b.callsBuy+=buyNorm;   b.callBuyBlocked+=buyBlock;
        b.callsSell+=sellNorm; b.callSellBlocked+=sellBlock;
      } else {
        b.putGamma+=gammaUnit; b.putOI+=oi;
        b.putsBuy+=buyNorm;   b.putBuyBlocked+=buyBlock;
        b.putsSell+=sellNorm; b.putSellBlocked+=sellBlock;
      }
      b.net=b.callGamma+b.putGamma;
    }

    const strikes=Object.values(byStrike).sort((a,b)=>a.strike-b.strike);
    if(!strikes.length) return res.status(200).json({currency:cur,spot,gammaUnits:[],flowByStrike:[]});

    // GEX normalize
    const maxG=Math.max(...strikes.map(s=>Math.max(Math.abs(s.callGamma),Math.abs(s.putGamma))),1e-9);
    const gammaUnits=strikes.map(s=>({
      strike:s.strike,
      callGamma:s.callGamma/maxG, putGamma:s.putGamma/maxG, net:s.net/maxG,
      callOI:+s.callOI.toFixed(1), putOI:+s.putOI.toFixed(1),
    }));

    // VolumeProfile formatı — 1 desimale yuvarla
    const f2=(n)=>+n.toFixed(1);
    const flowByStrike=strikes
      .filter(s=>s.callsBuy+s.putsBuy+s.callsSell+s.putsSell>0.01)
      .map(s=>({
        strike:s.strike,
        callsBuy:        f2(s.callsBuy),
        putsBuy:         f2(s.putsBuy),
        callBuyBlocked:  f2(s.callBuyBlocked),
        putBuyBlocked:   f2(s.putBuyBlocked),
        callsSell:       f2(s.callsSell),
        putsSell:        f2(s.putsSell),
        callSellBlocked: f2(s.callSellBlocked),
        putSellBlocked:  f2(s.putSellBlocked),
      }));

    res.setHeader("Cache-Control","s-maxage=120, stale-while-revalidate=240");
    res.status(200).json({
      currency:cur, spot, instruments:summary.length,
      gammaUnits, flowByStrike,
    });

  } catch(e){
    console.error("[orderflow]",e);
    res.status(500).json({error:e.message});
  }
}
