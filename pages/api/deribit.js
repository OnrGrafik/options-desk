export default async function handler(req, res) {
  const { method, params } = req.query;
  if (!method) return res.status(400).json({ error: "method gerekli" });
  try {
    const url = `https://www.deribit.com/api/v2/public/${method}?${params || ""}`;
    const r = await fetch(url);
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
