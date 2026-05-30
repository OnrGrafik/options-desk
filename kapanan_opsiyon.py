"""
Kapanan Opsiyon Alarm - FINAL v3
v2 -> v3:
  1. /tmp -> /var/data
  2. bot._run_async -> direkt requests.post
  3. Max Pain: doğru iteratif formül (v2'deki fix korundu)
"""

import os, json, time, math, threading, requests, pytz
from datetime import datetime, timezone

KANAL_ID  = -1003896040852
THREAD_ID = 2

BTC_MIN_KAPANIS = 1000
ETH_MIN_KAPANIS = 5000
BUYUK_SESSIZ    = 30 * 60
VADE_SESSIZ     = 6  * 3600

TR_TZ       = pytz.timezone("Europe/Istanbul")
STORAGE_DIR = "/var/data" if os.path.isdir("/var/data") else "/tmp"
DURUM_DOSYA = f"{STORAGE_DIR}/kapanan_durum.json"

_dosya_lock    = threading.RLock()
_ram_lock      = threading.Lock()
_ram_bellek: dict = {}


def _dosya_oku() -> dict:
    with _dosya_lock:
        try:
            with open(DURUM_DOSYA, "r") as f:
                return json.load(f)
        except Exception:
            return {}


def _dosya_yaz(data: dict):
    with _dosya_lock:
        try:
            simdi = time.time()
            temiz = {k: v for k, v in data.items() if simdi - v < 12*3600}
            with open(DURUM_DOSYA, "w") as f:
                json.dump(temiz, f)
        except Exception as e:
            print(f"[KapananOpsiyon] Dosya yazma: {e}")


def _gonderildi_mi(anahtar: str, sure: float) -> bool:
    simdi = time.time()
    with _ram_lock:
        son = _ram_bellek.get(anahtar, 0)
        if simdi - son < sure:
            return True
    data = _dosya_oku()
    son  = data.get(anahtar, 0)
    if simdi - son < sure:
        with _ram_lock:
            _ram_bellek[anahtar] = son
        return True
    return False


def _kaydet(anahtar: str):
    simdi = time.time()
    with _ram_lock:
        _ram_bellek[anahtar] = simdi
    data = _dosya_oku()
    data[anahtar] = simdi
    _dosya_yaz(data)


def _kaydet_ve_gonder(anahtar: str, mesaj: str):
    _kaydet(anahtar)
    _gonder(mesaj)


def _gonder(mesaj: str):
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{os.getenv('BOT_TOKEN')}/sendMessage",
            json={
                "chat_id": KANAL_ID,
                "text": mesaj,
                "parse_mode": "HTML",
                "message_thread_id": THREAD_ID,
                "disable_web_page_preview": True,
            }, timeout=15
        )
        if not r.ok:
            print(f"[KapananOpsiyon] TG hata [{r.status_code}]: {r.json().get('description','')}")
        else:
            print("[KapananOpsiyon] ✓ Telegram gönderildi")
    except Exception as e:
        print(f"[KapananOpsiyon] Gönderim hatası: {e}")


DERIBIT = "https://www.deribit.com/api/v2/public"

def _deribit(method, params=None):
    try:
        r = requests.get(f"{DERIBIT}/{method}", params=params or {}, timeout=12)
        r.raise_for_status()
        return r.json().get("result")
    except Exception as e:
        print(f"[KapananOpsiyon] Deribit/{method}: {e}")
        return None


def _spot(currency):
    idx = "btc_usd" if currency == "BTC" else "eth_usd"
    d   = _deribit("get_index_price", {"index_name": idx})
    return float(d.get("index_price", 0)) if d else 0.0


def _hesapla_max_pain(ticker_cache: dict) -> float:
    """
    Doğru Max Pain: argmin_K [ Σ_{K_i<K}(K-K_i)×callOI + Σ_{K_j>K}(K_j-K)×putOI ]
    """
    strike_oi: dict = {}
    for inst_data in ticker_cache.values():
        k   = inst_data["strike"]
        oi  = inst_data["oi"]
        tip = inst_data["tip"]
        if k not in strike_oi:
            strike_oi[k] = {"call": 0.0, "put": 0.0}
        if tip == "call":
            strike_oi[k]["call"] += oi
        else:
            strike_oi[k]["put"]  += oi

    if not strike_oi:
        return 0.0

    min_pain        = float("inf")
    max_pain_strike = 0.0

    for k_cand in strike_oi:
        pain = 0.0
        for k_opt, oi_data in strike_oi.items():
            if k_opt < k_cand:   # ITM call
                pain += (k_cand - k_opt) * oi_data["call"]
            if k_opt > k_cand:   # ITM put
                pain += (k_opt - k_cand) * oi_data["put"]
        if pain < min_pain:
            min_pain        = pain
            max_pain_strike = k_cand

    return max_pain_strike


