// ═══════════════════════════════════════════════════════════════════════
// Order Flow API v4
//
// Sol: Net GEX per strike — get_book_summary_by_currency (OI + gamma)
// Sağ: Son İşlemler Buy↑/Sell↓ — get_last_trades_by_currency
//      direction: "buy"/"sell" gerçek veri, strike bazında gruplu
//      Blocked: amount >= blockThreshold (BTC:10, ETH:100)
//
// GEX formülü (gex.js ile birebir):
//   Gamma = N'(d1) / (S × σ × √T)
//   GEX   = Gamma × OI × S² × 0.01 × sign
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

// Black-Scholes Gamma
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function bsGamma(S,K,T,sigma){
  if(T<=0||sigma<=0||S<=0||K<=0) return 0;
  const sqrtT=Math.sqrt(T);
  const d1=(Math.log(S/K)+0.5*sigma*sigma*T)/(sigma*sqrtT);
  return normPDF(d1)/(S*sigma*sqrtT);
}

// Expiry parse: "28MAR25" → UTC ms
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

  // Büyük lot eşiği (kontrat adedi)
  const blockThreshold = cur==="BTC" ? 10 : 100;

  try {
    // Paralel: spot + book summary + son işlemler
    const [spotRes, summary, tradesRes] = await Promise.all([
      deribit("get_index_price", { index_name:`${cur.toLowerCase()}_usd` }),
      deribit("get_book_summary_by_currency", { currency:cur, kind:"option" }),
      deribit("get_last_trades_by_currency", {
        currency:   cur,
        kind:       "option",
        count:      1000,       // max 1000
        sorting:    "desc",
      }),
    ]);

    const spot = parseFloat(spotRes?.index_price||0);
    if(!spot)        return res.status(503).json({error:"Spot alınamadı"});
    if(!summary?.length) return res.status(503).json({error:"Book summary alınamadı"});

    const trades = tradesRes?.trades || [];
    console.log(`[orderflow] ${cur} spot=${spot} instruments=${summary.length} trades=${trades.length}`);

    const now = Date.now();
    const lo  = spot*0.55, hi = spot*1.35;
    const byStrike = {};

    // ── Sol grafik: GEX (book_summary'den) ──────────────────────
    for(const inst of summary){
      const p = parseInst(inst.instrument_name);
      if(!p) continue;
      const {strike,tip,expStr} = p;
      if(strike<lo||strike>hi) continue;

      const oi     = parseFloat(inst.open_interest||0);
      const markIV = parseFloat(inst.mark_iv||50)/100;
      const expTs  = parseExpiry(expStr);
      const T      = expTs ? Math.max((expTs-now)/(365.25*24*3600*1000),0.00001) : 0.01;
      const gamma  = bsGamma(spot,strike,T,Math.max(markIV,0.05));
      const sign   = tip==="call"?1:-1;
      const gammaUnit = gamma*oi*sign;

      if(!byStrike[strike]) byStrike[strike]={
        strike,
        callGamma:0, putGamma:0, net:0,
        callOI:0,    putOI:0,
        callsBuy:0,  putsBuy:0,  callBuyBlocked:0,  putBuyBlocked:0,
        callsSell:0, putsSell:0, callSellBlocked:0, putSellBlocked:0,
      };
      const b = byStrike[strike];
      if(tip==="call"){ b.callGamma+=gammaUnit; b.callOI+=oi; }
      else             { b.putGamma +=gammaUnit; b.putOI +=oi; }
      b.net = b.callGamma + b.putGamma;
    }

    // ── Sağ grafik: Son işlemler (gerçek direction) ───────────────
    for(const t of trades){
      const p = parseInst(t.instrument_name);
      if(!p) continue;
      const {strike, tip} = p;
      if(strike<lo||strike>hi) continue;

      // amount = kontrat adedi (BTC için 1 kontrat = 1 BTC)
      const amount    = parseFloat(t.amount||0);
      const isBuy     = t.direction==="buy";
      const isBlocked = amount >= blockThreshold;

      if(!byStrike[strike]) byStrike[strike]={
        strike,
        callGamma:0, putGamma:0, net:0,
        callOI:0,    putOI:0,
        callsBuy:0,  putsBuy:0,  callBuyBlocked:0,  putBuyBlocked:0,
        callsSell:0, putsSell:0, callSellBlocked:0, putSellBlocked:0,
      };
      const b = byStrike[strike];

      if(tip==="call"){
        if(isBuy){
          if(isBlocked) b.callBuyBlocked  += amount;
          else          b.callsBuy         += amount;
        } else {
          if(isBlocked) b.callSellBlocked  += amount;
          else          b.callsSell         += amount;
        }
      } else {
        if(isBuy){
          if(isBlocked) b.putBuyBlocked   += amount;
          else          b.putsBuy          += amount;
        } else {
          if(isBlocked) b.putSellBlocked   += amount;
          else          b.putsSell          += amount;
        }
      }
    }

    const strikes = Object.values(byStrike).sort((a,b)=>a.strike-b.strike);
    if(!strikes.length)
      return res.status(200).json({currency:cur,spot,gammaUnits:[],flowByStrike:[],tradeCount:0});

    // GEX normalize
    const maxG = Math.max(...strikes.map(s=>Math.max(Math.abs(s.callGamma),Math.abs(s.putGamma))),1e-9);
    const gammaUnits = strikes.map(s=>({
      strike:    s.strike,
      callGamma: s.callGamma/maxG,
      putGamma:  s.putGamma/maxG,
      net:       s.net/maxG,
      callOI:    +s.callOI.toFixed(1),
      putOI:     +s.putOI.toFixed(1),
    }));

    // flowByStrike — sadece işlem olan strikeler
    const f2 = n => +n.toFixed(2);
    const flowByStrike = strikes
      .filter(s =>
        s.callsBuy+s.putsBuy+s.callsSell+s.putsSell+
        s.callBuyBlocked+s.putBuyBlocked+s.callSellBlocked+s.putSellBlocked > 0
      )
      .map(s=>({
        strike:           s.strike,
        callsBuy:         f2(s.callsBuy),
        putsBuy:          f2(s.putsBuy),
        callBuyBlocked:   f2(s.callBuyBlocked),
        putBuyBlocked:    f2(s.putBuyBlocked),
        callsSell:        f2(s.callsSell),
        putsSell:         f2(s.putsSell),
        callSellBlocked:  f2(s.callSellBlocked),
        putSellBlocked:   f2(s.putSellBlocked),
      }));

    res.setHeader("Cache-Control","s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({
      currency:   cur,
      spot,
      instruments: summary.length,
      tradeCount:  trades.length,
      gammaUnits,
      flowByStrike,
    });

  } catch(e){
    console.error("[orderflow]",e);
    res.status(500).json({error:e.message});
  }
}
