export default async function handler(req, res) {
  const { method, params } = req.query;
  
  if (!method) {
    return res.status(400).json({ error: "method parametresi gerekli" });
  }

  try {
    const url = `https://www.deribit.com/api/v2/public/${method}?${params || ""}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