def _vade_ozeti_hesapla(currency):
    enstrumanlar = _deribit("get_instruments", {"currency": currency, "kind": "option", "expired": "true"})
    if not enstrumanlar:
        return None

    now_ms   = int(time.time()*1000)
    gun_ms   = 24*3600*1000
    bugun_08 = int((now_ms//gun_ms)*gun_ms) + 8*3600*1000
    bugun_09 = bugun_08 + 3600*1000

    bugun_kapananlar = [i for i in enstrumanlar
                        if bugun_08 <= i.get("expiration_timestamp", 0) < bugun_09]
    if not bugun_kapananlar:
        return None

    bugun_str = datetime.utcnow().strftime("%Y-%m-%d")
    delivery  = _deribit("get_delivery_prices", {"index_name": f"{currency.lower()}_usd", "date": bugun_str})
    settlement = float(delivery["data"][0]["delivery_price"]) if delivery and delivery.get("data") else 0.0

    call_oi = itm_call = 0
    put_oi  = itm_put  = 0
    ticker_cache = {}

    for inst in bugun_kapananlar[:40]:
        t = _deribit("ticker", {"instrument_name": inst["instrument_name"]})
        if not t:
            time.sleep(0.05); continue
        oi  = float(t.get("open_interest", 0))
        tip = inst.get("option_type", "")
        k   = inst.get("strike", 0)
        ticker_cache[inst["instrument_name"]] = {"oi": oi, "strike": k, "tip": tip}
        if tip == "call":
            call_oi += oi
            if settlement > k:
                itm_call += oi
        else:
            put_oi += oi
            if settlement < k:
                itm_put += oi
        time.sleep(0.05)

    toplam_oi       = call_oi + put_oi
    pc_ratio        = put_oi/call_oi if call_oi > 0 else 0
    max_pain_strike = _hesapla_max_pain(ticker_cache)

    return {
        "currency": currency, "settlement": settlement,
        "toplam_oi": toplam_oi, "call_oi": call_oi, "put_oi": put_oi,
        "itm_call": itm_call, "itm_put": itm_put,
        "pc_ratio": pc_ratio, "max_pain": max_pain_strike,
        "kontrat": len(bugun_kapananlar),
    }


def _vade_mesaji(btc_ozet, eth_ozet, zaman):
    def blok(oz):
        if not oz:
            return "Veri alınamadı"
        return (
            f"Settlement: <b>${oz['settlement']:,.0f}</b>\n"
            f"Toplam OI: <b>{oz['toplam_oi']:,.0f} {oz['currency']}</b>\n"
            f"Call OI: {oz['call_oi']:,.0f} | Put OI: {oz['put_oi']:,.0f}\n"
            f"ITM Call: {oz['itm_call']:,.0f} | ITM Put: {oz['itm_put']:,.0f}\n"
            f"P/C Oranı: <b>{oz['pc_ratio']:.2f}</b> "
            f"({'Put bias 📕' if oz['pc_ratio']>1 else 'Call bias 📗'})\n"
            f"Max Pain: <b>${oz['max_pain']:,.0f}</b>\n"
            f"Kontrat: {oz['kontrat']} adet"
        )
    return (
        f"📅 <b>HAFTALIK VADE SONU ÖZETİ</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n{zaman}\n\n"
        f"₿ <b>BTC Opsiyonları:</b>\n{blok(btc_ozet)}\n\n"
        f"Ξ <b>ETH Opsiyonları:</b>\n{blok(eth_ozet)}\n\n"
        f"<i>Opsiyon Masası · Cuma vade sonu raporu</i>"
    )


def _buyuk_kapanislari_kontrol_et(currency, min_miktar, spot):
    islemler = _deribit("get_last_trades_by_currency", {
        "currency": currency, "kind": "option",
        "count": 50, "include_old": "false",
    })
    if not islemler or not islemler.get("trades"):
        return

    slot = int(time.time())//BUYUK_SESSIZ

    for t in islemler["trades"]:
        miktar = float(t.get("amount", 0))
        if miktar < min_miktar:
            continue

        inst     = t.get("instrument_name", "")
        fiyat    = float(t.get("price", 0))
        iv       = float(t.get("iv", 0))
        yon      = t.get("direction", "")
        idx_f    = float(t.get("index_price", 0))

        parcalar = inst.split("-")
        strike   = float(parcalar[2]) if len(parcalar) >= 3 else 0
        tip      = "CALL" if inst.endswith("-C") else "PUT"
        uzak_pct = ((strike-spot)/spot*100) if spot else 0

        anahtar = f"buyuk_{currency}_{slot}_{inst}"
        if _gonderildi_mi(anahtar, BUYUK_SESSIZ):
            continue

        yon_emoji = "🟢 ALIM" if yon == "buy" else "🔴 SATIM"
        tip_emoji = "📗" if tip == "CALL" else "📕"

        mesaj = (
            f"💥 <b>BÜYÜK OPSİYON KAPANIŞI — {currency}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"{tip_emoji} {tip} | Strike: <b>${strike:,.0f}</b> ({uzak_pct:+.1f}%)\n"
            f"Miktar: <b>{miktar:,.0f} {currency}</b>\n"
            f"Yön: {yon_emoji}\n"
            f"İşlem Fiyatı: {fiyat:.4f}\n"
            f"IV: {iv:.1f}%\n"
            f"Index Fiyat: <b>${idx_f:,.0f}</b>\n"
            f"Kontrat: <code>{inst}</code>\n\n"
            f"<i>{datetime.utcnow().strftime('%H:%M UTC')}</i>"
        )
        _kaydet_ve_gonder(anahtar, mesaj)
        time.sleep(0.5)


def _baslangic_yukle():
    data  = _dosya_oku()
    simdi = time.time()
    aktif = 0
    with _ram_lock:
        for k, v in data.items():
            if simdi - v < 12*3600:
                _ram_bellek[k] = v
                aktif += 1
    print(f"[KapananOpsiyon] {aktif} aktif susturma yüklendi" if aktif
          else "[KapananOpsiyon] Hafıza temiz")


def _cuma_vade_vakti() -> bool:
    now = datetime.now(timezone.utc)
    return now.weekday() == 4 and now.hour == 8 and 10 <= now.minute <= 30


def kapanan_opsiyon_loop():
    print(f"[KapananOpsiyon] ═══ Başlatıldı ═══ Storage: {STORAGE_DIR}")
    print(f"[KapananOpsiyon] BTC: {BTC_MIN_KAPANIS} | ETH: {ETH_MIN_KAPANIS}")
    _baslangic_yukle()

    ARALIK        = 15 * 60
    dongu         = 0
    son_vade_ozeti = 0.0

    while True:
        try:
            dongu += 1
            zaman  = datetime.utcnow().strftime("%d.%m.%Y %H:%M UTC")
            print(f"\n[KapananOpsiyon] ── Döngü #{dongu} | {zaman} ──")

            btc_spot = _spot("BTC")
            eth_spot = _spot("ETH")

            if btc_spot:
                _buyuk_kapanislari_kontrol_et("BTC", BTC_MIN_KAPANIS, btc_spot)
            if eth_spot:
                _buyuk_kapanislari_kontrol_et("ETH", ETH_MIN_KAPANIS, eth_spot)

            if _cuma_vade_vakti() and (time.time()-son_vade_ozeti) > VADE_SESSIZ:
                anahtar_vade = f"vade_ozet_{datetime.utcnow().strftime('%Y%m%d')}"
                if not _gonderildi_mi(anahtar_vade, VADE_SESSIZ):
                    print("[KapananOpsiyon] Vade sonu özeti hazırlanıyor...")
                    btc_oz = _vade_ozeti_hesapla("BTC")
                    eth_oz = _vade_ozeti_hesapla("ETH")
                    if btc_oz or eth_oz:
                        mesaj = _vade_mesaji(btc_oz, eth_oz, zaman)
                        _kaydet_ve_gonder(anahtar_vade, mesaj)
                        son_vade_ozeti = time.time()

        except Exception as e:
            print(f"[KapananOpsiyon] Genel hata: {e}")

        time.sleep(ARALIK)
